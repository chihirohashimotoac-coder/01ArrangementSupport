import { useState } from 'react';
import './ScoreInput.css';

export interface ScoreInputProps {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly value: number;
  readonly onCommit: (value: number) => void;
  /** よく使う値のショートカット。 */
  readonly presets?: readonly number[];
}

/** 残り点の入力。スマートフォンで数字キーパッドが出るようにしている。 */
export function ScoreInput({ label, min, max, value, onCommit, presets }: ScoreInputProps) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      setError(`${min}〜${max} の整数を入力してください。`);
      return;
    }
    setError(null);
    onCommit(parsed);
  };

  return (
    <div className="score-input">
      <label className="score-input__label">
        <span>{label}</span>
        <input
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          min={min}
          max={max}
          value={draft}
          data-testid="score-input"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit((event.target as HTMLInputElement).value);
            }
          }}
          aria-describedby={error ? 'score-input-error' : undefined}
          aria-invalid={error !== null}
        />
      </label>
      <button
        type="button"
        className="score-input__apply"
        data-testid="score-input-apply"
        onClick={() => commit(draft)}
      >
        セット
      </button>
      {presets && presets.length > 0 && (
        <div className="score-input__presets">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setDraft(String(preset));
                commit(String(preset));
              }}
            >
              {preset}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="score-input__error" id="score-input-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
