/**
 * TRAINING の採点。
 *
 * v1.3 では採点概念を 2 つに分ける（本仕様 7 節）。
 *
 *   ruleValid       … ルール上その回答が成立するか（合法か）
 *   learningCorrect … 学習目的として正解か
 *
 * CHECKOUT / RECOVERY では「合法な Double Out が完成した」= 両方 true。
 * SETUP では、合法に投げられても残りが Bogey / 170 超えなら
 * ruleValid = true / learningCorrect = false とする。
 * 主 UI の正答率は learningCorrect で数える（本仕様 8 節）。
 */
import { formatRoute, isFinishingDart, routeTotal, type Dart } from '../../domain/dart';
import { applyDart } from '../../domain/checkoutRules';
import type { RouteGrade } from '../../data/rankingRules';
import {
  evaluateCheckoutRoute,
  rankCheckoutRoutes,
  type RankedCheckoutRoute,
} from '../ranking/checkoutRanking';
import {
  evaluateSetupRoute,
  rankSetupRoutes,
  type RankedSetupRoute,
} from '../setup/enumerate';
import { leaveVerdictOf, type LeaveVerdict } from './setupQuestions';
import type { TrainingQuestion } from './model';

/** 回答が成立しなかった / 学習目的を満たさなかった理由。 */
export type FailureCode =
  | 'EMPTY'
  | 'TOO_MANY_DARTS'
  | 'BUST'
  | 'NOT_DOUBLE_FINISH'
  | 'TOTAL_MISMATCH'
  | 'NOT_FINISHED'
  | 'LEAVES_BOGEY'
  | 'LEAVE_ABOVE_CHECKOUT_RANGE';

/** ルール上そもそも成立しない理由（ruleValid = false になるもの）。 */
export const RULE_INVALID_CODES: readonly FailureCode[] = [
  'EMPTY',
  'TOO_MANY_DARTS',
  'BUST',
  'NOT_DOUBLE_FINISH',
  'TOTAL_MISMATCH',
  'NOT_FINISHED',
];

export interface GradeResult {
  /** ルールとして成立しているか。 */
  readonly ruleValid: boolean;
  /** 学習目的として正解か（主 UI の正答率はこちらを使う）。 */
  readonly learningCorrect: boolean;
  readonly failureCode: FailureCode | null;
  readonly failureMessageJa: string | null;
  /** 成立した場合の推奨度。 */
  readonly grade: RouteGrade | null;
  /** 回答ルートの評価（理由コードつき）。 */
  readonly checkoutEvaluation: RankedCheckoutRoute | null;
  readonly setupEvaluation: RankedSetupRoute | null;
  /** 最上位（基準）ルート。 */
  readonly bestCheckout: RankedCheckoutRoute | null;
  readonly bestSetup: RankedSetupRoute | null;
  /** 回答ルートの表示。 */
  readonly answerText: string;
  /** 上がりに使ったダブル（統計用）。 */
  readonly finishDouble: string | null;
  /** SETUP で回答後に残る点。 */
  readonly leave: number | null;
  readonly leaveVerdict: LeaveVerdict | null;
}

const FAILURE_MESSAGES: Record<FailureCode, string> = {
  EMPTY: '1 投も選ばれていません。',
  TOO_MANY_DARTS: '使える本数を超えています。',
  BUST: 'このルートは途中で Bust します（マイナス、または 1 残し）。',
  NOT_DOUBLE_FINISH: '最後の 1 投がダブル / BULL ではないため、上がりになりません。',
  TOTAL_MISMATCH: '合計が残り点と一致しません。',
  NOT_FINISHED: '使える本数ぶんすべてを選んでください。',
  LEAVES_BOGEY: 'ノーテンが残ります。次のラウンドで 3 本あっても上がれません。',
  LEAVE_ABOVE_CHECKOUT_RANGE: '残りが 170 を超えます。次のラウンドでは上がれません。',
};

function invalid(reason: FailureCode, answer: readonly Dart[]): GradeResult {
  return {
    ruleValid: false,
    learningCorrect: false,
    failureCode: reason,
    failureMessageJa: FAILURE_MESSAGES[reason],
    grade: null,
    checkoutEvaluation: null,
    setupEvaluation: null,
    bestCheckout: null,
    bestSetup: null,
    answerText: answer.length > 0 ? formatRoute(answer) : '（未回答）',
    finishDouble: null,
    leave: null,
    leaveVerdict: null,
  };
}

/** CHECKOUT / RECOVERY の回答を採点する。 */
function gradeCheckoutAnswer(
  question: TrainingQuestion,
  answer: readonly Dart[],
): GradeResult {
  if (answer.length === 0) return invalid('EMPTY', answer);
  if (answer.length > question.dartsAvailable) return invalid('TOO_MANY_DARTS', answer);

  let remaining = question.currentRemaining;
  for (let i = 0; i < answer.length; i += 1) {
    const result = applyDart(remaining, answer[i]);
    if (result.outcome === 'bust') {
      return invalid(
        result.bustReason === 'NOT_DOUBLE_FINISH' ? 'NOT_DOUBLE_FINISH' : 'BUST',
        answer,
      );
    }
    if (result.outcome === 'checkout') {
      if (i !== answer.length - 1) return invalid('TOTAL_MISMATCH', answer);
      remaining = 0;
      break;
    }
    remaining = result.remainingAfter;
  }
  if (remaining !== 0) {
    return invalid(
      routeTotal(answer) === question.currentRemaining ? 'NOT_DOUBLE_FINISH' : 'TOTAL_MISMATCH',
      answer,
    );
  }

  const evaluation = evaluateCheckoutRoute(
    question.currentRemaining,
    question.dartsAvailable,
    answer,
  );
  const ranked = rankCheckoutRoutes(question.currentRemaining, question.dartsAvailable);
  const finish = answer[answer.length - 1];

  return {
    ruleValid: true,
    // 数学的に成立する上がりは、C ランクでも学習上の正解とする。
    learningCorrect: true,
    failureCode: null,
    failureMessageJa: null,
    grade: evaluation?.grade ?? 'C',
    checkoutEvaluation: evaluation,
    setupEvaluation: null,
    bestCheckout: ranked.length > 0 ? ranked[0] : null,
    bestSetup: null,
    answerText: formatRoute(answer),
    finishDouble: isFinishingDart(finish) ? finish.id : null,
    leave: 0,
    leaveVerdict: null,
  };
}

/** SETUP の回答を採点する。 */
function gradeSetupAnswer(question: TrainingQuestion, answer: readonly Dart[]): GradeResult {
  if (answer.length === 0) return invalid('EMPTY', answer);
  if (answer.length > question.dartsAvailable) return invalid('TOO_MANY_DARTS', answer);
  if (answer.length < question.dartsAvailable) return invalid('NOT_FINISHED', answer);

  let remaining = question.currentRemaining;
  for (const dart of answer) {
    const result = applyDart(remaining, dart);
    if (result.outcome !== 'continue') return invalid('BUST', answer);
    remaining = result.remainingAfter;
  }

  const evaluation = evaluateSetupRoute(
    question.currentRemaining,
    question.dartsAvailable,
    answer,
  );
  const ranked = rankSetupRoutes(question.currentRemaining, question.dartsAvailable, {
    maxRoutes: 1,
  });

  const leave = remaining;
  const verdict = leaveVerdictOf(leave);
  const learningCorrect = verdict === 'checkoutable';
  const failureCode: FailureCode | null = learningCorrect
    ? null
    : verdict === 'above-range'
      ? 'LEAVE_ABOVE_CHECKOUT_RANGE'
      : 'LEAVES_BOGEY';

  return {
    // ルール上は合法に投げ切れている。
    ruleValid: true,
    learningCorrect,
    failureCode,
    failureMessageJa: failureCode === null ? null : FAILURE_MESSAGES[failureCode],
    grade: evaluation?.grade ?? 'C',
    checkoutEvaluation: null,
    setupEvaluation: evaluation,
    bestCheckout: null,
    bestSetup: ranked.length > 0 ? ranked[0] : null,
    answerText: formatRoute(answer),
    finishDouble: null,
    leave,
    leaveVerdict: verdict,
  };
}

/** 出題と回答から採点結果を作る。 */
export function gradeAnswer(question: TrainingQuestion, answer: readonly Dart[]): GradeResult {
  return question.kind === 'setup'
    ? gradeSetupAnswer(question, answer)
    : gradeCheckoutAnswer(question, answer);
}

/** 主 UI の正答率で「正解」とみなすか。 */
export function isCorrect(result: GradeResult): boolean {
  return result.learningCorrect;
}

/** 非推奨（C ランク）の選択か。 */
export function isDiscouraged(result: GradeResult): boolean {
  return result.ruleValid && result.grade === 'C';
}

/** SETUP 回答がノーテンを残したか。 */
export function leftBogey(result: GradeResult): boolean {
  return result.leaveVerdict === 'bogey';
}

/** SETUP 回答が 170 超えを残したか。 */
export function leftAboveCheckoutRange(result: GradeResult): boolean {
  return result.leaveVerdict === 'above-range';
}
