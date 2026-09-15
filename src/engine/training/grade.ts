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
import {
  aimClassOfDart,
  findFirstDartOption,
  leaveVerdictOf,
  safeAimNumbersOf,
  safeLandingsOf,
  setupFirstDartOptions,
  unsafeLandingsOf,
  type LeaveVerdict,
  type SetupFirstDartOption,
} from './setupQuestions';
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
  | 'LEAVE_ABOVE_CHECKOUT_RANGE'
  | 'FIRST_DART_SINGLE_MISS_DEAD_END'
  | 'FIRST_DART_NOT_SCORING_TARGET'
  | 'ADJUST_WEDGE_SINGLE_MISS'
  | 'ADJUST_WEDGE_DEAD';

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
  FIRST_DART_SINGLE_MISS_DEAD_END:
    'その的は、同じナンバーのシングルへ落ちると、このラウンドでテンパイを作れなくなります。',
  FIRST_DART_NOT_SCORING_TARGET:
    'この問題で選ぶのは、得点しながら組み立てられるトリプルです。',
  ADJUST_WEDGE_SINGLE_MISS:
    'そのナンバーは、トリプルに入れば上がれますが、シングル面に入ると次のラウンドで上がれません。',
  ADJUST_WEDGE_DEAD: 'そのナンバーは、どこに入っても次のラウンドで上がれません。',
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

/**
 * SETUP 1 投調整の回答を採点する。
 *
 * この形式で答えるのは「どのナンバーのウェッジへ投げるか」であって、
 * 62 セグメントのどれに刺すかではない（v1.3.5）。したがって採点も
 * **狙ったナンバーに入ったときに起きうる 2 つの着弾**で見る。
 *
 *   learningCorrect … シングル面に入ってもトリプル面に入っても、
 *                     次のラウンドで上がれる残りになる
 *
 * 例: 現在 182
 *   20 を狙う → T20 なら 122 ○ / S20 なら 162 ×（ノーテン） → 不正解
 *   18 を狙う → T18 なら 128 ○ / S18 なら 164 ○            → 正解
 *
 * 「狙いどおりトリプルに入れば上がれる」だけでは正解にしない。
 * ラスト 1 投の調整は、外れ方まで含めて安全なナンバーを選ぶ判断だから。
 */
function gradeSetupAdjustmentAnswer(
  question: TrainingQuestion,
  answer: readonly Dart[],
): GradeResult {
  if (answer.length === 0) return invalid('EMPTY', answer);
  if (answer.length > 1) return invalid('TOO_MANY_DARTS', answer);

  const dart = answer[0];
  const current = question.currentRemaining;
  const applied = applyDart(current, dart);
  if (applied.outcome !== 'continue') return invalid('BUST', answer);

  const leave = applied.remainingAfter;
  const leaveVerdict = leaveVerdictOf(leave);
  const aimClass = aimClassOfDart(current, dart);

  /*
   * 安全なナンバーが 1 つも無い残り（190 以上など、どのシングル面でも 170 を
   * 超える場面）では、存在しない安全さを要求しない。
   * その場合だけ、従来どおり「実際に作った残りが上がれるか」で採点する。
   */
  const safeExists = safeAimNumbersOf(current).length > 0;
  const learningCorrect = safeExists ? aimClass === 'safe' : leaveVerdict === 'checkoutable';
  const failureCode: FailureCode | null = learningCorrect
    ? null
    : !safeExists
      ? leaveVerdict === 'above-range'
        ? 'LEAVE_ABOVE_CHECKOUT_RANGE'
        : 'LEAVES_BOGEY'
      : aimClass === 'partial'
        ? 'ADJUST_WEDGE_SINGLE_MISS'
        : 'ADJUST_WEDGE_DEAD';

  const evaluation = evaluateSetupRoute(current, 1, answer);
  const ranked = rankSetupRoutes(current, 1, { maxRoutes: 1 });

  return {
    // ルール上は合法に投げられている。
    ruleValid: true,
    learningCorrect,
    failureCode,
    failureMessageJa:
      failureCode === null
        ? null
        : safeExists
          ? adjustmentFailureMessageJa(current, dart)
          : FAILURE_MESSAGES[failureCode],
    // 判定と推奨度を食い違わせない。安全でないナンバーは推奨度も C。
    grade: learningCorrect ? (evaluation?.grade ?? 'C') : 'C',
    checkoutEvaluation: null,
    setupEvaluation: evaluation,
    bestCheckout: null,
    bestSetup: ranked.length > 0 ? ranked[0] : null,
    answerText: formatRoute(answer),
    finishDouble: null,
    leave,
    leaveVerdict,
  };
}

/** 「20 はトリプルなら 122、シングルなら 162 でノーテン」のように説明する。 */
function adjustmentFailureMessageJa(current: number, dart: Dart): string {
  const target = dart.baseNumber === null ? 'BULL エリア' : `${dart.baseNumber}`;
  const unsafe = unsafeLandingsOf(current, dart);
  const safe = safeLandingsOf(current, dart);
  const describe = (outcome: { dart: Dart; leave: number; verdict: LeaveVerdict }): string => {
    const reason =
      outcome.verdict === 'bogey'
        ? 'ノーテン'
        : outcome.verdict === 'above-range'
          ? '170 超え'
          : 'Bust';
    return `${outcome.dart.id} に入ると ${outcome.leave}（${reason}）`;
  };
  const unsafeText = unsafe.map(describe).join('、');
  if (safe.length === 0) {
    return `${target} は、${unsafeText} で、次のラウンドで上がれません。`;
  }
  const safeText = safe.map((outcome) => `${outcome.dart.id} なら ${outcome.leave}`).join('、');
  return `${target} は ${safeText} で上がれますが、${unsafeText} になります。`;
}

/**
 * SETUP / FIRST DART の回答を採点する。
 *
 * この形式は 1 投しか答えないので、回答後に 170 以下になる必要はない。
 * したがって `gradeSetupAnswer()` の「回答後 leave が checkoutable なら正解」は使えない。
 *
 *   ruleValid       … 盤面上の合法なターゲットを 1 つ選べている
 *   learningCorrect … その的が「得点用の開始ターゲット」であり、かつ
 *                     同ナンバーのシングルへ落ちても残り本数でテンパイを作れる
 *
 * 広いシングルを狙えば確かに外しようがないが、それは得点の組み立てを捨てている。
 * この教材の主題は得点用トリプルの選択なので、候補外の的は正解にしない。
 */
function gradeSetupFirstDartAnswer(
  question: TrainingQuestion,
  answer: readonly Dart[],
): GradeResult {
  if (answer.length === 0) return invalid('EMPTY', answer);
  if (answer.length > 1) return invalid('TOO_MANY_DARTS', answer);

  const dart = answer[0];
  const start = question.currentRemaining;
  const result = applyDart(start, dart);
  if (result.outcome !== 'continue') return invalid('BUST', answer);

  const options = setupFirstDartOptions(start);
  const chosen = findFirstDartOption(start, dart.id);
  const recommended = options.find((option) => option.singleMissSafe) ?? null;

  const failureCode: FailureCode | null =
    chosen === null
      ? 'FIRST_DART_NOT_SCORING_TARGET'
      : chosen.singleMissSafe
        ? null
        : 'FIRST_DART_SINGLE_MISS_DEAD_END';

  /*
   * ルートカードに出す推奨度は、この問題の採点と同じ「第一ターゲットの推奨度」にする。
   * bestRoute はその的から投げ切ったときの 3 投ルートなので、そのままだと
   * 「判定は C なのにカードは S」のような食い違いになる。
   */
  const withFirstDartGrade = (option: SetupFirstDartOption | null): RankedSetupRoute | null =>
    option === null ? null : { ...option.bestRoute, grade: option.grade };

  return {
    ruleValid: true,
    learningCorrect: failureCode === null,
    failureCode,
    failureMessageJa: failureCode === null ? null : FAILURE_MESSAGES[failureCode],
    grade: chosen?.grade ?? 'C',
    checkoutEvaluation: null,
    setupEvaluation: withFirstDartGrade(chosen),
    bestCheckout: null,
    bestSetup: withFirstDartGrade(recommended),
    answerText: formatRoute(answer),
    finishDouble: null,
    // 1 投目のあとの残り。170 を超えていて当然なので verdict は付けない。
    leave: result.remainingAfter,
    leaveVerdict: null,
  };
}

/** 出題と回答から採点結果を作る。 */
export function gradeAnswer(question: TrainingQuestion, answer: readonly Dart[]): GradeResult {
  if (question.format === 'setup-first-dart') {
    return gradeSetupFirstDartAnswer(question, answer);
  }
  if (question.format === 'setup-adjustment') {
    return gradeSetupAdjustmentAnswer(question, answer);
  }
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
