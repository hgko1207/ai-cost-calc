import { describe, expect, it } from 'vitest';
import { advisor, prices, team } from './data';
import { krwShort } from './format';
import { compareAlternative, evaluateTeam, type TeamInput } from './team';
import { buildTeamSummary } from './teamSummary';

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

  it('엔터프라이즈는 월간 결제를 고르면 해당 없음 (연간 계약만)', () => {
    const groups = [{ typeId: 'normal', count: 25, hours: 2 }];
    expect(opt(run({ groups, billing: 'monthly' }), 'claude-enterprise').notApplicableReason).toBe('연간 계약만 가능');
    expect(opt(run({ groups, billing: 'annual' }), 'claude-enterprise').applicable).toBe(true);
  });

  it('엔터프라이즈는 20명 미만이면 해당 없음', () => {
    const e = opt(run({}), 'claude-enterprise');
    expect(e.applicable).toBe(false);
    expect(e.notApplicableReason).toContain('20');
  });

  it('개인 구독 지원: 하루 7시간이면 Max 5x + 초과분이 Max 20x보다 싸다', () => {
    const i = opt(run({}), 'claude-individual');
    const heavy = i.lines.find((l) => l.typeId === 'heavy')!;
    expect(heavy.choice).toBe('Claude Max 5x');
    expect(heavy.unitKrw).toBeLessThan(200 * 1400);
    // 하루 10시간이면 초과분이 커져 Max 20x가 낫다
    const i10 = opt(run({ groups: [{ typeId: 'heavy', count: 2, hours: 10 }] }), 'claude-individual');
    expect(i10.lines[0].choice).toBe('Claude Max 20x');
    expect(i.monthlyKrw).toBeGreaterThan(opt(run({}), 'claude-team').monthlyKrw);
  });

  it('ChatGPT Business 좌석 한도를 넘는 사용량은 추가 비용으로 잡는다', () => {
    const groups = [
      { typeId: 'heavy', count: 2, hours: 7 },
      { typeId: 'normal', count: 8, hours: 2 }, // 환산 1시간 → Business 좌석(1.2시간) 안
    ];
    const b = opt(run({ toolId: 'codex', groups, vat: true }), 'chatgpt-business');
    expect(b.hasOverage).toBe(true);
    // 가격 페이지가 달러로만 표시(2026-10-23) → Standard 연간 $20 × 1,400원 × 부가세 1.1, 한도 안
    expect(b.lines.find((l) => l.typeId === 'normal')!.unitKrw).toBeCloseTo(20 * 1400 * 1.1);
    const bNoVat = opt(run({ toolId: 'codex', groups, vat: false }), 'chatgpt-business');
    expect(bNoVat.lines.find((l) => l.typeId === 'normal')!.unitKrw).toBeCloseTo(20 * 1400);
    // 많이 쓰는 사람(환산 7시간)은 Premium 좌석(Standard의 5배 = 6시간) + 넘는 1시간 추가 비용
    const heavy = b.lines.find((l) => l.typeId === 'heavy')!;
    expect(heavy.choice).toBe('Premium 좌석');
    expect(heavy.overageKrw).toBeGreaterThan(0);
  });

  it('한도를 조금 넘으면 "기본 좌석 + 초과분"이 프리미엄보다 싸면 그쪽을 고른다', () => {
    const r = run({ billing: 'monthly', groups: [{ typeId: 'heavy', count: 2, hours: 2 }] }); // 환산 2시간, 기본 좌석 한도 1.5시간
    const line = opt(r, 'claude-team').lines[0];
    expect(line.choice).toBe('기본 좌석');
    expect(line.overageKrw).toBeGreaterThan(0);
    expect(line.unitKrw).toBeLessThan(125 * 1400); // 프리미엄(월간)보다 쌈
    expect(r.recommended?.option.id).toBe('claude-team');
  });

  it('API 종량제는 팀 비교 대상에서 빠져 있다', () => {
    for (const toolId of ['claude-code', 'codex', 'gemini']) {
      expect(run({ toolId }).options.some((o) => o.option.name.includes('API'))).toBe(false);
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

  describe('극단 입력', () => {
    it('모든 그룹이 0명이면 추천 없음, 모든 방식이 "인원을 입력하세요"', () => {
      const r = run({ groups: [{ typeId: 'heavy', count: 0, hours: 7 }, { typeId: 'normal', count: 0, hours: 2 }] });
      expect(r.headcount).toBe(0);
      expect(r.recommended).toBeNull();
      expect(r.options.every((o) => o.notApplicableReason === '인원을 입력하세요')).toBe(true);
    });

    it('Team 좌석 경계: 2명 OK, 150명 OK, 151명 해당 없음', () => {
      const g = (n: number) => [{ typeId: 'normal', count: n, hours: 2 }];
      expect(opt(run({ groups: g(2) }), 'claude-team').applicable).toBe(true);
      expect(opt(run({ groups: g(150) }), 'claude-team').applicable).toBe(true);
      expect(opt(run({ groups: g(151) }), 'claude-team').notApplicableReason).toBe('최대 150명까지');
    });

    it('Enterprise 경계: 19명 해당 없음, 20명 OK (연간)', () => {
      const g = (n: number) => [{ typeId: 'normal', count: n, hours: 2 }];
      expect(opt(run({ groups: g(19) }), 'claude-enterprise').applicable).toBe(false);
      expect(opt(run({ groups: g(20) }), 'claude-enterprise').applicable).toBe(true);
    });

    it('1만+1만 명: 금액이 유한하고 억 단위로 표시', () => {
      const groups = [{ typeId: 'heavy', count: 10_000, hours: 7 }, { typeId: 'normal', count: 10_000, hours: 2 }];
      const r = run({ groups });
      expect(opt(r, 'claude-team').applicable).toBe(false); // 150명 초과
      expect(opt(r, 'claude-enterprise').applicable).toBe(true);
      // Enterprise는 사용량을 API 요금으로 내므로 정액 개인 구독보다 비싸게 나온다
      expect(r.recommended?.option.id).toBe('claude-individual');
      expect(Number.isFinite(r.recommended!.annualKrw)).toBe(true);
      expect(krwShort(r.recommended!.annualKrw)).toContain('억');
      // 월간이면 Enterprise도 안 되므로 개인 구독 지원만 남는다
      expect(run({ groups, billing: 'monthly' }).recommended?.option.id).toBe('claude-individual');
    });

    it('Gemini(초과 시 대기)를 하루 16시간 쓰면 한도 초과로 표시되고 추가 비용은 붙지 않는다', () => {
      const r = run({ toolId: 'gemini', groups: [{ typeId: 'heavy', count: 3, hours: 16 }] });
      const std = opt(r, 'code-assist-standard');
      expect(std.lines[0].overageKrw).toBe(0);
      expect(r.recommended).not.toBeNull();
    });
  });

  describe('다른 선택지와 비교', () => {
    it('기본값(연간): Team 추천, 개인 구독 지원보다 싸다 (양수)', () => {
      const c = compareAlternative(run({}))!;
      expect(c.kind).toBe('vs-individual');
      expect(c.monthlyDiff).toBeGreaterThan(0);
      expect(c.annualDiff).toBeCloseTo(c.monthlyDiff * 12);
    });

    it('추천이 개인 구독이면 가장 싼 팀 요금제와 비교해 "얼마 더 드는지"를 보여 준다 (Codex)', () => {
      const r = run({ toolId: 'codex' });
      expect(r.recommended?.option.kind).toBe('individual');
      const c = compareAlternative(r)!;
      expect(c.kind).toBe('vs-team');
      expect(c.alt.option.id).toBe('chatgpt-business');
      expect(c.monthlyDiff).toBeGreaterThan(0);
    });

    it('Gemini처럼 개인 구독 방식이 없으면 null', () => {
      expect(compareAlternative(run({ toolId: 'gemini' }))).toBeNull();
    });

    it('1명이면 팀 좌석이 불가하므로 비교 대상 없음', () => {
      const r = run({ groups: [{ typeId: 'normal', count: 1, hours: 2 }] });
      expect(r.recommended?.option.kind).toBe('individual');
      expect(compareAlternative(r)).toBeNull();
    });
  });

  it('결재용 요약에 인원·추천·월/연 예산·출처 안내가 들어간다', () => {
    const r = run({ vat: true });
    const text = buildTeamSummary(r, {
      toolName: 'Claude Code',
      billing: 'annual',
      vat: true,
      fxRate: 1400,
      groups: [{ name: '많이 쓰는 사람', count: 2, hours: 7 }, { name: '일반 사용자', count: 8, hours: 2 }],
      checkedAt: '2026-10-06',
      url: 'https://example.com/?tab=team',
    });
    expect(text).toContain('총 10명');
    expect(text).toContain('Claude Team');
    expect(text).toContain('프리미엄 좌석 2명 + 기본 좌석 8명');
    expect(text).toMatch(/월 [\d,]+원 \/ 연 [\d,]+원/);
    expect(text).toContain('부가세 포함');
    expect(text).toContain('https://example.com/?tab=team');
  });

  describe('신규 구매 종료', () => {
    it('살 수 있는 방식이 있으면 판매가 끝난 방식은 더 싸도 추천하지 않는다', () => {
      const t2 = structuredClone(team);
      const claude = t2.tools.find((x) => x.id === 'claude-code')!;
      claude.options.find((o) => o.id === 'claude-team')!.salesEnded = { date: '2026-10-09', note: '-', sourceUrl: 'https://example.com' };
      const r = evaluateTeam(base, t2, advisor, prices.models, prices.plans);
      expect(opt(r, 'claude-team').monthlyKrw).toBeLessThan(opt(r, 'claude-individual').monthlyKrw); // 금액은 여전히 가장 쌈
      expect(r.recommended?.option.id).not.toBe('claude-team');
    });

    it('Gemini는 판매가 끝난 Code Assist 대신 Gemini Enterprise를 추천하고, Code Assist는 참고로 남긴다', () => {
      const r = run({ toolId: 'gemini', vat: true });
      expect(r.recommended?.option.id).toMatch(/^gemini-enterprise-/);
      expect(opt(r, 'code-assist-standard').option.salesEnded?.date).toBe('2026-10-09');
      const text = buildTeamSummary(r, {
        toolName: 'Gemini',
        billing: 'annual',
        vat: true,
        fxRate: 1400,
        groups: [{ name: '일반 사용자', count: 8, hours: 3 }],
        checkedAt: '2026-10-23',
        url: 'https://example.com/team/',
      });
      expect(text).toContain('■ 도입 조건:');
      expect(text).toContain('인보이스');
    });
  });

  describe('Gemini Enterprise (좌석 + 팀 공동 크레딧 + 사용량)', () => {
    it('Standard = 좌석 $30 × 인원 + (팀 사용량 − 1인 $10 × 인원), 종량제 = 사용량만', () => {
      const r = run({ toolId: 'gemini' }); // 많이 쓰는 2명 × 7시간 + 일반 8명 × 3시간 × 0.5 = 에이전트 환산 26시간
      const usageUsd = r.apiUsdPerAgentHour * 26;
      expect(usageUsd).toBeGreaterThan(100); // 크레딧($10 × 10명)보다 많이 쓰는 경우
      expect(opt(r, 'gemini-enterprise-standard').monthlyKrw).toBeCloseTo((30 * 10 + usageUsd - 10 * 10) * 1400);
      expect(opt(r, 'gemini-enterprise-payg').monthlyKrw).toBeCloseTo(usageUsd * 1400);
    });

    it('팀 사용량이 크레딧 합계 안이면 좌석료만 낸다 (크레딧은 팀 공동이라 많이 쓰는 사람 몫도 덮음)', () => {
      // 실제 크레딧($10)은 에이전트 작업 몇 분 분량이라, 크레딧을 크게 가정해 계산 규칙만 확인한다
      const t2 = structuredClone(team);
      const ge = t2.tools.find((x) => x.id === 'gemini')!.options.find((o) => o.id === 'gemini-enterprise-standard')!;
      if (ge.kind !== 'seat-credit-usage') throw new Error('kind');
      ge.includedCreditUsd = 1000;
      const r = evaluateTeam({ ...base, toolId: 'gemini' }, t2, advisor, prices.models, prices.plans);
      expect(r.apiUsdPerAgentHour * 26).toBeLessThan(1000 * 10); // 팀 사용량 < 크레딧 합계
      const s = opt(r, 'gemini-enterprise-standard');
      expect(s.monthlyKrw).toBeCloseTo(30 * 10 * 1400);
      expect(s.lines.every((l) => l.overageKrw === 0)).toBe(true);
    });
  });
});
