// 월간 가격 점검: 출처 링크 상태·확인일·종료 예정일을 모아 GitHub 이슈 본문(마크다운)을 stdout으로 낸다.
// 실행: node scripts/price-check.ts  (Node 24 타입 제거 실행, 의존성 없음)
// 링크가 깨져도 종료 코드는 0. 스크립트 자체 오류일 때만 실패한다.
import { readFileSync } from 'node:fs';
import { buildIssueBody, classify, collectSources, dateAlerts, type LinkStatus } from '../src/lib/priceCheck.ts';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../src/data/${p}`, import.meta.url), 'utf8'));
const prices = read('prices.json');
const team = read('team.json');
const posts = read('related-posts.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

async function check(url: string): Promise<LinkStatus> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': UA, 'Accept-Language': 'ko,en;q=0.8' },
      });
      const body = (await res.text()).slice(0, 2000);
      const status = classify(res.status, res.url, url, body);
      if (status !== 'error' || attempt === 2) return status;
    } catch {
      // 네트워크 오류·리디렉션 반복(로그인 요구 등)은 자동으로 판단할 수 없으므로 직접 확인으로 둔다
      if (attempt === 2) return 'manual';
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  return 'error';
}

const today = new Date().toISOString().slice(0, 10);
const sources = collectSources(prices, team, posts);
const checks = [];
for (const s of sources) checks.push({ ...s, status: await check(s.url) });
process.stdout.write(buildIssueBody(today, checks, dateAlerts(prices, today)) + '\n');
