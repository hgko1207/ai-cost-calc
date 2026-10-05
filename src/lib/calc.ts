// 비용 계산 순수 함수. UI와 분리해 테스트한다.
import type { Model, Plan, TokenPrices, UsageValues } from './data';

export interface Settings extends UsageValues {
  fxRate: number; // 원/달러
  vat: boolean; // USD 가격에 부가세 10% 적용
  capacityScale: number; // 구독 한도 가정 배율
}

export interface ModelCost {
  model: Model;
  available: boolean; // 평균 컨텍스트가 모델 최대 컨텍스트를 넘으면 false
  longContext: boolean; // 긴 컨텍스트 할증 단가 적용 여부
  usd: number;
  breakdown: { input: number; cacheWrite: number; cacheRead: number; output: number };
}

const VAT = 1.1;

export function uncachedPct(s: UsageValues): number {
  return Math.max(0, 100 - s.cacheReadPct - s.cacheWritePct);
}

export function ratesFor(model: Model, avgContextK: number): { rates: TokenPrices; longContext: boolean } {
  const lc = model.longContext;
  if (lc && avgContextK > lc.thresholdK) return { rates: lc.prices, longContext: true };
  return { rates: model.prices, longContext: false };
}

export function modelCost(model: Model, s: UsageValues): ModelCost {
  const { rates, longContext } = ratesFor(model, s.avgContextK);
  const monthlyInM = s.dailyInputM * s.workDays;
  const monthlyOutM = (s.dailyOutputK / 1000) * s.workDays;
  // 캐시 비율 합이 100%를 넘으면 비율대로 정규화
  const totalPct = Math.max(100, s.cacheReadPct + s.cacheWritePct);
  const breakdown = {
    input: monthlyInM * (uncachedPct(s) / totalPct) * rates.input,
    cacheWrite: monthlyInM * (s.cacheWritePct / totalPct) * rates.cacheWrite,
    cacheRead: monthlyInM * (s.cacheReadPct / totalPct) * rates.cacheRead,
    output: monthlyOutM * rates.output,
  };
  return {
    model,
    available: s.avgContextK <= model.contextWindowK,
    longContext,
    usd: breakdown.input + breakdown.cacheWrite + breakdown.cacheRead + breakdown.output,
    breakdown,
  };
}

export function usdToKrw(usd: number, s: Pick<Settings, 'fxRate' | 'vat'>): number {
  return usd * s.fxRate * (s.vat ? VAT : 1);
}

/** 구독 월 요금(원). 공식 원화 가격이 있으면 그대로, 없으면 USD × 환율(+부가세). */
export function planKrw(plan: Plan, s: Pick<Settings, 'fxRate' | 'vat'>): number {
  return plan.krwMonthly ?? usdToKrw(plan.usdMonthly, s);
}

/** 해당 사용량(API 환산 USD)을 구독 한도 안에서 감당할 수 있는지 */
export function planCovers(plan: Plan, apiUsd: number, capacityScale: number): boolean {
  return apiUsd <= plan.capacityUsd * capacityScale;
}

export interface Option {
  kind: 'api' | 'plan';
  id: string;
  name: string;
  krw: number;
  covers: boolean; // API는 항상 true
  plan?: Plan;
}

export interface Comparison {
  api: ModelCost;
  apiKrw: number;
  options: Option[]; // API + 같은 회사 구독, 월 비용 오름차순
  best: Option; // 감당 가능한 선택지 중 가장 저렴한 것
  savingKrw: number; // best가 구독일 때 API 대비 절약액
}

export function compare(model: Model, plans: Plan[], s: Settings): Comparison {
  const api = modelCost(model, s);
  const apiKrw = usdToKrw(api.usd, s);
  const options: Option[] = [
    { kind: 'api' as const, id: 'api', name: `${model.name} API`, krw: apiKrw, covers: true },
    ...plans
      .filter((p) => p.vendor === model.vendor)
      .map((p) => ({
        kind: 'plan' as const,
        id: p.id,
        name: p.name,
        krw: planKrw(p, s),
        covers: planCovers(p, api.usd, s.capacityScale),
        plan: p,
      })),
  ].sort((a, b) => a.krw - b.krw);
  const best = options.filter((o) => o.covers).reduce((a, b) => (b.krw < a.krw ? b : a));
  return { api, apiKrw, options, best, savingKrw: Math.max(0, apiKrw - best.krw) };
}

export interface PlanZone {
  plan: Plan;
  /** 이 하루 입력 토큰(M) 이상이면 API보다 구독이 저렴 */
  breakEvenM: number;
  /** 이 하루 입력 토큰(M)까지 구독 한도로 감당 가능 */
  capacityM: number;
  /** breakEvenM < capacityM 일 때만 구독이 유리한 구간이 존재 */
  hasZone: boolean;
}

/**
 * 하루 입력 토큰을 x로 두고, 출력·캐시 비율은 현재 설정 그대로 유지할 때
 * 구독이 API보다 유리한 구간을 계산한다. API 비용은 x에 정비례한다.
 */
export function planZones(model: Model, plans: Plan[], s: Settings): { usdPerDailyM: number; zones: PlanZone[] } {
  const outPerIn = s.dailyInputM > 0 ? s.dailyOutputK / s.dailyInputM : 0;
  const unit = modelCost(model, { ...s, dailyInputM: 1, dailyOutputK: outPerIn });
  const usdPerDailyM = unit.usd;
  const krwPerDailyM = usdToKrw(usdPerDailyM, s);
  const zones = plans
    .filter((p) => p.vendor === model.vendor)
    .map((plan) => {
      const breakEvenM = krwPerDailyM > 0 ? planKrw(plan, s) / krwPerDailyM : Infinity;
      const capacityM = usdPerDailyM > 0 ? (plan.capacityUsd * s.capacityScale) / usdPerDailyM : Infinity;
      return { plan, breakEvenM, capacityM, hasZone: breakEvenM < capacityM };
    });
  return { usdPerDailyM, zones };
}
