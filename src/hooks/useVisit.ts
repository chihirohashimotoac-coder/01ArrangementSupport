import { useCallback, useMemo, useState } from 'react';
import type { Dart } from '../domain/dart';
import {
  createVisit,
  recordThrow,
  undoThrow,
  type VisitState,
} from '../engine/recovery/visit';
import { suggestFor, type SuggestOptions } from '../engine/recovery/suggest';

/**
 * 1 ビジットの実戦入力。
 *
 * 1 投ごとに実際の着弾を記録し、そのつど提案を再計算する。
 * Bust したらビジット開始時の残りへ戻す（engine 側の責務）。
 */
export function useVisit(initialRemaining: number, options: SuggestOptions = {}) {
  const [visit, setVisit] = useState<VisitState>(() => createVisit(initialRemaining));

  const throwDart = useCallback((dart: Dart) => {
    setVisit((current) => recordThrow(current, dart));
  }, []);

  const undo = useCallback(() => {
    setVisit((current) => undoThrow(current));
  }, []);

  /** 現在の残りのまま次のビジットを始める。 */
  const nextVisit = useCallback(() => {
    setVisit((current) => createVisit(current.remaining));
  }, []);

  /** 残り点を指定してやり直す。 */
  const reset = useCallback((remaining: number) => {
    setVisit(createVisit(remaining));
  }, []);

  const suggestion = useMemo(
    () => suggestFor(visit.remaining, visit.dartsLeft, options),
    // options はページ側で useMemo 済みの値を渡す前提。
    [visit.remaining, visit.dartsLeft, options],
  );

  return { visit, suggestion, throwDart, undo, nextVisit, reset };
}
