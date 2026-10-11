import { describe, expect, it } from 'vitest';
import { faqsFor, teamCostAnswer } from './content';

describe('teamCostAnswer', () => {
  it('기본 10명(많이 쓰는 사람 2 · 일반 8) · 연간: 손계산 값과 같다', () => {
    // 프리미엄 2 × $100 + 기본 8 × $20 = $360 → × 1,400원 × 1.1(부가세) = 554,400원 ≈ 55만 원, 1인 55,440원 ≈ 5.5만 원
    const a = teamCostAnswer();
    expect(a).toContain('기본 좌석은 1인 월 $20');
    expect(a).toContain('프리미엄 좌석은 월 $100');
    expect(a).toContain('10명(많이 쓰는 사람 2, 일반 사용자 8)');
    expect(a).toContain('월 약 55만 원');
    expect(a).toContain('1인당 약 5.5만 원');
    expect(a).toContain('부가세 포함');
  });

  it('팀 페이지 FAQ에 계산된 답변이 들어간다', () => {
    const f = faqsFor('team').find((x) => x.q.includes('1인당 얼마나'));
    expect(f?.a).toBe(teamCostAnswer());
  });
});
