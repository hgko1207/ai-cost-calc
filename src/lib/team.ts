// 팀·회사 도입 비용 비교 (순수 함수).
// 사용자 유형별 "에이전트 작업 환산 시간"으로 도입 방식(팀 좌석, 엔터프라이즈, 개인 구독 지원, API)을 비교한다.
import { apiUsdPerAgentHour as apiUsdPerAgentHourOf, planAgentHours, statusOf, type PlanStatus } from './advisor';
import { officialKrw, planKrw, usdToKrw } from './calc';
import type { Advisor, Model, Plan, Team, TeamOption } from './data';

export type Billing = 'monthly' | 'annual';

export interface TeamGroup {
  typeId: string;
  count: number;
  hours: number; // 하루 사용 시간
}

export interface TeamInput {
  toolId: string;
  groups: TeamGroup[];
  billing: Billing;
  workDays: number;
  fxRate: number;
  vat: boolean;
}

export interface GroupLine {
  typeId: string;
  count: number;
  loadHours: number;
  choice: string; // 이 그룹에 배정한 좌석·요금제 이름 (API면 'API')
  unitKrw: number; // 1인당 월 비용 (추가 사용량 포함)
  status: PlanStatus | 'api';
  capacityAgentHours?: number; // 배정한 좌석·요금제가 감당하는 에이전트 작업 환산 시간
  overageKrw: number; // 1인당 월 추가 사용량 비용
}

export interface OptionResult {
  option: TeamOption;
  applicable: boolean;
  notApplicableReason?: string;
  monthlyKrw: number;
  annualKrw: number;
  perUserKrw: number;
  lines: GroupLine[];
  hasOverage: boolean; // 한도를 넘어 추가 결제가 생김
  hasShortage: boolean; // 한도를 넘는데 추가 결제가 불가 (대기해야 함)
  billingNote?: string;
}

export interface TeamResult {
  headcount: number;
  totalLoadHours: number;
  options: OptionResult[]; // 적용 가능한 것 먼저, 월 비용 오름차순
  recommended: OptionResult | null;
  apiUsdPerAgentHour: number;
}

export function evaluateTeam(input: TeamInput, team: Team, advisor: Advisor, models: Model[], plans: Plan[]): TeamResult {
  const tool = team.tools.find((t) => t.id === input.toolId) ?? team.tools[0];
  const model = models.find((m) => m.id === tool.defaultModel)!;

  // 에이전트 작업을 하루 1시간 할 때의 API 월 비용
  const apiUsdPerAgentHour = apiUsdPerAgentHourOf(advisor, model, input.workDays);
  const krw = (usd: number) => usdToKrw(usd, input);
  const apiKrw = (loadHours: number) => krw(apiUsdPerAgentHour * loadHours);

  const groups = input.groups
    .filter((g) => g.count > 0)
    .map((g) => {
      const type = team.userTypes.find((t) => t.id === g.typeId)!;
      const intensity = advisor.modes.find((m) => m.id === type.modeId)?.intensity ?? 1;
      return { ...g, loadHours: g.hours * intensity };
    });
  const headcount = groups.reduce((s, g) => s + g.count, 0);
  const totalLoadHours = groups.reduce((s, g) => s + g.loadHours * g.count, 0);

  /**
   * 1인당 총비용(좌석 + 한도 초과분)이 가장 싼 선택지를 고른다.
   * 추가 결제가 되는 도구는 "작은 좌석 + 초과분"이 "큰 좌석"보다 쌀 수 있어 둘 다 비교한다.
   * 추가 결제가 안 되는 도구(대기)는 감당 가능한 가장 싼 것, 없으면 가장 큰 것.
   */
  function pick<T extends { agentHours: number; krw: number; name: string }>(choices: T[], loadHours: number) {
    const overageOf = (c: T) => (tool.overage === 'paid' ? apiKrw(Math.max(0, loadHours - c.agentHours)) : 0);
    let chosen: T;
    if (tool.overage === 'paid') {
      chosen = choices.reduce((best, c) => (c.krw + overageOf(c) < best.krw + overageOf(best) ? c : best));
    } else {
      const fit = [...choices].sort((a, b) => a.krw - b.krw).find((c) => c.agentHours >= loadHours);
      chosen = fit ?? [...choices].sort((a, b) => b.agentHours - a.agentHours)[0];
    }
    return { chosen, overageKrw: overageOf(chosen), status: statusOf(loadHours / chosen.agentHours) };
  }

  const evaluate = (option: TeamOption): OptionResult => {
    const empty = { monthlyKrw: 0, annualKrw: 0, perUserKrw: 0, lines: [], hasOverage: false, hasShortage: false };
    if (headcount === 0) return { option, applicable: false, notApplicableReason: '인원을 입력하세요', ...empty };

    let lines: GroupLine[] = [];
    let billingNote: string | undefined;

    if (option.kind === 'seats') {
      if (headcount < option.minSeats) {
        return { option, applicable: false, notApplicableReason: `최소 ${option.minSeats}명부터`, ...empty };
      }
      if (option.maxSeats && headcount > option.maxSeats) {
        return { option, applicable: false, notApplicableReason: `최대 ${option.maxSeats}명까지`, ...empty };
      }
      const seats = option.seats.map((s) => ({
        ...s,
        krw:
          input.billing === 'annual'
            ? s.annualKrw != null ? officialKrw(s.annualKrw, input) : krw(s.annualUsd)
            : s.monthlyKrw != null ? officialKrw(s.monthlyKrw, input) : krw(s.monthlyUsd),
      }));
      lines = groups.map((g) => {
        const { chosen, overageKrw, status } = pick(seats, g.loadHours);
        return { typeId: g.typeId, count: g.count, loadHours: g.loadHours, choice: chosen.name, unitKrw: chosen.krw + overageKrw, status, overageKrw, capacityAgentHours: chosen.agentHours };
      });
    } else if (option.kind === 'seat-plus-usage') {
      if (input.billing === 'monthly') {
        return { option, applicable: false, notApplicableReason: '연간 계약만 가능', ...empty };
      }
      if (headcount < option.minSeats) {
        return { option, applicable: false, notApplicableReason: `최소 ${option.minSeats}명부터`, ...empty };
      }
      const seatKrw = krw(option.seatAnnualUsd);
      lines = groups.map((g) => ({
        typeId: g.typeId,
        count: g.count,
        loadHours: g.loadHours,
        choice: '좌석 + 사용량',
        unitKrw: seatKrw + apiKrw(g.loadHours),
        status: 'api',
        overageKrw: 0,
      }));

    } else if (option.kind === 'individual') {
      const choices = option.plans.map((p) => {
        const plan = plans.find((x) => x.id === p.planId)!;
        return { name: plan.name, agentHours: planAgentHours(advisor, p.planId) ?? 0, krw: planKrw(plan, input) };
      });
      lines = groups.map((g) => {
        const { chosen, overageKrw, status } = pick(choices, g.loadHours);
        return { typeId: g.typeId, count: g.count, loadHours: g.loadHours, choice: chosen.name, unitKrw: chosen.krw + overageKrw, status, overageKrw, capacityAgentHours: chosen.agentHours };
      });
      if (input.billing === 'annual') billingNote = '개인 구독은 월간 가격 기준';
    } else {
      const unknown: never = option;
      throw new Error(`알 수 없는 도입 방식: ${JSON.stringify(unknown)}`);
    }

    const monthlyKrw = lines.reduce((s, l) => s + l.unitKrw * l.count, 0);
    const hasOverLimit = lines.some((l) => l.status === 'short');
    return {
      option,
      applicable: true,
      monthlyKrw,
      annualKrw: monthlyKrw * 12,
      perUserKrw: monthlyKrw / headcount,
      lines,
      hasOverage: hasOverLimit && tool.overage === 'paid',
      hasShortage: hasOverLimit && tool.overage === 'wait',
      billingNote,
    };
  };

  const options = tool.options
    .map(evaluate)
    .sort((a, b) => Number(b.applicable) - Number(a.applicable) || a.monthlyKrw - b.monthlyKrw);
  const candidates = options.filter((o) => o.applicable && !o.hasShortage);
  const recommended = (candidates.length ? candidates : options.filter((o) => o.applicable))[0] ?? null;
  return { headcount, totalLoadHours, options, recommended, apiUsdPerAgentHour };
}
