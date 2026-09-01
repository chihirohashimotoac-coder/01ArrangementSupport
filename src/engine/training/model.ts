/**
 * TRAINING の出題モデル（V2）。
 *
 * v1 では「残り点」と「種別」しか持たず、
 *  - SETUP が「合法に 3 投できたか」でしか採点できない
 *  - 同じ問題が連続しても検知できない
 *  - 復習対象を残り点でしか表現できない
 * という限界があった。
 *
 * V2 では 1 問を
 *  「開始残り」「ここまでの実際の投球」「現在の残り」「使える本数」
 * として表し、さらに教育カテゴリ・難易度・安定キーを持たせる。
 */

export type TrainingKind = 'checkout' | 'setup' | 'recovery';
export type TrainingMode = TrainingKind | 'mixed';

/** 出題の形式。SETUP だけが 2 形式を持つ。 */
export type TrainingFormat =
  | 'checkout-route'
  | 'setup-adjustment'
  | 'setup-full'
  | 'recovery-route';

export type TrainingDifficulty = 'easy' | 'medium' | 'hard';

export const TRAINING_DIFFICULTIES: readonly TrainingDifficulty[] = ['easy', 'medium', 'hard'];

/**
 * SETUP の教育カテゴリ（本仕様 19 節 A〜I）。
 *
 * A: 一般的なノーテン回避 / B: 18・19・20 のずらし / C: 0・1・4・7 /
 * D: 302〜309 / E: とりあえず TON の罠 / F: 95〜105 への着地 /
 * G: S-BULL 25 での調整 / H: 同じ数字を続けると悪化する /
 * I: 基礎確認
 */
export const SETUP_CATEGORIES = [
  'setup-bogey-avoid',
  'setup-adjust-18-19-20',
  'setup-digits-0147',
  'setup-302-309',
  'setup-ton-trap',
  'setup-landing-95-105',
  'setup-sbull',
  'setup-same-number-worse',
  'setup-basics',
] as const;
export type SetupCategory = (typeof SETUP_CATEGORIES)[number];

/** CHECKOUT のカテゴリは「残り点の帯」。 */
export const CHECKOUT_CATEGORIES = [
  'checkout-under-100',
  'checkout-100-119',
  'checkout-120-149',
  'checkout-150-170',
] as const;
export type CheckoutCategory = (typeof CHECKOUT_CATEGORIES)[number];

/** RECOVERY のカテゴリは「立て直しの型」。 */
export const RECOVERY_CATEGORIES = [
  'recovery-direct',
  'recovery-rebuild',
  'recovery-advanced',
] as const;
export type RecoveryCategory = (typeof RECOVERY_CATEGORIES)[number];

export type TrainingCategory = SetupCategory | CheckoutCategory | RecoveryCategory;

/** 学習タグ（統計・復習の切り口）。 */
export const LEARNING_TAGS = {
  bogeyAvoidance: 'bogey-avoidance',
  aboveCheckoutRange: 'above-170',
  thirdDartAdjust: 'third-dart-adjust',
  tonTrap: 'ton-trap',
  landing95to105: 'landing-95-105',
  sbullAdjust: 'sbull-adjust',
  digits0147: 'digits-0147',
  sameNumberWorse: 'same-number-worse',
  twoDartCheckout: 'two-dart-checkout',
  bullFinish: 'bull-finish',
  tripleRequired: 'triple-required',
  directFinish: 'direct-finish',
  trivial: 'trivial',
} as const;

/**
 * 「ここまでに実際に入った 1 投」。
 *
 * ユーザーの回答ではなく、読み取り専用の事実として提示する（本仕様 10 節）。
 * 狙いと実際が違うことがあるので、両方を持つ。
 */
export interface ContextualThrow {
  readonly intendedDartId: string | null;
  readonly actualDartId: string;
}

/** RECOVERY の出題文脈（PR #7 の成立条件をそのまま保持する）。 */
export interface RecoveryContext {
  /** ラウンド開始時の残り。 */
  readonly visitStartRemaining: number;
  readonly intendedDartId: string;
  readonly actualDartId: string;
  /** 出題時に存在確認した、grader へ入力できる合法な正答。 */
  readonly expectedRoute: readonly string[];
}

export interface TrainingQuestion {
  /** セッション内で一意（index を含む）。重複判定には使わない。 */
  readonly id: string;
  /** 意味的に同じ問題を表す安定キー（本仕様 29 節）。期待解答は含めない。 */
  readonly problemKey: string;
  readonly kind: TrainingKind;
  readonly format: TrainingFormat;
  readonly difficulty: TrainingDifficulty;
  readonly primaryCategory: TrainingCategory;
  readonly learningTags: readonly string[];
  /** ラウンド開始時の残り。 */
  readonly startRemaining: number;
  /** 回答時点の残り。 */
  readonly currentRemaining: number;
  readonly dartsAvailable: number;
  /** ここまでに実際に入った投球（読み取り専用）。 */
  readonly contextualThrows: readonly ContextualThrow[];
  readonly promptJa: string;
  readonly recovery: RecoveryContext | null;
  /** 出題時に確認した推奨解答（セグメント表記）。 */
  readonly expectedAnswer: readonly string[];
  /** 判断を要しない易しい問題か（出題数を制限する）。 */
  readonly trivial: boolean;
}

/** 同じ状況を指すキー（残り点・現在残りの近接出題を避けるために使う）。 */
export function contextKeyOf(question: TrainingQuestion): string {
  return `${question.kind}|${question.startRemaining}|${question.currentRemaining}`;
}

export function checkoutProblemKey(left: number, darts: number): string {
  return `checkout|v2|left=${left}|darts=${darts}`;
}

export function setupAdjustmentProblemKey(
  start: number,
  contextualActualIds: readonly string[],
  current: number,
  darts: number,
): string {
  return `setup|v2|adjust|start=${start}|ctx=${contextualActualIds.join(',')}|current=${current}|darts=${darts}`;
}

export function setupFullProblemKey(start: number, darts: number): string {
  return `setup|v2|full|start=${start}|darts=${darts}`;
}

export function recoveryProblemKey(
  start: number,
  intendedDartId: string,
  actualDartId: string,
  current: number,
  darts: number,
): string {
  return `recovery|v2|start=${start}|intended=${intendedDartId}|actual=${actualDartId}|current=${current}|darts=${darts}`;
}

/** 復習対象。残り点だけでは SETUP の文脈を表現できないため構造化する（本仕様 32 節）。 */
export interface ReviewTarget {
  readonly kind: TrainingKind | null;
  readonly problemKey: string | null;
  readonly startRemaining: number | null;
  readonly primaryCategory: TrainingCategory | null;
  readonly learningTags: readonly string[];
  /** 大きいほど優先。 */
  readonly weight: number;
}

/** 残り点だけの legacy 復習対象を ReviewTarget へ変換する。 */
export function reviewTargetFromScore(remaining: number, weight = 1): ReviewTarget {
  return {
    kind: null,
    problemKey: null,
    startRemaining: remaining,
    primaryCategory: null,
    learningTags: [],
    weight,
  };
}
