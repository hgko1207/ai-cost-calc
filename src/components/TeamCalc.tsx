// 팀·회사 도입 비용 비교: 인원 구성과 결제 주기를 받아 도입 방식별 월·연 예산표를 보여준다.
import { useEffect, useMemo, useState } from 'react';
import type { Advisor, Model, Plan, Team } from '../lib/data';
import { krwShort } from '../lib/format';
import { compareAlternative, evaluateTeam, type Billing, type GroupLine, type TeamGroup } from '../lib/team';
import { buildTeamSummary } from '../lib/teamSummary';
import { track } from '../lib/track';
import FeatureChecks from './FeatureChecks';
import MobileResultBar from './MobileResultBar';
import NumberInput from './NumberInput';
import Segmented from './Segmented';
import {
  DEFAULT_MONEY,
  TEAM_LIMITS,
  copyShareUrl,
  moneyFromQuery,
  onMoney,
  replaceOwnParams,
  shareUrl,
  teamFromQuery,
  teamGroupKey as groupKey,
  teamToQuery,
} from '../lib/url';

export interface TeamCalcProps {
  team: Team;
  advisor: Advisor;
  models: Model[];
  plans: Plan[];
}

interface State {
  toolId: string;
  groups: TeamGroup[];
  billing: Billing;
  workDays: number;
}

const STATUS_LABEL = { ok: '여유', tight: '한도 근접', short: '한도 초과', api: '쓴 만큼 결제' } as const;
const MARK = { yes: '✓', no: '✗', unknown: '—' } as const;

/** "Codex (ChatGPT)" → "Codex", "Gemini Code Assist" → "Gemini": 선택 버튼용 짧은 도구 이름 */
const toolLabel = (name: string) => name.replace(/\s*\(.*\)$/, '').replace(/ Code Assist$/, '');
/** "2026-10-06" → "2026.10.6" */
const dotDate = (iso: string) => iso.split('-').map(Number).join('.');

/** −/+ 버튼이 붙은 숫자 입력 */
function Stepper(props: { value: number; min: number; max: number; step: number; integer?: boolean; unit: string; label: string; onChange: (v: number) => void }) {
  const { value, min, max, step, integer, unit, label, onChange } = props;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`${label} ${step}${unit} 줄이기`} onClick={() => onChange(clamp(value - step))}>
        −
      </button>
      <NumberInput value={value} min={min} max={max} step={integer ? 1 : 0.5} integer={integer} unit={unit} ariaLabel={label} onChange={onChange} />
      <button type="button" aria-label={`${label} ${step}${unit} 늘리기`} onClick={() => onChange(clamp(value + step))}>
        +
      </button>
    </span>
  );
}

export default function TeamCalc({ team, advisor, models, plans }: TeamCalcProps) {
  const DEFAULTS: State = {
    toolId: team.tools[0].id,
    groups: team.userTypes.map((t) => ({ typeId: t.id, count: t.defaultCount, hours: t.defaultHours })),
    billing: 'annual',
    workDays: team.defaultWorkDays,
  };
  // lc·lh는 예전 '가벼운 사용자' 그룹 키. 공유 링크에 남지 않도록 함께 정리한다
  const OWN_KEYS = ['tt', 'b', 'twd', 'lc', 'lh', ...team.userTypes.flatMap((t) => [groupKey(t.id, 'c'), groupKey(t.id, 'h')])];

  const [state, setState] = useState<State>(DEFAULTS);
  const [money, setMoney] = useState(DEFAULT_MONEY);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null); // 예산표로 보는 도입 방식 (null = 추천)
  const [showWhy, setShowWhy] = useState(false);

  useEffect(() => {
    setState(teamFromQuery(window.location.search, DEFAULTS, team.tools.map((t) => t.id)));
    setMoney(moneyFromQuery(window.location.search));
    setHydrated(true);
    return onMoney(setMoney);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => teamToQuery(state, DEFAULTS), [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (hydrated) replaceOwnParams(OWN_KEYS, query);
  }, [query, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = useMemo(
    () => evaluateTeam({ ...state, ...money }, team, advisor, models, plans),
    [state, money, team, advisor, models, plans],
  );
  const tool = team.tools.find((t) => t.id === state.toolId) ?? team.tools[0];
  const rec = r.recommended;
  const view = r.options.find((o) => o.option.id === viewId && o.applicable) ?? rec;
  const typeName = (id: string) => team.userTypes.find((t) => t.id === id)?.name ?? id;
  const hoursOf = (typeId: string) => state.groups.find((g) => g.typeId === typeId)?.hours ?? 0;

  /** "이 좌석은 하루 약 7.5시간까지(추정)" */
  const capacityText = (l: GroupLine) => {
    const hours = hoursOf(l.typeId);
    if (!l.capacityAgentHours || l.loadHours <= 0) return '좌석별 한도 없음, 쓴 만큼 결제';
    const cap = (l.capacityAgentHours * hours) / l.loadHours; // 이 그룹의 사용 방식 기준 시간으로 환산
    if (cap >= 16) return '이 좌석은 한도가 넉넉함';
    return `이 좌석은 하루 약 ${Math.round(cap * 2) / 2}시간까지(추정)`;
  };

  const setGroup = (i: number, patch: Partial<TeamGroup>) =>
    setState((s) => ({ ...s, groups: s.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));

  const copyLink = async () => {
    await copyShareUrl([...OWN_KEYS, 'tab']);
    track('팀: 링크 복사');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const cmp = compareAlternative(r);
  const copySummary = async () => {
    const text = buildTeamSummary(r, {
      toolName: tool.name,
      billing: state.billing,
      vat: money.vat,
      fxRate: money.fxRate,
      groups: state.groups.map((g) => ({ name: typeName(g.typeId), count: g.count, hours: g.hours })),
      checkedAt: team.updatedAt,
      url: shareUrl([...OWN_KEYS, 'tab']),
    });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('아래 내용을 복사하세요', text);
    }
    track('팀: 결재용 요약 복사');
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const billingName = state.billing === 'annual' ? '연간' : '월간';

  return (
    <div className="advisor">
      <section className="card inputs" aria-labelledby="team-q">
        <h2 id="team-q" className="sr-only">
          팀 구성
        </h2>

        <div className="qf">
          <p className="qf-label">도입할 도구</p>
          <Segmented
            label="도입할 도구"
            value={state.toolId}
            options={team.tools.map((t) => ({ id: t.id, name: toolLabel(t.name) }))}
            onChange={(toolId) => {
              setState((s) => ({ ...s, toolId }));
              setViewId(null);
            }}
          />
        </div>

        <div className="qf">
          <p className="qf-label">
            인원과 하루 사용 시간 <strong className="q-value">총 {r.headcount}명</strong>
          </p>
          <div className="groups">
            {state.groups.map((g, i) => {
              const type = team.userTypes.find((t) => t.id === g.typeId)!;
              return (
                <div className="group" key={g.typeId}>
                  <p className="group-name">
                    <strong>{type.name}</strong>
                    <span>{type.description}</span>
                  </p>
                  <div className="group-ctl">
                    <Stepper
                      value={g.count}
                      min={0}
                      max={TEAM_LIMITS.maxPeople}
                      step={1}
                      integer
                      unit="명"
                      label={`${type.name} 인원`}
                      onChange={(count) => setGroup(i, { count })}
                    />
                    <span className="unit-text">명</span>
                    <span className="group-gap" />
                    <span className="unit-text">하루</span>
                    <Stepper
                      value={g.hours}
                      min={TEAM_LIMITS.minHours}
                      max={TEAM_LIMITS.maxHours}
                      step={1}
                      unit="시간"
                      label={`${type.name} 하루 사용 시간`}
                      onChange={(hours) => setGroup(i, { hours })}
                    />
                    <span className="unit-text">시간</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="qf">
          <p className="qf-label">결제 주기</p>
          <Segmented<Billing>
            label="결제 주기"
            value={state.billing}
            options={[
              { id: 'annual', name: '연간' },
              { id: 'monthly', name: '월간' },
            ]}
            onChange={(billing) => setState((s) => ({ ...s, billing }))}
          />
          <p className="qf-hint">{state.billing === 'annual' ? '연간이면 좌석 단가가 약 20% 싸요.' : '월간은 비싸지만 인원이 자주 바뀔 때 편해요.'}</p>
        </div>

        <label className="qf qf-row">
          <span className="qf-label">한 달 작업일</span>
          <span className="qf-row-input">
            <NumberInput value={state.workDays} min={1} max={31} integer unit="일" onChange={(workDays) => setState((s) => ({ ...s, workDays }))} />일
          </span>
        </label>
      </section>

      <section className="card result" id="team-result" aria-labelledby="team-r">
        <p className="sr-only" aria-live="polite">
          {hydrated && rec && `추천: ${rec.option.name}, 월 ${krwShort(rec.monthlyKrw)}, 연 ${krwShort(rec.annualKrw)}`}
        </p>
        {view ? (
          <>
            <div className="result-head">
              <div>
                <p className="eyebrow-inline">예산표{view === rec ? ' · 추천 도입 방식' : ''}</p>
                <h2 id="team-r" className="result-title">
                  {view.option.name}
                </h2>
                <p className="doc-meta">
                  {r.headcount}명 · {billingName} 결제 · 부가세 {money.vat ? '포함' : '별도'} · {dotDate(team.updatedAt)} 가격
                  {view.billingNote && ` · ${view.billingNote}`}
                </p>
              </div>
              <div className="result-total">
                <strong>월 {krwShort(view.monthlyKrw)}</strong>
                <span>
                  연 {krwShort(view.annualKrw)} · 1인 {krwShort(view.perUserKrw)}
                </span>
              </div>
            </div>

            <div className="doc-tabs" role="group" aria-label="도입 방식 바꿔 보기">
              {r.options.map((o) => (
                <button
                  key={o.option.id}
                  type="button"
                  className="doc-tab"
                  aria-pressed={o === view}
                  disabled={!o.applicable}
                  onClick={() => setViewId(o.option.id)}
                >
                  <strong>{o.option.name}</strong>
                  {o === rec && <span className="pill rec">추천</span>}
                  <span>{o.applicable ? `월 ${krwShort(o.monthlyKrw)}` : o.notApplicableReason}</span>
                </button>
              ))}
            </div>

            <table className="budget">
              <thead>
                <tr>
                  <th scope="col">좌석·요금제</th>
                  <th scope="col">대상</th>
                  <th scope="col" className="num">
                    1인 월
                  </th>
                  <th scope="col" className="num">
                    인원
                  </th>
                  <th scope="col" className="num">
                    월 금액
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.lines.map((l) => (
                  <tr key={l.typeId}>
                    <th scope="row">{l.choice}</th>
                    <td>
                      {typeName(l.typeId)}
                      <span className="sub">
                        하루 {hoursOf(l.typeId)}시간 · <span className={`st-${l.status}`}>{STATUS_LABEL[l.status]}</span>
                      </span>
                    </td>
                    <td className="num">
                      {krwShort(l.unitKrw)}
                      {l.overageKrw > 0 && <span className="sub">추가 사용량 {krwShort(l.overageKrw)} 포함</span>}
                    </td>
                    <td className="num">{l.count}</td>
                    <td className="num">{krwShort(l.unitKrw * l.count)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>
                    합계
                  </th>
                  <td className="num">{r.headcount}명</td>
                  <td className="num">
                    <strong>월 {krwShort(view.monthlyKrw)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>

            {view.hasOverage && <p className="warn small">일부 인원은 좌석 한도를 넘어 추가 사용량 비용이 포함됐습니다. {tool.overageNote}.</p>}
            {view.hasShortage && <p className="warn small">일부 인원은 좌석 한도를 넘습니다. {tool.overageNote}.</p>}

            {cmp?.kind === 'vs-individual' && (
              <p className="api-line">
                <span className="muted">각자 개인 구독을 지원하면 월 {krwShort(cmp.alt.monthlyKrw)}</span>
                <span className={cmp.monthlyDiff >= 0 ? 'good' : 'muted'}>
                  →{' '}
                  {cmp.monthlyDiff >= 0
                    ? `추천 방식으로 하면 월 ${krwShort(cmp.monthlyDiff)}(연 ${krwShort(cmp.annualDiff)}) 아낄 수 있어요`
                    : `월 ${krwShort(-cmp.monthlyDiff)} 더 싸지만 아래 관리 기능은 없어요`}
                </span>
              </p>
            )}
            {cmp?.kind === 'vs-team' && (
              <p className="api-line">
                <span className="muted">회사용 요금제({cmp.alt.option.name})로 바꾸면 월 {krwShort(cmp.monthlyDiff)} 더 들지만</span>
                <span>→ 회사 관리 기능을 쓸 수 있어요</span>
              </p>
            )}

            <div className="feat">
              <p className="qf-label">
                {view.option.name}의 관리 기능
                {team.features.some((f) => view.option.checks[f.id]?.value !== 'yes') && (
                  <span className="feat-legend">✓ 지원 · ✗ 미지원 · — 공식 페이지에서 확인 안 됨</span>
                )}
              </p>
              <ul className="feat-list">
                {team.features.map((f) => {
                  const v = view.option.checks[f.id]?.value ?? 'unknown';
                  return (
                    <li key={f.id} className={`fc-${v}`}>
                      <span aria-hidden="true">{MARK[v]}</span>
                      <span className="sr-only">{v === 'yes' ? '지원' : v === 'no' ? '미지원' : '확인 안 됨'}</span> {f.name}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="result-actions">
              <button type="button" className="share" onClick={copySummary}>
                {copiedSummary ? '요약을 복사했습니다' : '결재용 요약 복사'}
              </button>
              <button type="button" className="link-btn" onClick={copyLink}>
                {copied ? '링크를 복사했습니다' : '링크 복사'}
              </button>
              <button type="button" className="link-btn sub" aria-expanded={showWhy} aria-controls="team-why" onClick={() => setShowWhy((v) => !v)}>
                좌석 배정·계산 근거 {showWhy ? '▴' : '▾'}
              </button>
            </div>

            {showWhy && (
              <div className="why-panel" id="team-why">
                <p>
                  {view.option.summary}{' '}
                  <a href={view.option.sourceUrl} target="_blank" rel="noopener">
                    공식 안내 보기 ↗
                  </a>
                </p>
                <ul className="why-list">
                  {view.lines.map((l) => (
                    <li key={l.typeId}>
                      {typeName(l.typeId)} {l.count}명(1인 하루 {hoursOf(l.typeId)}시간) → {l.choice}: {capacityText(l)}
                    </li>
                  ))}
                  <li>모든 금액은 추정치입니다. 상태는 1인 기준으로, 하루 사용 시간이 좌석 한도의 70% 이하면 여유, 100% 이하면 한도 근접입니다.</li>
                  <li>사람마다 총비용(좌석 + 한도 초과분)이 가장 싼 좌석을 배정했습니다. {tool.overageNote}.</li>
                  <li>
                    Enterprise 사용량과 좌석 한도 초과분은 API 요금({models.find((m) => m.id === tool.defaultModel)?.name} 기준)으로 계산했습니다. 환율{' '}
                    {money.fxRate.toLocaleString('ko-KR')}원/$, 부가세 {money.vat ? '10% 포함' : '별도'}.
                  </li>
                  <li>API 종량제(쓴 만큼 결제)는 비교에서 뺐습니다. 서비스 개발·자동화처럼 코딩 도구 구독과 다른 용도에 주로 씁니다.</li>
                </ul>
                {rec && (
                  <FeatureChecks
                    features={team.features}
                    columns={[
                      { name: rec.option.name, checks: rec.option.checks, highlight: true },
                      ...(cmp ? [{ name: cmp.kind === 'vs-individual' ? '개인 구독 지원' : cmp.alt.option.name, checks: cmp.alt.option.checks }] : []),
                    ]}
                  />
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="eyebrow-inline">예산표</p>
            <h2 id="team-r" className="result-title">
              인원을 입력하세요
            </h2>
            <p className="result-reason">인원을 1명 이상 입력하면 도입 방식별 월·연 예산과 관리 기능을 비교해 드려요.</p>
          </>
        )}
      </section>
      {hydrated && rec && (
        <MobileResultBar targetId="team-result" label={`추천: ${rec.option.name} · 월 ${krwShort(rec.monthlyKrw)}`} />
      )}
    </div>
  );
}
