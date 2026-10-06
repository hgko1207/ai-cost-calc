// 월간 가격 점검 이슈를 만드는 순수 함수들. scripts/price-check.ts(Node)와 테스트가 함께 쓴다.
// Node의 타입 제거 실행을 위해 enum 등 런타임 TS 문법은 쓰지 않는다.

export interface SourceItem {
  label: string; // 예: "Claude Pro (요금제)"
  url: string;
  verifiedAt?: string; // YYYY-MM-DD
}

export interface DateAlert {
  label: string;
  date: string;
  kind: 'retire' | 'price-change';
}

export type LinkStatus = 'ok' | 'moved' | 'broken' | 'manual' | 'error';

export const STALE_DAYS = 35;
export const ALERT_DAYS = 45;

interface PricesLike {
  models: { name: string; sourceUrl: string; verifiedAt: string; retiresAt?: string; priceChangesAt?: string }[];
  plans: { name: string; sourceUrl: string; verifiedAt: string }[];
  vendors: { name: string; apiPricingUrl: string; planPricingUrl: string }[];
}
interface TeamLike {
  updatedAt: string;
  tools: { options: { name: string; sourceUrl: string; checks?: Record<string, { sourceUrl?: string }> }[] }[];
}
interface PostLike {
  title: string;
  url: string;
}

/** 데이터 파일의 출처를 모아 URL 기준으로 중복을 없앤다. 같은 URL이면 가장 오래된 확인일을 남긴다. */
export function collectSources(prices: PricesLike, team: TeamLike, posts: PostLike[]): SourceItem[] {
  const items: SourceItem[] = [
    ...prices.models.map((m) => ({ label: `${m.name} (API)`, url: m.sourceUrl, verifiedAt: m.verifiedAt })),
    ...prices.plans.map((p) => ({ label: `${p.name} (요금제)`, url: p.sourceUrl, verifiedAt: p.verifiedAt })),
    ...prices.vendors.flatMap((v) => [
      { label: `${v.name} API 가격`, url: v.apiPricingUrl },
      { label: `${v.name} 요금제`, url: v.planPricingUrl },
    ]),
    ...team.tools.flatMap((t) =>
      t.options.flatMap((o) => [
        { label: `${o.name} (팀)`, url: o.sourceUrl, verifiedAt: team.updatedAt },
        ...Object.values(o.checks ?? {})
          .filter((c) => c.sourceUrl)
          .map((c) => ({ label: `${o.name} 관리 기능`, url: c.sourceUrl!, verifiedAt: team.updatedAt })),
      ]),
    ),
    ...posts.map((p) => ({ label: `블로그: ${p.title}`, url: p.url })),
  ];
  const byUrl = new Map<string, SourceItem>();
  for (const it of items) {
    const prev = byUrl.get(it.url);
    if (!prev) byUrl.set(it.url, it);
    else if (it.verifiedAt && (!prev.verifiedAt || it.verifiedAt < prev.verifiedAt)) byUrl.set(it.url, { ...prev, verifiedAt: it.verifiedAt });
  }
  return [...byUrl.values()];
}

/** HTTP 응답을 점검 상태로 분류한다. 봇 차단(403·429·503·Cloudflare 확인 화면)은 "직접 확인". */
export function classify(status: number, finalUrl: string, requestedUrl: string, bodyStart = ''): LinkStatus {
  if (status === 403 || status === 429 || status === 503 || /just a moment|cf-chl|captcha/i.test(bodyStart)) return 'manual';
  if (status === 404 || status === 410) return 'broken';
  if (/oauth|signin|login/i.test(finalUrl) && !/oauth|signin|login/i.test(requestedUrl)) return 'manual'; // 로그인 화면으로 보냄
  if (status >= 200 && status < 300) {
    try {
      const want = new URL(requestedUrl).pathname.replace(/\/$/, '');
      const got = new URL(finalUrl).pathname.replace(/\/$/, '');
      // 지원 문서처럼 /articles/123 → /articles/123-제목 으로 바뀌는 건 정상
      return got === want || got.startsWith(`${want}-`) || got.startsWith(`${want}/`) ? 'ok' : 'moved';
    } catch {
      return 'ok';
    }
  }
  return 'error';
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export function isStale(verifiedAt: string | undefined, today: string, days = STALE_DAYS): boolean {
  return !!verifiedAt && daysBetween(verifiedAt, today) > days;
}

/** 지났거나 ALERT_DAYS 안에 다가오는 종료·가격 변경일 */
export function dateAlerts(prices: PricesLike, today: string, days = ALERT_DAYS): DateAlert[] {
  const out: DateAlert[] = [];
  for (const m of prices.models) {
    if (m.retiresAt && daysBetween(today, m.retiresAt) <= days) out.push({ label: m.name, date: m.retiresAt, kind: 'retire' });
    if (m.priceChangesAt && daysBetween(today, m.priceChangesAt) <= days) out.push({ label: m.name, date: m.priceChangesAt, kind: 'price-change' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const STATUS_TEXT: Record<LinkStatus, string> = {
  ok: '정상',
  moved: '주소 바뀜',
  broken: '깨짐',
  manual: '자동 확인 불가(직접 확인)',
  error: '오류',
};

export function buildIssueBody(
  today: string,
  checks: (SourceItem & { status: LinkStatus })[],
  alerts: DateAlert[],
): string {
  const lines: string[] = [`가격 점검 체크리스트 (${today} 자동 생성)`, ''];
  if (alerts.length) {
    lines.push('## ⚠ 다가오는 일정', '');
    for (const a of alerts) {
      const d = daysBetween(today, a.date);
      const when = d < 0 ? `${-d}일 지남` : `${d}일 남음`;
      lines.push(`- [ ] **${a.label}** ${a.kind === 'retire' ? '지원 종료' : '가격 변경'} ${a.date} (${when}) → 데이터 반영`);
    }
    lines.push('');
  }
  const problems = checks.filter((c) => c.status === 'broken' || c.status === 'moved' || c.status === 'error');
  if (problems.length) {
    lines.push('## 링크 문제', '');
    for (const c of problems) lines.push(`- [ ] ${c.label} · [출처](${c.url}) · ${STATUS_TEXT[c.status]}`);
    lines.push('');
  }
  lines.push('## 항목별 가격 확인', '', '공식 페이지를 열어 숫자가 그대로인지 확인하고, 바뀌었으면 JSON과 확인일(verifiedAt)을 고친다.', '');
  for (const c of checks) {
    const age = c.verifiedAt ? ` · 확인일 ${c.verifiedAt} (${daysBetween(c.verifiedAt, today)}일 전${isStale(c.verifiedAt, today) ? ', 오래됨' : ''})` : '';
    lines.push(`- [ ] ${c.label} · [출처](${c.url})${age} · ${STATUS_TEXT[c.status]}`);
  }
  return lines.join('\n');
}
