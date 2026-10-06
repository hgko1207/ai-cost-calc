import { describe, expect, it } from 'vitest';
import { compare, modelCost, planZones, type Settings } from './calc';
import { makeCapacityOf } from './advisor';
import { advisor, prices, presets } from './data';
import { fromQuery, toQuery, type CalcState } from './url';

const model = (id: string) => prices.models.find((m) => m.id === id)!;
const daily = presets.find((p) => p.id === 'daily')!.values;
const settings: Settings = { ...daily, fxRate: 1400, vat: false, capacityScale: 1 };
const capacityOf = makeCapacityOf(advisor, prices.models, daily.workDays);

describe('modelCost', () => {
  it('매일 코딩 프리셋 × Opus 5.5를 손계산과 일치시킨다', () => {
    // 월 입력 550M: 캐시쓰기 38.5M×$5 + 캐시읽기 511.5M×$0.2, 출력 1.87M×$20
    const c = modelCost(model('opus-5-5'), daily);
    expect(c.breakdown.cacheWrite).toBeCloseTo(192.5);
    expect(c.breakdown.cacheRead).toBeCloseTo(102.3);
    expect(c.breakdown.output).toBeCloseTo(37.4);
    expect(c.usd).toBeCloseTo(332.2);
    expect(c.longContext).toBe(false);
  });

  it('임계값을 넘는 컨텍스트에는 긴 컨텍스트 단가를 적용한다', () => {
    const c = modelCost(model('gpt-6-astra'), daily); // 300K > 272K
    expect(c.longContext).toBe(true);
    expect(c.usd).toBeCloseTo(38.5 * 25 + 511.5 * 2 + 1.87 * 75);
    expect(modelCost(model('gpt-6-astra'), { ...daily, avgContextK: 200 }).longContext).toBe(false);
  });

  it('최대 컨텍스트를 넘으면 사용 불가로 표시한다', () => {
    expect(modelCost(model('haiku-4-5'), daily).available).toBe(false);
    expect(modelCost(model('haiku-4-5'), { ...daily, avgContextK: 150 }).available).toBe(true);
  });

  it('캐시 비율 합이 100%를 넘으면 정규화한다', () => {
    const c = modelCost(model('opus-5-5'), { ...daily, cacheReadPct: 100, cacheWritePct: 100 });
    expect(c.breakdown.cacheRead + c.breakdown.cacheWrite).toBeCloseTo(275 * 0.2 + 275 * 5);
  });
});

describe('compare', () => {
  it('한도 안에서 가장 싼 구독을 고른다', () => {
    const r = compare(model('opus-5-5'), prices.plans, settings, capacityOf);
    expect(r.best.id).toBe('claude-max-5x'); // Pro는 한도($100) 초과
    expect(r.options.find((o) => o.id === 'claude-pro')!.covers).toBe(false);
    expect(r.savingKrw).toBeCloseTo(332.2 * 1400 - 140_000);
  });

  it('사용량이 적으면 API를 추천한다', () => {
    const r = compare(model('sonnet-5-5'), prices.plans, { ...settings, dailyInputM: 0.1, dailyOutputK: 1 }, capacityOf);
    expect(r.best.kind).toBe('api');
    expect(r.savingKrw).toBe(0);
  });

  it('공식 원화가는 부가세 포함가로 보고, 부가세 별도 기준이면 1.1로 나눈다', () => {
    const withVat = compare(model('gemini-3-1-pro'), prices.plans, { ...settings, vat: true }, capacityOf);
    expect(withVat.options.find((o) => o.id === 'google-ai-pro')!.krw).toBe(29_000);
    const noVat = compare(model('gemini-3-1-pro'), prices.plans, { ...settings, vat: false }, capacityOf);
    expect(noVat.options.find((o) => o.id === 'google-ai-pro')!.krw).toBeCloseTo(29_000 / 1.1);
    // 달러 요금제는 부가세 포함이면 1.1배
    expect(withVat.api.usd * 1400 * 1.1).toBeCloseTo(withVat.apiKrw);
  });
});

describe('planZones', () => {
  it('손익분기점과 한도 지점을 계산한다', () => {
    const { usdPerDailyM, zones } = planZones(model('opus-5-5'), prices.plans, settings, capacityOf);
    expect(usdPerDailyM).toBeCloseTo(332.2 / 25);
    const max5 = zones.find((z) => z.plan.id === 'claude-max-5x')!;
    expect(max5.breakEvenM).toBeCloseTo(140_000 / ((332.2 / 25) * 1400));
    expect(max5.capacityM).toBeCloseTo(capacityOf(prices.plans.find((p) => p.id === 'claude-max-5x')!) / (332.2 / 25));
    expect(max5.hasZone).toBe(true);
  });
});

describe('한도 기준 통일', () => {
  it('토큰 계산기의 한도는 요금제 추천의 하루 감당 시간에서 나온다 (Max 5x = 6시간)', () => {
    const max5 = prices.plans.find((p) => p.id === 'claude-max-5x')!;
    // 6시간 × (Opus 5.5로 에이전트 작업 하루 1시간의 API 월 비용)
    const perHour = modelCost(model('opus-5-5'), { ...advisor.agentHourUsage, workDays: 22 }).usd;
    expect(capacityOf(max5)).toBeCloseTo(6 * perHour);
  });

  it('하루 7시간 에이전트 작업이면 위·아래 계산기 모두 Max 5x 한도 초과로 본다', () => {
    const usage = { ...advisor.agentHourUsage, dailyInputM: 35, dailyOutputK: 112, workDays: 22 };
    const r = compare(model('opus-5-5'), prices.plans, { ...settings, ...usage }, capacityOf);
    expect(r.options.find((o) => o.id === 'claude-max-5x')!.covers).toBe(false);
  });
});

describe('url', () => {
  const defaults: CalcState = { ...settings, presetId: 'daily', modelId: 'opus-5-5' };
  const ids = { presets: presets.map((p) => p.id), models: prices.models.map((m) => m.id) };

  it('기본값과 다른 값만 쿼리에 넣고 다시 복원한다', () => {
    const state: CalcState = { ...defaults, presetId: 'custom', dailyInputM: 42, vat: true, modelId: 'gpt-6-astra' };
    const q = toQuery(state, defaults);
    expect(q).toBe('p=custom&m=gpt-6-astra&in=42&vat=1');
    expect(fromQuery(q, defaults, ids)).toEqual(state);
  });

  it('잘못된 값은 무시하거나 범위로 자른다', () => {
    const s = fromQuery('m=nope&p=evil&in=abc&cr=500&d=-3', defaults, ids);
    expect(s.modelId).toBe('opus-5-5');
    expect(s.presetId).toBe('daily');
    expect(s.dailyInputM).toBe(25);
    expect(s.cacheReadPct).toBe(100);
    expect(s.workDays).toBe(0);
  });
});
