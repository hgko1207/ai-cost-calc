// 팀·회사 도입 비용 비교: 인원 구성과 결제 주기를 받아 도입 방식별 월·연 비용을 보여준다.
import { useEffect, useMemo, useState } from 'react';
import type { Advisor, Model, Plan, Team } from '../lib/data';
import { krwShort } from '../lib/format';
import { evaluateTeam, type Billing, type TeamGroup } from '../lib/team';
import { copyShareUrl, replaceOwnParams } from '../lib/url';

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

// URL 키: tt=도구, b=결제주기, twd=작업일, {유형 첫 글자}c/{유형 첫 글자}h = 인원/시간
const groupKey = (typeId: string, k: 'c' | 'h') => `${typeId[0]}${k}`;
const STATUS_LABEL = { ok: '여유', tight: '빠듯함', short: '한도 초과', api: '쓴 만큼' } as const;

export default function TeamCalc({ team, advisor, models, plans }: TeamCalcProps) {
  const DEFAULTS: State = {
    toolId: team.tools[0].id,
    groups: team.userTypes.map((t) => ({ typeId: t.id, count: t.defaultCount, hours: t.defaultHours })),
    billing: 'annual',
    workDays: team.defaultWorkDays,
  };
  const OWN_KEYS = ['tt', 'b', 'twd', ...team.userTypes.flatMap((t) => [groupKey(t.id, 'c'), groupKey(t.id, 'h')])];

  const [state, setState] = useState<State>(DEFAULTS);
  const [money, setMoney] = useState({ fxRate: 1400, vat: false });
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const num = (k: string, min: number, max: number) => {
      const n = Number(q.get(k));
      return q.has(k) && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
    };
    setState({
      toolId: team.tools.some((t) => t.id === q.get('tt')) ? q.get('tt')! : DEFAULTS.toolId,
      billing: q.get('b') === 'monthly' ? 'monthly' : 'annual',
      workDays: num('twd', 1, 31) ?? DEFAULTS.workDays,
      groups: DEFAULTS.groups.map((g) => ({
        typeId: g.typeId,
        count: Math.round(num(groupKey(g.typeId, 'c'), 0, 10_000) ?? g.count),
        hours: num(groupKey(g.typeId, 'h'), 0.5, 16) ?? g.hours,
      })),
    });
    const fx = Number(q.get('fx'));
    setMoney({ fxRate: fx > 0 ? fx : 1400, vat: q.get('vat') === '1' });
    setHydrated(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (state.toolId !== DEFAULTS.toolId) q.set('tt', state.toolId);
    if (state.billing !== DEFAULTS.billing) q.set('b', state.billing);
    if (state.workDays !== DEFAULTS.workDays) q.set('twd', String(state.workDays));
    state.groups.forEach((g, i) => {
      if (g.count !== DEFAULTS.groups[i].count) q.set(groupKey(g.typeId, 'c'), String(g.count));
      if (g.hours !== DEFAULTS.groups[i].hours) q.set(groupKey(g.typeId, 'h'), String(g.hours));
    });
    return q.toString();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const setGroup = (i: number, patch: Partial<TeamGroup>) =>
    setState((s) => ({ ...s, groups: s.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));

  const copyLink = async () => {
    await copyShareUrl();
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
          <div className="q-options" role="radiogroup" aria-label="도입할 도구">
            {team.tools.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={state.toolId === t.id}
                className="opt"
                onClick={() => setState((s) => ({ ...s, toolId: t.id }))}
              >
                <strong>{t.name}</strong>
              </button>
            ))}
          </div>
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
                    <button type="button" aria-label="1명 줄이기" onClick={() => setGroup(i, { count: Math.max(0, g.count - 1) })}>
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={g.count}
                      aria-label={`${type.name} 인원 수`}
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value));
                        if (n >= 0 && n <= 10_000) setGroup(i, { count: n });
                      }}
                    />
                    <button type="button" aria-label="1명 늘리기" onClick={() => setGroup(i, { count: g.count + 1 })}>
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
                        const n = Number(e.target.value);
                        if (n >= 0.5 && n <= 16) setGroup(i, { hours: n });
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
          <div className="q-options" role="radiogroup" aria-label="결제 주기">
            {(
              [
                ['annual', '연간 결제', '좌석 단가가 약 20% 저렴'],
                ['monthly', '월간 결제', '인원 변동이 잦을 때'],
              ] as const
            ).map(([id, name, desc]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={state.billing === id}
                className="opt"
                onClick={() => setState((s) => ({ ...s, billing: id }))}
              >
                <strong>{name}</strong>
                <span>{desc}</span>
              </button>
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
                if (n >= 1 && n <= 31) setState((s) => ({ ...s, workDays: n }));
              }}
            />
            일
          </label>
        </div>
      </section>

      <section className="card result" aria-live="polite" aria-labelledby="team-r">
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
                </li>
              ))}
            </ul>
            {rec.lines.some((l) => l.status === 'tight') && (
              <p className="muted small hint">빠듯한 그룹은 한도에 자주 걸리면 상위 좌석·요금제로 바꾸는 게 좋습니다.</p>
            )}
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
              {krwShort(r.apiUsdPerAgentHour * money.fxRate)})으로 계산했습니다.
            </li>
            <li>달러 가격은 환율 {money.fxRate.toLocaleString('ko-KR')}원/$, 부가세 별도로 환산했습니다.</li>
          </ul>
        </details>

        <button type="button" className="share" onClick={copyLink}>
          {copied ? '링크를 복사했습니다' : '이 결과 링크 복사'}
        </button>
      </section>
    </div>
  );
}
