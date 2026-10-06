// 계산기 상태 <-> URL 쿼리 파라미터 (결과 공유용)
import type { Settings } from './calc';

export interface CalcState extends Settings {
  presetId: string; // 프리셋 id 또는 'custom'
  modelId: string;
}

const KEYS = {
  presetId: 'p',
  modelId: 'm',
  dailyInputM: 'in',
  dailyOutputK: 'out',
  workDays: 'd',
  cacheReadPct: 'cr',
  cacheWritePct: 'cw',
  avgContextK: 'ctx',
  fxRate: 'fx',
  vat: 'vat',
  capacityScale: 'cap',
} as const satisfies Record<keyof CalcState, string>;

const LIMITS: Partial<Record<keyof CalcState, [number, number]>> = {
  dailyInputM: [0, 10_000],
  dailyOutputK: [0, 100_000],
  workDays: [0, 31],
  cacheReadPct: [0, 100],
  cacheWritePct: [0, 100],
  avgContextK: [1, 2_000],
  fxRate: [1, 100_000],
  capacityScale: [0.1, 10],
};

export function toQuery(state: CalcState, defaults: CalcState): string {
  const q = new URLSearchParams();
  for (const [field, key] of Object.entries(KEYS) as [keyof CalcState, string][]) {
    const v = state[field];
    if (v === defaults[field]) continue;
    q.set(key, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  return q.toString();
}

export function fromQuery(search: string, defaults: CalcState, validIds: { presets: string[]; models: string[] }): CalcState {
  const q = new URLSearchParams(search);
  const state = { ...defaults };
  for (const [field, key] of Object.entries(KEYS) as [keyof CalcState, string][]) {
    const raw = q.get(key);
    if (raw == null) continue;
    if (field === 'presetId') {
      if (raw === 'custom' || validIds.presets.includes(raw)) state.presetId = raw;
    } else if (field === 'modelId') {
      if (validIds.models.includes(raw)) state.modelId = raw;
    } else if (field === 'vat') {
      state.vat = raw === '1';
    } else {
      const n = Number(raw);
      const [min, max] = LIMITS[field] ?? [-Infinity, Infinity];
      if (Number.isFinite(n)) (state[field] as number) = Math.min(max, Math.max(min, n));
    }
  }
  return state;
}

export const CALC_KEYS: readonly string[] = Object.values(KEYS);

/**
 * 한 페이지에 계산기가 둘(요금제 추천, 토큰 계산기)이라 서로의 파라미터를 지우지 않도록
 * 자기 키만 바꿔서 주소창에 반영한다. embed 등 다른 키는 그대로 둔다.
 */
export function replaceOwnParams(ownKeys: readonly string[], ownQuery: string): void {
  const params = new URLSearchParams(window.location.search);
  for (const k of ownKeys) params.delete(k);
  new URLSearchParams(ownQuery).forEach((v, k) => params.set(k, v));
  const qs = params.toString();
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

/** 공유용 주소: 지금 보고 있는 계산기의 키(+ 환율·부가세)만 남긴다. 다른 탭의 값이 섞이지 않게. */
export function shareUrl(keepKeys: readonly string[]): string {
  const keep = new Set([...keepKeys, 'fx', 'vat']);
  const params = new URLSearchParams();
  new URLSearchParams(window.location.search).forEach((v, k) => {
    if (keep.has(k)) params.set(k, v);
  });
  const qs = params.toString();
  return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ''}`;
}

export async function copyShareUrl(keepKeys: readonly string[]): Promise<void> {
  const url = shareUrl(keepKeys);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    window.prompt('아래 링크를 복사하세요', url);
  }
}

// ── 환율·부가세: 세 계산기가 함께 쓰는 값 ──
export interface Money {
  fxRate: number;
  vat: boolean;
}
export const DEFAULT_MONEY: Money = { fxRate: 1400, vat: true };
const MONEY_EVENT = 'aicalc:money';

export function moneyFromQuery(search: string): Money {
  const q = new URLSearchParams(search);
  const fx = Number(q.get('fx'));
  return {
    fxRate: q.has('fx') && Number.isFinite(fx) ? Math.min(100_000, Math.max(1, fx)) : DEFAULT_MONEY.fxRate,
    vat: q.has('vat') ? q.get('vat') === '1' : DEFAULT_MONEY.vat,
  };
}

/** 토큰 계산기에서 환율·부가세를 바꾸면 다른 계산기에도 알린다 */
export function emitMoney(m: Money): void {
  window.dispatchEvent(new CustomEvent<Money>(MONEY_EVENT, { detail: m }));
}

export function onMoney(cb: (m: Money) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<Money>).detail);
  window.addEventListener(MONEY_EVENT, h);
  return () => window.removeEventListener(MONEY_EVENT, h);
}

// ── 팀 계산기 URL ──
export const TEAM_LIMITS = { maxPeople: 10_000, minHours: 0.5, maxHours: 16 } as const;

export interface TeamUrlState {
  toolId: string;
  billing: 'monthly' | 'annual';
  workDays: number;
  groups: { typeId: string; count: number; hours: number }[];
}

/** 그룹 키: 유형 id 첫 글자 + c(인원)/h(시간). 예: heavy → hc, hh */
export const teamGroupKey = (typeId: string, k: 'c' | 'h') => `${typeId[0]}${k}`;

export function teamToQuery(s: TeamUrlState, d: TeamUrlState): string {
  const q = new URLSearchParams();
  if (s.toolId !== d.toolId) q.set('tt', s.toolId);
  if (s.billing !== d.billing) q.set('b', s.billing);
  if (s.workDays !== d.workDays) q.set('twd', String(s.workDays));
  s.groups.forEach((g, i) => {
    if (g.count !== d.groups[i]?.count) q.set(teamGroupKey(g.typeId, 'c'), String(g.count));
    if (g.hours !== d.groups[i]?.hours) q.set(teamGroupKey(g.typeId, 'h'), String(g.hours));
  });
  return q.toString();
}

export function teamFromQuery(search: string, d: TeamUrlState, toolIds: string[]): TeamUrlState {
  const q = new URLSearchParams(search);
  const num = (k: string, min: number, max: number) => {
    const raw = q.get(k);
    const n = Number(raw);
    return raw !== null && raw.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
  };
  const tt = q.get('tt');
  return {
    toolId: tt && toolIds.includes(tt) ? tt : d.toolId,
    billing: q.get('b') === 'monthly' ? 'monthly' : 'annual',
    workDays: num('twd', 1, 31) ?? d.workDays,
    groups: d.groups.map((g) => ({
      typeId: g.typeId,
      count: Math.round(num(teamGroupKey(g.typeId, 'c'), 0, TEAM_LIMITS.maxPeople) ?? g.count),
      hours: num(teamGroupKey(g.typeId, 'h'), TEAM_LIMITS.minHours, TEAM_LIMITS.maxHours) ?? g.hours,
    })),
  };
}
