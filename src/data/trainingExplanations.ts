/**
 * TRAINING の feedback 表示文。
 *
 * 「何を答えればよかったか」を必ず伝える、という要件（本仕様 34 節）に対応する。
 * 判定そのものは engine が行い、ここでは表示用の日本語だけを組み立てる。
 */
import { findDart } from '../domain/dart';
import type { LeaveVerdict } from '../engine/training/setupQuestions';

export const LEAVE_VERDICT_LABEL_JA: Readonly<Record<LeaveVerdict, string>> = {
  checkoutable: '次のラウンドで上がれます',
  bogey: 'ノーテン（3 本あっても上がれません）',
  'above-range': '170 超え。次のラウンドでは上がれません',
  bust: 'Bust（残りが 2 未満になります）',
};

/** 「166（ノーテン）」のような 1 行。 */
export function describeLeaveJa(leave: number, verdict: LeaveVerdict): string {
  return `残り ${leave} — ${LEAVE_VERDICT_LABEL_JA[verdict]}`;
}

/** その 1 投が「何番を狙っているか」（表示用）。 */
function targetNumberOf(dartId: string): string | null {
  const dart = findDart(dartId);
  if (!dart) return null;
  if (dart.baseNumber === null) return dart.id === 'SB' ? 'S-BULL' : 'BULL';
  return String(dart.baseNumber);
}

export interface SetupDifferenceInput {
  readonly answerDartId: string | null;
  readonly answerLeave: number | null;
  readonly answerVerdict: LeaveVerdict | null;
  readonly recommendedDartId: string;
  readonly recommendedLeave: number;
}

/**
 * SETUP 1 投調整で「なぜ推奨解答なのか」を 1 文にする。
 *
 * 例: 「20 を続けると 166 が残るため、最後だけ 19 へずらします。」
 */
export function setupDifferenceJa(input: SetupDifferenceInput): string {
  const recommendedTarget = targetNumberOf(input.recommendedDartId) ?? input.recommendedDartId;
  if (input.answerDartId === null || input.answerLeave === null || input.answerVerdict === null) {
    return `${input.recommendedDartId} を狙うと ${input.recommendedLeave} が残り、次のラウンドで上がれます。`;
  }
  if (input.answerVerdict === 'checkoutable') {
    return `その回答でも次のラウンドで上がれます。${input.recommendedDartId} なら ${input.recommendedLeave} が残ります。`;
  }

  const answerTarget = targetNumberOf(input.answerDartId) ?? input.answerDartId;
  const problem =
    input.answerVerdict === 'bogey'
      ? `${answerTarget} を狙うと ${input.answerLeave} が残り、3 本あっても上がれません`
      : input.answerVerdict === 'above-range'
        ? `${answerTarget} を狙うと ${input.answerLeave} が残り、170 を超えて次のラウンドで上がれません`
        : `${answerTarget} を狙うと残りが 2 未満になり Bust します`;

  return `${problem}。最後だけ ${recommendedTarget} へずらすと ${input.recommendedLeave} が残ります。`;
}

/** SETUP 3 投フルで「なぜその組み立てか」を 1 文にする。 */
export function setupFullDifferenceJa(
  answerLeave: number | null,
  answerVerdict: LeaveVerdict | null,
  recommendedRouteText: string,
  recommendedLeave: number,
): string {
  if (answerLeave === null || answerVerdict === null) {
    return `${recommendedRouteText} なら ${recommendedLeave} が残り、次のラウンドで上がれます。`;
  }
  if (answerVerdict === 'checkoutable') {
    return `その組み立てでも次のラウンドで上がれます。${recommendedRouteText} なら ${recommendedLeave} が残ります。`;
  }
  const problem =
    answerVerdict === 'bogey'
      ? `${answerLeave} はノーテンで、3 本あっても上がれません`
      : answerVerdict === 'above-range'
        ? `${answerLeave} は 170 を超え、次のラウンドで上がれません`
        : '途中で Bust します';
  return `${problem}。${recommendedRouteText} なら ${recommendedLeave} が残ります。`;
}

/** CHECKOUT / RECOVERY で「何を答えればよかったか」を 1 文にする。 */
export function checkoutDifferenceJa(
  recommendedRouteText: string,
  remaining: number,
  dartsAvailable: number,
  answered: boolean,
): string {
  return answered
    ? `残り ${remaining} 点・${dartsAvailable} 本なら ${recommendedRouteText} で上がれます。`
    : `残り ${remaining} 点・${dartsAvailable} 本は ${recommendedRouteText} で上がれます。`;
}
