const krwFmt = new Intl.NumberFormat('ko-KR');
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdFmtSmall = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

/** 1,234,567 → "123만 원", 12,345 → "1.2만 원", 1,000 미만은 그대로 */
export function krwShort(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 100_000_000) return `${(n / 100_000_000).toFixed(abs >= 1_000_000_000 ? 0 : 1)}억 원`;
  if (abs >= 100_000) return `${krwFmt.format(Math.round(n / 10_000))}만 원`;
  if (abs >= 10_000) return `${(n / 10_000).toFixed(1)}만 원`;
  return `${krwFmt.format(Math.round(n))}원`;
}

export function krw(n: number): string {
  return `${krwFmt.format(Math.round(n))}원`;
}

export function usd(n: number): string {
  return n < 10 ? usdFmtSmall.format(n) : usdFmt.format(n);
}

export function tokensM(m: number): string {
  if (m === 0) return '0';
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)}B`;
  if (m >= 1) return `${m >= 100 ? Math.round(m) : +m.toFixed(1)}M`;
  return `${Math.round(m * 1000)}K`;
}
