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

  it('API 환산 비용은 실측 기반 시간당 토큰으로 계산한다', () => {
    // 하루 5.5시간 에이전트 = 입력 27.5M/일 → Opus 5.5 월 약 $364
    const a = run({ hours: 5.5, modeId: 'agent' });
    expect(a.api.usd).toBeGreaterThan(350);
    expect(a.api.usd).toBeLessThan(380);
  });
});
