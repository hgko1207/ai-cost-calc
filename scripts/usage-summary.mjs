// Claude Code 로컬 로그(~/.claude/projects/**/*.jsonl)에서 토큰 사용량 숫자만 집계한다.
// 대화 내용은 읽지 않고 message.usage / model / timestamp 만 사용한다.
// 사용: node scripts/usage-summary.mjs [--json out.json]
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(homedir(), '.claude', 'projects');
const IDLE_GAP_MS = 15 * 60 * 1000; // 15분 넘게 공백이면 작업 중단으로 간주

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

const emptyTotals = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0, requests: 0 });
const add = (t, u) => {
  t.input += u.input_tokens ?? 0;
  t.cacheWrite += u.cache_creation_input_tokens ?? 0;
  t.cacheRead += u.cache_read_input_tokens ?? 0;
  t.output += u.output_tokens ?? 0;
  t.requests += 1;
};

const seen = new Set();
const byDay = new Map();   // YYYY-MM-DD -> { totals, timestamps[] }
const byModel = new Map(); // model -> totals
const total = emptyTotals();

for await (const file of walk(ROOT)) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const msg = rec.message;
    if (rec.type !== 'assistant' || !msg?.usage || !rec.timestamp) continue;
    if (msg.model === '<synthetic>') continue;
    // 스트리밍 응답은 같은 메시지가 여러 줄로 기록되므로 중복 제거
    const key = `${msg.id}:${rec.requestId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const d = new Date(rec.timestamp);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!byDay.has(day)) byDay.set(day, { totals: emptyTotals(), ts: [] });
    const dayEntry = byDay.get(day);
    add(dayEntry.totals, msg.usage);
    dayEntry.ts.push(d.getTime());

    if (!byModel.has(msg.model)) byModel.set(msg.model, emptyTotals());
    add(byModel.get(msg.model), msg.usage);
    add(total, msg.usage);
  }
}

const activeHours = (ts) => {
  ts.sort((a, b) => a - b);
  let ms = 0;
  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1];
    if (gap <= IDLE_GAP_MS) ms += gap;
  }
  return ms / 3_600_000;
};

const days = [...byDay.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([day, { totals, ts }]) => ({ day, ...totals, activeHours: +activeHours(ts).toFixed(2) }));

const inputSide = (t) => t.input + t.cacheWrite + t.cacheRead;
const pct = (n, d) => (d ? +((n / d) * 100).toFixed(1) : 0);
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const totalHours = days.reduce((s, d) => s + d.activeHours, 0);
const summary = {
  range: { from: days[0]?.day, to: days.at(-1)?.day, activeDays: days.length },
  total,
  ratios: {
    cacheReadShareOfInput: pct(total.cacheRead, inputSide(total)),
    cacheWriteShareOfInput: pct(total.cacheWrite, inputSide(total)),
    uncachedShareOfInput: pct(total.input, inputSide(total)),
    outputPerInput: +(total.output / inputSide(total)).toFixed(4),
  },
  perActiveDay: {
    avgInputSide: Math.round(inputSide(total) / days.length),
    avgOutput: Math.round(total.output / days.length),
    medianInputSide: median(days.map(inputSide)),
    medianOutput: median(days.map((d) => d.output)),
    avgActiveHours: +(totalHours / days.length).toFixed(2),
  },
  perActiveHour: {
    inputSide: Math.round(inputSide(total) / totalHours),
    output: Math.round(total.output / totalHours),
    requests: +(total.requests / totalHours).toFixed(1),
  },
  byModel: Object.fromEntries(byModel),
  days,
};

const outIdx = process.argv.indexOf('--json');
if (outIdx > -1) await writeFile(process.argv[outIdx + 1], JSON.stringify(summary, null, 2));

const { days: _d, ...head } = summary;
console.log(JSON.stringify(head, null, 2));
const top = [...days].sort((a, b) => inputSide(b) - inputSide(a)).slice(0, 5);
console.log('\n상위 5일 (입력측 토큰):');
for (const d of top) console.log(`${d.day}  in=${inputSide(d).toLocaleString()}  out=${d.output.toLocaleString()}  hours=${d.activeHours}`);
