import { describe, expect, it } from 'vitest';
import { planAgentHours } from './advisor';
import { advisor, parseTeam, prices, team } from './data';
import teamJson from '../data/team.json';

describe('데이터 검증', () => {
  it('팀 탭의 개인 구독 요금제는 모두 advisor.json에 한도가 있다', () => {
    for (const t of team.tools)
      for (const o of t.options)
        if (o.kind === 'individual') for (const p of o.plans) expect(planAgentHours(advisor, p.planId)).toBeGreaterThan(0);
  });

  it('한도가 없는 개인 요금제가 들어오면 빌드 단계에서 거부한다', () => {
    const bad = structuredClone(teamJson) as typeof teamJson;
    const opt = bad.tools[0].options.find((o) => o.kind === 'individual') as { plans: { planId: string }[] };
    opt.plans.push({ planId: 'chatgpt-plus-unknown' });
    expect(() => parseTeam(bad)).toThrow();
  });

  it('없는 기본 모델을 가리키면 거부한다', () => {
    const bad = structuredClone(teamJson);
    bad.tools[0].defaultModel = 'no-such-model';
    expect(() => parseTeam(bad)).toThrow();
  });

  it('종료·가격 변경 예정일은 날짜 형식이다', () => {
    const haiku = prices.models.find((m) => m.id === 'haiku-4-5')!;
    expect(haiku.retiresAt).toBe('2026-10-15');
    expect(prices.models.find((m) => m.id === 'gemini-3-8-flash')!.priceChangesAt).toBe('2027-01-01');
  });

  it('기본 모델로 쓰는 모델은 종료 예정이 아니다', () => {
    const defaults = new Set([...advisor.tools.map((t) => t.defaultModel), ...team.tools.map((t) => t.defaultModel)]);
    for (const id of defaults) expect(prices.models.find((m) => m.id === id)!.retiresAt).toBeUndefined();
  });
});
