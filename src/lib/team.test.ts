import { describe, expect, it } from 'vitest';
import { advisor, prices, team } from './data';
import { evaluateTeam, type TeamInput } from './team';

const base: TeamInput = {
  toolId: 'claude-code',
  groups: [
    { typeId: 'heavy', count: 2, hours: 7 },
    { typeId: 'normal', count: 8, hours: 3 },
  ],
  billing: 'annual',
  workDays: 22,
  fxRate: 1400,
  vat: false,
};
const run = (patch: Partial<TeamInput>) => evaluateTeam({ ...base, ...patch }, team, advisor, prices.models, prices.plans);
const opt = (r: ReturnType<typeof run>, id: string) => r.options.find((o) => o.option.id === id)!;

describe('evaluateTeam', () => {
  it('10명 예시: Claude Team 연간 = 프리미엄 2 + 기본 8 = 월 $360', () => {
    const r = run({});
    const t = opt(r, 'claude-team');
    expect(r.headcount).toBe(10);
    expect(t.lines.find((l) => l.typeId === 'heavy')!.choice).toBe('프리미엄 좌석');
    expect(t.lines.find((l) => l.typeId === 'normal')!.choice).toBe('기본 좌석');
    expect(t.monthlyKrw).toBeCloseTo(360 * 1400);
    expect(t.annualKrw).toBeCloseTo(360 * 1400 * 12);
    expect(r.recommended?.option.id).toBe('claude-team');
  });

  it('월간 결제면 Team 좌석 단가가 올라간다', () => {
    expect(opt(run({ billing: 'monthly' }), 'claude-team').monthlyKrw).toBeCloseTo((2 * 125 + 8 * 25) * 1400);
  });

  it('엔터프라이즈는 20명 미만이면 해당 없음', () => {
    const e = opt(run({}), 'claude-enterprise');
    expect(e.applicable).toBe(false);
    expect(e.notApplicableReason).toContain('20');
  });

  it('개인 구독 지원은 헤비 사용자에게 Max 20x를 배정한다', () => {
    const i = opt(run({}), 'claude-individual');
    expect(i.lines.find((l) => l.typeId === 'heavy')!.choice).toBe('Claude Max 20x');
    expect(i.monthlyKrw).toBeGreaterThan(opt(run({}), 'claude-team').monthlyKrw);
  });

  it('ChatGPT Business 좌석 한도를 넘는 사용량은 추가 비용으로 잡는다', () => {
    const groups = [
      { typeId: 'heavy', count: 2, hours: 7 },
      { typeId: 'normal', count: 8, hours: 2 }, // 환산 1시간 → Business 좌석(1.2시간) 안
    ];
    const b = opt(run({ toolId: 'codex', groups }), 'chatgpt-business');
    expect(b.hasOverage).toBe(true);
    expect(b.lines.find((l) => l.typeId === 'normal')!.unitKrw).toBe(28_900); // 공식 원화가, 한도 안
    expect(b.lines.find((l) => l.typeId === 'heavy')!.overageKrw).toBeGreaterThan(0);
  });

  it('API 종량제는 팀 비교 대상에서 빠져 있다', () => {
    for (const toolId of ['claude-code', 'codex', 'gemini']) {
      expect(run({ toolId }).options.some((o) => o.option.kind === 'api')).toBe(false);
    }
  });

  it('1명이면 최소 2명인 팀 좌석은 해당 없음', () => {
    const r = run({ groups: [{ typeId: 'normal', count: 1, hours: 3 }] });
    expect(opt(r, 'claude-team').applicable).toBe(false);
    expect(r.recommended?.option.kind).not.toBe('seats');
  });

  it('인원이 0이면 추천 없음', () => {
    expect(run({ groups: [] }).recommended).toBeNull();
  });
});
