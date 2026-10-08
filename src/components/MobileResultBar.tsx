// 모바일에서 질문을 입력하는 동안 화면 아래에 추천 요약을 띄우고, 누르면 결과 카드로 이동한다.
// 결과 카드나 꼬리말(추정치 안내)이 화면에 보이면 숨긴다: 페이지 끝에서 안내문을 가리지 않게.
import { useEffect, useState } from 'react';

export default function MobileResultBar({ targetId, label }: { targetId: string; label: string }) {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const els = [document.getElementById(targetId), document.querySelector('.footer')].filter((el): el is Element => !!el);
    if (!els.length || !('IntersectionObserver' in window)) return;
    const visible = new Map<Element, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target, e.isIntersecting);
        setHidden([...visible.values()].some(Boolean));
      },
      { threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [targetId]);

  if (hidden) return null;
  return (
    <div className="mobile-bar">
      <span className="mobile-bar-label">{label}</span>
      <button
        type="button"
        onClick={() => {
          // "움직임 줄이기" 설정이면 부드러운 스크롤 대신 바로 이동
          const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          document.getElementById(targetId)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        }}
      >
        결과 보기
      </button>
    </div>
  );
}
