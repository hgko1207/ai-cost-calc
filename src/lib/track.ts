// 방문 측정(GoatCounter) 이벤트. 광고 차단 등으로 스크립트가 없으면 조용히 넘어간다.
declare global {
  interface Window {
    goatcounter?: { count?: (vars: { path: string; title?: string; event?: boolean }) => void };
  }
}

/** 버튼·링크 클릭을 이벤트로 센다. 블로그 iframe 안이면 이름 끝에 "(삽입)"을 붙인다. */
export function track(name: string): void {
  try {
    const framed = window.self !== window.top;
    window.goatcounter?.count?.({ path: framed ? `${name} (삽입)` : name, event: true });
  } catch {
    // 측정 실패는 계산기 동작과 무관하므로 무시
  }
}
