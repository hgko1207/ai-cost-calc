// 회사 관리 기능 비교표: ✓ 지원 / ✗ 미지원 / — 확인 안 됨. 칸마다 출처 번호를 단다.
import type { FeatureCheck } from '../lib/data';

export interface FeatureColumn {
  name: string;
  checks: Record<string, FeatureCheck>;
  highlight?: boolean;
}

const MARK = { yes: '✓', no: '✗', unknown: '—' } as const;
const LABEL = { yes: '지원', no: '미지원', unknown: '확인 안 됨' } as const;

export default function FeatureChecks({ features, columns }: { features: { id: string; name: string }[]; columns: FeatureColumn[] }) {
  // 표에 나온 출처를 순서대로 번호 매김
  const sources: string[] = [];
  const refOf = (url?: string) => {
    if (!url) return 0;
    if (!sources.includes(url)) sources.push(url);
    return sources.indexOf(url) + 1;
  };
  const rows = features.map((f) => ({ f, cells: columns.map((c) => ({ c: c.checks[f.id], ref: refOf(c.checks[f.id]?.sourceUrl) })) }));

  return (
    <div className="feature-checks">
      <table>
        <thead>
          <tr>
            <th scope="col">회사 관리 기능</th>
            {columns.map((c) => (
              <th scope="col" key={c.name} className={c.highlight ? 'is-hl' : undefined}>
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ f, cells }) => (
            <tr key={f.id}>
              <th scope="row">{f.name}</th>
              {cells.map(({ c, ref }, i) => {
                const v = c?.value ?? 'unknown';
                return (
                  <td key={i} className={`fc fc-${v}${columns[i].highlight ? ' is-hl' : ''}`} title={c?.note}>
                    <span aria-hidden="true">{MARK[v]}</span>
                    <span className="sr-only">{LABEL[v]}</span>
                    {ref > 0 && (
                      <a className="fc-ref" href={sources[ref - 1]} target="_blank" rel="noopener" aria-label={`출처 ${ref}`}>
                        {ref}
                      </a>
                    )}
                    {c?.note && <span className="fc-note">{c.note}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fc-legend">✓ 지원 · ✗ 미지원 · — 공식 페이지로 확인 안 됨. 작은 숫자를 누르면 출처로 이동합니다.</p>
    </div>
  );
}
