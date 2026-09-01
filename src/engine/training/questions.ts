/**
 * TRAINING の出題候補と出題オブジェクト。
 *
 * 「暗記」ではなく「判断」を学ぶため、CHECKOUT / SETUP / RECOVERY の
 * それぞれで、実戦で起きる状況をそのまま問題にする。
 *
 * v1.3 の再設計では、乱数で毎回引き直すのではなく
 * 「全候補を難易度・カテゴリつきで先に構築し、sampler が選ぶ」形にした。
 * RECOVERY の候補成立条件（PR #7）はそのまま維持している。
 */
import { THROWABLE_DARTS, findDart, requireDart, type Dart } from '../../domain/dart';
import {
  DARTS_PER_VISIT,
  MAX_CHECKOUT,
  MAX_SETUP_REMAINING,
  applyDart,
  isBogey,
  isCheckoutable,
} from '../../domain/checkoutRules';
import { getStandardRoute } from '../../data/standardCheckoutRoutes';
import { sampleCheckoutRoute } from '../checkout/enumerate';
import { canReachTenpai } from '../setup/enumerate';
import { checkoutDifficultyOf, checkoutRouteShape, recoveryDifficultyOf } from './difficulty';
import {
  LEARNING_TAGS,
  checkoutProblemKey,
  recoveryProblemKey,
  setupAdjustmentProblemKey,
  setupFullProblemKey,
  type CheckoutCategory,
  type ContextualThrow,
  type RecoveryCategory,
  type TrainingDifficulty,
  type TrainingKind,
  type TrainingMode,
  type TrainingQuestion,
} from './model';
import {
  setupAdjustmentCandidates,
  setupFullCandidates,
  type SetupAdjustmentCandidate,
  type SetupFullCandidate,
} from './setupQuestions';

export type {
  ContextualThrow,
  RecoveryContext,
  TrainingCategory,
  TrainingDifficulty,
  TrainingKind,
  TrainingMode,
  TrainingQuestion,
} from './model';

export interface TrainingSettings {
  readonly mode: TrainingMode;
  /** 出題する残り点の範囲（CHECKOUT / RECOVERY 用）。 */
  readonly checkoutRange: { readonly min: number; readonly max: number };
  /** 出題する残り点の範囲（SETUP 用）。 */
  readonly setupRange: { readonly min: number; readonly max: number };
  /** 出題数。null は無限。 */
  readonly questionCount: number | null;
  /** 1 問あたりの制限時間（秒）。null は無制限。 */
  readonly timeLimitSeconds: number | null;
  /** 間違えた問題・苦手カテゴリを優先して出題する。 */
  readonly reviewWeakFirst: boolean;
}

export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = {
  mode: 'checkout',
  checkoutRange: { min: 2, max: MAX_CHECKOUT },
  setupRange: { min: 171, max: MAX_SETUP_REMAINING },
  questionCount: 10,
  timeLimitSeconds: null,
  reviewWeakFirst: true,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ---------------------------------------------------------------------------
// CHECKOUT
// ---------------------------------------------------------------------------

/** CHECKOUT の出題対象になる残り点（Bogey と、上がれない残りを除く）。 */
export function checkoutCandidates(range: { min: number; max: number }): number[] {
  const min = clamp(Math.min(range.min, range.max), 2, MAX_CHECKOUT);
  const max = clamp(Math.max(range.min, range.max), 2, MAX_CHECKOUT);
  const values: number[] = [];
  for (let n = min; n <= max; n += 1) {
    if (!isBogey(n) && getStandardRoute(n) !== null) values.push(n);
  }
  return values;
}

export function checkoutCategoryOf(left: number): CheckoutCategory {
  if (left >= 150) return 'checkout-150-170';
  if (left >= 120) return 'checkout-120-149';
  if (left >= 100) return 'checkout-100-119';
  return 'checkout-under-100';
}

export interface CheckoutQuestionCandidate {
  readonly kind: 'checkout';
  readonly left: number;
  readonly dartsAvailable: number;
  readonly difficulty: TrainingDifficulty;
  readonly primaryCategory: CheckoutCategory;
  readonly learningTags: readonly string[];
  readonly expectedAnswer: readonly string[];
  readonly trivial: boolean;
  /** 残りがそのままダブル / BULL で、1 投で上がれる。 */
  readonly directOneDart: boolean;
}

const checkoutPoolCache = new Map<string, readonly CheckoutQuestionCandidate[]>();

export function checkoutQuestionCandidates(range: {
  min: number;
  max: number;
}): readonly CheckoutQuestionCandidate[] {
  const lefts = checkoutCandidates(range);
  const cacheKey = lefts.length === 0 ? 'empty' : `${lefts[0]}/${lefts[lefts.length - 1]}/${lefts.length}`;
  const cached = checkoutPoolCache.get(cacheKey);
  if (cached) return cached;

  const candidates: CheckoutQuestionCandidate[] = lefts.map((left) => {
    const shape = checkoutRouteShape(left, DARTS_PER_VISIT);
    const standard = getStandardRoute(left);
    const route = standard?.darts ?? sampleCheckoutRoute(left, DARTS_PER_VISIT)?.darts ?? [];
    const directOneDart = shape?.minLength === 1;
    const trivial =
      directOneDart === true ||
      (route.length === 2 &&
        left < 100 &&
        !route.some((dart) => dart.kind === 'triple' || dart.baseNumber === null));

    const tags = new Set<string>();
    if (directOneDart) tags.add(LEARNING_TAGS.directFinish);
    if (route.some((dart) => dart.baseNumber === null)) tags.add(LEARNING_TAGS.bullFinish);
    if (shape?.tripleRequired) tags.add(LEARNING_TAGS.tripleRequired);
    if (isCheckoutable(left, 2)) tags.add(LEARNING_TAGS.twoDartCheckout);
    if (trivial) tags.add(LEARNING_TAGS.trivial);

    return {
      kind: 'checkout' as const,
      left,
      dartsAvailable: DARTS_PER_VISIT,
      difficulty: checkoutDifficultyOf(left, DARTS_PER_VISIT),
      primaryCategory: checkoutCategoryOf(left),
      learningTags: [...tags].sort(),
      expectedAnswer: route.map((dart) => dart.id),
      trivial,
      directOneDart: directOneDart === true,
    };
  });

  checkoutPoolCache.set(cacheKey, candidates);
  return candidates;
}

// ---------------------------------------------------------------------------
// RECOVERY（PR #7 の成立条件を維持する）
// ---------------------------------------------------------------------------

/** 実投後の状態と合法な正答まで確定した RECOVERY 出題候補。 */
export interface RecoveryQuestionCandidate {
  readonly kind: 'recovery';
  readonly visitStartRemaining: number;
  readonly intendedDart: Dart;
  readonly actualDart: Dart;
  readonly remaining: number;
  readonly dartsAvailable: number;
  readonly expectedRoute: readonly Dart[];
  readonly difficulty: TrainingDifficulty;
  readonly primaryCategory: RecoveryCategory;
  readonly learningTags: readonly string[];
  readonly trivial: boolean;
}

function recoveryCategoryOf(difficulty: TrainingDifficulty): RecoveryCategory {
  if (difficulty === 'easy') return 'recovery-direct';
  if (difficulty === 'medium') return 'recovery-rebuild';
  return 'recovery-advanced';
}

/**
 * 任意の狙い・実投から、回答可能な RECOVERY 出題候補を作る。
 *
 * Bust / Checkout 済みの状態は「次にどこを狙うか」を問えないため除外する。
 * 継続状態でも、残り 2 本以内の合法な Double Out route が実在しなければ除外する。
 */
export function createRecoveryQuestionCandidate(
  visitStartRemaining: number,
  intendedDart: Dart,
  actualDart: Dart,
): RecoveryQuestionCandidate | null {
  if (
    !Number.isInteger(visitStartRemaining) ||
    visitStartRemaining < 2 ||
    visitStartRemaining > MAX_CHECKOUT
  ) {
    return null;
  }

  const actualResult = applyDart(visitStartRemaining, actualDart);
  if (actualResult.outcome !== 'continue') return null;

  const dartsAvailable = DARTS_PER_VISIT - 1;
  const remaining = actualResult.remainingAfter;
  if (!isCheckoutable(remaining, dartsAvailable)) return null;

  const expected = sampleCheckoutRoute(remaining, dartsAvailable);
  if (expected === null) return null;

  const difficulty = recoveryDifficultyOf(remaining, dartsAvailable);
  const shape = checkoutRouteShape(remaining, dartsAvailable);
  const tags = new Set<string>();
  if (shape?.minLength === 1) tags.add(LEARNING_TAGS.directFinish);
  if (shape?.bullRequired) tags.add(LEARNING_TAGS.bullFinish);
  if (shape?.tripleRequired) tags.add(LEARNING_TAGS.tripleRequired);
  const trivial = shape?.minLength === 1;
  if (trivial) tags.add(LEARNING_TAGS.trivial);

  return {
    kind: 'recovery',
    visitStartRemaining,
    intendedDart,
    actualDart,
    remaining,
    dartsAvailable,
    expectedRoute: expected.darts,
    difficulty,
    primaryCategory: recoveryCategoryOf(difficulty),
    learningTags: [...tags].sort(),
    trivial: trivial === true,
  };
}

/** 基準ルートの 1 投目がシングルへ落ちた RECOVERY 候補を作る。 */
function recoveryQuestionCandidateFor(visitStart: number): RecoveryQuestionCandidate | null {
  const standard = getStandardRoute(visitStart);
  if (!standard) return null;
  const intended = standard.darts[0];
  if (intended.baseNumber === null) return null;

  const singleMiss = findDart(`S${intended.baseNumber}`);
  // 1 投目がすでにシングルなら「外した先」が同じ的になり、問題にならない。
  if (!singleMiss || singleMiss.id === intended.id) return null;
  return createRecoveryQuestionCandidate(visitStart, intended, singleMiss);
}

/**
 * RECOVERY の全出題候補。
 *
 * 生成時の random retry に頼らず、実投後に合法な正答が存在する候補だけを先に構築する。
 */
export function recoveryQuestionCandidates(range: {
  min: number;
  max: number;
}): RecoveryQuestionCandidate[] {
  const candidates: RecoveryQuestionCandidate[] = [];
  for (const visitStart of checkoutCandidates(range)) {
    const candidate = recoveryQuestionCandidateFor(visitStart);
    if (candidate !== null) candidates.push(candidate);
  }
  return candidates;
}

/** RECOVERY の出題対象になるラウンド開始時の残り点。 */
export function recoveryCandidates(range: { min: number; max: number }): number[] {
  return recoveryQuestionCandidates(range).map((candidate) => candidate.visitStartRemaining);
}

/** その残り点から回答可能な RECOVERY 問題を作れるか。 */
export function canBuildRecoveryQuestion(visitStart: number): boolean {
  return recoveryQuestionCandidateFor(visitStart) !== null;
}

// ---------------------------------------------------------------------------
// SETUP
// ---------------------------------------------------------------------------

/** SETUP の出題対象になる残り点（テンパイを作れるものだけ）。 */
export function setupCandidates(range: { min: number; max: number }): number[] {
  const min = clamp(Math.min(range.min, range.max), 171, MAX_SETUP_REMAINING);
  const max = clamp(Math.max(range.min, range.max), 171, MAX_SETUP_REMAINING);
  const values: number[] = [];
  for (let n = min; n <= max; n += 1) {
    if (canReachTenpai(n, DARTS_PER_VISIT)) values.push(n);
  }
  return values;
}

// ---------------------------------------------------------------------------
// 出題オブジェクトの生成
// ---------------------------------------------------------------------------

function formatContext(throws: readonly ContextualThrow[]): string {
  return throws.map((item) => item.actualDartId).join(' → ');
}

export function buildCheckoutQuestion(
  candidate: CheckoutQuestionCandidate,
  index: number,
): TrainingQuestion {
  return {
    id: `checkout-${candidate.left}-${index}`,
    problemKey: checkoutProblemKey(candidate.left, candidate.dartsAvailable),
    kind: 'checkout',
    format: 'checkout-route',
    difficulty: candidate.difficulty,
    primaryCategory: candidate.primaryCategory,
    learningTags: candidate.learningTags,
    startRemaining: candidate.left,
    currentRemaining: candidate.left,
    dartsAvailable: candidate.dartsAvailable,
    contextualThrows: [],
    promptJa: `残り ${candidate.left} 点。3 本でどう上がりますか？`,
    recovery: null,
    expectedAnswer: candidate.expectedAnswer,
    trivial: candidate.trivial,
  };
}

export function buildSetupAdjustmentQuestion(
  candidate: SetupAdjustmentCandidate,
  index: number,
): TrainingQuestion {
  const actualIds = candidate.contextualThrows.map((item) => item.actualDartId);
  return {
    id: `setup-adjust-${candidate.startRemaining}-${actualIds.join('')}-${index}`,
    problemKey: setupAdjustmentProblemKey(
      candidate.startRemaining,
      actualIds,
      candidate.currentRemaining,
      candidate.dartsAvailable,
    ),
    kind: 'setup',
    format: 'setup-adjustment',
    difficulty: candidate.difficulty,
    primaryCategory: candidate.primaryCategory,
    learningTags: candidate.learningTags,
    startRemaining: candidate.startRemaining,
    currentRemaining: candidate.currentRemaining,
    dartsAvailable: candidate.dartsAvailable,
    contextualThrows: candidate.contextualThrows,
    promptJa: `開始 ${candidate.startRemaining} 点。ここまで ${formatContext(
      candidate.contextualThrows,
    )} で、現在 ${candidate.currentRemaining} 点。次のラウンドで上がれる残りにするには、最後の 1 投をどこへ狙いますか？`,
    recovery: null,
    expectedAnswer: [candidate.recommended.id],
    trivial: candidate.trivial,
  };
}

export function buildSetupFullQuestion(
  candidate: SetupFullCandidate,
  index: number,
): TrainingQuestion {
  return {
    id: `setup-full-${candidate.startRemaining}-${index}`,
    problemKey: setupFullProblemKey(candidate.startRemaining, candidate.dartsAvailable),
    kind: 'setup',
    format: 'setup-full',
    difficulty: candidate.difficulty,
    primaryCategory: candidate.primaryCategory,
    learningTags: candidate.learningTags,
    startRemaining: candidate.startRemaining,
    currentRemaining: candidate.startRemaining,
    dartsAvailable: candidate.dartsAvailable,
    contextualThrows: [],
    promptJa: `残り ${candidate.startRemaining} 点。3 投で、次のラウンドに上がれる残りを作ってください。`,
    recovery: null,
    expectedAnswer: candidate.recommended.map((dart) => dart.id),
    trivial: false,
  };
}

/**
 * RECOVERY の出題を作る。
 *
 * 基準ルートの 1 投目を「狙った的」とし、そこから実戦で起きやすいズレ
 * （トリプル → シングル）を起こした状態を問題にする。
 */
export function buildRecoveryQuestion(
  candidate: RecoveryQuestionCandidate,
  index: number,
): TrainingQuestion {
  const {
    visitStartRemaining,
    intendedDart,
    actualDart,
    remaining,
    dartsAvailable,
    expectedRoute,
  } = candidate;
  return {
    id: `recovery-${visitStartRemaining}-${actualDart.id}-${index}`,
    problemKey: recoveryProblemKey(
      visitStartRemaining,
      intendedDart.id,
      actualDart.id,
      remaining,
      dartsAvailable,
    ),
    kind: 'recovery',
    format: 'recovery-route',
    difficulty: candidate.difficulty,
    primaryCategory: candidate.primaryCategory,
    learningTags: candidate.learningTags,
    startRemaining: visitStartRemaining,
    currentRemaining: remaining,
    dartsAvailable,
    contextualThrows: [{ intendedDartId: intendedDart.id, actualDartId: actualDart.id }],
    promptJa: `残り ${visitStartRemaining} から ${intendedDart.id} を狙って ${actualDart.id} でした。残り ${remaining} 点・${dartsAvailable} 本。次はどこを狙いますか？`,
    recovery: {
      visitStartRemaining,
      intendedDartId: intendedDart.id,
      actualDartId: actualDart.id,
      expectedRoute: expectedRoute.map((dart) => dart.id),
    },
    expectedAnswer: expectedRoute.map((dart) => dart.id),
    trivial: candidate.trivial,
  };
}

// ---------------------------------------------------------------------------
// pool
// ---------------------------------------------------------------------------

export interface TrainingPools {
  readonly checkout: readonly CheckoutQuestionCandidate[];
  readonly recovery: readonly RecoveryQuestionCandidate[];
  readonly setupAdjustment: readonly SetupAdjustmentCandidate[];
  readonly setupFull: readonly SetupFullCandidate[];
}

export function buildPools(settings: TrainingSettings): TrainingPools {
  const needsCheckout = settings.mode === 'checkout' || settings.mode === 'mixed';
  const needsRecovery = settings.mode === 'recovery' || settings.mode === 'mixed';
  const needsSetup = settings.mode === 'setup' || settings.mode === 'mixed';
  return {
    checkout: needsCheckout ? checkoutQuestionCandidates(settings.checkoutRange) : [],
    recovery: needsRecovery ? recoveryQuestionCandidates(settings.checkoutRange) : [],
    setupAdjustment: needsSetup ? setupAdjustmentCandidates(settings.setupRange) : [],
    setupFull: needsSetup ? setupFullCandidates(settings.setupRange) : [],
  };
}

/** 空でない pool を持つ出題種別だけを返す。 */
export function kindsWithCandidates(mode: TrainingMode, pools: TrainingPools): TrainingKind[] {
  const available: TrainingKind[] = [];
  if (pools.checkout.length > 0) available.push('checkout');
  if (pools.setupAdjustment.length > 0 || pools.setupFull.length > 0) available.push('setup');
  if (pools.recovery.length > 0) available.push('recovery');
  return mode === 'mixed' ? available : available.filter((kind) => kind === mode);
}

/**
 * その設定で 1 問でも出題できるか。
 * UI は開始前にこれを見て、出題できない範囲を伝える。
 */
export function canGenerateQuestions(settings: TrainingSettings): boolean {
  return kindsWithCandidates(settings.mode, buildPools(settings)).length > 0;
}

/** SVG ボードでの回答に使える全セグメント（MISS を除く）。 */
export const ANSWERABLE_DARTS = THROWABLE_DARTS;

/** その問題が「上がりを答える問題」かどうか。 */
export function isCheckoutQuestion(question: TrainingQuestion): boolean {
  return (
    question.kind !== 'setup' &&
    isCheckoutable(question.currentRemaining, question.dartsAvailable)
  );
}

/** 出題が持つ推奨解答を Dart 配列として取り出す。 */
export function expectedAnswerDarts(question: TrainingQuestion): readonly Dart[] {
  return question.expectedAnswer.map((id) => requireDart(id));
}

/** テスト用にキャッシュを空にする。 */
export function clearQuestionPoolCache(): void {
  checkoutPoolCache.clear();
}
