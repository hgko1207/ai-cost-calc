import { useEffect, useMemo, useState } from 'react';
import { compare, modelCost, planZones, uncachedPct, usdToKrw, type Settings } from '../lib/calc';
import type { Model, Plan, Preset, UsageValues, Vendor } from '../lib/data';
import { krw, krwShort, tokensM, usd } from '../lib/format';
import { fromQuery, toQuery, type CalcState } from '../lib/url';
import BreakEvenChart from './BreakEvenChart';

// 데이터는 빌드 시 zod로 검증한 뒤 props로 받는다 (클라이언트 번들에 zod를 넣지 않기 위해)
export interface CalculatorData {
  vendors: Vendor[];
  models: Model[];
  plans: Plan[];
  presets: Preset[];
}

const DEFAULT_PRESET_ID = 'daily';
const DEFAULT_MODEL_ID = 'opus-5-5';

function NumField(props: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  const { label, unit, value, onChange, min = 0, max, step = 1, hint } = props;
  // 입력 중인 문자열("1." 등)을 보존하려고 로컬 문자열 상태를 둔다
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value !== '' && Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min, n)));
          }}
        />
        <span className="unit">{unit}</span>
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export default function Calculator({ data }: { data: CalculatorData }) {
  const { presets, vendors } = data;
  const prices = data;
  const DEFAULTS = useMemo<CalcState>(() => {
    const preset = presets.find((p) => p.id === DEFAULT_PRESET_ID) ?? presets[0];
    return { ...preset.values, presetId: preset.id, modelId: DEFAULT_MODEL_ID, fxRate: 1400, vat: false, capacityScale: 1 };
  }, [presets]);
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? id;

  const [state, setState] = useState<CalcState>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const validIds = { presets: presets.map((p) => p.id), models: prices.models.map((m) => m.id) };
    // 프리셋이 지정되면 그 프리셋 값을 기준으로 나머지 파라미터를 덮어쓴다
    const preset = presets.find((p) => p.id === new URLSearchParams(window.location.search).get('p'));
    const base = preset ? { ...DEFAULTS, ...preset.values, presetId: preset.id } : DEFAULTS;
    setState(fromQuery(window.location.search, base, validIds));
    setHydrated(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 프리셋 값과 같은 항목은 URL에서 생략해 링크를 짧게 유지한다
  const activePreset = presets.find((p) => p.id === state.presetId);
  const query = toQuery(state, activePreset ? { ...DEFAULTS, ...activePreset.values } : DEFAULTS);
  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(query);
    if (new URLSearchParams(window.location.search).get('embed') === '1') params.set('embed', '1');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [query, hydrated]);

  const setUsage = (patch: Partial<UsageValues>) => setState((s) => ({ ...s, ...patch, presetId: 'custom' }));
  const set = (patch: Partial<CalcState>) => setState((s) => ({ ...s, ...patch }));

  const settings: Settings = state;
  const model = prices.models.find((m) => m.id === state.modelId) ?? prices.models[0];
  const result = useMemo(() => compare(model, prices.plans, settings), [model, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoneData = useMemo(() => planZones(model, prices.plans, settings), [model, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const costs = useMemo(
    () => prices.models.map((m) => modelCost(m, settings)).sort((a, b) => b.usd - a.usd),
    [state], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const maxUsd = Math.max(...costs.filter((c) => c.available).map((c) => c.usd), 1e-9);

  const shareUrl = () => `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ''}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
    } catch {
      window.prompt('아래 링크를 복사하세요', shareUrl());
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const zonesWithRange = zoneData.zones.filter((z) => z.hasZone);
  const best = result.best;

  return (
    <div className="calc">
      {/* ── 입력 ── */}
      <section className="card" aria-labelledby="input-title">
        <h2 id="input-title" className="card-title">사용 패턴</h2>
        <div className="presets" role="group" aria-label="프리셋">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className="preset"
              aria-pressed={state.presetId === p.id}
              onClick={() => set({ ...p.values, presetId: p.id })}
            >
              <strong>{p.name}</strong>
              <span>{p.description}</span>
            </button>
          ))}
          <button
            type="button"
            className="preset"
            aria-pressed={state.presetId === 'custom'}
            onClick={() => set({ presetId: 'custom' })}
          >
            <strong>직접 입력</strong>
            <span>아래 값을 바꾸면 자동 전환</span>
          </button>
        </div>

        <div className="fields">
          <NumField label="하루 입력 토큰" unit="M" step={0.5} value={state.dailyInputM} onChange={(v) => setUsage({ dailyInputM: v })} hint="캐시 포함 전체 입력 (1M = 100만)" />
          <NumField label="하루 출력 토큰" unit="K" step={5} value={state.dailyOutputK} onChange={(v) => setUsage({ dailyOutputK: v })} hint="1K = 1,000" />
          <NumField label="한 달 작업일" unit="일" max={31} value={state.workDays} onChange={(v) => setUsage({ workDays: v })} />
          <NumField label="환율" unit="원/$" step={10} min={1} value={state.fxRate} onChange={(v) => set({ fxRate: v })} />
        </div>
        <label className="check">
          <input type="checkbox" checked={state.vat} onChange={(e) => set({ vat: e.target.checked })} />
          달러 가격에 부가세 10% 포함 (국내 카드 결제 시 실제 청구액에 가까움)
        </label>

        <details className="advanced">
          <summary>고급 설정 — 캐시 비율 · 컨텍스트 · 구독 한도 가정</summary>
          <div className="fields">
            <NumField label="캐시 읽기 비율" unit="%" max={100} value={state.cacheReadPct} onChange={(v) => setUsage({ cacheReadPct: v })} hint="입력 중 캐시에서 읽은 비율" />
            <NumField label="캐시 쓰기 비율" unit="%" max={100} value={state.cacheWritePct} onChange={(v) => setUsage({ cacheWritePct: v })} hint={`나머지 ${uncachedPct(state)}%는 일반 입력`} />
            <NumField label="요청당 평균 컨텍스트" unit="K" step={10} min={1} max={2000} value={state.avgContextK} onChange={(v) => setUsage({ avgContextK: v })} hint="긴 컨텍스트 할증·최대 길이 판단에 사용" />
            <NumField label="구독 한도 가정 배율" unit="배" step={0.1} min={0.1} max={10} value={state.capacityScale} onChange={(v) => set({ capacityScale: v })} hint="1 = 기본 추정치. 한도가 더 넉넉하다고 보면 올리세요" />
          </div>
        </details>
      </section>

      {/* ── 결론 ── */}
      <section className="card verdict" aria-live="polite">
        <label className="model-select">
          <span>주로 쓸 모델</span>
          <select value={state.modelId} onChange={(e) => set({ modelId: e.target.value })}>
            {prices.vendors.map((v) => (
              <optgroup key={v.id} label={v.name}>
                {prices.models
                  .filter((m) => m.vendor === v.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        {!result.api.available ? (
          <p className="verdict-main">
            {model.name}는 최대 컨텍스트가 {model.contextWindowK}K라서 평균 {state.avgContextK}K 컨텍스트로는 쓸 수 없습니다.
          </p>
        ) : best.kind === 'plan' ? (
          <p className="verdict-main">
            <strong>{best.name}</strong> 구독이 유리합니다. API로 쓰면 월 <strong>{krwShort(result.apiKrw)}</strong>, 구독은{' '}
            <strong>{krwShort(best.krw)}</strong> → 월 <strong className="accent">{krwShort(result.savingKrw)}</strong> 절약
          </p>
        ) : result.options.some((o) => o.kind === 'plan' && o.covers) ? (
          <p className="verdict-main">
            <strong>API 종량제</strong>가 유리합니다. API 비용(월 <strong>{krwShort(result.apiKrw)}</strong>)이 구독료보다 적게 나옵니다.
          </p>
        ) : (
          <p className="verdict-main">
            이 사용량은 {vendorName(model.vendor)} 구독 한도(추정)를 모두 넘습니다. <strong>API 종량제</strong>로 월{' '}
            <strong>{krwShort(result.apiKrw)}</strong>이 예상됩니다. 더 저렴한 모델을 함께 비교해 보세요.
          </p>
        )}
        <p className="muted small">
          월 입력 {tokensM(state.dailyInputM * state.workDays)} · 출력 {tokensM((state.dailyOutputK / 1000) * state.workDays)} 토큰 기준
          {result.api.longContext && ' · 긴 컨텍스트 할증 단가 적용'}
        </p>

        <table className="options">
          <thead>
            <tr>
              <th scope="col">{vendorName(model.vendor)} 선택지</th>
              <th scope="col" className="num">월 비용</th>
              <th scope="col">이 사용량 감당</th>
            </tr>
          </thead>
          <tbody>
            {result.options.map((o) => (
              <tr key={o.id} className={o.id === best.id ? 'is-best' : undefined}>
                <th scope="row">
                  {o.name}
                  {o.id === best.id && <span className="badge">추천</span>}
                  {o.plan && <span className="sub">{o.plan.limitsNote}</span>}
                </th>
                <td className="num">
                  {krw(o.krw)}
                  {o.plan?.krwMonthly != null && <span className="sub">공식 원화가</span>}
                </td>
                <td>{o.kind === 'api' ? '사용한 만큼 과금' : o.covers ? '가능 (추정)' : '한도 초과 (추정)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="share" onClick={copyLink}>
          {copied ? '링크를 복사했습니다' : '이 결과 링크 복사'}
        </button>
      </section>

      {/* ── 구독 유리 구간 ── */}
      <section className="card" aria-labelledby="zone-title">
        <h2 id="zone-title" className="card-title">구독이 유리한 구간</h2>
        <p className="muted small">출력·캐시 비율은 그대로 두고 하루 입력 토큰만 늘렸을 때의 월 비용입니다. 색칠된 구간에서는 해당 구독이 가장 저렴합니다.</p>
        {result.api.available && (
          <BreakEvenChart zones={zoneData.zones} usdPerDailyM={zoneData.usdPerDailyM} settings={settings} modelName={model.name} />
        )}
        <ul className="zones">
          {zoneData.zones.map((z) => (
            <li key={z.plan.id}>
              <strong>{z.plan.name}</strong>:{' '}
              {z.hasZone
                ? `하루 입력 ${tokensM(z.breakEvenM)} ~ ${tokensM(z.capacityM)} 토큰 구간에서 API보다 저렴`
                : `한도(추정) 안에서는 API가 더 저렴 — 구독 이점 없음`}
            </li>
          ))}
          {zonesWithRange.length === 0 && <li className="muted">이 모델은 어떤 구독도 API보다 유리한 구간이 없습니다.</li>}
        </ul>
      </section>

      {/* ── 모델별 비교 ── */}
      <section className="card" aria-labelledby="models-title">
        <div className="card-head">
          <h2 id="models-title" className="card-title">모델별 API 월 비용</h2>
          <button type="button" className="link-btn" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
            {showTable ? '막대로 보기' : '표로 보기'}
          </button>
        </div>
        {!showTable ? (
          <ol className="bars">
            {costs.map((c) => (
              <li key={c.model.id} className={c.model.id === model.id ? 'is-selected' : undefined}>
                <button type="button" onClick={() => set({ modelId: c.model.id })} aria-label={`${c.model.name} 선택`}>
                  <span className="bar-label">
                    <span className={`dot v-${c.model.vendor}`} />
                    {c.model.name}
                    {c.longContext && <span className="tag">할증</span>}
                  </span>
                  <span className="bar-track">
                    {c.available ? (
                      <span className={`bar v-${c.model.vendor}`} style={{ width: `${Math.max(0.6, (c.usd / maxUsd) * 100)}%` }} />
                    ) : (
                      <span className="bar-na">컨텍스트 초과 (최대 {c.model.contextWindowK}K)</span>
                    )}
                  </span>
                  <span className="bar-value">{c.available ? krwShort(usdToKrw(c.usd, settings)) : '-'}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="table-wrap">
            <table className="detail">
              <thead>
                <tr>
                  <th scope="col">모델</th>
                  <th scope="col" className="num">입력</th>
                  <th scope="col" className="num">캐시 쓰기</th>
                  <th scope="col" className="num">캐시 읽기</th>
                  <th scope="col" className="num">출력</th>
                  <th scope="col" className="num">월 합계</th>
                </tr>
              </thead>
              <tbody>
                {costs.map((c) => (
                  <tr key={c.model.id}>
                    <th scope="row">
                      {c.model.name}
                      <span className="sub">
                        ${c.model.prices.input} / ${c.model.prices.output} per 1M{c.longContext && ' (할증 적용)'}
                      </span>
                    </th>
                    <td className="num">{usd(c.breakdown.input)}</td>
                    <td className="num">{usd(c.breakdown.cacheWrite)}</td>
                    <td className="num">{usd(c.breakdown.cacheRead)}</td>
                    <td className="num">{usd(c.breakdown.output)}</td>
                    <td className="num">
                      {c.available ? (
                        <>
                          <strong>{usd(c.usd)}</strong>
                          <span className="sub">{krw(usdToKrw(c.usd, settings))}</span>
                        </>
                      ) : (
                        '컨텍스트 초과'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">막대를 누르면 위 비교 기준 모델이 바뀝니다. "할증"은 긴 컨텍스트 단가가 적용된 모델입니다.</p>
      </section>

      <p className="disclaimer" role="note">
        ⚠ 이 계산 결과는 공개 가격과 가정값으로 만든 <strong>추정치</strong>입니다. 구독 요금제의 실제 사용 한도는 공개되지 않았고,
        토크나이저·캐시 동작·환율에 따라 실제 청구액은 달라질 수 있습니다.
      </p>
    </div>
  );
}
