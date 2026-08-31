import { useId, useState } from 'react';
import './ScoreInput.css';

export interface ScoreInputProps {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  /** 現在の残り点。未入力なら null。 */
  readonly value: number | null;
  /** 有効な値になった時点で即座に呼ばれる。空欄に戻したときは null。 */
  readonly onChange: (value: number | null) => void;
  /** よく使う値のショートカット。 */
  readonly presets?: readonly number[];
}

const toDraft = (value: number | null) => (value === null ? '' : String(value));

/**
 * 残り点の入力。
 *
 * 実戦中はタップ数が少ないほど良いので、確定ボタンは置かない。
 * 有効な整数になった時点で即座に `onChange` を呼び、そのまま候補が再計算される。
 * 入力途中の一時的な無効値（103 を打つ途中の "1"）ではエラーを出さず、
 * blur したときだけ範囲外を指摘する。
 */
export function ScoreInput({ label, min, max, value, onChange, presets }: ScoreInputProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = useState(() => toDraft(value));
  const [error, setError] = useState<string | null>(null);
  const [lastValue, setLastValue] = useState(value);

  /*
   * 外から value が変わったとき（「次のビジットへ」で残り点が進んだ場合など）は
   * 入力欄も追従させる。追従しないと、古い残り点が表示されたままになる。
   * effect ではなくレンダー中に調整する（React 公式の推奨パターン）。
   */
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(toDraft(value));
    setError(null);
  }

  const parse = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '' || !/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
    return parsed;
  };

  /** 入力のたびに呼ばれる。有効になった瞬間だけ親へ伝える。 */
  const handleInput = (raw: string) => {
    setDraft(raw);
    if (raw.trim() === '') {
      setError(null);
      setLastValue(null);
      onChange(null);
      return;
    }
    const parsed = parse(raw);
    if (parsed === null) return; // 入力途中とみなし、画面は今の状態のまま保つ。
    setError(null);
    setLastValue(parsed);
    onChange(parsed);
  };

  /** 入力を終えた時点で、まだ範囲外なら理由を示す。空欄はエラーにしない。 */
  const validate = (raw: string) => {
    if (raw.trim() === '' || parse(raw) !== null) {
      setError(null);
      return;
    }
    setError(`${min}〜${max} の整数を入力してください。`);
  };

  const applyPreset = (preset: number) => {
    setDraft(String(preset));
    setError(null);
    setLastValue(preset);
    onChange(preset);
  };

  return (
    <div className="score-input">
      <div className="score-input__field">
        <label className="score-input__labels" htmlFor={inputId}>
          <span className="score-input__label">{label}</span>
          <span className="score-input__range">{min}〜{max}</span>
        </label>
        <input
          id={inputId}
          className="score-input__input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={3}
          placeholder="—"
          value={draft}
          data-testid="score-input"
          onChange={(event) => handleInput(event.target.value)}
          /* タップしたら現在値を全選択し、次の数字でそのまま置き換えられるようにする。 */
          onFocus={(event) => event.target.select()}
          onBlur={(event) => validate(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              validate((event.target as HTMLInputElement).value);
              (event.target as HTMLInputElement).blur();
            }
          }}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error !== null}
        />
      </div>
      {presets && presets.length > 0 && (
        <div className="score-input__presets">
          {presets.map((preset) => (
            <button key={preset} type="button" onClick={() => applyPreset(preset)}>
              {preset}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="score-input__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
