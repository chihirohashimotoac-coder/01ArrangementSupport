/**
 * SETUP TRAINING の出題候補。
 *
 * SETUP の学習目的は「最大得点」でも「160 を作ること」でもない。
 *
 *   1. ここまでの実際の投球結果を受け入れる
 *   2. 最後の 1 投で Bogey（ノーテン）と 170 超えを避ける
 *   3. 次のラウンドで 3 本以内に上がれる残りを作る
 *
 * この 3 つを反復するための教材として、主形式を
 * 「先行 2 投の結果を提示し、最後の 1 投だけを答える」1-dart adjustment とする。
 *
 * 推奨解答は通常 Practice と同じ `rankSetupRoutes` から取る。
 * TRAINING のためにランキングの重み（Human Approval 済み）は一切変更しない。
 */
import { THROWABLE_DARTS, findDart, requireDart, type Dart } from '../../domain/dart';
import {
  DARTS_PER_VISIT,
  MAX_CHECKOUT,
  MAX_SETUP_REMAINING,
  MIN_CHECKOUT,
  isBogey,
  isCheckoutable,
} from '../../domain/checkoutRules';
import { PREMIUM_TENPAI_LEAVES, TON_SCORE } from '../../data/rankingRules';
import { LAST_DIGIT_RULE_BAND } from '../../data/bogeyNumbers';
import { canReachTenpai, rankSetupRoutes } from '../setup/enumerate';
import { isTonTrap } from '../setup/leaveQuality';
import {
  LEARNING_TAGS,
  type ContextualThrow,
  type SetupCategory,
  type TrainingDifficulty,
} from './model';

/** 「次のラウンドで 3 本以内に上がれる残り」か。 */
export function isGoodLeave(leave: number): boolean {
  return isCheckoutable(leave, DARTS_PER_VISIT);
}

/** 残りの分類（学習上の主判定）。 */
export type LeaveVerdict = 'checkoutable' | 'bogey' | 'above-range' | 'bust';

export function leaveVerdictOf(leave: number): LeaveVerdict {
  if (leave < MIN_CHECKOUT) return 'bust';
  if (leave > MAX_CHECKOUT) return 'above-range';
  if (isBogey(leave)) return 'bogey';
  return 'checkoutable';
}

export interface AdjustmentOutcome {
  readonly dart: Dart;
  readonly leave: number;
  readonly verdict: LeaveVerdict;
}

const outcomeCache = new Map<number, readonly AdjustmentOutcome[]>();

/** 現在の残りに対する、全セグメント 1 投ぶんの結果。 */
export function adjustmentOutcomes(current: number): readonly AdjustmentOutcome[] {
  const cached = outcomeCache.get(current);
  if (cached) return cached;
  const outcomes = THROWABLE_DARTS.map((dart) => {
    const leave = current - dart.score;
    return { dart, leave, verdict: leaveVerdictOf(leave) };
  });
  outcomeCache.set(current, outcomes);
  return outcomes;
}

/** その残りから、1 投で「上がれる残り」を作れるか。 */
export function hasGoodAdjustment(current: number): boolean {
  return adjustmentOutcomes(current).some((outcome) => outcome.verdict === 'checkoutable');
}

/**
 * 1 投調整の推奨解答。
 * 通常 Practice と同じランキングの第 1 候補をそのまま使う。
 */
export function recommendedAdjustment(current: number): Dart | null {
  const ranked = rankSetupRoutes(current, 1, { maxRoutes: 1 });
  const dart = ranked.length > 0 ? ranked[0].darts[0] : null;
  if (dart === undefined || dart === null) return null;
  return leaveVerdictOf(current - dart.score) === 'checkoutable' ? dart : null;
}

/** 3 投フル組み立ての推奨解答。 */
export function recommendedFullRoute(start: number): readonly Dart[] | null {
  const ranked = rankSetupRoutes(start, DARTS_PER_VISIT, { maxRoutes: 1 });
  if (ranked.length === 0) return null;
  return leaveVerdictOf(ranked[0].leave) === 'checkoutable' ? ranked[0].darts : null;
}

/** 「同じ数字を続けて狙う」ときの 1 投（トリプル狙いでもシングル面が本命）。 */
export function continuationDartOf(actualDartId: string): Dart | null {
  const dart = findDart(actualDartId);
  if (!dart) return null;
  if (dart.baseNumber === null) return findDart('SB') ?? null;
  return findDart(`S${dart.baseNumber}`) ?? null;
}

// ---------------------------------------------------------------------------
// 出題候補
// ---------------------------------------------------------------------------

interface PrefixPattern {
  readonly throws: readonly ContextualThrow[];
  readonly labelJa: string;
}

/**
 * 先行 2 投のパターン。
 *
 * 「実際に入った結果」なので、狙いどおり入ったものと外したものを両方置く。
 * actual の並びが問題の同一性（problemKey）を決めるため、actual は重複させない。
 */
export const SETUP_PREFIX_PATTERNS: readonly PrefixPattern[] = [
  { throws: [{ intendedDartId: 'T20', actualDartId: 'T20' }, { intendedDartId: 'T20', actualDartId: 'T20' }], labelJa: 'T20 が 2 本入った' },
  { throws: [{ intendedDartId: 'T20', actualDartId: 'T20' }, { intendedDartId: 'T20', actualDartId: 'S20' }], labelJa: 'T20 のあと S20 へ落ちた' },
  { throws: [{ intendedDartId: 'T20', actualDartId: 'S20' }, { intendedDartId: 'T20', actualDartId: 'S20' }], labelJa: 'T20 狙いが 2 本とも S20' },
  { throws: [{ intendedDartId: 'T19', actualDartId: 'T19' }, { intendedDartId: 'T19', actualDartId: 'T19' }], labelJa: 'T19 が 2 本入った' },
  { throws: [{ intendedDartId: 'T19', actualDartId: 'T19' }, { intendedDartId: 'T19', actualDartId: 'S19' }], labelJa: 'T19 のあと S19 へ落ちた' },
  { throws: [{ intendedDartId: 'T18', actualDartId: 'T18' }, { intendedDartId: 'T18', actualDartId: 'T18' }], labelJa: 'T18 が 2 本入った' },
  { throws: [{ intendedDartId: 'T20', actualDartId: 'T20' }, { intendedDartId: 'T20', actualDartId: 'S5' }], labelJa: 'T20 のあと S5 へ外した' },
  { throws: [{ intendedDartId: 'T20', actualDartId: 'S20' }, { intendedDartId: 'T20', actualDartId: 'S1' }], labelJa: 'S20 のあと S1 へ外した' },
  { throws: [{ intendedDartId: 'T20', actualDartId: 'T20' }, { intendedDartId: 'SB', actualDartId: 'SB' }], labelJa: 'T20 のあと S-BULL で調整した' },
  { throws: [{ intendedDartId: 'T19', actualDartId: 'S19' }, { intendedDartId: 'T20', actualDartId: 'T20' }], labelJa: 'S19 のあと T20 が入った' },
];

export interface SetupAdjustmentCandidate {
  readonly format: 'setup-adjustment';
  readonly startRemaining: number;
  readonly contextualThrows: readonly ContextualThrow[];
  readonly contextTotal: number;
  readonly currentRemaining: number;
  readonly dartsAvailable: 1;
  readonly recommended: Dart;
  readonly recommendedLeave: number;
  readonly outcomes: readonly AdjustmentOutcome[];
  readonly continuation: Dart | null;
  readonly continuationLeave: number | null;
  readonly primaryCategory: SetupCategory;
  readonly difficulty: TrainingDifficulty;
  readonly learningTags: readonly string[];
  readonly trivial: boolean;
  readonly contextLabelJa: string;
}

export interface SetupFullCandidate {
  readonly format: 'setup-full';
  readonly startRemaining: number;
  readonly currentRemaining: number;
  readonly dartsAvailable: 3;
  readonly recommended: readonly Dart[];
  readonly recommendedLeave: number;
  readonly primaryCategory: SetupCategory;
  readonly difficulty: TrainingDifficulty;
  readonly learningTags: readonly string[];
  readonly trivial: false;
}

const BAND_MIN = LAST_DIGIT_RULE_BAND.min;
const BAND_MAX = LAST_DIGIT_RULE_BAND.max;
const LANDING_BAND = { min: 95, max: 105 } as const;

function inPremiumBand(leave: number): boolean {
  return PREMIUM_TENPAI_LEAVES.includes(leave);
}

/** 「ちょうど 100 点」をこの 1 投で作れてしまうか（とりあえず TON の罠）。 */
function completesTon(contextTotal: number): boolean {
  const needed = TON_SCORE - contextTotal;
  if (needed <= 0) return false;
  return THROWABLE_DARTS.some((dart) => dart.score === needed);
}

/** 教育カテゴリを 1 つだけ決める（具体的なものから順に判定する）。 */
function categorizeAdjustment(input: {
  startRemaining: number;
  contextualActualIds: readonly string[];
  contextTotal: number;
  currentRemaining: number;
  recommended: Dart;
  recommendedLeave: number;
  outcomes: readonly AdjustmentOutcome[];
  continuationLeave: number | null;
}): SetupCategory {
  const {
    startRemaining,
    contextualActualIds,
    contextTotal,
    recommended,
    recommendedLeave,
    outcomes,
    continuationLeave,
  } = input;

  if (
    startRemaining >= 302 &&
    startRemaining <= 309 &&
    contextualActualIds.length === 2 &&
    contextualActualIds.every((id) => id === 'T20')
  ) {
    return 'setup-302-309';
  }

  if (isTonTrap(startRemaining) && completesTon(contextTotal)) return 'setup-ton-trap';

  if (contextualActualIds.includes('SB') || recommended.id === 'SB') return 'setup-sbull';

  const recommendedTotal = contextTotal + recommended.score;
  if (
    contextTotal < LANDING_BAND.min &&
    recommendedTotal >= LANDING_BAND.min &&
    recommendedTotal <= LANDING_BAND.max
  ) {
    return 'setup-landing-95-105';
  }

  const continuationIsBad =
    continuationLeave !== null && leaveVerdictOf(continuationLeave) !== 'checkoutable';

  const bandTrapExists = outcomes.some(
    (outcome) =>
      outcome.verdict === 'bogey' && outcome.leave >= BAND_MIN && outcome.leave <= BAND_MAX,
  );

  if (inPremiumBand(recommendedLeave) && bandTrapExists && continuationIsBad) {
    return 'setup-digits-0147';
  }

  if (continuationIsBad) return 'setup-same-number-worse';

  if (['S18', 'S19', 'S20'].includes(recommended.id)) return 'setup-adjust-18-19-20';

  if (outcomes.some((outcome) => outcome.verdict === 'bogey' || outcome.verdict === 'above-range')) {
    return 'setup-bogey-avoid';
  }

  return 'setup-basics';
}

/** カテゴリから難易度を決める（本仕様 21 節）。 */
function difficultyOfSetupCategory(
  category: SetupCategory,
  format: 'setup-adjustment' | 'setup-full',
): TrainingDifficulty {
  if (format === 'setup-full') return category === 'setup-basics' ? 'medium' : 'hard';
  if (category === 'setup-basics') return 'easy';
  if (
    category === 'setup-ton-trap' ||
    category === 'setup-landing-95-105' ||
    category === 'setup-sbull'
  ) {
    return 'hard';
  }
  return 'medium';
}

function tagsOfAdjustment(candidate: {
  outcomes: readonly AdjustmentOutcome[];
  recommendedLeave: number;
  continuationLeave: number | null;
  category: SetupCategory;
  trivial: boolean;
}): string[] {
  const tags = new Set<string>();
  if (candidate.outcomes.some((outcome) => outcome.verdict === 'bogey')) {
    tags.add(LEARNING_TAGS.bogeyAvoidance);
  }
  if (candidate.outcomes.some((outcome) => outcome.verdict === 'above-range')) {
    tags.add(LEARNING_TAGS.aboveCheckoutRange);
  }
  if (
    candidate.continuationLeave !== null &&
    leaveVerdictOf(candidate.continuationLeave) !== 'checkoutable'
  ) {
    tags.add(LEARNING_TAGS.sameNumberWorse);
  }
  if (isCheckoutable(candidate.recommendedLeave, 2)) tags.add(LEARNING_TAGS.twoDartCheckout);
  if (inPremiumBand(candidate.recommendedLeave)) {
    tags.add(`leave-${candidate.recommendedLeave}`);
    tags.add(LEARNING_TAGS.digits0147);
  }
  tags.add(LEARNING_TAGS.thirdDartAdjust);
  if (candidate.category === 'setup-ton-trap') tags.add(LEARNING_TAGS.tonTrap);
  if (candidate.category === 'setup-landing-95-105') tags.add(LEARNING_TAGS.landing95to105);
  if (candidate.category === 'setup-sbull') tags.add(LEARNING_TAGS.sbullAdjust);
  if (candidate.trivial) tags.add(LEARNING_TAGS.trivial);
  return [...tags].sort();
}

function clampSetupRange(range: { min: number; max: number }): { min: number; max: number } {
  const lo = Math.min(range.min, range.max);
  const hi = Math.max(range.min, range.max);
  return {
    min: Math.min(Math.max(lo, 171), MAX_SETUP_REMAINING),
    max: Math.min(Math.max(hi, 171), MAX_SETUP_REMAINING),
  };
}

const adjustmentCache = new Map<string, readonly SetupAdjustmentCandidate[]>();

/**
 * 1 投調整の全出題候補。
 *
 * 「開始残り × 先行 2 投のパターン」を総当たりし、
 * 最後の 1 投で上がれる残りを作れるものだけを候補にする。
 */
export function setupAdjustmentCandidates(range: {
  min: number;
  max: number;
}): readonly SetupAdjustmentCandidate[] {
  const { min, max } = clampSetupRange(range);
  const cacheKey = `${min}/${max}`;
  const cached = adjustmentCache.get(cacheKey);
  if (cached) return cached;

  const candidates: SetupAdjustmentCandidate[] = [];
  for (let start = min; start <= max; start += 1) {
    for (const pattern of SETUP_PREFIX_PATTERNS) {
      const actualIds = pattern.throws.map((item) => item.actualDartId);
      const contextTotal = actualIds.reduce((sum, id) => sum + requireDart(id).score, 0);
      const current = start - contextTotal;
      if (current < MIN_CHECKOUT) continue;
      // 先行 2 投の途中で Bust していないこと（残り 1 未満・1 残しを作らない）。
      let left = start;
      let busted = false;
      for (const id of actualIds) {
        left -= requireDart(id).score;
        if (left < MIN_CHECKOUT) busted = true;
      }
      if (busted) continue;

      const recommended = recommendedAdjustment(current);
      if (recommended === null) continue;

      const outcomes = adjustmentOutcomes(current);
      const continuation = continuationDartOf(actualIds[actualIds.length - 1]);
      const continuationLeave =
        continuation === null ? null : current - continuation.score;
      const recommendedLeave = current - recommended.score;

      const category = categorizeAdjustment({
        startRemaining: start,
        contextualActualIds: actualIds,
        contextTotal,
        currentRemaining: current,
        recommended,
        recommendedLeave,
        outcomes,
        continuationLeave,
      });

      // trivial は「継続の的でも上がれる」かつ「ノーテン・170 超えの判断が要らない」
      // 場合だけ（本仕様 47 節）。後者は基礎確認カテゴリの定義そのものなので、
      // 判断を要する問題を trivial として数えない。
      const trivial =
        category === 'setup-basics' &&
        continuationLeave !== null &&
        leaveVerdictOf(continuationLeave) === 'checkoutable';

      candidates.push({
        format: 'setup-adjustment',
        startRemaining: start,
        contextualThrows: pattern.throws,
        contextTotal,
        currentRemaining: current,
        dartsAvailable: 1,
        recommended,
        recommendedLeave,
        outcomes,
        continuation,
        continuationLeave,
        primaryCategory: category,
        difficulty: difficultyOfSetupCategory(category, 'setup-adjustment'),
        learningTags: tagsOfAdjustment({
          outcomes,
          recommendedLeave,
          continuationLeave,
          category,
          trivial,
        }),
        trivial,
        contextLabelJa: pattern.labelJa,
      });
    }
  }

  adjustmentCache.set(cacheKey, candidates);
  return candidates;
}

const fullCache = new Map<string, readonly SetupFullCandidate[]>();

/** 3 投フル組み立ての全出題候補。 */
export function setupFullCandidates(range: {
  min: number;
  max: number;
}): readonly SetupFullCandidate[] {
  const { min, max } = clampSetupRange(range);
  const cacheKey = `${min}/${max}`;
  const cached = fullCache.get(cacheKey);
  if (cached) return cached;

  const candidates: SetupFullCandidate[] = [];
  for (let start = min; start <= max; start += 1) {
    if (!canReachTenpai(start, DARTS_PER_VISIT)) continue;
    const recommended = recommendedFullRoute(start);
    if (recommended === null) continue;
    const recommendedLeave = start - recommended.reduce((sum, dart) => sum + dart.score, 0);

    const category = categorizeFull(start, recommended, recommendedLeave);
    const tags = new Set<string>([LEARNING_TAGS.bogeyAvoidance]);
    if (isCheckoutable(recommendedLeave, 2)) tags.add(LEARNING_TAGS.twoDartCheckout);
    if (inPremiumBand(recommendedLeave)) {
      tags.add(`leave-${recommendedLeave}`);
      tags.add(LEARNING_TAGS.digits0147);
    }
    if (category === 'setup-ton-trap') tags.add(LEARNING_TAGS.tonTrap);
    if (category === 'setup-landing-95-105') tags.add(LEARNING_TAGS.landing95to105);
    if (category === 'setup-sbull') tags.add(LEARNING_TAGS.sbullAdjust);

    candidates.push({
      format: 'setup-full',
      startRemaining: start,
      currentRemaining: start,
      dartsAvailable: 3,
      recommended,
      recommendedLeave,
      primaryCategory: category,
      difficulty: difficultyOfSetupCategory(category, 'setup-full'),
      learningTags: [...tags].sort(),
      trivial: false,
    });
  }

  fullCache.set(cacheKey, candidates);
  return candidates;
}

function categorizeFull(
  start: number,
  recommended: readonly Dart[],
  recommendedLeave: number,
): SetupCategory {
  if (start >= 302 && start <= 309) return 'setup-302-309';
  if (isTonTrap(start)) return 'setup-ton-trap';
  if (recommended.some((dart) => dart.id === 'SB')) return 'setup-sbull';
  const total = recommended.reduce((sum, dart) => sum + dart.score, 0);
  if (total >= LANDING_BAND.min && total <= LANDING_BAND.max) return 'setup-landing-95-105';
  if (inPremiumBand(recommendedLeave)) return 'setup-digits-0147';
  const continuationLeave = start - 60;
  if (leaveVerdictOf(continuationLeave) !== 'checkoutable') return 'setup-same-number-worse';
  const last = recommended[recommended.length - 1];
  if (['S18', 'S19', 'S20'].includes(last.id)) return 'setup-adjust-18-19-20';
  return 'setup-bogey-avoid';
}

/** テスト用にキャッシュを空にする。 */
export function clearSetupQuestionCache(): void {
  outcomeCache.clear();
  adjustmentCache.clear();
  fullCache.clear();
}
