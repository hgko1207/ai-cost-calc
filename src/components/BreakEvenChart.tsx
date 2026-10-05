// "구독이 유리한 구간" 차트: x = 하루 입력 토큰, y = 월 비용(원)
// API 비용은 사용량에 정비례하는 직선, 구독은 한도까지 평평한 선으로 그린다.
import { planKrw, usdToKrw, type PlanZone, type Settings } from '../lib/calc';
import { krwShort, tokensM } from '../lib/format';

interface Props {
  zones: PlanZone[];
  usdPerDailyM: number;
  settings: Settings;
  modelName: string;
}

const W = 640;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 40, left: 64 };
const PLAN_COLORS = ['var(--plan-1)', 'var(--plan-2)', 'var(--plan-3)', 'var(--plan-4)'];

function niceStep(max: number, count: number): number {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

export default function BreakEvenChart({ zones, usdPerDailyM, settings, modelName }: Props) {
  const krwPerM = usdToKrw(usdPerDailyM, settings);
  const current = settings.dailyInputM;
  const prices = zones.map((z) => planKrw(z.plan, settings));

  // y축은 구독료가 잘 보이도록 "가장 비싼 구독의 2배"와 "현재 API 비용의 1.3배" 중 큰 값까지만,
  // x축은 API 직선이 그 높이에 닿는 지점까지 그린다
  const yMaxRaw = Math.max(...prices.map((p) => p * 2), krwPerM * current * 1.3, 1);
  const yStep = niceStep(yMaxRaw, 4);
  const yMax = Math.ceil(yMaxRaw / yStep) * yStep;
  const xMaxRaw = Math.max(krwPerM > 0 ? yMax / krwPerM : 0, current * 1.3, 1);
  const xStep = niceStep(xMaxRaw, 5);
  const xMax = Math.ceil(xMaxRaw / xStep) * xStep;
  const apiEndX = krwPerM > 0 ? Math.min(xMax, yMax / krwPerM) : xMax;

  const px = (x: number) => PAD.left + (x / xMax) * (W - PAD.left - PAD.right);
  const py = (y: number) => H - PAD.bottom - (y / yMax) * (H - PAD.top - PAD.bottom);

  // x를 잘게 나눠 각 지점에서 가장 저렴한 선택지를 구하고, 구독이 이기는 구간을 띠로 칠한다
  const SAMPLES = 240;
  type Band = { planIdx: number; from: number; to: number };
  const bands: Band[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const x = ((i + 0.5) / SAMPLES) * xMax;
    let bestIdx = -1;
    let bestCost = krwPerM * x;
    zones.forEach((z, idx) => {
      if (x <= z.capacityM && prices[idx] < bestCost) {
        bestCost = prices[idx];
        bestIdx = idx;
      }
    });
    const from = (i / SAMPLES) * xMax;
    const to = ((i + 1) / SAMPLES) * xMax;
    const last = bands.at(-1);
    if (bestIdx >= 0 && last && last.planIdx === bestIdx && Math.abs(last.to - from) < 1e-9) last.to = to;
    else if (bestIdx >= 0) bands.push({ planIdx: bestIdx, from, to });
  }

  const xTicks = Array.from({ length: Math.round(xMax / xStep) + 1 }, (_, i) => i * xStep);
  const yTicks = Array.from({ length: Math.round(yMax / yStep) + 1 }, (_, i) => i * yStep);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${modelName} 사용량별 API 비용과 구독 요금 비교 차트`}>
        {bands.map((b, i) => (
          <rect
            key={i}
            x={px(b.from)}
            y={PAD.top}
            width={px(b.to) - px(b.from)}
            height={H - PAD.top - PAD.bottom}
            fill={PLAN_COLORS[b.planIdx % PLAN_COLORS.length]}
            opacity={0.12}
          />
        ))}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={py(t)} y2={py(t)} className="grid" />
            <text x={PAD.left - 8} y={py(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {krwShort(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={px(t)} y={H - PAD.bottom + 18} className="tick" textAnchor="middle">
            {tokensM(t)}
          </text>
        ))}
        <text x={(PAD.left + W - PAD.right) / 2} y={H - 4} className="axis-label" textAnchor="middle">
          하루 입력 토큰
        </text>

        {zones.map((z, i) => {
          const end = Math.min(z.capacityM, xMax);
          const color = PLAN_COLORS[i % PLAN_COLORS.length];
          return (
            <g key={z.plan.id}>
              <line x1={px(0)} x2={px(end)} y1={py(prices[i])} y2={py(prices[i])} stroke={color} strokeWidth={2.5} />
              {z.capacityM <= xMax && <circle cx={px(end)} cy={py(prices[i])} r={4} fill={color} />}
            </g>
          );
        })}

        <line x1={px(0)} y1={py(0)} x2={px(apiEndX)} y2={py(krwPerM * apiEndX)} className="api-line" />

        {current <= xMax && (
          <g>
            <line x1={px(current)} x2={px(current)} y1={PAD.top} y2={H - PAD.bottom} className="current-line" />
            <text x={px(current) + 4} y={PAD.top + 12} className="current-label">
              현재
            </text>
          </g>
        )}
      </svg>
      <ul className="chart-legend">
        <li>
          <span className="swatch api" /> {modelName} API
        </li>
        {zones.map((z, i) => (
          <li key={z.plan.id}>
            <span className="swatch" style={{ background: PLAN_COLORS[i % PLAN_COLORS.length] }} /> {z.plan.name}
          </li>
        ))}
        <li className="muted">● = 구독 한도 추정 지점</li>
      </ul>
    </figure>
  );
}
