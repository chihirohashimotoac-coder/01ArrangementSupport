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
  isBogey,
  isCheckoutable,
} from '../../domain/checkoutRules';
import { getStandardRoute } from '../../data/standardCheckoutRoutes';
import { canReachTenpai } from '../setup/enumerate';
import { createRandom, type RandomSource } from './random';

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
 * RECOVERY の出題対象になる残り点。
 *
 * 基準ルートの 1 投目をシングルへ外した状態を問題にするため、
 * 「1 投目がトリプル / ダブルで、外した後の残りが 2 以上」でなければ出題できない。
 * 例えば 2〜3 の範囲では 1 問も作れない（2 は D1 を外すと 1 残り、
 * 3 は 1 投目が S1 なので外す先がない）。
 */
export function recoveryCandidates(range: { min: number; max: number }): number[] {
  return checkoutCandidates(range).filter((left) => canBuildRecoveryQuestion(left));
}

/** その残り点から RECOVERY の問題を作れるか。 */
export function canBuildRecoveryQuestion(visitStart: number): boolean {
  const standard = getStandardRoute(visitStart);
  if (!standard) return false;
  const intended = standard.darts[0];
  if (intended.baseNumber === null) return false;
  const singleMiss = findDart(`S${intended.baseNumber}`);
  // 1 投目がすでにシングルなら「外した先」が同じ的になり、問題にならない。
  if (!singleMiss || singleMiss.id === intended.id) return false;
  const remaining = visitStart - singleMiss.score;
  return remaining >= 2 && remaining <= MAX_SETUP_REMAINING;
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
function buildRecoveryQuestion(
  visitStart: number,
  random: RandomSource,
  index: number,
): TrainingQuestion | null {
  const standard = getStandardRoute(visitStart);
  if (!standard) return null;
  const intended = standard.darts[0];
  if (intended.baseNumber === null) return null;

  // 縦ズレ（シングルへ落ちる）を基本にしつつ、たまに横ズレも出す。
  const singleMiss = findDart(`S${intended.baseNumber}`);
  const candidates: Dart[] = [];
  if (singleMiss && singleMiss.id !== intended.id) candidates.push(singleMiss);
  if (candidates.length === 0) return null;

  const actual = random.pick(candidates);
  if (!actual) return null;

  const remaining = visitStart - actual.score;
  if (remaining < 2 || remaining > MAX_SETUP_REMAINING) return null;

  return {
    id: `recovery-${visitStart}-${actual.id}-${index}`,
    kind: 'recovery',
    remaining,
    dartsAvailable: DARTS_PER_VISIT - 1,
    promptJa: `残り ${visitStart} から ${intended.id} を狙って ${actual.id} でした。残り ${remaining} 点・2 本。次はどこを狙いますか？`,
    recovery: { visitStartRemaining: visitStart, intendedDart: intended, actualDart: actual },
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
  const recoveryPool = recoveryCandidates(settings.checkoutRange);
  const reviewPool = (options.reviewTargets ?? []).filter(
    (n) => checkoutPool.includes(n) || setupPool.includes(n),
  );

  // 選ばれたモードで 1 問も作れない設定なら、空回りせずに空を返す。
  // 呼び出し側（UI）はこれを「この設定では出題できません」として扱う。
  if (poolFor(settings.mode, { checkoutPool, setupPool, recoveryPool }).length === 0) return [];

  const questions: TrainingQuestion[] = [];
  for (let i = 0; questions.length < count && i < count * 20; i += 1) {
    const kind: TrainingKind =
      settings.mode === 'mixed'
        ? (['checkout', 'setup', 'recovery'] as const)[random.nextInt(0, 2)]
        : settings.mode;

    // 苦手スコアを 3 回に 1 回ほど混ぜる。
    const useReview =
      settings.reviewWeakFirst && reviewPool.length > 0 && random.next() < 0.34;

    if (kind === 'setup') {
      const pool = useReview ? reviewPool.filter((n) => setupPool.includes(n)) : setupPool;
      const remaining = random.pick(pool.length > 0 ? pool : setupPool);
      if (remaining !== null) questions.push(buildSetupQuestion(remaining, i));
      continue;
    }

    const pool = useReview ? reviewPool.filter((n) => checkoutPool.includes(n)) : checkoutPool;
    const remaining = random.pick(pool.length > 0 ? pool : checkoutPool);
    if (remaining === null) continue;

    if (kind === 'recovery') {
      const recoveryBase = random.pick(
        useReview
          ? (reviewPool.filter((n) => recoveryPool.includes(n)).length > 0
              ? reviewPool.filter((n) => recoveryPool.includes(n))
              : recoveryPool)
          : recoveryPool,
      );
      if (recoveryBase === null) continue;
      const question = buildRecoveryQuestion(recoveryBase, random, i);
      if (question) questions.push(question);
      continue;
    }
    questions.push(buildCheckoutQuestion(remaining, i));
  }
  return questions;
}

/** モードごとに、出題に使える残り点のプール。 */
function poolFor(
  mode: TrainingMode,
  pools: { checkoutPool: number[]; setupPool: number[]; recoveryPool: number[] },
): number[] {
  switch (mode) {
    case 'checkout':
      return pools.checkoutPool;
    case 'setup':
      return pools.setupPool;
    case 'recovery':
      return pools.recoveryPool;
    case 'mixed':
      return [...pools.checkoutPool, ...pools.setupPool, ...pools.recoveryPool];
  }
}

/**
 * その設定で 1 問でも出題できるか。
 * UI は開始前にこれを見て、出題できない範囲を伝える。
 */
export function canGenerateQuestions(settings: TrainingSettings): boolean {
  return (
    poolFor(settings.mode, {
      checkoutPool: checkoutCandidates(settings.checkoutRange),
      setupPool: setupCandidates(settings.setupRange),
      recoveryPool: recoveryCandidates(settings.checkoutRange),
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
