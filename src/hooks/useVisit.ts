import { useCallback, useMemo, useState } from 'react';
import type { Dart } from '../domain/dart';
import {
  createVisit,
  recordThrow,
  undoThrow,
  type VisitState,
} from '../engine/recovery/visit';
import { suggestFor, type SuggestOptions, type Suggestion } from '../engine/recovery/suggest';

/**
 * 1 ビジットの実戦入力。
 *
 * 1 投ごとに実際の着弾を記録し、そのつど提案を再計算する。
 * Bust したらビジット開始時の残りへ戻す（engine 側の責務）。
 *
 * 残り点が未入力のあいだは `visit` / `suggestion` が null になる。
 * 入力前に既定値の候補を出さないための、明示的な「まだ何もない」状態。
 */
export function useVisit(initialRemaining: number | null, options: SuggestOptions = {}) {
  const [visit, setVisit] = useState<VisitState | null>(() =>
    initialRemaining === null ? null : createVisit(initialRemaining),
  );

  const throwDart = useCallback((dart: Dart) => {
    setVisit((current) => (current === null ? null : recordThrow(current, dart)));
  }, []);

  const undo = useCallback(() => {
    setVisit((current) => (current === null ? null : undoThrow(current)));
  }, []);

  /** 現在の残りのまま次のビジットを始める。 */
  const nextVisit = useCallback(() => {
    setVisit((current) => (current === null ? null : createVisit(current.remaining)));
  }, []);

  /** 残り点を指定してやり直す。 */
  const reset = useCallback((remaining: number) => {
    setVisit(createVisit(remaining));
  }, []);

  /** 残り点を未入力へ戻す。 */
  const clear = useCallback(() => {
    setVisit(null);
  }, []);

  const suggestion = useMemo<Suggestion | null>(
    () => (visit === null ? null : suggestFor(visit.remaining, visit.dartsLeft, options)),
    // options はページ側で useMemo 済みの値を渡す前提。
    [visit, options],
  );

  return { visit, suggestion, throwDart, undo, nextVisit, reset, clear };
}
