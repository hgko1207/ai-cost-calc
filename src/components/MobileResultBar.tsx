// 모바일에서 질문을 입력하는 동안 화면 아래에 추천 요약을 띄우고, 누르면 결과 카드로 이동한다.
// 결과 카드가 화면에 보이면 숨긴다.
import { useEffect, useState } from 'react';

export default function MobileResultBar({ targetId, label }: { targetId: string; label: string }) {
  const [resultVisible, setResultVisible] = useState(true);

  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setResultVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [targetId]);

  if (resultVisible) return null;
  return (
    <div className="mobile-bar">
      <span className="mobile-bar-label">{label}</span>
      <button type="button" onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
        결과 보기
      </button>
    </div>
  );
}
