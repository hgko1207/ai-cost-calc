// 요금제 추천: 독자가 아는 값(도구·시간·방식·지금 요금제·한도 빈도)만 받아 요금제를 추천한다.
import { useEffect, useMemo, useState } from 'react';
import { advise, type Advice, type AdvisorInput, type PlanFit, type PlanStatus } from '../lib/advisor';
import type { Advisor as AdvisorData, LimitFrequency, Model, Plan, RelatedPost } from '../lib/data';
import { krwShort, tokensM } from '../lib/format';
import MobileResultBar from './MobileResultBar';
import Segmented from './Segmented';
import { DEFAULT_MONEY, copyShareUrl, moneyFromQuery, onMoney, replaceOwnParams } from '../lib/url';

export interface AdvisorProps {
  advisor: AdvisorData;
  models: Model[];
  plans: Plan[];
  relatedPosts: RelatedPost[];
}

type State = Omit<AdvisorInput, 'fxRate' | 'vat'>;

const KEYS = { toolId: 't', hours: 'h', modeId: 'u', currentPlanId: 'c', frequency: 'f', workDays: 'wd' } as const;
const STATUS_LABEL: Record<PlanStatus, string> = { short: '한도 초과', tight: '한도 근접', ok: '여유' };
const FREQ_IDS: LimitFrequency[] = ['none', 'sometimes', 'often', 'daily'];

function toQuery(s: State, d: State): string {
  const q = new URLSearchParams();
  for (const [field, key] of Object.entries(KEYS) as [keyof State, string][]) {
    if (s[field] !== d[field] && s[field] !== null) q.set(key, String(s[field]));
  }
  return q.toString();
}

function fromQuery(search: string, d: State, data: AdvisorData, plans: Plan[]): State {
  const q = new URLSearchParams(search);
  const s = { ...d };
  const tool = data.tools.find((t) => t.id === q.get(KEYS.toolId));
  if (tool) s.toolId = tool.id;
  const h = Number(q.get(KEYS.hours));
  if (q.has(KEYS.hours) && Number.isFinite(h)) s.hours = Math.min(12, Math.max(0.5, h)); // 슬라이더 범위와 같게
  const mode = q.get(KEYS.modeId);
  if (data.modes.some((m) => m.id === mode)) s.modeId = mode!;
  // 지금 요금제는 선택한 도구의 요금제만 받는다
  const cur = q.get(KEYS.currentPlanId);
  const toolPlans = data.tools.find((t) => t.id === s.toolId)?.plans ?? [];
  if (cur === 'none' || toolPlans.some((p) => p.planId === cur)) s.currentPlanId = cur!;
  const f = q.get(KEYS.frequency) as LimitFrequency | null;
  if (f && FREQ_IDS.includes(f)) s.frequency = f;
  const wd = Number(q.get(KEYS.workDays));
  if (q.has(KEYS.workDays) && Number.isFinite(wd)) s.workDays = Math.min(31, Math.max(1, wd));
  return s;
}

/** "Claude Max 20x" → 화면 폭이 좁을 때 쓰는 짧은 이름 */
const shortName = (name: string) => name.replace(/^(Claude|ChatGPT|Google AI)\s+/, '');

function reasonText(a: Advice, s: State, modeName: string, current: PlanFit | undefined, freqName: string): string {
  const rec = a.recommended;
  const usage = `하루 ${s.hours}시간, '${modeName}' 방식`;
  switch (a.reason) {
    case 'api-cheaper':
      return `${usage} 정도면 구독보다 쓴 만큼 내는 API가 조금 더 저렴합니다. 다만 매번 결제 걱정 없이 쓰고 싶다면 ${(a.fits.find((f) => f.status !== 'short') ?? a.fits.at(-1)!).plan.name} 요금제도 괜찮습니다.`;
    case 'fits':
      return rec!.status === 'tight'
        ? `${usage} 기준으로 ${rec!.plan.name} 요금제가 가장 경제적입니다. 다만 한도에 가끔 걸릴 수 있습니다.`
        : `${usage} 기준으로 ${rec!.plan.name} 요금제면 한도 걱정 없이 쓸 수 있습니다.`;
    case 'exceeds-all':
      return `${usage}이면 최상위 요금제로도 빠듯한 사용량입니다. ${rec!.plan.name} 요금제를 쓰면서, 한도에 걸릴 때는 API를 함께 쓰는 방법을 고려해 보세요.`;
    case 'upgrade':
      return `지금 ${current!.plan.name}에서 한도에 ${freqName} 걸린다면 ${rec!.plan.name} 요금제로 올리는 걸 추천합니다. 월 ${krwShort(rec!.krw - current!.krw)} 더 내면 한도 걱정이 크게 줄어듭니다.`;
    case 'upgrade-top':
      return `이미 최상위 요금제입니다. 한도에 걸릴 때는 API를 함께 쓰거나, 가벼운 작업을 더 저렴한 모델로 나눠 보세요.`;
    case 'keep':
      return s.frequency === 'sometimes'
        ? `한도에 가끔 걸리는 정도라면 지금 ${current!.plan.name} 요금제를 유지하는 게 가장 경제적입니다.`
        : `지금 ${current!.plan.name} 요금제가 사용량에 잘 맞습니다.`;
    case 'downgrade':
      return `한도에 거의 걸리지 않는다면 ${rec!.plan.name} 요금제로 내려도 충분할 가능성이 높습니다. 월 ${krwShort(current!.krw - rec!.krw)} 아낄 수 있습니다.`;
  }
}

/** 하루 사용 가능 시간을 범위로: 추정치라 한 점 대신 ±15% (예: 6 → "약 5~7시간") */
function hoursRange(h: number): string {
  if (h >= 16) return '하루 종일 써도 여유';
  const lo = Math.max(0.5, Math.round(h * 0.85 * 2) / 2);
  const hi = Math.round(h * 1.15 * 2) / 2;
  return lo === hi ? `하루 약 ${lo}시간까지` : `하루 약 ${lo}~${hi}시간까지`;
}

/** 상황에 맞는 블로그 글 하나 */
function pickPost(posts: RelatedPost[], toolId: string, planId: string | undefined): RelatedPost | undefined {
  const want = toolId !== 'claude-code' ? 'compare' : planId?.includes('max') ? 'max' : 'opus';
  return posts.find((p) => p.tags.includes(want)) ?? posts[0];
}

const withUtm = (url: string) => {
  const u = new URL(url);
  u.searchParams.set('utm_source', 'ai-cost-calc');
  u.searchParams.set('utm_medium', 'result');
  return u.toString();
};

export default function Advisor({ advisor, models, plans, relatedPosts }: AdvisorProps) {
  const DEFAULTS: State = {
    toolId: advisor.tools[0].id,
    hours: 4,
    modeId: 'pair',
    currentPlanId: 'none',
    frequency: null,
    workDays: advisor.defaultWorkDays,
  };
  const [state, setState] = useState<State>(DEFAULTS);
  const [money, setMoney] = useState(DEFAULT_MONEY);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setState(fromQuery(window.location.search, DEFAULTS, advisor, plans));
    // 환율·부가세는 아래 토큰 계산기의 파라미터(fx, vat)를 함께 쓰고, 바뀌면 이벤트로 따라간다
    setMoney(moneyFromQuery(window.location.search));
    setHydrated(true);
    return onMoney(setMoney);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const query = toQuery(state, DEFAULTS);
  useEffect(() => {
    if (hydrated) replaceOwnParams(Object.values(KEYS), query);
  }, [query, hydrated]);

  const set = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  const tool = advisor.tools.find((t) => t.id === state.toolId) ?? advisor.tools[0];
  const mode = advisor.modes.find((m) => m.id === state.modeId) ?? advisor.modes[0];
  const freq = advisor.limitFrequencies.find((f) => f.id === state.frequency) ?? advisor.limitFrequencies[0];
  const freqChosen = state.frequency !== null;
  const lowConfidence = tool.confidence === 'low';
  const a = useMemo(() => advise({ ...state, ...money }, advisor, models, plans), [state, money, advisor, models, plans]);
  const current = a.fits.find((f) => f.isCurrent);
  const rec = a.recommended;
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? id;

  const setTool = (toolId: string) => {
    const next = advisor.tools.find((t) => t.id === toolId)!;
    // 도구를 바꾸면 그 도구의 요금제가 아닌 "지금 요금제"는 초기화
    const keep = next.plans.some((p) => p.planId === state.currentPlanId);
    set({ toolId, currentPlanId: keep ? state.currentPlanId : 'none', frequency: keep ? state.frequency : null });
  };

  const copyLink = async () => {
    await copyShareUrl(Object.values(KEYS));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const recPrice = rec ? rec.krw : a.api.krw;
  const resultPost = pickPost(relatedPosts, state.toolId, rec?.plan.id ?? (current ? current.plan.id : undefined));
  const comparePost = relatedPosts.find((p) => p.tags.includes('compare'));
  const saving = a.api.krw - recPrice;

  return (
    <div className="advisor">
      <section className="card" aria-labelledby="q-title">
        <h2 id="q-title" className="card-title">
          내 사용 패턴 <span className="muted small">5가지만 고르세요</span>
        </h2>

        <div className="q">
          <p className="q-label">1. 어떤 도구로 코딩하나요?</p>
          <Segmented label="코딩 도구" value={state.toolId} options={advisor.tools} onChange={setTool} />
          {comparePost && (
            <p className="q-help">
              아직 못 정했다면?{' '}
              <a href={withUtm(comparePost.url)} target="_blank" rel="noopener">
                도구별 가격·성능 비교 글 ↗
              </a>
            </p>
          )}
        </div>

        <div className="q">
          <label className="q-label" htmlFor="hours">
            2. 하루에 몇 시간 쓰나요? <strong className="q-value">{state.hours}시간</strong>
          </label>
          <input
            id="hours"
            className="range"
            type="range"
            min={0.5}
            max={12}
            step={0.5}
            value={state.hours}
            aria-valuetext={`하루 ${state.hours}시간`}
            onChange={(e) => set({ hours: Number(e.target.value) })}
          />
          <div className="range-scale" aria-hidden="true">
            {[0.5, 4, 8, 12].map((h) => (
              <span key={h} style={{ left: `${((h - 0.5) / 11.5) * 100}%` }}>
                {h < 1 ? '30분' : `${h}시간`}
              </span>
            ))}
          </div>
          <label className="inline-field">
            한 달 작업일
            <input
              type="number"
              min={1}
              max={31}
              value={state.workDays}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 1 && n <= 31) set({ workDays: n });
              }}
            />
            일
          </label>
        </div>

        <div className="q">
          <p className="q-label">3. 주로 어떻게 쓰나요?</p>
          <Segmented label="사용 방식" value={state.modeId} options={advisor.modes} onChange={(modeId) => set({ modeId })} wide />
        </div>

        <div className="q">
          <p className="q-label">4. 지금 쓰는 요금제는?</p>
          <Segmented
            label="지금 요금제"
            value={state.currentPlanId}
            options={[{ id: 'none', name: '없음' }, ...tool.plans.map((p) => ({ id: p.planId, name: shortName(planName(p.planId)) }))]}
            onChange={(currentPlanId) => set({ currentPlanId, frequency: null })}
          />
        </div>

        {state.currentPlanId !== 'none' && (
          <div className="q">
            <p className="q-label">
              5. 그 요금제에서 사용 한도에 얼마나 자주 걸리나요? <span className="muted small">(선택하면 경험을 우선 반영)</span>
            </p>
            <Segmented
              label="한도에 걸리는 빈도"
              value={state.frequency}
              options={advisor.limitFrequencies}
              onChange={(frequency) => set({ frequency })}
            />
          </div>
        )}
      </section>

      <section className="card result" id="advisor-result" aria-labelledby="r-title">
        <p className="sr-only" aria-live="polite">
          {hydrated && `추천: ${rec ? `${rec.plan.name}, 월 ${krwShort(rec.krw)}` : `API 종량제, 월 약 ${krwShort(a.api.krw)}`}`}
        </p>
        <p className="eyebrow-inline">추천</p>
        <h2 id="r-title" className="result-title">
          {rec ? rec.plan.name : 'API 종량제 (쓴 만큼 결제)'}
          <span className="result-price">
            {rec ? `월 $${rec.plan.usdMonthly} · ${krwShort(rec.krw)}` : `월 약 ${krwShort(a.api.krw)}`}
          </span>
        </h2>
        <p className="result-reason">{reasonText(a, state, mode.name, current, freq.name)}</p>

        <ol className="plan-fits">
          {a.fits.map((f) => (
            <li key={f.plan.id} className={`fit s-${f.status}${rec?.plan.id === f.plan.id ? ' is-rec' : ''}`}>
              <div className="fit-head">
                <strong>{shortName(f.plan.name)}</strong>
                {f.isCurrent && <span className="pill">지금</span>}
                {rec?.plan.id === f.plan.id && <span className="pill rec">추천</span>}
              </div>
              <div className="fit-price">{krwShort(f.krw)}</div>
              {lowConfidence ? null : (
                <div className="meter" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, f.utilization * 100)}%` }} />
                </div>
              )}
              <div className="fit-status">
                {f.isCurrent && freqChosen
                  ? state.frequency === 'none'
                    ? '한도에 거의 안 걸림 (입력하신 경험)'
                    : `한도에 ${freq.name} 걸림 (입력하신 경험)`
                  : STATUS_LABEL[f.status]}
              </div>
              <div className="fit-cap">
                {hoursRange(f.agentHours / mode.intensity)}
                {lowConfidence && <span className="pill">참고값</span>}
              </div>
            </li>
          ))}
        </ol>
        <p className="muted small legend">
          '{mode.name}' 방식으로 이 요금제를 하루 몇 시간까지 쓸 수 있는지(추정)와 비교했습니다. 한도는 운영자 1명의 실사용 기록 기준입니다.
        </p>

        <div className="api-note">
          <p>
            <strong>같은 양을 쓴 만큼(API) 냈다면?</strong> 월 약 <strong>{krwShort(a.api.krw)}</strong>
            <span className="muted"> ({a.api.model.name} 기준)</span>
          </p>
          <p className="muted small">
            {!rec
              ? '→ 이 정도 사용량이면 쓴 만큼 내는 쪽이 더 쌉니다.'
              : saving > 0
                ? `→ 구독으로 월 약 ${krwShort(saving)} 아끼는 셈입니다. 사용량이 많을수록 구독이 유리합니다.`
                : '→ 금액만 보면 API가 비슷하거나 조금 싸지만, 구독은 정해진 금액으로 한도 걱정을 덜 수 있습니다.'}
          </p>
        </div>

        {tool.confidence === 'low' && (
          <p className="warn small">{tool.name} 쪽은 실사용 데이터가 없어 Claude Code 기준을 빌려 쓴 참고값입니다.</p>
        )}

        {resultPost && (
          <a className="result-post" href={withUtm(resultPost.url)} target="_blank" rel="noopener">
            <span>관련 글</span>
            <strong>{resultPost.title}</strong>
          </a>
        )}

        <details className="why">
          <summary>왜 이렇게 계산됐나요?</summary>
          <ul>
            <li>
              '{mode.name}' 방식은 에이전트에게 맡길 때보다 사용량이 적어서, 하루 {state.hours}시간을 에이전트 작업 약 {+a.loadHours.toFixed(1)}
              시간 분량으로 계산했습니다.
            </li>
            <li>{tool.basis}</li>
            <li>
              API 환산: 한 달 입력 약 {tokensM(a.monthlyTokens.inputM)}·출력 {tokensM(a.monthlyTokens.outputM)} 토큰, 프롬프트 캐싱
              반영, 환율 {money.fxRate.toLocaleString('ko-KR')}원/$, 부가세 {money.vat ? '포함' : '별도'}.
            </li>
            {current && freqChosen && <li>지금 요금제의 상태는 계산 대신 알려 주신 "한도에 걸리는 빈도"로 판단했습니다.</li>}
          </ul>
        </details>

        <button type="button" className="share" onClick={copyLink}>
          {copied ? '링크를 복사했습니다' : '이 결과 링크 복사'}
        </button>
      </section>
      {hydrated && (
        <MobileResultBar
          targetId="advisor-result"
          label={`추천: ${rec ? `${shortName(rec.plan.name)} · 월 ${krwShort(rec.krw)}` : `API 종량제 · 월 ${krwShort(a.api.krw)}`}`}
        />
      )}
    </div>
  );
}
