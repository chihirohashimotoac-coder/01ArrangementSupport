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
import { findDart, formatRoute, requireDart, type Dart } from '../../domain/dart';
import { DARTS_PER_VISIT } from '../../domain/checkoutRules';
import { rankCheckoutRoutes } from '../ranking/checkoutRanking';
import { rankSetupRoutes } from '../setup/enumerate';
import {
  checkoutDifferenceJa,
  describeLeaveJa,
  firstDartDifferenceJa,
  firstDartMissOutcomeJa,
  setupDifferenceJa,
  setupFullDifferenceJa,
  type WedgeLanding,
} from '../../data/trainingExplanations';
import type { TrainingQuestion } from './model';
import type { GradeResult } from './grade';
import {
  aimClassOfDart,
  findFirstDartOption,
  leaveVerdictOf,
  recommendedAdjustment,
  recommendedFullRoute,
  safeAimNumbersOf,
  setupFirstDartOptions,
  wedgeDartsOfDart,
  type LeaveVerdict,
  type SetupFirstDartOption,
} from './setupQuestions';

const LEAVE_VERDICT_SHORT_JA: Readonly<Record<LeaveVerdict, string>> = {
  checkoutable: '上がれる',
  bogey: 'ノーテン',
  'above-range': '170 超え',
  bust: 'Bust',
};

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
    if (question.format === 'setup-first-dart') {
      const best = recommendedFirstDartOption(question);
      return best ? [best.dart] : fallback;
    }
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

/**
 * SETUP 1 投調整で、推奨以外にも成立する回答（上位のみ）。
 *
 * 並び順は既存の SETUP ランキング（`rankSetupRoutes`）に従う。
 * 得点順に並べると「T20 → 残り 122」が先頭に来てしまい、
 * 「最後の 1 投は細かくずらして整える」という教材の意図から離れる。
 */
export function alternativeAdjustments(
  question: TrainingQuestion,
  recommendedId: string,
  limit = 3,
): readonly string[] {
  if (question.format !== 'setup-adjustment') return [];

  const current = question.currentRemaining;
  const recommendedNumber = requireDart(recommendedId === '' ? 'S20' : recommendedId).baseNumber;
  const texts: string[] = [];
  for (const aimNumber of safeAimNumbersOf(current)) {
    if (aimNumber === recommendedNumber) continue;
    texts.push(`${aimNumber} → ${wedgeLandingsOf(current, `S${aimNumber}`).map((landing) => `${landing.dartId} なら ${landing.leave}`).join(' / ')}`);
    if (texts.length >= limit) break;
  }
  return texts;
}

/** そのナンバーへ投げたときの 2 つの着弾（表示用）。 */
function wedgeLandingsOf(current: number, dartId: string): readonly WedgeLanding[] {
  const dart = findDart(dartId);
  if (!dart) return [];
  return wedgeDartsOfDart(dart).map((item) => ({
    dartId: item.id,
    leave: current - item.score,
    verdict: leaveVerdictOf(current - item.score),
  }));
}

/**
 * SETUP / FIRST DART で、推奨以外にも成立する第一ターゲット。
 *
 * 唯一の正解を固定しない（本仕様 5-6 節）。シングル落ち耐性を保ち、
 * 実戦の SETUP として成立する的は、推奨度に差があっても正解として示す。
 */
export function alternativeFirstDarts(
  question: TrainingQuestion,
  recommendedId: string,
  limit = 3,
): readonly string[] {
  if (question.format !== 'setup-first-dart') return [];
  const texts: string[] = [];
  for (const option of setupFirstDartOptions(question.currentRemaining)) {
    if (!option.singleMissSafe) continue;
    if (option.dart.id === recommendedId) continue;
    texts.push(`${option.dart.id}（推奨度 ${option.grade}）→ ${option.missDart.id} でも ${option.missLeave}`);
    if (texts.length >= limit) break;
  }
  return texts;
}

/** SETUP / FIRST DART でいちばん推奨する第一ターゲット。 */
function recommendedFirstDartOption(question: TrainingQuestion): SetupFirstDartOption | null {
  const options = setupFirstDartOptions(question.currentRemaining);
  return options.find((option) => option.singleMissSafe) ?? options[0] ?? null;
}

/**
 * 「シングルへ落ちたあと、そこからどうテンパイを作るか」の一例。
 * 通常 Practice と同じ SETUP ランキングの第 1 候補をそのまま使う。
 */
function missRecoveryHintJa(missLeave: number, dartsAfterMiss: number): string | null {
  if (dartsAfterMiss <= 0) return null;
  const best = rankSetupRoutes(missLeave, dartsAfterMiss, { maxRoutes: 1 })[0];
  if (best === undefined) return null;
  if (leaveVerdictOf(best.leave) !== 'checkoutable') return null;
  return `${best.routeText} で ${best.leave} 残しを作れます`;
}

function firstDartOutcomeJa(option: SetupFirstDartOption, dartsAfterMiss: number): string {
  return firstDartMissOutcomeJa({
    dartId: option.dart.id,
    missDartId: option.missDart.id,
    missLeave: option.missLeave,
    dartsAfterMiss,
    singleMissSafe: option.singleMissSafe,
    recoveryHintJa: option.singleMissSafe
      ? missRecoveryHintJa(option.missLeave, dartsAfterMiss)
      : null,
  });
}

function outcomeOfAnswer(question: TrainingQuestion, result: GradeResult): string {
  if (!result.ruleValid) return result.failureMessageJa ?? 'この回答は成立しません。';
  if (question.format === 'setup-first-dart') {
    const answerId = result.answerText;
    const option = findFirstDartOption(question.currentRemaining, answerId);
    if (option === null) {
      return result.failureMessageJa ?? 'この残りの得点ターゲットとしては選びません。';
    }
    return firstDartOutcomeJa(option, question.visitDartsAvailable - 1);
  }
  if (question.format === 'setup-adjustment') {
    const answerId = result.answerText;
    const landings = wedgeLandingsOf(question.currentRemaining, answerId);
    if (landings.length === 0) {
      return result.leave === null || result.leaveVerdict === null
        ? '—'
        : describeLeaveJa(result.leave, result.leaveVerdict);
    }
    const text = landings
      .map((landing) => `${landing.dartId} → 残り ${landing.leave}（${LEAVE_VERDICT_SHORT_JA[landing.verdict]}）`)
      .join(' / ');
    return text;
  }
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

  const isFirstDart = question.format === 'setup-first-dart';
  const dartsAfterMiss = question.visitDartsAvailable - 1;
  const recommendedOption = isFirstDart ? recommendedFirstDartOption(question) : null;
  const answeredOption =
    isFirstDart && answer.length === 1
      ? findFirstDartOption(question.currentRemaining, answer[0].id)
      : null;

  const recommendedOutcomeJa = isFirstDart
    ? recommendedOption === null
      ? '—'
      : firstDartOutcomeJa(recommendedOption, dartsAfterMiss)
    : isSetup && recommendedVerdict !== null
      ? describeLeaveJa(recommendedLeave, recommendedVerdict)
      : '上がりが成立します。';

  let differenceJa: string;
  if (isFirstDart) {
    differenceJa = firstDartDifferenceJa({
      answerDartId: answer.length === 1 ? answer[0].id : null,
      answerSafe: answeredOption?.singleMissSafe === true,
      answerIsCandidate: answeredOption !== null,
      answerMissDartId: answeredOption?.missDart.id ?? null,
      recommendedDartId: recommendedOption?.dart.id ?? recommended[0]?.id ?? '',
      recommendedMissDartId: recommendedOption?.missDart.id ?? '',
    });
  } else if (isSetup && question.format === 'setup-adjustment') {
    const answerId = answer.length === 1 ? answer[0].id : null;
    differenceJa = setupDifferenceJa({
      answerDartId: answerId,
      answerLandings: answerId === null ? [] : wedgeLandingsOf(question.currentRemaining, answerId),
      answerSafe:
        answerId !== null &&
        aimClassOfDart(question.currentRemaining, requireDart(answerId)) === 'safe',
      recommendedDartId: recommended[0]?.id ?? '',
      recommendedLandings:
        recommended.length === 1
          ? wedgeLandingsOf(question.currentRemaining, recommended[0].id)
          : [],
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
    alternativeTexts: isFirstDart
      ? alternativeFirstDarts(question, recommendedOption?.dart.id ?? '')
      : result.learningCorrect
        ? []
        : alternativeAdjustments(question, recommended[0]?.id ?? ''),
    answerLeave: result.leave,
    answerLeaveVerdict: result.leaveVerdict,
    recommendedLeave: isSetup && !isFirstDart ? recommendedLeave : null,
  };
}
