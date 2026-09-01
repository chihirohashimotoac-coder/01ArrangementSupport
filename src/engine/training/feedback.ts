/**
 * TRAINING の feedback。
 *
 * 要件（本仕様 34・35 節）:
 *  - どの問題でも、回答後に「何を答えればよかったか」が必ず分かる
 *  - 不成立（EMPTY / BUST / TOTAL_MISMATCH …）でも推奨解答を返す
 *
 * 表示順は
 *   1 判定 → 2 あなたの回答 → 3 その結果 → 4 おすすめ → 5 その結果 → 6 違いの理由 → 7 他の成立回答
 * とし、UI 側はこの構造をそのまま並べるだけでよいようにする。
 */
import { formatRoute, requireDart, type Dart } from '../../domain/dart';
import { DARTS_PER_VISIT } from '../../domain/checkoutRules';
import { rankCheckoutRoutes } from '../ranking/checkoutRanking';
import {
  checkoutDifferenceJa,
  describeLeaveJa,
  setupDifferenceJa,
  setupFullDifferenceJa,
} from '../../data/trainingExplanations';
import type { TrainingQuestion } from './model';
import type { GradeResult } from './grade';
import {
  adjustmentOutcomes,
  leaveVerdictOf,
  recommendedAdjustment,
  recommendedFullRoute,
  type LeaveVerdict,
} from './setupQuestions';

export interface TrainingFeedback {
  /** 1. 判定 */
  readonly verdictJa: string;
  readonly learningCorrect: boolean;
  readonly ruleValid: boolean;
  /** 2. あなたの回答 */
  readonly answerDartIds: readonly string[];
  readonly answerText: string;
  /** 3. あなたの回答の結果 */
  readonly answerOutcomeJa: string;
  /** 4. おすすめ回答 */
  readonly recommendedDartIds: readonly string[];
  readonly recommendedText: string;
  /** 5. おすすめ回答の結果 */
  readonly recommendedOutcomeJa: string;
  /** 6. 違いの理由 */
  readonly differenceJa: string;
  /** 7. 他の成立回答（必要な場合のみ） */
  readonly alternativeTexts: readonly string[];
  readonly answerLeave: number | null;
  readonly answerLeaveVerdict: LeaveVerdict | null;
  readonly recommendedLeave: number | null;
}

/** 出題に対する推奨解答。どの問題でも必ず 1 つ返す。 */
export function recommendedAnswerOf(question: TrainingQuestion): readonly Dart[] {
  const fallback = question.expectedAnswer.map((id) => requireDart(id));

  if (question.kind === 'setup') {
    if (question.format === 'setup-adjustment') {
      const dart = recommendedAdjustment(question.currentRemaining);
      return dart ? [dart] : fallback;
    }
    const route = recommendedFullRoute(question.startRemaining);
    return route ?? fallback;
  }

  const ranked = rankCheckoutRoutes(question.currentRemaining, question.dartsAvailable);
  if (ranked.length > 0) return ranked[0].darts;
  // ranking が空になるのは候補生成の invariant 違反。
  // PR #7 で保持している expectedRoute を最後の砦として使う。
  if (fallback.length > 0) return fallback;
  // それでも空なら「本数の制約を外せばこう上がれる」を示す（無回答よりは学べる）。
  const relaxed = rankCheckoutRoutes(question.currentRemaining, DARTS_PER_VISIT);
  return relaxed.length > 0 ? relaxed[0].darts : [];
}

/** SETUP 1 投調整で、推奨以外にも成立する回答（上位のみ）。 */
export function alternativeAdjustments(
  question: TrainingQuestion,
  recommendedId: string,
  limit = 3,
): readonly string[] {
  if (question.format !== 'setup-adjustment') return [];
  return adjustmentOutcomes(question.currentRemaining)
    .filter(
      (outcome) => outcome.verdict === 'checkoutable' && outcome.dart.id !== recommendedId,
    )
    .sort((a, b) => b.dart.score - a.dart.score || a.dart.id.localeCompare(b.dart.id))
    .slice(0, limit)
    .map((outcome) => `${outcome.dart.id} → 残り ${outcome.leave}`);
}

function outcomeOfAnswer(question: TrainingQuestion, result: GradeResult): string {
  if (!result.ruleValid) return result.failureMessageJa ?? 'この回答は成立しません。';
  if (question.kind === 'setup') {
    return result.leave === null || result.leaveVerdict === null
      ? '—'
      : describeLeaveJa(result.leave, result.leaveVerdict);
  }
  return '上がりが成立します。';
}

export function buildFeedback(
  question: TrainingQuestion,
  answer: readonly Dart[],
  result: GradeResult,
): TrainingFeedback {
  const recommended = recommendedAnswerOf(question);
  const recommendedText = formatRoute(recommended);
  const recommendedScore = recommended.reduce((sum, dart) => sum + dart.score, 0);

  const isSetup = question.kind === 'setup';
  const recommendedLeave = isSetup ? question.currentRemaining - recommendedScore : 0;
  const recommendedVerdict = isSetup ? leaveVerdictOf(recommendedLeave) : null;

  const verdictJa = result.learningCorrect
    ? `正解（推奨度 ${result.grade ?? '—'}）`
    : result.ruleValid
      ? `ルール上は成立しますが、学習目的では不正解 — ${result.failureMessageJa ?? ''}`
      : `成立しません — ${result.failureMessageJa ?? ''}`;

  const recommendedOutcomeJa =
    isSetup && recommendedVerdict !== null
      ? describeLeaveJa(recommendedLeave, recommendedVerdict)
      : '上がりが成立します。';

  let differenceJa: string;
  if (isSetup && question.format === 'setup-adjustment') {
    differenceJa = setupDifferenceJa({
      answerDartId: answer.length === 1 ? answer[0].id : null,
      answerLeave: result.leave,
      answerVerdict: result.leaveVerdict,
      recommendedDartId: recommended[0]?.id ?? '',
      recommendedLeave,
    });
  } else if (isSetup) {
    differenceJa = setupFullDifferenceJa(
      result.leave,
      result.leaveVerdict,
      recommendedText,
      recommendedLeave,
    );
  } else {
    differenceJa = checkoutDifferenceJa(
      recommendedText,
      question.currentRemaining,
      question.dartsAvailable,
      answer.length > 0,
    );
  }

  return {
    verdictJa,
    learningCorrect: result.learningCorrect,
    ruleValid: result.ruleValid,
    answerDartIds: answer.map((dart) => dart.id),
    answerText: result.answerText,
    answerOutcomeJa: outcomeOfAnswer(question, result),
    recommendedDartIds: recommended.map((dart) => dart.id),
    recommendedText,
    recommendedOutcomeJa,
    differenceJa,
    alternativeTexts: result.learningCorrect
      ? []
      : alternativeAdjustments(question, recommended[0]?.id ?? ''),
    answerLeave: result.leave,
    answerLeaveVerdict: result.leaveVerdict,
    recommendedLeave: isSetup ? recommendedLeave : null,
  };
}
