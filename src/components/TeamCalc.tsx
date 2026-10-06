// 팀·회사 도입 비용 비교: 인원 구성과 결제 주기를 받아 도입 방식별 월·연 비용을 보여준다.
import { useEffect, useMemo, useState } from 'react';
import type { Advisor, Model, Plan, Team } from '../lib/data';
import { krwShort } from '../lib/format';
import { evaluateTeam, type Billing, type TeamGroup } from '../lib/team';
import MobileResultBar from './MobileResultBar';
import Segmented from './Segmented';
import {
  DEFAULT_MONEY,
  TEAM_LIMITS,
  copyShareUrl,
  moneyFromQuery,
  onMoney,
  replaceOwnParams,
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
  const [openId, setOpenId] = useState<string | null>(null);

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
  const maxMonthly = Math.max(...r.options.filter((o) => o.applicable).map((o) => o.monthlyKrw), 1);
  const typeName = (id: string) => team.userTypes.find((t) => t.id === id)?.name ?? id;

  /** "1인 하루 7시간 사용 · 좌석 한도 약 7.5시간 (93%)" */
  const usageText = (l: { typeId: string; loadHours: number; capacityAgentHours?: number; status: string }) => {
    const hours = state.groups.find((g) => g.typeId === l.typeId)?.hours ?? 0;
    if (!l.capacityAgentHours || l.loadHours <= 0) return `1인 하루 ${hours}시간 사용 · 좌석별 한도 없음`;
    const cap = (l.capacityAgentHours * hours) / l.loadHours; // 이 그룹의 사용 방식 기준 시간으로 환산
    if (cap >= 16) return `1인 하루 ${hours}시간 사용 · 한도 넉넉함`;
    return `1인 하루 ${hours}시간 사용 · 한도 약 ${+cap.toFixed(1)}시간 (${Math.round((l.loadHours / l.capacityAgentHours) * 100)}%)`;
  };

  const setGroup = (i: number, patch: Partial<TeamGroup>) =>
    setState((s) => ({ ...s, groups: s.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));

  const copyLink = async () => {
    await copyShareUrl([...OWN_KEYS, 'tab']);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="advisor">
      <section className="card" aria-labelledby="team-q">
        <h2 id="team-q" className="card-title">
          팀 구성 <span className="muted small">인원과 사용 정도를 입력하세요</span>
        </h2>

        <div className="q">
          <p className="q-label">1. 어떤 도구를 도입하나요?</p>
          <Segmented
            label="도입할 도구"
            value={state.toolId}
            options={team.tools.map((t) => ({ id: t.id, name: t.name }))}
            onChange={(toolId) => setState((s) => ({ ...s, toolId }))}
          />
        </div>

        <div className="q">
          <p className="q-label">
            2. 인원 구성 <strong className="q-value">총 {r.headcount}명</strong>
          </p>
          <div className="groups">
            {state.groups.map((g, i) => {
              const type = team.userTypes.find((t) => t.id === g.typeId)!;
              return (
                <div className="group" key={g.typeId}>
                  <div className="group-name">
                    <strong>{type.name}</strong>
                    <span>{type.description}</span>
                  </div>
                  <div className="stepper" role="group" aria-label={`${type.name} 인원`}>
                    <button type="button" aria-label={`${type.name} 1명 줄이기`} onClick={() => setGroup(i, { count: Math.max(0, g.count - 1) })}>
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={g.count}
                      aria-label={`${type.name} 인원 수`}
                      onChange={(e) => {
                        if (e.target.value.trim() === '') return; // 지우는 중에는 0명으로 바꾸지 않는다
                        const n = Math.round(Number(e.target.value));
                        if (n >= 0 && n <= TEAM_LIMITS.maxPeople) setGroup(i, { count: n });
                      }}
                    />
                    <button type="button" aria-label={`${type.name} 1명 늘리기`} onClick={() => setGroup(i, { count: Math.min(TEAM_LIMITS.maxPeople, g.count + 1) })}>
                      +
                    </button>
                    <span className="unit-text">명</span>
                  </div>
                  <label className="group-hours">
                    하루
                    <input
                      type="number"
                      min={0.5}
                      max={16}
                      step={0.5}
                      value={g.hours}
                      onChange={(e) => {
                        if (e.target.value.trim() === '') return;
                        const n = Number(e.target.value);
                        if (n >= TEAM_LIMITS.minHours && n <= TEAM_LIMITS.maxHours) setGroup(i, { hours: n });
                      }}
                    />
                    시간
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        <div className="q">
          <p className="q-label">3. 결제 주기</p>
          <Segmented<Billing>
            label="결제 주기"
            value={state.billing}
            options={[
              { id: 'annual', name: '연간 결제', description: '좌석 단가가 약 20% 저렴' },
              { id: 'monthly', name: '월간 결제', description: '인원 변동이 잦을 때' },
            ]}
            onChange={(billing) => setState((s) => ({ ...s, billing }))}
          />
          <label className="inline-field">
            한 달 작업일
            <input
              type="number"
              min={1}
              max={31}
              value={state.workDays}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 1 && n <= 31) setState((s) => ({ ...s, workDays: n }));
              }}
            />
            일
          </label>
        </div>
      </section>

      <section className="card result" id="team-result" aria-labelledby="team-r">
        <p className="sr-only" aria-live="polite">
          {hydrated && rec && `추천: ${rec.option.name}, 월 ${krwShort(rec.monthlyKrw)}, 연 ${krwShort(rec.annualKrw)}`}
        </p>
        <p className="eyebrow-inline">추천 도입 방식</p>
        {rec ? (
          <>
            <h2 id="team-r" className="result-title">
              {rec.option.name}
            </h2>
            <ul className="assign">
              {rec.lines.map((l) => (
                <li key={l.typeId}>
                  <span className="assign-who">
                    {typeName(l.typeId)} <strong>{l.count}명</strong>
                  </span>
                  <span className="assign-what">
                    {l.choice}
                    <span className={`assign-status st-${l.status}`}>{STATUS_LABEL[l.status]}</span>
                  </span>
                  <span className="assign-detail">{usageText(l)}</span>
                </li>
              ))}
            </ul>
            <p className="muted small hint">
              상태는 <strong>1인 기준</strong>입니다. 한 사람의 하루 사용 시간이 좌석 한도의 70% 이하면 여유, 70% 초과~100%면 한도 근접(가끔 걸릴 수 있음)입니다. 인원 수가 아니라 하루 사용
              시간을 바꾸면 달라집니다.
            </p>
            <dl className="totals">
              <div>
                <dt>월 비용</dt>
                <dd>{krwShort(rec.monthlyKrw)}</dd>
              </div>
              <div>
                <dt>연 비용</dt>
                <dd>{krwShort(rec.annualKrw)}</dd>
              </div>
              <div>
                <dt>1인당 월</dt>
                <dd>{krwShort(rec.perUserKrw)}</dd>
              </div>
            </dl>
            {rec.hasOverage && <p className="warn small">일부 인원은 좌석 한도를 넘어 추가 사용량 비용이 포함됐습니다. {tool.overageNote}.</p>}
          </>
        ) : (
          <h2 id="team-r" className="result-title">
            인원을 입력하세요
          </h2>
        )}

        <p className="list-label">도입 방식 비교 ({state.billing === 'annual' ? '연간 결제' : '월간 결제'} 기준)</p>
        <ol className="options-list">
          {r.options.map((o) => {
            const isRec = rec?.option.id === o.option.id;
            const open = openId === o.option.id;
            return (
              <li key={o.option.id} className={`option${isRec ? ' is-rec' : ''}${o.applicable ? '' : ' is-na'}`}>
                <button
                  type="button"
                  className="option-head"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : o.option.id)}
                >
                  <span className="option-name">
                    <strong>{o.option.name}</strong>
                    {isRec && <span className="pill rec">추천</span>}
                    {o.hasOverage && <span className="pill">추가 사용량 포함</span>}
                    {o.hasShortage && <span className="pill warn-pill">한도 초과 시 대기</span>}
                  </span>
                  {o.applicable ? (
                    <span className="option-cost">
                      <strong>월 {krwShort(o.monthlyKrw)}</strong>
                      <span>연 {krwShort(o.annualKrw)} · 1인 {krwShort(o.perUserKrw)}</span>
                    </span>
                  ) : (
                    <span className="option-cost na">{o.notApplicableReason}</span>
                  )}
                  {o.applicable && (
                    <span className="meter" aria-hidden="true">
                      <span style={{ width: `${Math.max(2, (o.monthlyKrw / maxMonthly) * 100)}%` }} />
                    </span>
                  )}
                </button>
                {open && (
                  <div className="option-body">
                    <p className="muted small">{o.option.summary}</p>
                    {o.applicable && (
                      <table className="lines">
                        <thead>
                          <tr>
                            <th scope="col">유형</th>
                            <th scope="col">배정</th>
                            <th scope="col">상태</th>
                            <th scope="col" className="num">1인 월</th>
                          </tr>
                        </thead>
                        <tbody>
                          {o.lines.map((l) => (
                            <tr key={l.typeId}>
                              <th scope="row">
                                {typeName(l.typeId)} {l.count}명
                              </th>
                              <td>{l.choice}</td>
                              <td className={`st-${l.status}`}>{STATUS_LABEL[l.status]}</td>
                              <td className="num">
                                {krwShort(l.unitKrw)}
                                {l.overageKrw > 0 && <span className="sub">추가 {krwShort(l.overageKrw)} 포함</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {o.billingNote && <p className="muted small">※ {o.billingNote}</p>}
                    <ul className="features">
                      {o.option.features.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    <a className="small" href={o.option.sourceUrl} target="_blank" rel="noopener">
                      공식 안내 보기 ↗
                    </a>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <p className="muted small api-excluded">
          API 종량제(쓴 만큼 결제)는 비교에서 뺐습니다. 서비스 개발, 자동화(CI·사내 봇), 클라우드 계약처럼 코딩 도구 구독과 다른 용도에 주로 씁니다.
        </p>

        <details className="why">
          <summary>왜 이렇게 계산됐나요?</summary>
          <ul>
            <li>사용 방식별로 하루 사용 시간을 "에이전트 작업 환산 시간"으로 바꾼 뒤, 각 좌석·요금제가 감당할 수 있는 시간과 비교했습니다 (개인 탭과 같은 기준).</li>
            <li>사람마다 감당 가능한 가장 싼 좌석을 배정하고, 한도를 넘는 사용량은 {tool.overageNote}.</li>
            <li>
              Enterprise 사용량과 좌석 한도 초과분은 API 요금({models.find((m) => m.id === tool.defaultModel)?.name} 기준, 에이전트 작업 하루 1시간당 월 약{' '}
              {krwShort(r.apiUsdPerAgentHour * money.fxRate * (money.vat ? 1.1 : 1))})으로 계산했습니다.
            </li>
            <li>
              달러 가격은 환율 {money.fxRate.toLocaleString('ko-KR')}원/$, 부가세 {money.vat ? '10% 포함' : '별도'}로 환산했습니다. 공식 원화 가격은 부가세 포함가로
              보고 같은 기준에 맞췄습니다.
            </li>
          </ul>
        </details>

        <button type="button" className="share" onClick={copyLink}>
          {copied ? '링크를 복사했습니다' : '이 결과 링크 복사'}
        </button>
      </section>
      {hydrated && rec && (
        <MobileResultBar targetId="team-result" label={`추천: ${rec.option.name} · 월 ${krwShort(rec.monthlyKrw)}`} />
      )}
    </div>
  );
}
