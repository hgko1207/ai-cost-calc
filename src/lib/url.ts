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
