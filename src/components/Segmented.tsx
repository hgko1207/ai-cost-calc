// 라디오 그룹 형태의 선택 버튼. 탭 키로는 그룹에 한 번만 들어오고, 방향키로 선택을 옮긴다 (WAI-ARIA radio group 패턴).
import { useRef, type KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> {
  id: T;
  name: string;
  description?: string;
}

export default function Segmented<T extends string>(props: {
  label: string;
  value: T | null; // null = 아직 선택 안 함
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  wide?: boolean;
}) {
  const { label, value, options, onChange, wide } = props;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIdx = options.findIndex((o) => o.id === value);
  const focusIdx = selectedIdx >= 0 ? selectedIdx : 0;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = options.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? i === last ? 0 : i + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? i === 0 ? last : i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div
      className="q-options"
      role="radiogroup"
      aria-label={label}
      data-wide={wide || undefined}
      // 설명 없는 짧은 선택지는 회색 트랙 위 세그먼트 컨트롤로 보여 준다
      data-seg={!wide && options.every((o) => !o.description) ? '' : undefined}
    >
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          tabIndex={i === focusIdx ? 0 : -1}
          className="opt"
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          <strong>{o.name}</strong>
          {o.description && <span>{o.description}</span>}
        </button>
      ))}
    </div>
  );
}
