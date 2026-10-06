// 요금제 추천 로직 (순수 함수).
// 사용량을 "에이전트 작업 환산 시간"으로 바꾼 뒤, 요금제별 감당 가능 시간과 비교한다.
import { modelCost, planKrw, usdToKrw } from './calc';
import type { Advisor, LimitFrequency, Model, Plan } from './data';

export interface AdvisorInput {
  toolId: string;
  hours: number; // 하루 사용 시간
  modeId: string;
  currentPlanId: string; // 'none' 또는 요금제 id
  frequency: LimitFrequency | null; // 현재 요금제에서 한도에 걸리는 빈도 (선택 안 하면 null)
  workDays: number;
  fxRate: number;
  vat: boolean;
}

export type PlanStatus = 'short' | 'tight' | 'ok'; // 부족 / 빠듯함 / 여유

export interface PlanFit {
  plan: Plan;
  agentHours: number;
  utilization: number; // 환산 사용 시간 / 감당 가능 시간
  status: PlanStatus;
  krw: number;
  isCurrent: boolean;
}

export type Reason =
  | 'fits' // 감당 가능한 가장 싼 요금제
  | 'api-cheaper' // 사용량이 적어 API 종량제가 더 쌈
  | 'exceeds-all' // 최상위 요금제로도 부족
  | 'upgrade' // 지금 요금제에서 한도에 자주 걸림
  | 'upgrade-top' // 한도에 자주 걸리지만 이미 최상위
  | 'keep' // 지금 요금제 유지
  | 'downgrade'; // 한도에 거의 안 걸려서 한 단계 낮춰도 됨

export interface Advice {
  loadHours: number; // 에이전트 작업 환산 하루 시간
  fits: PlanFit[];
  recommended: PlanFit | null; // null 이면 API 종량제 추천
  reason: Reason;
  api: { model: Model; usd: number; krw: number };
  monthlyTokens: { inputM: number; outputM: number };
}

const TIGHT_FROM = 0.7;

export function statusOf(utilization: number): PlanStatus {
  if (utilization > 1) return 'short';
  if (utilization > TIGHT_FROM) return 'tight';
  return 'ok';
}

/** 한도에 걸리는 빈도를 사용자가 알려 주면 계산값보다 그 경험을 우선한다 */
function statusFromFrequency(f: LimitFrequency): PlanStatus {
  if (f === 'daily') return 'short';
  if (f === 'often' || f === 'sometimes') return 'tight';
  return 'ok';
}

export function advise(input: AdvisorInput, advisor: Advisor, models: Model[], plans: Plan[]): Advice {
  const tool = advisor.tools.find((t) => t.id === input.toolId) ?? advisor.tools[0];
  const mode = advisor.modes.find((m) => m.id === input.modeId) ?? advisor.modes[0];
  const model = models.find((m) => m.id === tool.defaultModel)!;
  const loadHours = input.hours * mode.intensity;

  const u = advisor.agentHourUsage;
  const usage = {
    dailyInputM: u.dailyInputM * loadHours,
    dailyOutputK: u.dailyOutputK * loadHours,
    workDays: input.workDays,
    cacheReadPct: u.cacheReadPct,
    cacheWritePct: u.cacheWritePct,
    avgContextK: u.avgContextK,
  };
  const apiUsd = modelCost(model, usage).usd;
  const apiKrw = usdToKrw(apiUsd, input);

  const fits: PlanFit[] = tool.plans.map(({ planId, agentHours }) => {
    const plan = plans.find((p) => p.id === planId)!;
    const utilization = loadHours / agentHours;
    const isCurrent = plan.id === input.currentPlanId;
    return {
      plan,
      agentHours,
      utilization,
      status: isCurrent && input.frequency ? statusFromFrequency(input.frequency) : statusOf(utilization),
      krw: planKrw(plan, input),
      isCurrent,
    };
  });

  const result = (recommended: PlanFit | null, reason: Reason): Advice => ({
    loadHours,
    fits,
    recommended,
    reason,
    api: { model, usd: apiUsd, krw: apiKrw },
    monthlyTokens: { inputM: usage.dailyInputM * usage.workDays, outputM: (usage.dailyOutputK / 1000) * usage.workDays },
  });

  // 지금 요금제와 한도 빈도를 모두 알려 준 경우에만 그 경험을 우선한다
  const currentIdx = input.frequency ? fits.findIndex((f) => f.isCurrent) : -1;
  if (currentIdx >= 0) {
    const f = input.frequency;
    if (f === 'often' || f === 'daily') {
      const next = fits[currentIdx + 1];
      return next ? result(next, 'upgrade') : result(fits[currentIdx], 'upgrade-top');
    }
    if (f === 'none' && currentIdx > 0 && statusOf(fits[currentIdx - 1].utilization) !== 'short') {
      return result(fits[currentIdx - 1], 'downgrade');
    }
    return result(fits[currentIdx], 'keep');
  }

  const cheapestFit = fits.find((f) => f.status !== 'short');
  if (!cheapestFit) return result(fits.at(-1)!, 'exceeds-all');
  // 추천하려는 요금제보다 API가 싸면 API를 추천한다 (가장 싼 요금제가 아니라 감당 가능한 요금제와 비교)
  if (apiKrw < cheapestFit.krw) return result(null, 'api-cheaper');
  return result(cheapestFit, 'fits');
}

/** 요금제의 하루 감당 가능 시간(에이전트 작업 환산). advisor.json이 유일한 출처다. */
export function planAgentHours(advisor: Advisor, planId: string): number | undefined {
  for (const t of advisor.tools) {
    const p = t.plans.find((x) => x.planId === planId);
    if (p) return p.agentHours;
  }
  return undefined;
}

/** 에이전트 작업을 하루 1시간 할 때의 API 월 비용(USD) */
export function apiUsdPerAgentHour(advisor: Advisor, model: Model, workDays: number): number {
  const u = advisor.agentHourUsage;
  return modelCost(model, {
    dailyInputM: u.dailyInputM,
    dailyOutputK: u.dailyOutputK,
    workDays,
    cacheReadPct: u.cacheReadPct,
    cacheWritePct: u.cacheWritePct,
    avgContextK: u.avgContextK,
  }).usd;
}

/**
 * 토큰 계산기용 "API 환산 월 한도(USD)".
 * 하루 감당 시간 × (그 도구 기본 모델로 에이전트 작업 1시간의 API 월 비용)으로, 요금제 추천과 같은 기준을 쓴다.
 */
export function makeCapacityOf(advisor: Advisor, models: Model[], workDays: number): (plan: Plan) => number {
  return (plan) => {
    const tool = advisor.tools.find((t) => t.plans.some((p) => p.planId === plan.id));
    const hours = planAgentHours(advisor, plan.id);
    const model = models.find((m) => m.id === tool?.defaultModel);
    if (!tool || hours == null || !model) return 0;
    return hours * apiUsdPerAgentHour(advisor, model, workDays);
  };
}
