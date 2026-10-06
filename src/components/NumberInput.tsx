// 숫자 입력칸. 범위를 벗어나거나 숫자가 아니면 바로 안내하고, 칸을 벗어나면 마지막 올바른 값으로 되돌린다.
import { useEffect, useId, useState } from 'react';

export default function NumberInput(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
  onChange: (v: number) => void;
  ariaLabel?: string;
  className?: string;
  unit?: string; // 안내 문구용 단위 (예: "명", "시간", "일")
}) {
  const { value, min, max, step = 1, integer, onChange, ariaLabel, className, unit = '' } = props;
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  // 외부에서 값이 바뀌면(버튼, 프리셋, URL) 입력칸도 맞춘다
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    if (integer && !Number.isInteger(n)) return null;
    return n;
  };

  return (
    <span className={`num-input${error ? ' is-invalid' : ''}`}>
      <input
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        min={min}
        max={max}
        step={step}
        value={text}
        aria-label={ariaLabel}
        aria-invalid={!!error}
        aria-describedby={error ? id : undefined}
        className={className}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          setText(raw);
          const n = validate(raw);
          if (n === null) {
            setError(raw.trim() === '' ? null : `${min}~${max.toLocaleString('ko-KR')}${unit} 사이${integer ? ' 정수' : ''}로 입력하세요`);
          } else {
            setError(null);
            onChange(n);
          }
        }}
        onBlur={() => {
          if (validate(text) === null) {
            setText(String(value));
            setError(null);
          }
        }}
      />
      {error && (
        <span className="num-error" id={id} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
