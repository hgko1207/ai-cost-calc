# AI 코딩 비용 계산기

하루 사용량을 넣으면 Claude·GPT·Gemini 모델별 API 월 비용과 구독 요금제(Pro, Max 등) 중 무엇이 유리한지 원화로 계산하는 정적 사이트.

- 스택: Astro 7 + React 19 (계산기만 React 아일랜드, 나머지는 정적 HTML)
- 서버 없음. `dist/`를 정적 호스팅에 올리면 끝.

## 명령어

```bash
npm install
npm run dev       # http://localhost:4321 개발 서버
npm test          # 계산 로직 테스트 (vitest)
npm run build     # dist/ 생성 (가격 JSON 스키마 검증 포함)
npm run preview   # 빌드 결과 미리보기
npm run usage     # 내 Claude Code 로그에서 토큰 사용량 집계 (숫자만)
```

## 가격 갱신 (모델 출시·가격 변경 시)

코드는 건드리지 않고 데이터만 고친다.

1. `src/data/prices.json`
   - `updatedAt`: 페이지에 표시되는 기준일
   - `models[]`: 단가는 모두 USD / 100만 토큰. `longContext`는 할증 구간이 있는 모델만.
   - `plans[]`: `krwMonthly`는 공식 원화가가 있을 때만, 없으면 `null`(USD × 환율로 계산).
     `capacityUsd`는 "API 환산 월 사용 가능액" 추정값, 근거는 `capacityBasis`에 적는다.
   - 항목마다 `sourceUrl`, `verifiedAt` 갱신
2. `npm test && npm run build`: 스키마가 맞지 않으면 빌드가 실패한다.
3. 커밋·푸시하면 자동 배포된다(아래 설정 후).

프리셋은 `src/data/presets.json`, 블로그 관련 글은 `src/data/related-posts.json`.

## URL 파라미터

| 키 | 의미 | 예 |
|---|---|---|
| `p` | 프리셋 (`light`, `daily`, `heavy`, `custom`) | `?p=heavy` |
| `m` | 비교 기준 모델 id | `&m=gpt-6-astra` |
| `in` / `out` / `d` | 하루 입력(M) / 하루 출력(K) / 월 작업일 | `&in=40` |
| `cr` / `cw` / `ctx` | 캐시 읽기% / 캐시 쓰기% / 평균 컨텍스트(K) | |
| `fx` / `vat` / `cap` | 환율 / 부가세(1) / 구독 한도 배율 | |
| `embed=1` | 계산기만 표시 (블로그 iframe용) | |

## 티스토리 글에 넣기

HTML 모드에서:

```html
<iframe src="https://hgko1207.github.io/ai-cost-calc/?embed=1&p=daily&m=opus-5-5"
        style="width:100%;height:1500px;border:0" loading="lazy"
        title="AI 코딩 비용 계산기"></iframe>
```

글마다 `p`, `m`을 바꿔 글 주제에 맞는 상태로 열 수 있다.

## 배포: GitHub Pages (현재 사용 중, 무료)

- 주소: https://hgko1207.github.io/ai-cost-calc/
- `main` 브랜치에 푸시하면 `.github/workflows/deploy.yml`이 테스트 → 빌드 → 배포를 자동으로 한다.
- 진행 상황: 저장소의 Actions 탭, 또는 `gh run watch`

## 다른 호스팅으로 옮기기 (Cloudflare Pages 등)

대역폭 무제한, 커스텀 도메인을 원하면 Cloudflare Pages(무료)로 옮길 수 있다.

1. Cloudflare 대시보드 → Workers & Pages → Create → Pages → Connect to Git → 이 저장소 선택
2. Build command `npm run build`, Output directory `dist`
3. 환경 변수: `SITE_URL` = 새 주소(예: `https://ai-cost-calc.pages.dev`), `BASE_PATH` = `/`
4. 옮긴 뒤에는 GitHub Pages 워크플로를 끄거나 지운다.

## 검색 노출

- Google Search Console, 네이버 서치어드바이저에 사이트 등록 후 `sitemap-index.xml` 제출
- 블로그 글 → 계산기 링크, 계산기 → 블로그 글 링크(`utm_source=ai-cost-calc`)로 서로 연결
