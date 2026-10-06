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

/** 공유용 주소: 현재 상태 그대로, embed 표시만 뺀다 */
export function shareUrl(): string {
  const params = new URLSearchParams(window.location.search);
  params.delete('embed');
  const qs = params.toString();
  return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ''}`;
}

export async function copyShareUrl(): Promise<void> {
  const url = shareUrl();
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    window.prompt('아래 링크를 복사하세요', url);
  }
}
