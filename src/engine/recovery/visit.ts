/**
 * 1 ビジット（最大 3 投）の進行状態。
 *
 * CHECKOUT / SETUP のどちらでも同じ型を使い、1 投ごとに実際の着弾を
 * 積み上げていく。開始点が既知のときだけ Bust でビジット開始点へ戻す。
 */
import { MISS_DART, type Dart } from '../../domain/dart';
import {
  DARTS_PER_VISIT,
  applyDart,
  type BustReason,
} from '../../domain/checkoutRules';

export type VisitStatus = 'in-progress' | 'checkout' | 'bust';

export interface ThrownDart {
  readonly dart: Dart;
  /** この 1 投を投げる前の残り。 */
  readonly remainingBefore: number;
  /** この 1 投のあとの残り（Bust の場合はビジット開始時の残り）。 */
  readonly remainingAfter: number;
  readonly outcome: VisitStatus;
}

export interface VisitState {
  /** 参照開始時の残り。途中参照では本当のビジット開始点とは限らない。 */
  readonly visitStartRemaining: number;
  /** 本当のビジット開始点が記録されているか。 */
  readonly visitStartKnown: boolean;
  /** 参照開始時に使えた本数。Undo はこの本数を超えて戻らない。 */
  readonly initialDartsLeft: number;
  readonly thrown: readonly ThrownDart[];
  /** 現在の残り。 */
  readonly remaining: number;
  /** 残り本数。 */
  readonly dartsLeft: number;
  readonly status: VisitStatus;
  readonly bustReason: BustReason | null;
}

/** 新しいビジットを開始する。 */
export function createVisit(remaining: number): VisitState {
  return {
    visitStartRemaining: remaining,
    visitStartKnown: true,
    initialDartsLeft: DARTS_PER_VISIT,
    thrown: [],
    remaining,
    dartsLeft: DARTS_PER_VISIT,
    status: 'in-progress',
    bustReason: null,
  };
}

/** すでに進んだビジットを、現在の残りと使える本数から参照する。 */
export function createReferenceVisit(remaining: number, dartsLeft: 1 | 2 | 3): VisitState {
  return {
    ...createVisit(remaining),
    visitStartKnown: dartsLeft === DARTS_PER_VISIT,
    initialDartsLeft: dartsLeft,
    dartsLeft,
  };
}

/**
 * 1 投を記録する。
 * 「狙い」ではなく「実際にどこへ刺さったか」を渡す。MISS も指定できる。
 */
export function recordThrow(state: VisitState, dart: Dart): VisitState {
  if (state.status !== 'in-progress' || state.dartsLeft <= 0) return state;

  const result = applyDart(state.remaining, dart);
  const thrown: ThrownDart = {
    dart,
    remainingBefore: state.remaining,
    remainingAfter:
      result.outcome === 'bust' && state.visitStartKnown ? state.visitStartRemaining : result.remainingAfter,
    outcome: result.outcome === 'continue' ? 'in-progress' : result.outcome,
  };

  if (result.outcome === 'bust') {
    return {
      ...state,
      thrown: [...state.thrown, thrown],
      // Bust したビジットの得点は無効。開始時の残りへ戻す。
      // 開始点不明の BUST は復帰点を確定できない。参照点を仮の値として保持し、
      // UI では再入力まで次のビジットへ進ませない。
      remaining: state.visitStartKnown ? state.visitStartRemaining : state.remaining,
      dartsLeft: 0,
      status: 'bust',
      bustReason: result.bustReason,
    };
  }

  return {
    ...state,
    thrown: [...state.thrown, thrown],
    remaining: result.remainingAfter,
    dartsLeft: state.dartsLeft - 1,
    status: result.outcome === 'checkout' ? 'checkout' : 'in-progress',
    bustReason: null,
  };
}

/** 直前の 1 投を取り消す。 */
export function undoThrow(state: VisitState): VisitState {
  if (state.thrown.length === 0) return state;
  const remainingThrows = state.thrown.slice(0, -1);
  const last = remainingThrows[remainingThrows.length - 1];
  return {
    visitStartRemaining: state.visitStartRemaining,
    visitStartKnown: state.visitStartKnown,
    initialDartsLeft: state.initialDartsLeft,
    thrown: remainingThrows,
    remaining: last ? last.remainingAfter : state.visitStartRemaining,
    dartsLeft: state.initialDartsLeft - remainingThrows.length,
    status: 'in-progress',
    bustReason: null,
  };
}

/** MISS を 1 投記録する。 */
export function recordMiss(state: VisitState): VisitState {
  return recordThrow(state, MISS_DART);
}

/** ビジットが終わっているか（3 投使い切り / 上がり / Bust）。 */
export function isVisitFinished(state: VisitState): boolean {
  return state.status !== 'in-progress' || state.dartsLeft === 0;
}
