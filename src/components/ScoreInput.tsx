import { useId, useRef, useState } from 'react';
import './ScoreInput.css';

export interface ScoreInputProps {
  /** 見出し（「残り点 LEFT」）。 */
  readonly label: string;
  /** 見出しの右に添える短い補足（「2〜170・このビジットで上がる」）。 */
  readonly hint?: string;
  readonly min: number;
  readonly max: number;
  /** 未入力のときに出す入力例（「例 103」）。 */
  readonly placeholder?: string;
  /** 現在の残り点。未入力なら null。 */
  readonly value: number | null;
  /** 有効な値になった時点で即座に呼ばれる。空欄に戻したときは null。 */
  readonly onChange: (value: number | null) => void;
  /**
   * 入力を「終えた」ことが明確になったときだけ呼ばれる（Enter / Done、
   * または値を書き換えたあとの blur）。入力途中の onChange では呼ばない。
   */
  readonly onCommit?: (value: number) => void;
}

const toDraft = (value: number | null) => (value === null ? '' : String(value));

/**
 * 残り点の入力。
 *
 * 実戦中はタップ数が少ないほど良いので、確定ボタンは置かない。
 * 有効な整数になった時点で即座に `onChange` を呼び、そのまま候補が再計算される。
 * 入力途中の一時的な無効値（103 を打つ途中の "1"）ではエラーを出さず、
 * blur したときだけ範囲外を指摘する。
 *
 * `onChange`（入力のたび）と `onCommit`（入力を終えたとき）は役割が違う。
 * 103 を打つ途中の "10" もそれ自体は合法な CHECKOUT 値なので、
 * 有効値になっただけで画面を動かすと入力中に視界が飛ぶ。画面移動のような
 * 「入力が終わった前提の処理」は `onCommit` 側でだけ行う。
 */
export function ScoreInput({
  label,
  hint,
  min,
  max,
  placeholder,
  value,
  onChange,
  onCommit,
}: ScoreInputProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = useState(() => toDraft(value));
  const [error, setError] = useState<string | null>(null);
  const [lastValue, setLastValue] = useState(value);
  /** 最後の commit 以降にユーザーが値を書き換えたか。 */
  const editedRef = useRef(false);

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

  /** 入力のたびに呼ばれる。有効な値になった時点で即座に親へ伝える。 */
  const handleInput = (raw: string) => {
    setDraft(raw);
    setError(null); // エラーは入力を終えた（blur した）ときだけ出す。
    editedRef.current = true;
    /*
     * 空欄も範囲外も、候補を出さない「未入力」として親へ伝える。
     * ここで前の値を残すと、入力欄が 171 なのに途中値 17 の候補が出たままになり、
     * 実戦で別の残り点のルートを読んでしまう。範囲外では計算しない、が仕様。
     */
    const parsed = parse(raw);
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

  /**
   * 入力の完了を親へ伝える。
   *
   * `explicit`（Enter / Done）は無条件。blur は、値を書き換えていたときだけにする。
   * 意図しない focus 移動で画面が飛ぶのを避けるため。
   */
  const commit = (raw: string, explicit: boolean) => {
    const parsed = parse(raw);
    const edited = editedRef.current;
    editedRef.current = false;
    if (parsed === null) return;
    if (!explicit && !edited) return;
    onCommit?.(parsed);
  };

  return (
    <div className="score-input">
      <label className="score-input__labels" htmlFor={inputId}>
        <span className="score-input__label">{label}</span>
        {hint && <span className="score-input__hint">{hint}</span>}
      </label>
      <div className="score-input__field">
        <input
          id={inputId}
          className="score-input__input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={3}
          placeholder={placeholder ?? '—'}
          value={draft}
          data-testid="score-input"
          onChange={(event) => handleInput(event.target.value)}
          /* タップしたら現在値を全選択し、次の数字でそのまま置き換えられるようにする。 */
          onFocus={(event) => event.target.select()}
          onBlur={(event) => {
            validate(event.target.value);
            commit(event.target.value, false);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const input = event.target as HTMLInputElement;
            validate(input.value);
            /*
             * commit → blur の順に呼ぶ。blur 側では commit 済みとして扱われるので
             * 二重に発火しない。実際の画面移動は keyboard が閉じるのを待ってから
             * 行う（親の onCommit 側の責務）。
             */
            commit(input.value, true);
            input.blur();
          }}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error !== null}
        />
      </div>
      {error && (
        <p className="score-input__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
