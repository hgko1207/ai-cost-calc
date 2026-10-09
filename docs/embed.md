# 티스토리 글에 계산기 넣기

글 편집기를 **HTML 모드**로 바꾼 뒤 아래 코드를 붙여 넣는다.

## 1. 기본 코드 (자동 높이)

계산기가 내용 높이를 알려 주고, 아래 `<script>`가 iframe 높이를 맞춘다. 결과가 바뀌어 길이가 달라져도 잘리거나 빈 공간이 생기지 않는다.

```html
<iframe class="aicalc" src="https://hgko1207.github.io/ai-cost-calc/personal/?embed=1"
        style="width:100%;height:1400px;border:0" loading="lazy" title="AI 코딩 요금제 계산기"></iframe>
<script>
addEventListener('message', function (e) {
  if (e.origin !== 'https://hgko1207.github.io' || !e.data || e.data.type !== 'aicalc:height') return;
  document.querySelectorAll('iframe.aicalc').forEach(function (f) {
    if (f.contentWindow === e.source) f.style.height = e.data.height + 'px';
  });
});
</script>
```

- 한 글에 계산기를 여러 개 넣어도 된다(`class="aicalc"`만 지키면 됨). `<script>`는 글당 한 번만 넣으면 된다.
- 티스토리가 `<script>`를 지우는 경우에도 `height:1400px` 고정 높이로 동작한다. 실측 높이(2026.10.7)는 글 폭 760px에서 개인 약 1,030px·팀 약 1,370px, 모바일(375px)에서 개인 약 1,420px·팀 약 1,820px이다. 팀 계산기를 모바일까지 고려하면 1,850px로 넣는다.

## 2. 글별 추천 주소

`src="..."`의 주소만 바꾼다. 글 주제에 맞는 상태로 열린다.

| 글 | 주소 | 열리는 상태 |
|---|---|---|
| [Claude Max 후기](https://hgko-dev.tistory.com/572) | `personal/?embed=1&c=claude-max-5x&u=agent&h=5` | 지금 Max 5x, 에이전트 작업 하루 5시간 |
| [Claude Opus 5.5 정리](https://hgko-dev.tistory.com/634) | `personal/?embed=1&u=agent&h=4` | Claude Code, 에이전트 작업 하루 4시간 |
| [GPT-6 Astra vs Claude Fable 5.1](https://hgko-dev.tistory.com/620) | `personal/?embed=1&t=codex` | Codex 기준 |
| 회사 도입 글 (새로 쓸 때) | `team/?embed=1` | 팀·회사 예산표, 10명 기본 |

주소 앞부분은 항상 `https://hgko1207.github.io/ai-cost-calc/` 이다. 다른 값은 [운영 가이드](maintaining.md)의 "URL 파라미터" 표를 참고한다.

## 3. 삽입 모드에서 달라지는 것

- 머리글 소개, 페이지 아래 설명·가격표·FAQ는 숨기고 계산기와 결과만 보인다.
- 결과 아래에 상황에 맞는 블로그 관련 글 1개가 나온다.
- 맨 위 "전체 화면에서 자세히 보기"로 원래 페이지를 새 탭에서 연다.
- 링크에는 `utm_source=ai-cost-calc`가 붙어 티스토리 유입 통계에서 구분된다.

## 4. 박스 효과 보기 (방문 측정)

계산기는 GoatCounter로 방문을 센다(쿠키 없음). 집계 화면: https://hgko-calc.goatcounter.com

- 글 안에 넣은 계산기도 집계된다. **Pages**에서 경로 끝에 "(삽입)"이 붙은 줄이 블로그 글 안에서 본 수다.
  - 예: `/ai-cost-calc/personal/ (삽입)`, `/ai-cost-calc/team/ (삽입)`
- 어느 글에서 봤는지는 **Top referrers**에 글 주소(예: `hgko-dev.tistory.com/572`)로 나온다.
  - 티스토리 글에 `<meta name="referrer" content="always">`가 있어 글 주소 전체가 넘어온다(2026.10.7 확인). iframe 코드에 `referrerpolicy`를 따로 넣지 않는다.
- 글 안에서 누른 버튼도 이름 끝에 "(삽입)"이 붙어 따로 센다.
  - 예: `개인: 결과 링크 복사 (삽입)`, `개인: 관련 글 클릭 (삽입)`
- 효과 비교: 박스를 붙인 날짜를 적어 두고, 그 전후 같은 기간(예: 2주)의 "(삽입)" 방문 수와 버튼 클릭 수를 비교한다.
- 광고 차단 프로그램을 쓰는 방문자는 집계되지 않으므로, 실제 수는 화면보다 조금 많다.
