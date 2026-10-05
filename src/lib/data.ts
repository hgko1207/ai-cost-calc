// 가격·프리셋·관련 글 JSON을 스키마로 검증해서 내보낸다.
// 데이터가 잘못되면 빌드 단계에서 실패하므로 잘못된 가격이 배포되지 않는다.
import { z } from 'zod';
import pricesJson from '../data/prices.json';
import presetsJson from '../data/presets.json';
import relatedJson from '../data/related-posts.json';

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
  capacityUsd: z.number().positive(),
  capacityBasis: z.string(),
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

export type Vendor = z.infer<typeof VendorSchema>;
export type Model = z.infer<typeof ModelSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type TokenPrices = z.infer<typeof tokenPrices>;
export type UsageValues = z.infer<typeof InputValuesSchema>;
export type Preset = z.infer<typeof PresetSchema>;
export type RelatedPost = z.infer<typeof RelatedPostSchema>;

export const prices = PricesSchema.parse(pricesJson);
export const presets = z.array(PresetSchema).min(1).parse(presetsJson);
export const relatedPosts = z.array(RelatedPostSchema).parse(relatedJson);
