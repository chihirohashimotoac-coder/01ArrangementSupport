/**
 * TRAINING の出題生成。
 *
 * 「暗記」ではなく「判断」を学ぶため、CHECKOUT / SETUP / RECOVERY の
 * それぞれで、実戦で起きる状況をそのまま問題にする。
 */
import { THROWABLE_DARTS, findDart, type Dart } from '../../domain/dart';
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
import { createRandom } from './random';

export type TrainingKind = 'checkout' | 'setup' | 'recovery';
export type TrainingMode = TrainingKind | 'mixed';

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
  /** 間違えた問題・苦手スコアを優先して出題する。 */
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

export interface RecoveryContext {
  /** ビジット開始時の残り。 */
  readonly visitStartRemaining: number;
  /** 狙ったセグメント。 */
  readonly intendedDart: Dart;
  /** 実際に刺さったセグメント。 */
  readonly actualDart: Dart;
  /** 出題時に存在確認した、grader へ入力できる合法な正答。 */
  readonly expectedRoute: readonly Dart[];
}

/** 実投後の状態と合法な正答まで確定した RECOVERY 出題候補。 */
export interface RecoveryQuestionCandidate extends RecoveryContext {
  readonly remaining: number;
  readonly dartsAvailable: number;
}

export interface TrainingQuestion {
  readonly id: string;
  readonly kind: TrainingKind;
  /** 出題時点の残り点。 */
  readonly remaining: number;
  /** 使える本数。 */
  readonly dartsAvailable: number;
  readonly promptJa: string;
  readonly recovery: RecoveryContext | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

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

  return {
    visitStartRemaining,
    intendedDart,
    actualDart,
    remaining,
    dartsAvailable,
    expectedRoute: expected.darts,
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

/** RECOVERY の出題対象になるビジット開始時の残り点。 */
export function recoveryCandidates(range: { min: number; max: number }): number[] {
  return recoveryQuestionCandidates(range).map((candidate) => candidate.visitStartRemaining);
}

/** その残り点から回答可能な RECOVERY 問題を作れるか。 */
export function canBuildRecoveryQuestion(visitStart: number): boolean {
  return recoveryQuestionCandidateFor(visitStart) !== null;
}

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

function buildCheckoutQuestion(remaining: number, index: number): TrainingQuestion {
  return {
    id: `checkout-${remaining}-${index}`,
    kind: 'checkout',
    remaining,
    dartsAvailable: DARTS_PER_VISIT,
    promptJa: `残り ${remaining} 点。3 本でどう上がりますか？`,
    recovery: null,
  };
}

function buildSetupQuestion(remaining: number, index: number): TrainingQuestion {
  return {
    id: `setup-${remaining}-${index}`,
    kind: 'setup',
    remaining,
    dartsAvailable: DARTS_PER_VISIT,
    promptJa: `残り ${remaining} 点。次ラウンドに良いテンパイを残してください。`,
    recovery: null,
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
    kind: 'recovery',
    remaining,
    dartsAvailable,
    promptJa: `残り ${visitStartRemaining} から ${intendedDart.id} を狙って ${actualDart.id} でした。残り ${remaining} 点・${dartsAvailable} 本。次はどこを狙いますか？`,
    recovery: { visitStartRemaining, intendedDart, actualDart, expectedRoute },
  };
}

export interface GenerateOptions {
  readonly settings: TrainingSettings;
  readonly seed: number;
  /** 重点的に再出題したい残り点（苦手スコア・間違えた問題）。 */
  readonly reviewTargets?: readonly number[];
  /** 生成する問題数。settings.questionCount が null のときに使う。 */
  readonly count?: number;
}

/** 設定に従って出題列を作る。同じ seed からは常に同じ並びになる。 */
export function generateQuestions(options: GenerateOptions): TrainingQuestion[] {
  const { settings, seed } = options;
  const random = createRandom(seed);
  const count = settings.questionCount ?? options.count ?? 10;

  const checkoutPool = checkoutCandidates(settings.checkoutRange);
  const setupPool = setupCandidates(settings.setupRange);
  const recoveryPool = recoveryQuestionCandidates(settings.checkoutRange);
  const reviewPool = (options.reviewTargets ?? []).filter(
    (n) => checkoutPool.includes(n) || setupPool.includes(n),
  );
  const availableKinds = kindsWithCandidates(settings.mode, {
    checkoutPool,
    setupPool,
    recoveryPool,
  });

  // 選ばれたモードで 1 問も作れない設定なら、空の pool を引かずに空を返す。
  // 呼び出し側（UI）はこれを「この設定では出題できません」として扱う。
  if (availableKinds.length === 0) return [];

  const questions: TrainingQuestion[] = [];
  for (let i = 0; i < count; i += 1) {
    const kind: TrainingKind =
      settings.mode === 'mixed'
        ? availableKinds[random.nextInt(0, availableKinds.length - 1)]
        : settings.mode;

    // 苦手スコアを 3 回に 1 回ほど混ぜる。
    const useReview =
      settings.reviewWeakFirst && reviewPool.length > 0 && random.next() < 0.34;

    if (kind === 'setup') {
      const pool = useReview ? reviewPool.filter((n) => setupPool.includes(n)) : setupPool;
      const remaining = random.pick(pool.length > 0 ? pool : setupPool);
      if (remaining === null) throw new Error('SETUP の出題候補 pool が空です。');
      questions.push(buildSetupQuestion(remaining, i));
      continue;
    }

    if (kind === 'recovery') {
      const candidate = random.pick(
        useReview
          ? (recoveryPool.filter((item) => reviewPool.includes(item.visitStartRemaining)).length > 0
              ? recoveryPool.filter((item) => reviewPool.includes(item.visitStartRemaining))
              : recoveryPool)
          : recoveryPool,
      );
      if (candidate === null) throw new Error('RECOVERY の出題候補 pool が空です。');
      questions.push(buildRecoveryQuestion(candidate, i));
      continue;
    }

    const pool = useReview ? reviewPool.filter((n) => checkoutPool.includes(n)) : checkoutPool;
    const remaining = random.pick(pool.length > 0 ? pool : checkoutPool);
    if (remaining === null) throw new Error('CHECKOUT の出題候補 pool が空です。');
    questions.push(buildCheckoutQuestion(remaining, i));
  }
  return questions;
}

/** 空でない pool を持つ出題種別だけを返す。 */
function kindsWithCandidates(
  mode: TrainingMode,
  pools: {
    checkoutPool: readonly number[];
    setupPool: readonly number[];
    recoveryPool: readonly RecoveryQuestionCandidate[];
  },
): TrainingKind[] {
  const available: TrainingKind[] = [];
  if (pools.checkoutPool.length > 0) available.push('checkout');
  if (pools.setupPool.length > 0) available.push('setup');
  if (pools.recoveryPool.length > 0) available.push('recovery');
  return mode === 'mixed' ? available : available.filter((kind) => kind === mode);
}

/**
 * その設定で 1 問でも出題できるか。
 * UI は開始前にこれを見て、出題できない範囲を伝える。
 */
export function canGenerateQuestions(settings: TrainingSettings): boolean {
  return (
    kindsWithCandidates(settings.mode, {
      checkoutPool: checkoutCandidates(settings.checkoutRange),
      setupPool: setupCandidates(settings.setupRange),
      recoveryPool: recoveryQuestionCandidates(settings.checkoutRange),
    }).length > 0
  );
}

/** SVG ボードでの回答に使える全セグメント（MISS を除く）。 */
export const ANSWERABLE_DARTS = THROWABLE_DARTS;

/** その問題が「上がりを答える問題」かどうか。 */
export function isCheckoutQuestion(question: TrainingQuestion): boolean {
  return (
    question.kind !== 'setup' && isCheckoutable(question.remaining, question.dartsAvailable)
  );
}
