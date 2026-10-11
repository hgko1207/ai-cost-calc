import { describe, expect, it } from 'vitest';
import { krw, krwShort, tokensM, usd } from './format';

describe('krwShort', () => {
  it('Infinity·NaN → 대시', () => {
    expect(krwShort(Infinity)).toBe('-');
    expect(krwShort(-Infinity)).toBe('-');
    expect(krwShort(NaN)).toBe('-');
  });

  it('1,000 미만은 원 단위 그대로', () => {
    expect(krwShort(500)).toBe('500원');
    expect(krwShort(0)).toBe('0원');
    expect(krwShort(999)).toBe('999원');
  });

  it('1만~10만 미만은 소수 1자리 만 원', () => {
    expect(krwShort(10_000)).toBe('1.0만 원');
    expect(krwShort(12_345)).toBe('1.2만 원');
    expect(krwShort(55_000)).toBe('5.5만 원');
    expect(krwShort(99_999)).toBe('10.0만 원');
  });

  it('10만 이상~1억 미만은 정수 만 원', () => {
    expect(krwShort(100_000)).toBe('10만 원');
    expect(krwShort(1_234_567)).toBe('123만 원');
    expect(krwShort(50_000_000)).toBe('5,000만 원');
  });

  it('1억 이상은 억 원 (10억 미만 소수 1자리, 10억 이상 정수)', () => {
    expect(krwShort(100_000_000)).toBe('1.0억 원');
    expect(krwShort(150_000_000)).toBe('1.5억 원');
    expect(krwShort(1_000_000_000)).toBe('10억 원');
    expect(krwShort(12_000_000_000)).toBe('120억 원');
  });

  it('음수도 부호가 유지된다', () => {
    expect(krwShort(-500)).toBe('-500원');
    expect(krwShort(-12_345)).toBe('-1.2만 원');
    expect(krwShort(-1_234_567)).toBe('-123만 원');
    expect(krwShort(-150_000_000)).toBe('-1.5억 원');
  });
});

describe('krw', () => {
  it('천 단위 쉼표 + 원', () => {
    expect(krw(0)).toBe('0원');
    expect(krw(12_345)).toBe('12,345원');
    expect(krw(1_234_567)).toBe('1,234,567원');
  });

  it('소수점은 반올림', () => {
    expect(krw(99.4)).toBe('99원');
    expect(krw(99.5)).toBe('100원');
  });
});

describe('usd', () => {
  it('10 미만은 소수 2자리', () => {
    expect(usd(5.5)).toBe('$5.50');
    expect(usd(0.12)).toBe('$0.12');
  });

  it('10 이상은 정수', () => {
    expect(usd(10)).toBe('$10');
    expect(usd(99.9)).toBe('$100');
    expect(usd(1234)).toBe('$1,234');
  });
});

describe('tokensM', () => {
  it('0은 "0"', () => {
    expect(tokensM(0)).toBe('0');
  });

  it('1M 미만은 K 단위', () => {
    expect(tokensM(0.5)).toBe('500K');
    expect(tokensM(0.001)).toBe('1K');
  });

  it('1M~1000M 미만은 M 단위', () => {
    expect(tokensM(1)).toBe('1M');
    expect(tokensM(3.7)).toBe('3.7M');
    expect(tokensM(99.9)).toBe('99.9M');
    expect(tokensM(150)).toBe('150M');
    expect(tokensM(999)).toBe('999M');
  });

  it('1000M 이상은 B 단위 (1만M 미만 소수 1자리, 이상 정수)', () => {
    expect(tokensM(1000)).toBe('1.0B');
    expect(tokensM(1500)).toBe('1.5B');
    expect(tokensM(10_000)).toBe('10B');
    expect(tokensM(15_000)).toBe('15B');
  });
});
