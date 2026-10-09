import { describe, expect, it } from 'vitest';
import { advise, type AdvisorInput } from './advisor';
import { advisor, prices } from './data';

const base: AdvisorInput = {
  toolId: 'claude-code',
  hours: 4,
  modeId: 'pair',
  currentPlanId: 'none',
  frequency: 'sometimes',
  workDays: 22,
  fxRate: 1400,
  vat: false,
};
const run = (patch: Partial<AdvisorInput>) => advise({ ...base, ...patch }, advisor, prices.models, prices.plans);

describe('advise', () => {
  it('운영자 사례: Max 5x로 하루 5시간 에이전트 작업, 한도에 자주 걸림 → Max 20x', () => {
    const a = run({ hours: 5, modeId: 'agent', currentPlanId: 'claude-max-5x', frequency: 'often' });
    expect(a.recommended?.plan.id).toBe('claude-max-20x');
    expect(a.reason).toBe('upgrade');
    expect(a.fits.find((f) => f.isCurrent)!.status).toBe('tight');
  });

  it('요금제가 없으면 감당 가능한 가장 싼 요금제를 고른다', () => {
    const a = run({ hours: 4, modeId: 'pair' }); // 환산 2시간 → Pro(1.2h) 부족
    expect(a.loadHours).toBe(2);
    expect(a.recommended?.plan.id).toBe('claude-max-5x');
    expect(a.fits[0].status).toBe('short');
  });

  it('하루 8시간 에이전트 작업이면 Max 20x', () => {
    expect(run({ hours: 8, modeId: 'agent' }).recommended?.plan.id).toBe('claude-max-20x');
  });

  it('아주 가볍게 쓰면 API 종량제를 추천한다', () => {
    const a = run({ hours: 0.5, modeId: 'chat' });
    expect(a.recommended).toBeNull();
    expect(a.reason).toBe('api-cheaper');
    expect(a.api.krw).toBeLessThan(a.fits[0].krw);
  });

  it('한도에 거의 안 걸리고 아래 요금제로도 충분하면 다운그레이드를 권한다', () => {
    const a = run({ hours: 1, modeId: 'pair', currentPlanId: 'claude-max-5x', frequency: 'none' });
    expect(a.recommended?.plan.id).toBe('claude-pro');
    expect(a.reason).toBe('downgrade');
  });

  it('최상위 요금제에서 한도에 자주 걸리면 그대로 두고 알린다', () => {
    const a = run({ hours: 10, modeId: 'agent', currentPlanId: 'claude-max-20x', frequency: 'daily' });
    expect(a.reason).toBe('upgrade-top');
  });

  // 손계산: 에이전트 작업 1시간분 API 월 비용(Opus 5.5, 22일) = 캐시 읽기 102.3M×$0.2 + 캐시 쓰기 7.7M×$5 + 출력 0.352M×$20 = $66
  it('API가 조금만 싸면 구독을 추천한다 (같이 코딩 3시간: API ₩138,600 vs Max 5x ₩140,000, 1% 차이)', () => {
    const a = run({ hours: 3, modeId: 'pair' });
    expect(a.api.krw).toBeCloseTo(138_600, 0);
    expect(a.recommended?.plan.id).toBe('claude-max-5x');
    expect(a.reason).toBe('fits');
  });

  it('기준(20%) 미만 차이면 구독 (같이 코딩 2.5시간: API ₩115,500, Max 5x보다 17.5% 쌈)', () => {
    const a = run({ hours: 2.5, modeId: 'pair' });
    expect(a.api.krw).toBeCloseTo(115_500, 0);
    expect(a.recommended?.plan.id).toBe('claude-max-5x');
  });

  it('기준(20%) 이상 싸면 API (질문 위주 1시간: API ₩18,480 vs Pro ₩28,000, 34% 쌈)', () => {
    const a = run({ hours: 1, modeId: 'chat' });
    expect(a.api.krw).toBeCloseTo(18_480, 0);
    expect(a.reason).toBe('api-cheaper');
  });

  it('API는 한도 안 가장 싼 구독보다 기준(20%) 이상 쌀 때만 추천한다 (모든 도구·방식, 슬라이더 0.5시간 단위)', () => {
    const ratio = advisor.apiRecommendation.minSavingRatio;
    for (const toolId of advisor.tools.map((t) => t.id)) {
      for (const modeId of advisor.modes.map((m) => m.id)) {
        for (let hours = 0.5; hours <= 12; hours += 0.5) {
          const a = run({ toolId, hours, modeId, frequency: null });
          if (a.recommended) continue;
          const cheapest = a.fits.find((f) => f.status !== 'short')!;
          expect(a.api.krw, `${toolId} ${modeId} ${hours}시간`).toBeLessThanOrEqual(cheapest.krw * (1 - ratio));
        }
      }
    }
  });

  it('Claude Code(실측 기반)는 하루 시간을 늘려도 한 번 구독을 추천한 뒤 API로 되돌아가지 않는다', () => {
    for (const modeId of advisor.modes.map((m) => m.id)) {
      let subscribed = false;
      for (let hours = 0.5; hours <= 12; hours += 0.5) {
        const a = run({ hours, modeId, frequency: null });
        if (a.recommended) subscribed = true;
        else expect(subscribed, `${modeId} ${hours}시간`).toBe(false);
      }
    }
  });

  it('한도에 딱 맞는 사용량은 초과가 아니다 (질문 위주 6시간 = 환산 1.2시간 = Pro 한도)', () => {
    const a = run({ hours: 6, modeId: 'chat', frequency: null });
    expect(a.loadHours).toBe(1.2);
    expect(a.fits[0].status).not.toBe('short');
    expect(a.recommended?.plan.id).toBe('claude-pro');
  });

  it('한도 빈도를 고르지 않으면 지금 요금제도 계산값으로 판단한다', () => {
    // 하루 4시간 에이전트 = Max 5x 한도(6시간)의 67% → 여유, 유지
    const a = run({ hours: 4, modeId: 'agent', currentPlanId: 'claude-max-5x', frequency: null });
    const cur = a.fits.find((f) => f.isCurrent)!;
    expect(cur.status).toBe('ok');
    expect(a.recommended?.plan.id).toBe('claude-max-5x');
  });

  it('API 환산 비용은 실측 기반 시간당 토큰으로 계산한다', () => {
    // 하루 5.5시간 에이전트 = 입력 27.5M/일 → Opus 5.5 월 약 $364
    const a = run({ hours: 5.5, modeId: 'agent' });
    expect(a.api.usd).toBeGreaterThan(350);
    expect(a.api.usd).toBeLessThan(380);
  });
});
