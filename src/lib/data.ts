// 가격·프리셋·관련 글 JSON을 스키마로 검증해서 내보낸다.
// 데이터가 잘못되면 빌드 단계에서 실패하므로 잘못된 가격이 배포되지 않는다.
import { z } from 'zod';
import pricesJson from '../data/prices.json';
import presetsJson from '../data/presets.json';
import relatedJson from '../data/related-posts.json';
import advisorJson from '../data/advisor.json';
import teamJson from '../data/team.json';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const price = z.number().nonnegative();
const tokenPrices = z.object({
  input: price,
  cacheWrite: price,
  cacheRead: price,
  output: price,
});

const VendorSchema = z.object({
  id: z.string(),
  name: z.string(),
  apiPricingUrl: z.url(),
  planPricingUrl: z.url(),
});

const ModelSchema = z.object({
  id: z.string(),
  vendor: z.string(),
  name: z.string(),
  apiId: z.string(),
  tier: z.enum(['flagship', 'workhorse', 'light']),
  contextWindowK: z.number().positive(),
  prices: tokenPrices,
  longContext: z.object({ thresholdK: z.number().positive(), prices: tokenPrices }).optional(),
  note: z.string().optional(),
  sourceUrl: z.url(),
  verifiedAt: isoDate,
});

const PlanSchema = z.object({
  id: z.string(),
  vendor: z.string(),
  name: z.string(),
  usdMonthly: price,
  krwMonthly: z.number().positive().nullable(),
  codingTools: z.string(),
  limitsNote: z.string(),
  proMultiplier: z.number().positive().optional(), // 개인 Pro 대비 사용량 배수 (공식)
  sourceUrl: z.url(),
  verifiedAt: isoDate,
});

const PricesSchema = z
  .object({
    updatedAt: isoDate,
    vendors: z.array(VendorSchema).min(1),
    models: z.array(ModelSchema).min(1),
    plans: z.array(PlanSchema),
  })
  .superRefine((d, ctx) => {
    const vendorIds = new Set(d.vendors.map((v) => v.id));
    for (const item of [...d.models, ...d.plans]) {
      if (!vendorIds.has(item.vendor)) {
        ctx.addIssue({ code: 'custom', message: `알 수 없는 vendor: ${item.vendor} (${item.id})` });
      }
    }
    const ids = [...d.models, ...d.plans].map((x) => x.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: '중복된 id가 있습니다' });
  });

const InputValuesSchema = z.object({
  dailyInputM: z.number().nonnegative(),
  dailyOutputK: z.number().nonnegative(),
  workDays: z.number().min(0).max(31),
  cacheReadPct: z.number().min(0).max(100),
  cacheWritePct: z.number().min(0).max(100),
  avgContextK: z.number().positive(),
});

const PresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  values: InputValuesSchema,
});

const RelatedPostSchema = z.object({
  title: z.string(),
  url: z.url(),
  description: z.string(),
});

const AdvisorSchema = z.object({
  agentHourUsage: InputValuesSchema.omit({ workDays: true }).extend({ note: z.string() }),
  defaultWorkDays: z.number().min(1).max(31),
  modes: z.array(
    z.object({ id: z.string(), name: z.string(), description: z.string(), intensity: z.number().positive() }),
  ),
  limitFrequencies: z.array(z.object({ id: z.enum(['none', 'sometimes', 'often', 'daily']), name: z.string() })),
  tools: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      vendor: z.string(),
      defaultModel: z.string(),
      confidence: z.enum(['high', 'low']),
      basis: z.string(),
      // 요금제를 싼 것부터 비싼 것 순으로 나열 (업그레이드 = 다음 항목)
      plans: z.array(z.object({ planId: z.string(), agentHours: z.number().positive() })).min(1),
    }),
  ),
});

const SeatSchema = z.object({
  id: z.string(),
  name: z.string(),
  monthlyUsd: price,
  annualUsd: price,
  monthlyKrw: z.number().positive().optional(),
  annualKrw: z.number().positive().optional(),
  agentHours: z.number().positive(),
  basis: z.string(), // 계산에 쓴 감당 가능 시간의 근거
  limitNote: z.string(), // 공식 사용 한도 (가격표 표시용)
  proMultiplier: z.number().positive().optional(), // 개인 Pro 대비 사용량 배수 (공식)
});
const TeamOptionBase = {
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  features: z.array(z.string()),
  sourceUrl: z.url(),
};
const TeamOptionSchema = z.discriminatedUnion('kind', [
  z.object({
    ...TeamOptionBase,
    kind: z.literal('seats'),
    minSeats: z.number().int().positive(),
    maxSeats: z.number().int().positive().optional(),
    seats: z.array(SeatSchema).min(1),
  }),
  z.object({
    ...TeamOptionBase,
    kind: z.literal('seat-plus-usage'),
    minSeats: z.number().int().positive(),
    seatAnnualUsd: price,
    limitNote: z.string(),
  }),
  z.object({
    ...TeamOptionBase,
    kind: z.literal('individual'),
    // 감당 가능 시간은 advisor.json의 같은 요금제 값을 쓴다 (한 곳에서만 관리)
    plans: z.array(z.object({ planId: z.string() })).min(1),
  }),
]);
const TeamSchema = z.object({
  updatedAt: isoDate,
  defaultWorkDays: z.number().min(1).max(31),
  userTypes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      modeId: z.string(),
      defaultHours: z.number().positive(),
      defaultCount: z.number().int().nonnegative(),
    }),
  ),
  tools: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      vendor: z.string(),
      defaultModel: z.string(),
      overage: z.enum(['paid', 'wait']),
      overageNote: z.string(),
      options: z.array(TeamOptionSchema).min(1),
    }),
  ),
});

export type Vendor = z.infer<typeof VendorSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type TeamTool = Team['tools'][number];
export type TeamOption = TeamTool['options'][number];
export type Advisor = z.infer<typeof AdvisorSchema>;
export type LimitFrequency = Advisor['limitFrequencies'][number]['id'];
export type Model = z.infer<typeof ModelSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type TokenPrices = z.infer<typeof tokenPrices>;
export type UsageValues = z.infer<typeof InputValuesSchema>;
export type Preset = z.infer<typeof PresetSchema>;
export type RelatedPost = z.infer<typeof RelatedPostSchema>;

export const prices = PricesSchema.parse(pricesJson);
export const presets = z.array(PresetSchema).min(1).parse(presetsJson);
export const relatedPosts = z.array(RelatedPostSchema).parse(relatedJson);

export const advisor = AdvisorSchema.superRefine((a, ctx) => {
  const planIds = new Set(prices.plans.map((p) => p.id));
  // 업그레이드 = 다음 요금제이므로 도구별 요금제는 가격 오름차순이어야 한다
  for (const t of a.tools) {
    const usd = t.plans.map((p) => prices.plans.find((x) => x.id === p.planId)?.usdMonthly ?? 0);
    if (usd.some((v, i) => i > 0 && v < usd[i - 1])) ctx.addIssue({ code: 'custom', message: `${t.id}: 요금제는 가격 오름차순으로` });
  }
  const modelIds = new Set(prices.models.map((m) => m.id));
  for (const t of a.tools) {
    if (!modelIds.has(t.defaultModel)) ctx.addIssue({ code: 'custom', message: `알 수 없는 모델: ${t.defaultModel}` });
    for (const p of t.plans) {
      if (!planIds.has(p.planId)) ctx.addIssue({ code: 'custom', message: `알 수 없는 요금제: ${p.planId}` });
    }
  }
}).parse(advisorJson);

export const team = TeamSchema.superRefine((t, ctx) => {
  const planIds = new Set(prices.plans.map((p) => p.id));
  const modelIds = new Set(prices.models.map((m) => m.id));
  const modeIds = new Set(advisor.modes.map((m) => m.id));
  // URL 키를 유형 id의 첫 글자로 만들므로 첫 글자가 겹치면 안 된다
  const initials = t.userTypes.map((u) => u.id[0]);
  if (new Set(initials).size !== initials.length) ctx.addIssue({ code: 'custom', message: '사용자 유형 id의 첫 글자가 겹칩니다' });
  for (const u of t.userTypes) {
    if (!modeIds.has(u.modeId)) ctx.addIssue({ code: 'custom', message: `알 수 없는 사용 방식: ${u.modeId}` });
  }
  for (const tool of t.tools) {
    if (!modelIds.has(tool.defaultModel)) ctx.addIssue({ code: 'custom', message: `알 수 없는 모델: ${tool.defaultModel}` });
    for (const o of tool.options) {
      if (o.kind !== 'individual') continue;
      for (const p of o.plans) {
        if (!planIds.has(p.planId)) ctx.addIssue({ code: 'custom', message: `알 수 없는 요금제: ${p.planId}` });
      }
    }
  }
}).parse(teamJson);
