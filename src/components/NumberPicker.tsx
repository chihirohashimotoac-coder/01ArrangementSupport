import { memo } from 'react';
import { BOARD_NUMBERS } from '../domain/boardNumbers';
import './NumberPicker.css';

export interface NumberPickerProps {
  /** 選べるナンバー（既定は盤面の並び順で 1〜20 すべて）。 */
  readonly numbers?: readonly number[];
  readonly selected?: number | null;
  readonly onSelect?: (aimNumber: number) => void;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
}

/**
 * 「どのナンバーを狙うか」を選ぶ入力。
 *
 * SETUP の学習で決めるのは狙うナンバーであって、62 セグメントのどれに刺すかではない。
 * 盤面から 1 区画を選ばせると、シングル面とトリプル面のどちらを選ぶかという
 * 本題ではない迷いが生まれるため、ナンバーだけを選ばせる（v1.3.5）。
 *
 * 並びは盤面と同じ時計回り（20 → 1 → 18 → …）にして、
 * 「20 の隣は 1 と 5、18 はその外側」という位置関係がそのまま見えるようにする。
 */
function NumberPickerComponent({
  numbers = BOARD_NUMBERS,
  selected = null,
  onSelect,
  disabled = false,
  ariaLabel = '狙うナンバー',
}: NumberPickerProps) {
  return (
    <div className="number-picker" role="group" aria-label={ariaLabel}>
      {numbers.map((aimNumber) => (
        <button
          key={aimNumber}
          type="button"
          className="number-picker__button"
          data-testid={`aim-number-${aimNumber}`}
          aria-pressed={selected === aimNumber}
          disabled={disabled}
          onClick={() => onSelect?.(aimNumber)}
        >
          {aimNumber}
        </button>
      ))}
    </div>
  );
}

export const NumberPicker = memo(NumberPickerComponent);
