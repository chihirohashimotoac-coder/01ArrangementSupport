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
import {
  THROWABLE_DARTS,
  TRIPLE_DARTS,
  findDart,
  requireDart,
  type Dart,
} from '../../domain/dart';
import {
  DARTS_PER_VISIT,
  MAX_CHECKOUT,
  MAX_SETUP_REMAINING,
  MIN_CHECKOUT,
  isBogey,
  isCheckoutable,
} from '../../domain/checkoutRules';
import {
  DEFAULT_SETUP_MAIN_TARGET,
  GRADE_THRESHOLDS,
  PREMIUM_TENPAI_LEAVES,
  TON_SCORE,
  type RouteGrade,
} from '../../data/rankingRules';
import { LAST_DIGIT_RULE_BAND } from '../../data/bogeyNumbers';
import {
  canReachTenpai,
  evaluateSetupRoute,
  isSingleMissTenpaiSafe,
  rankSetupRoutes,
  singleMissDartOf,
  type RankedSetupRoute,
} from '../setup/enumerate';
import { isTonTrap } from '../setup/leaveQuality';
import {
  LEARNING_TAGS,
  firstDartConceptKeyOf,
  lastDartConceptKeyOf,
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

/**
 * ラスト 1 投で「自然に狙う」的の候補。
 *
 *  - 直前に入ったナンバーをそのまま続ける（継続）
 *  - 主目標（既定 T20）の 20 へ戻る
 *
 * その的を狙ったときに実際に起きうる着弾は、同じウェッジのシングル面と
 * トリプル面の 2 つ（BULL エリアなら S-BULL と BULL）。
 */
function naturalTargetOutcomesOf(lastActualId: string): Dart[][] {
  const numbers = new Set<number | null>();
  const last = findDart(lastActualId);
  if (last) numbers.add(last.baseNumber);
  const main = findDart(DEFAULT_SETUP_MAIN_TARGET);
  if (main) numbers.add(main.baseNumber);

  const groups: Dart[][] = [];
  for (const number of numbers) {
    if (number === null) {
      const sb = findDart('SB');
      const bull = findDart('BULL');
      if (sb && bull) groups.push([sb, bull]);
      continue;
    }
    const single = findDart(`S${number}`);
    const triple = findDart(`T${number}`);
    if (single && triple) groups.push([single, triple]);
  }
  return groups;
}

/**
 * その 1 投調整が「本当に調整判断を必要とするか」。
 *
 * 自然に狙う的（直前と同じナンバー / 主目標の 20）のうち、
 * **どこへ入っても次ラウンドで上がれる**ものが 1 つでもあるなら、
 * 実戦では何も考えずに投げて問題ない。教材としては弱いので false を返す。
 *
 * 例:
 *   現在 176（ここまで T18 → T18）
 *     18 を続ける: T18 → 122 ○ / S18 → 158 ○   → 判断不要
 *     20 へ戻る  : T20 → 116 ○ / S20 → 156 ○   → 判断不要
 *   現在 182（ここまで T20 → T20）
 *     20 を続ける: T20 → 122 ○ / S20 → 162 ×   → 判断が要る
 *
 * 固定の下限（182 以上など）ではなく計算で決めるので、
 * 179（S20 で 159 のノーテン）のような残りも候補に入る。
 */
export function isDecisionRequiredAdjustment(
  currentRemaining: number,
  lastActualDartId: string,
): boolean {
  for (const outcomes of naturalTargetOutcomesOf(lastActualDartId)) {
    // Bust する着弾は、この教材が扱う「悪い残り」ではない（本仕様 6-1 節の列挙は
    // Bogey / 170 超え / テンパイ不能）。Bust を避ける判断は CHECKOUT 側の話なので、
    // ここでは残る着弾だけを見る。
    const reachable = outcomes.filter(
      (dart) => leaveVerdictOf(currentRemaining - dart.score) !== 'bust',
    );
    if (reachable.length === 0) continue;
    const alwaysSafe = reachable.every(
      (dart) => leaveVerdictOf(currentRemaining - dart.score) === 'checkoutable',
    );
    if (alwaysSafe) return false;
  }
  return true;
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
  /**
   * 自然な狙いのままでは悪い残りになりうるため、実際に調整判断が要る問題か。
   * v1.3.4 以降、新規出題はこれが true のものだけを使う。
   */
  readonly decisionRequired: boolean;
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

/** 既定の得点ターゲット（20 のシングル）をそのまま続けた場合の結果。 */
const DEFAULT_SCORING_TARGET = 'S20';

function tagsOfAdjustment(candidate: {
  currentRemaining: number;
  recommended: Dart;
  outcomes: readonly AdjustmentOutcome[];
  recommendedLeave: number;
  continuationLeave: number | null;
  category: SetupCategory;
  trivial: boolean;
  decisionRequired: boolean;
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
  tags.add(LEARNING_TAGS.lastDartAdjustment);

  // 「現在残りから逆算する」技術そのものを学習単位にする。
  // 302 を間違えた、ではなく「182 からの 3 投目調整が苦手」と分かるようにする。
  tags.add(lastDartConceptKeyOf(candidate.currentRemaining, candidate.recommended.id));

  // そのまま 20 を続けたらどうなるか。この比較が 3 投目調整の教材そのもの。
  const keepScoring = candidate.outcomes.find(
    (outcome) => outcome.dart.id === DEFAULT_SCORING_TARGET,
  );
  if (
    keepScoring !== undefined &&
    keepScoring.verdict !== 'checkoutable' &&
    candidate.recommended.id !== DEFAULT_SCORING_TARGET &&
    leaveVerdictOf(candidate.recommendedLeave) === 'checkoutable'
  ) {
    tags.add(LEARNING_TAGS.avoidBogeyOnLastDart);
    if (candidate.recommended.id === 'S18') tags.add(LEARNING_TAGS.shift20To18);
    if (candidate.recommended.id === 'S19') tags.add(LEARNING_TAGS.shift20To19);
  }
  if (candidate.category === 'setup-ton-trap') tags.add(LEARNING_TAGS.tonTrap);
  if (candidate.category === 'setup-landing-95-105') tags.add(LEARNING_TAGS.landing95to105);
  if (candidate.category === 'setup-sbull') tags.add(LEARNING_TAGS.sbullAdjust);
  if (candidate.trivial) tags.add(LEARNING_TAGS.trivial);
  if (candidate.decisionRequired) tags.add(LEARNING_TAGS.decisionRequired);
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

      const decisionRequired = isDecisionRequiredAdjustment(
        current,
        actualIds[actualIds.length - 1],
      );

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
          currentRemaining: current,
          recommended,
          outcomes,
          recommendedLeave,
          continuationLeave,
          category,
          trivial,
          decisionRequired,
        }),
        trivial,
        contextLabelJa: pattern.labelJa,
        decisionRequired,
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

// ---------------------------------------------------------------------------
// SETUP / FIRST DART（1 投目だけを選ぶ）
// ---------------------------------------------------------------------------

/**
 * 「この残りから実戦で最初に考える得点ターゲット」として扱う上位件数。
 *
 * 出題する残り点を選ぶときだけに使う。取得点の多い順に見て、この本数の中に
 * 安全な的と危険な的が混ざっている残りを教材にする。
 * 採点は（この件数に関係なく）盤面上のすべてのトリプルを規則どおり判定する。
 */
const MAJOR_SCORING_TARGETS = 3;

export interface SetupFirstDartOption {
  /** 狙う的（得点用のトリプル）。 */
  readonly dart: Dart;
  /** 狙いどおり入った場合の残り。 */
  readonly idealLeave: number;
  /** 同ナンバーのシングルへ落ちた場合。 */
  readonly missDart: Dart;
  readonly missLeave: number;
  /** シングルへ落ちても、残り本数でテンパイを作れるか。 */
  readonly singleMissSafe: boolean;
  /** その的から始める最良ルート（feedback の「おすすめ」に使う）。 */
  readonly bestRoute: RankedSetupRoute;
  /** その的から始めることの推奨度（既存 SETUP ランキングの grade）。 */
  readonly grade: RouteGrade;
}

const firstDartOptionCache = new Map<number, readonly SetupFirstDartOption[]>();

/**
 * その残りから「1 投目に狙う価値のある得点用トリプル」の一覧。
 *
 * 候補は SETUP ランキング（シングル落ち耐性のふるいを外した状態）に
 * 実際に現れる開始ターゲットから取る。教材の主題が
 * 「得点用トリプルの選び方」なので、シングルや BULL は候補にしない。
 * 「広いシングルを狙えば安全」という抜け道を正解にしないためでもある。
 *
 * 並びは
 *   1. シングルへ落ちてもテンパイを作れるか
 *   2. 取得点が多いか
 *   3. その的から始める最良ルートの評価
 * の順。1 が SETUP の合否そのもので、2 は「同じ質の残りを作れるなら点を多く取る」
 * という既存の方針（SETUP_POINTS_WEIGHT）と同じ考え方にあたる。
 *
 * 推奨度は「安全な的の中での差」として付ける。安全な代替がある以上、
 * シングル落ちでテンパイを失う的は、スコアが高くても C とする
 * （DISCOURAGING_REASON_CODES と同じ扱い）。
 */
export function setupFirstDartOptions(start: number): readonly SetupFirstDartOption[] {
  const cached = firstDartOptionCache.get(start);
  if (cached) return cached;

  interface Draft {
    readonly dart: Dart;
    readonly idealLeave: number;
    readonly missDart: Dart;
    readonly missLeave: number;
    readonly singleMissSafe: boolean;
    readonly bestRoute: RankedSetupRoute;
  }

  const drafts: Draft[] = [];
  for (const dart of TRIPLE_DARTS) {
    const missDart = singleMissDartOf(dart);
    if (missDart === null) continue;
    const idealLeave = start - dart.score;
    if (idealLeave < MIN_CHECKOUT) continue;
    // 狙いどおり入った場合に、残り 2 本でテンパイを作れる的だけを候補にする。
    if (!canReachTenpai(idealLeave, DARTS_PER_VISIT - 1)) continue;
    const bestRoute = bestRouteStartingWith(start, dart);
    if (bestRoute === null) continue;
    drafts.push({
      dart,
      idealLeave,
      missDart,
      missLeave: start - missDart.score,
      singleMissSafe: isSingleMissTenpaiSafe(start, dart, DARTS_PER_VISIT),
      bestRoute,
    });
  }

  drafts.sort(
    (a, b) =>
      Number(b.singleMissSafe) - Number(a.singleMissSafe) ||
      b.dart.score - a.dart.score ||
      b.bestRoute.score - a.bestRoute.score ||
      a.dart.id.localeCompare(b.dart.id),
  );

  const bestSafeScore = drafts.find((draft) => draft.singleMissSafe)?.bestRoute.score ?? null;
  const options: SetupFirstDartOption[] = drafts.map((draft) => ({
    ...draft,
    grade: gradeOfFirstDart(draft.singleMissSafe, draft.bestRoute.score, bestSafeScore),
  }));

  firstDartOptionCache.set(start, options);
  return options;
}

/**
 * その的から投げ始める最良ルート。
 *
 * 残りの 2 本は通常 Practice と同じ `rankSetupRoutes` に任せる。
 * シングル落ち耐性のふるいは外す（危険な的も「狙いどおり入ればどうなるか」を
 * 示す必要があるため）。教材としての良し悪しは safe / grade が表す。
 */
function bestRouteStartingWith(start: number, dart: Dart): RankedSetupRoute | null {
  const rest = rankSetupRoutes(start - dart.score, DARTS_PER_VISIT - 1, {
    maxRoutes: 1,
    includeSingleMissUnsafe: true,
  })[0];
  if (rest === undefined) return null;
  return evaluateSetupRoute(start, DARTS_PER_VISIT, [dart, ...rest.darts], {
    includeSingleMissUnsafe: true,
  });
}

function gradeOfFirstDart(
  singleMissSafe: boolean,
  score: number,
  bestSafeScore: number | null,
): RouteGrade {
  if (!singleMissSafe || bestSafeScore === null) return 'C';
  const gap = bestSafeScore - score;
  if (gap <= GRADE_THRESHOLDS.S) return 'S';
  if (gap <= GRADE_THRESHOLDS.A) return 'A';
  if (gap <= GRADE_THRESHOLDS.B) return 'B';
  return 'C';
}

export interface SetupFirstDartCandidate {
  readonly format: 'setup-first-dart';
  readonly startRemaining: number;
  readonly currentRemaining: number;
  /** 回答は 1 投だけ。 */
  readonly dartsAvailable: 1;
  /** このラウンドで投げられる本数。 */
  readonly visitDartsAvailable: 3;
  readonly options: readonly SetupFirstDartOption[];
  readonly safeOptions: readonly SetupFirstDartOption[];
  readonly unsafeOptions: readonly SetupFirstDartOption[];
  /** いちばん推奨する第一ターゲット。 */
  readonly recommended: SetupFirstDartOption;
  readonly primaryCategory: SetupCategory;
  readonly difficulty: TrainingDifficulty;
  readonly learningTags: readonly string[];
  readonly trivial: false;
}

const firstDartCache = new Map<string, readonly SetupFirstDartCandidate[]>();

/**
 * SETUP / FIRST DART の全出題候補。
 *
 * 出題するのは「第一ターゲットによってシングル落ち耐性に差が出る残り」だけ。
 * どのトリプルから入っても安全な残りを並べても、考えずに T20 と答えて
 * 正解になってしまい、教材にならない（本仕様 5-4 節）。
 * 残り点をハードコードせず、SETUP engine の判定から機械的に抽出する。
 */
export function setupFirstDartCandidates(range: {
  min: number;
  max: number;
}): readonly SetupFirstDartCandidate[] {
  const { min, max } = clampSetupRange(range);
  const cacheKey = `${min}/${max}`;
  const cached = firstDartCache.get(cacheKey);
  if (cached) return cached;

  const candidates: SetupFirstDartCandidate[] = [];
  for (let start = min; start <= max; start += 1) {
    if (!canReachTenpai(start, DARTS_PER_VISIT)) continue;
    const options = setupFirstDartOptions(start);
    const safeOptions = options.filter((option) => option.singleMissSafe);
    const unsafeOptions = options.filter((option) => !option.singleMissSafe);
    if (safeOptions.length === 0 || unsafeOptions.length === 0) continue;

    /*
     * 出題するのは「実戦で最初に考える得点ターゲット」の中で安全性が分かれる残りだけ。
     *
     * 盤面のトリプル 20 種すべてを見ると、T1 のような誰も狙わない的が危険というだけで
     * 教材になってしまう。取得点の多い順に上位 3 つ（ふつうは T20 / T19 / T18）を見て、
     * そこに安全な的と危険な的が混ざっている残りだけを出題する。
     * 採点はこの絞り込みと無関係に、盤面上のすべてのトリプルを規則どおり判定する。
     */
    const major = [...options]
      .sort((a, b) => b.dart.score - a.dart.score || a.dart.id.localeCompare(b.dart.id))
      .slice(0, MAJOR_SCORING_TARGETS);
    if (!major.some((option) => option.singleMissSafe)) continue;
    if (!major.some((option) => !option.singleMissSafe)) continue;

    const recommended = safeOptions[0];
    // 主目標がそのまま安全なら「20 で良いと見抜く」問題、
    // 振り直しが要るなら「20 を捨てる」問題。後者の方が難しい。
    const mainTargetIsSafe = safeOptions.some(
      (option) => option.dart.id === DEFAULT_SETUP_MAIN_TARGET,
    );
    const tags = new Set<string>([
      LEARNING_TAGS.firstDartSafety,
      LEARNING_TAGS.singleMissTenpaiSafe,
      LEARNING_TAGS.avoidSingleMissDeadEnd,
      LEARNING_TAGS.bogeyAvoidance,
      firstDartConceptKeyOf(start, recommended.dart.id),
    ]);
    if (inPremiumBand(recommended.bestRoute.leave)) {
      tags.add(`leave-${recommended.bestRoute.leave}`);
    }

    candidates.push({
      format: 'setup-first-dart',
      startRemaining: start,
      currentRemaining: start,
      dartsAvailable: 1,
      visitDartsAvailable: DARTS_PER_VISIT,
      options,
      safeOptions,
      unsafeOptions,
      recommended,
      primaryCategory: 'setup-first-dart-safety',
      difficulty: mainTargetIsSafe ? 'medium' : 'hard',
      learningTags: [...tags].sort(),
      trivial: false,
    });
  }

  firstDartCache.set(cacheKey, candidates);
  return candidates;
}

/** 回答した 1 投が、第一ターゲット候補のどれかか。 */
export function findFirstDartOption(
  start: number,
  dartId: string,
): SetupFirstDartOption | null {
  return setupFirstDartOptions(start).find((option) => option.dart.id === dartId) ?? null;
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
  firstDartCache.clear();
  firstDartOptionCache.clear();
}
