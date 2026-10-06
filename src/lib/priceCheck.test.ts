import { describe, expect, it } from 'vitest';
import { prices, relatedPosts, team } from './data';
import { buildIssueBody, classify, collectSources, dateAlerts, isStale } from './priceCheck';

describe('월간 가격 점검', () => {
  it('출처를 모으고 같은 URL은 한 번만', () => {
    const s = collectSources(prices, team, relatedPosts);
    expect(new Set(s.map((x) => x.url)).size).toBe(s.length);
    expect(s.some((x) => x.url.includes('claude.com/ko/pricing'))).toBe(true);
    expect(s.some((x) => x.label.startsWith('블로그:'))).toBe(true);
  });

  it('봇 차단은 "직접 확인", 404는 깨짐, 경로가 바뀌면 이동', () => {
    expect(classify(403, 'https://a.com/x', 'https://a.com/x')).toBe('manual');
    expect(classify(200, 'https://a.com/x', 'https://a.com/x', '<title>Just a moment...</title>')).toBe('manual');
    expect(classify(404, 'https://a.com/x', 'https://a.com/x')).toBe('broken');
    expect(classify(200, 'https://a.com/y', 'https://a.com/x')).toBe('moved');
    expect(classify(200, 'https://a.com/x/', 'https://a.com/x')).toBe('ok');
    expect(classify(500, 'https://a.com/x', 'https://a.com/x')).toBe('error');
    // 지원 문서 slug 붙는 리디렉션은 정상, 로그인 화면으로 보내면 직접 확인
    expect(classify(200, 'https://s.com/ko/articles/123-team', 'https://s.com/ko/articles/123')).toBe('ok');
    expect(classify(200, 'https://ai.dev/oauth2callback?x', 'https://ai.dev/docs/pricing')).toBe('manual');
  });

  it('확인일이 35일 넘으면 오래됨', () => {
    expect(isStale('2026-10-06', '2026-11-01')).toBe(false);
    expect(isStale('2026-10-06', '2026-11-11')).toBe(true);
  });

  it('종료·가격 변경 예정일 알림 (45일 이내·지난 것)', () => {
    const a = dateAlerts(prices, '2026-10-06');
    expect(a.map((x) => x.label)).toContain('Claude Haiku 4.5');
    expect(a.some((x) => x.kind === 'price-change')).toBe(false); // 2027-01-01은 아직 45일 밖
    expect(dateAlerts(prices, '2026-12-01').some((x) => x.kind === 'price-change')).toBe(true);
  });

  it('이슈 본문: 일정 → 링크 문제 → 체크리스트 순서', () => {
    const body = buildIssueBody(
      '2026-11-01',
      [
        { label: 'A', url: 'https://a.com', verifiedAt: '2026-09-01', status: 'ok' },
        { label: 'B', url: 'https://b.com', status: 'broken' },
      ],
      [{ label: 'Claude Haiku 4.5', date: '2026-10-15', kind: 'retire' }],
    );
    expect(body.indexOf('다가오는 일정')).toBeLessThan(body.indexOf('링크 문제'));
    expect(body).toContain('17일 지남');
    expect(body).toContain('오래됨');
    expect(body).toContain('- [ ] B');
  });
});
