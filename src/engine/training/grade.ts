/**
 * TRAINING の採点。
 *
 * 方針（本プロンプト 25 節）:
 *  - 数学的に成立するルートを単純に「不正解」にしない。
 *  - 成立するなら推奨度 S / A / B / C を付け、C でも「正解ではあるが非推奨」とする。
 *  - 非推奨の理由を必ず表示できるようにする。
 *  - 順番まで含めて別ルートとして扱う（26 節）。
 */
import { formatRoute, isFinishingDart, routeTotal, type Dart } from '../../domain/dart';
import { applyDart, isBogey } from '../../domain/checkoutRules';
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
import type { TrainingQuestion } from './questions';

/** 回答が成立しなかった理由。 */
export type InvalidReason =
  | 'EMPTY'
  | 'TOO_MANY_DARTS'
  | 'BUST'
  | 'NOT_DOUBLE_FINISH'
  | 'TOTAL_MISMATCH'
  | 'NOT_FINISHED';

export interface GradeResult {
  /** ルールとして成立しているか。 */
  readonly valid: boolean;
  readonly invalidReason: InvalidReason | null;
  readonly invalidMessageJa: string | null;
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
}

const INVALID_MESSAGES: Record<InvalidReason, string> = {
  EMPTY: '1 投も選ばれていません。',
  TOO_MANY_DARTS: '使える本数を超えています。',
  BUST: 'このルートは途中で Bust します（マイナス、または 1 残し）。',
  NOT_DOUBLE_FINISH: '最後の 1 投がダブル / BULL ではないため、上がりになりません。',
  TOTAL_MISMATCH: '合計が残り点と一致しません。',
  NOT_FINISHED: '3 本すべてを選んでください。',
};

function invalid(reason: InvalidReason, answer: readonly Dart[]): GradeResult {
  return {
    valid: false,
    invalidReason: reason,
    invalidMessageJa: INVALID_MESSAGES[reason],
    grade: null,
    checkoutEvaluation: null,
    setupEvaluation: null,
    bestCheckout: null,
    bestSetup: null,
    answerText: answer.length > 0 ? formatRoute(answer) : '（未回答）',
    finishDouble: null,
  };
}

/** CHECKOUT / RECOVERY の回答を採点する。 */
function gradeCheckoutAnswer(
  question: TrainingQuestion,
  answer: readonly Dart[],
): GradeResult {
  if (answer.length === 0) return invalid('EMPTY', answer);
  if (answer.length > question.dartsAvailable) return invalid('TOO_MANY_DARTS', answer);

  let remaining = question.remaining;
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
      routeTotal(answer) === question.remaining ? 'NOT_DOUBLE_FINISH' : 'TOTAL_MISMATCH',
      answer,
    );
  }

  const evaluation = evaluateCheckoutRoute(question.remaining, question.dartsAvailable, answer);
  const ranked = rankCheckoutRoutes(question.remaining, question.dartsAvailable);
  const finish = answer[answer.length - 1];

  return {
    valid: true,
    invalidReason: null,
    invalidMessageJa: null,
    grade: evaluation?.grade ?? 'C',
    checkoutEvaluation: evaluation,
    setupEvaluation: null,
    bestCheckout: ranked.length > 0 ? ranked[0] : null,
    bestSetup: null,
    answerText: formatRoute(answer),
    finishDouble: isFinishingDart(finish) ? finish.id : null,
  };
}

/** SETUP の回答を採点する。 */
function gradeSetupAnswer(question: TrainingQuestion, answer: readonly Dart[]): GradeResult {
  if (answer.length === 0) return invalid('EMPTY', answer);
  if (answer.length > question.dartsAvailable) return invalid('TOO_MANY_DARTS', answer);
  if (answer.length < question.dartsAvailable) return invalid('NOT_FINISHED', answer);

  let remaining = question.remaining;
  for (const dart of answer) {
    const result = applyDart(remaining, dart);
    if (result.outcome !== 'continue') return invalid('BUST', answer);
    remaining = result.remainingAfter;
  }

  const evaluation = evaluateSetupRoute(question.remaining, question.dartsAvailable, answer);
  const ranked = rankSetupRoutes(question.remaining, question.dartsAvailable, { maxRoutes: 1 });

  return {
    valid: true,
    invalidReason: null,
    invalidMessageJa: null,
    grade: evaluation?.grade ?? 'C',
    checkoutEvaluation: null,
    setupEvaluation: evaluation,
    bestCheckout: null,
    bestSetup: ranked.length > 0 ? ranked[0] : null,
    answerText: formatRoute(answer),
    finishDouble: null,
  };
}

/** 出題と回答から採点結果を作る。 */
export function gradeAnswer(question: TrainingQuestion, answer: readonly Dart[]): GradeResult {
  return question.kind === 'setup'
    ? gradeSetupAnswer(question, answer)
    : gradeCheckoutAnswer(question, answer);
}

/** 「正解」とみなすか（成立していれば正解、推奨度は別軸）。 */
export function isCorrect(result: GradeResult): boolean {
  return result.valid;
}

/** 非推奨（C ランク）の選択か。 */
export function isDiscouraged(result: GradeResult): boolean {
  return result.valid && result.grade === 'C';
}

/** SETUP 回答がノーテンを残したか。 */
export function leftBogey(result: GradeResult): boolean {
  return result.setupEvaluation !== null && isBogey(result.setupEvaluation.leave);
}
