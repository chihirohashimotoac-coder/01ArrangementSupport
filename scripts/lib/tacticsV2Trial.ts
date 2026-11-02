/**
 * 戦術 v2（2026-11-01 監査指摘）の**試算用**の実装。
 *
 * ============================================================
 *  これは本体（src/**）へ入れる前に差分表を作るための scripts 側のコード。
 *  production bundle からは参照しない。重みの数値はすべて「提案値」で、
 *  オーナーの承認を得るまで src/data/rankingRules.ts へは入れない
 *  （CLAUDE.md §3 / プロンプト 0-2）。
 * ============================================================
 *
 * 方針:
 *   - フラグをすべて外すと、現行の `rankCheckoutRoutes()` / `rankSetupRoutes()` と
 *     **同じ結果になる**ように書く（audit-checkout-v2.ts が全件で照合する）。
 *     差分表に出る変化が「試算の書き写し誤り」ではなく「提案した規則の効果」だと
 *     言えるようにするため。
 *   - engine の部品（列挙・隣接・テンパイ判定・残りの評価）はそのまま使う。
 */
import {
  FINISHING_DARTS,
  THROWABLE_DARTS,
  findDart,
  isFinishingDart,
  parseRoute,
  routeKey,
  type Dart,
} from '../../src/domain/dart';
import { MAX_CHECKOUT, isBogey, isCheckoutable } from '../../src/domain/checkoutRules';
import {
  CHECKOUT_REASON_WEIGHTS,
  DART_COUNT_PENALTY,
  DISCOURAGING_REASON_CODES,
  DOUBLE_QUALITY,
  GOOD_DOUBLE_TIERS,
  GRADE_THRESHOLDS,
  SETUP_DIFFICULTY_WEIGHT,
  SETUP_POINTS_WEIGHT,
  SETUP_REASON_WEIGHTS,
  TRIPLE_COUNT_PENALTY,
  USER_DOUBLE_PREFERENCE_BONUS,
  WEAK_DOUBLE_TIERS,
  type RouteGrade,
} from '../../src/data/rankingRules';
import { missVariantsOf, neighborsOf } from '../../src/data/boardAdjacency';
import { getStandardRoute } from '../../src/data/standardCheckoutRoutes';
import { enumerateCheckoutRoutes, type CheckoutRoute } from '../../src/engine/checkout/enumerate';
import { evaluateLeave } from '../../src/engine/setup/leaveQuality';
import { difficultyOf, targetKeyOf } from '../../src/engine/setup/sequences';
import { isSingleMissTenpaiSafe } from '../../src/engine/setup/tenpai';

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

export function gradeOf(score: number, best: number): RouteGrade {
  const gap = best - score;
  if (gap <= GRADE_THRESHOLDS.S) return 'S';
  if (gap <= GRADE_THRESHOLDS.A) return 'A';
  if (gap <= GRADE_THRESHOLDS.B) return 'B';
  return 'C';
}

// ---------------------------------------------------------------------------
// CHECKOUT
// ---------------------------------------------------------------------------

/** v2 で増やす理由コード（試算用の仮称）。 */
export type TrialCheckoutCode =
  | keyof typeof CHECKOUT_REASON_WEIGHTS
  /** 本数に余裕があるのに、1 投目のシングルで 1 本を繋ぎに使う（1-4 / 81 の件）。 */
  | 'SPENDS_EXTRA_DART'
  /** 点数の差だけで C になった（1-8）。表示のみで重み 0。 */
  | 'BELOW_TOP_ROUTE';

export interface CheckoutV2Flags {
  /** 1-1 L-H1: BULL 始動の縦ズレ（BULL → SB）を外れ判定に入れる。 */
  readonly bullMiss: boolean;
  /** 1-2 L-H2: 「トリプル不要」の代替から NON_FINAL_DOUBLE を除く。 */
  readonly tripleFreeExcludesNonFinalDouble: boolean;
  /** 1-4: 本数を使う繋ぎのシングル（SAFE_SINGLE_START を付けず減点）。 */
  readonly spendsExtraDart: boolean;
  /** 1-5: 残り 2 本の 51〜70 の基準ルートを導出規則に替える。 */
  readonly twoDartSixtiesStandard: boolean;
  /** 1-8 L-M2: 否定理由のない C に BELOW_TOP_ROUTE を付ける。 */
  readonly belowTopReason: boolean;
  /** 1-10: 外れてちょうど 0（ダブル / BULL）なら上がりとして扱う。 */
  readonly exactFinishOnMiss: boolean;
}

export const CHECKOUT_FLAGS_OFF: CheckoutV2Flags = {
  bullMiss: false,
  tripleFreeExcludesNonFinalDouble: false,
  spendsExtraDart: false,
  twoDartSixtiesStandard: false,
  belowTopReason: false,
  exactFinishOnMiss: false,
};

export const CHECKOUT_FLAGS_V2: CheckoutV2Flags = {
  bullMiss: true,
  tripleFreeExcludesNonFinalDouble: true,
  spendsExtraDart: true,
  twoDartSixtiesStandard: true,
  belowTopReason: true,
  exactFinishOnMiss: true,
};

/** 提案する重み（承認前の仮の値）。 */
export const PROPOSED_CHECKOUT_WEIGHTS = {
  SPENDS_EXTRA_DART: -30,
  BELOW_TOP_ROUTE: 0,
} as const;

const NEGATIVE_CODES = new Set<string>([
  'SINGLE_MISS_LOSES_CHECKOUT',
  'SINGLE_MISS_LEAVES_BOGEY',
  'NEIGHBOR_RISK',
  'WEAK_DOUBLE',
  'BULL_REQUIRED',
  'EXTRA_TARGET_SWITCH',
  'SAFER_START_EXISTS',
  'UNNECESSARY_TRIPLE',
  'NON_FINAL_DOUBLE',
  'SPENDS_EXTRA_DART',
  'BELOW_TOP_ROUTE',
]);

export function isNegativeCode(code: string): boolean {
  return NEGATIVE_CODES.has(code);
}

/**
 * 1-5 の導出規則（試算）。残り 2 本・51〜70 だけに使う。
 *   51〜60: S(残り − 40) → D20
 *   61〜70: S(残り − 50) → BULL（D-BULL）
 */
export function twoDartSixtiesRoute(remaining: number): readonly Dart[] | null {
  if (remaining >= 51 && remaining <= 60) return parseRoute([`S${remaining - 40}`, 'D20']);
  if (remaining >= 61 && remaining <= 70) return parseRoute([`S${remaining - 50}`, 'BULL']);
  return null;
}

export function standardDartsFor(
  remaining: number,
  dartsAvailable: number,
  flags: CheckoutV2Flags,
): readonly Dart[] | null {
  if (flags.twoDartSixtiesStandard && dartsAvailable === 2) {
    const derived = twoDartSixtiesRoute(remaining);
    if (derived) return derived;
  }
  return getStandardRoute(remaining)?.darts ?? null;
}

export interface TrialCheckoutRoute {
  readonly darts: readonly Dart[];
  readonly key: string;
  readonly score: number;
  readonly tacticalScore: number;
  readonly codes: readonly TrialCheckoutCode[];
  readonly isStandard: boolean;
  readonly grade: RouteGrade;
}

export interface TrialCheckoutOptions {
  readonly preferredDoubles?: readonly string[];
  readonly applyStandardBonus?: boolean;
}

interface Analyzed {
  readonly route: CheckoutRoute;
  readonly codes: TrialCheckoutCode[];
  readonly multipliers: Map<TrialCheckoutCode, number>;
  readonly extraScore: number;
  readonly containsTriple: boolean;
  readonly containsBull: boolean;
  readonly singleMissSafe: boolean | null;
}

function weightOf(code: TrialCheckoutCode): number {
  if (code === 'SPENDS_EXTRA_DART') return PROPOSED_CHECKOUT_WEIGHTS.SPENDS_EXTRA_DART;
  if (code === 'BELOW_TOP_ROUTE') return PROPOSED_CHECKOUT_WEIGHTS.BELOW_TOP_ROUTE;
  return CHECKOUT_REASON_WEIGHTS[code];
}

function analyzeCheckout(
  route: CheckoutRoute,
  remaining: number,
  dartsAvailable: number,
  options: TrialCheckoutOptions,
  standardKey: string | null,
  flags: CheckoutV2Flags,
): Analyzed {
  const codes: TrialCheckoutCode[] = [];
  const multipliers = new Map<TrialCheckoutCode, number>();
  let extraScore = 0;
  const darts = route.darts;
  const first = darts[0];
  const finish = darts[darts.length - 1];
  const isStandard = standardKey !== null && route.key === standardKey;

  if (isStandard && options.applyStandardBonus !== false) codes.push('STANDARD_ROUTE');
  if (darts.length === 1) codes.push('FINISH_IN_ONE');
  if (darts.length < dartsAvailable) codes.push('FEWER_DARTS');

  const dartsAfterMiss = dartsAvailable - 1;
  const landedSafe = (landed: Dart): boolean => {
    const leave = remaining - landed.score;
    if (leave >= 2 && isCheckoutable(leave, dartsAfterMiss)) return true;
    return flags.exactFinishOnMiss && leave === 0 && isFinishingDart(landed);
  };

  let singleMissSafe: boolean | null = null;
  const verticalTarget =
    first.kind === 'triple' || first.kind === 'double'
      ? findDart(`S${first.baseNumber}`)
      : flags.bullMiss && first.id === 'BULL'
        ? findDart('SB')
        : undefined;
  if (dartsAfterMiss >= 1 && verticalTarget) {
    const safe = landedSafe(verticalTarget);
    singleMissSafe = safe;
    if (safe) codes.push('SINGLE_MISS_SAFE');
    else {
      codes.push('SINGLE_MISS_LOSES_CHECKOUT');
      if (isBogey(remaining - verticalTarget.score)) codes.push('SINGLE_MISS_LEAVES_BOGEY');
    }
  }

  const spendsExtra =
    flags.spendsExtraDart &&
    first.kind === 'single' &&
    darts.length > minPlainDartsOf(remaining, dartsAvailable);

  if (dartsAfterMiss >= 1 && first.kind === 'single' && first.baseNumber !== null) {
    const overshoots = [findDart(`T${first.baseNumber}`), findDart(`D${first.baseNumber}`)].filter(
      (dart): dart is Dart => dart !== undefined,
    );
    let allSafe = overshoots.length > 0;
    for (const dart of overshoots) if (!landedSafe(dart)) allSafe = false;
    if (allSafe && !spendsExtra) codes.push('SAFE_SINGLE_START');
  }
  if (spendsExtra) codes.push('SPENDS_EXTRA_DART');

  if (dartsAfterMiss >= 1) {
    const horizontal = missVariantsOf(first).filter((v) => v.direction === 'horizontal');
    let safeCount = 0;
    for (const variant of horizontal) if (landedSafe(variant.dart)) safeCount += 1;
    if (horizontal.length > 0) {
      if (safeCount === horizontal.length) codes.push('NEIGHBOR_SAFE');
      else if (safeCount === 0) codes.push('NEIGHBOR_RISK');
    }
  }

  const quality = DOUBLE_QUALITY[finish.id];
  if (quality) {
    if (GOOD_DOUBLE_TIERS.includes(quality.tier)) codes.push('GOOD_DOUBLE');
    else if (WEAK_DOUBLE_TIERS.includes(quality.tier)) codes.push('WEAK_DOUBLE');
  }

  const preferred = options.preferredDoubles ?? [];
  const preferenceIndex = preferred.indexOf(finish.id);
  if (preferenceIndex >= 0) {
    extraScore +=
      USER_DOUBLE_PREFERENCE_BONUS[Math.min(preferenceIndex, USER_DOUBLE_PREFERENCE_BONUS.length - 1)];
    codes.push('USER_DOUBLE_PREFERENCE');
  }

  const containsBull = darts.some((dart) => dart.baseNumber === null);
  if (containsBull) codes.push('BULL_REQUIRED');

  let switchCount = 0;
  let continuity = false;
  for (let i = 1; i < darts.length; i += 1) {
    if (targetKeyOf(darts[i]) === targetKeyOf(darts[i - 1])) continuity = true;
    else switchCount += 1;
  }
  if (continuity) codes.push('TARGET_CONTINUITY');
  if (switchCount >= 2) {
    codes.push('EXTRA_TARGET_SWITCH');
    multipliers.set('EXTRA_TARGET_SWITCH', switchCount - 1);
  }
  const nonFinalDoubles = darts.slice(0, -1).filter((dart) => dart.kind === 'double').length;
  if (nonFinalDoubles > 0) {
    codes.push('NON_FINAL_DOUBLE');
    multipliers.set('NON_FINAL_DOUBLE', nonFinalDoubles);
  }

  return {
    route,
    codes,
    multipliers,
    extraScore,
    containsTriple: darts.some((dart) => dart.kind === 'triple'),
    containsBull,
    singleMissSafe,
  };
}

/**
 * BULL / S-BULL を使わずに上がれる最少本数（無ければ BULL を含めた最少本数）。
 * 「本数に余裕があるのに 1 本を繋ぎに使う」の判定に使う。50 のように
 * 1 本で上がるには BULL が要る残りでは、S18 → D16 のような 2 本を「余分」と見なさない。
 */
const minPlainCache = new Map<string, number>();
export function minPlainDartsOf(remaining: number, dartsAvailable: number): number {
  const cacheKey = `${remaining}/${dartsAvailable}`;
  const cached = minPlainCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const value = computeMinPlainDarts(remaining, dartsAvailable);
  minPlainCache.set(cacheKey, value);
  return value;
}

function computeMinPlainDarts(remaining: number, dartsAvailable: number): number {
  const routes = enumerateCheckoutRoutes(remaining, dartsAvailable);
  let plain = Infinity;
  let any = Infinity;
  for (const route of routes) {
    any = Math.min(any, route.darts.length);
    if (!route.darts.some((dart) => dart.baseNumber === null)) plain = Math.min(plain, route.darts.length);
  }
  return Number.isFinite(plain) ? plain : any;
}

const checkoutCache = new Map<string, readonly TrialCheckoutRoute[]>();

export function rankCheckoutTrial(
  remaining: number,
  dartsAvailable: number,
  options: TrialCheckoutOptions,
  flags: CheckoutV2Flags,
): readonly TrialCheckoutRoute[] {
  const cacheKey = `${remaining}/${dartsAvailable}/${(options.preferredDoubles ?? []).join(',')}/${
    options.applyStandardBonus === false ? 'nb' : 'b'
  }/${JSON.stringify(flags)}`;
  const cached = checkoutCache.get(cacheKey);
  if (cached) return cached;

  const routes = enumerateCheckoutRoutes(remaining, dartsAvailable);
  if (routes.length === 0) return [];
  const standard = standardDartsFor(remaining, dartsAvailable, flags);
  const standardKey = standard ? routeKey(standard) : null;
  const analyzed = routes.map((route) =>
    analyzeCheckout(route, remaining, dartsAvailable, options, standardKey, flags),
  );

  const minTripleFreeLength = analyzed.reduce((min, item) => {
    if (item.containsTriple || item.containsBull) return min;
    if (flags.tripleFreeExcludesNonFinalDouble && item.codes.includes('NON_FINAL_DOUBLE')) return min;
    return Math.min(min, item.route.darts.length);
  }, Number.POSITIVE_INFINITY);
  const safeStartLengths = new Set<number>();
  for (const item of analyzed) {
    if (item.singleMissSafe === true) safeStartLengths.add(item.route.darts.length);
  }
  for (const item of analyzed) {
    if (item.singleMissSafe === false && safeStartLengths.has(item.route.darts.length)) {
      item.codes.push('SAFER_START_EXISTS');
    }
    if (item.containsTriple && minTripleFreeLength <= item.route.darts.length) {
      item.codes.push('UNNECESSARY_TRIPLE');
    }
  }

  const scored = analyzed.map((item) => {
    const reasonScore = item.codes.reduce(
      (sum, code) => sum + weightOf(code) * (item.multipliers.get(code) ?? 1),
      0,
    );
    const tripleCount = item.route.darts.filter((dart) => dart.kind === 'triple').length;
    const structural =
      DART_COUNT_PENALTY * item.route.darts.length + TRIPLE_COUNT_PENALTY * tripleCount;
    const score = reasonScore + item.extraScore - structural;
    const standardBonus = item.codes.includes('STANDARD_ROUTE')
      ? CHECKOUT_REASON_WEIGHTS.STANDARD_ROUTE
      : 0;
    return {
      darts: item.route.darts,
      key: item.route.key,
      score,
      tacticalScore: score - standardBonus,
      codes: item.codes,
      isStandard: standardKey !== null && item.route.key === standardKey,
    };
  });
  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const bestTactical = scored.reduce((max, item) => Math.max(max, item.tacticalScore), -Infinity);
  const discouraging = (codes: readonly string[]) =>
    codes.some((code) => (DISCOURAGING_REASON_CODES as readonly string[]).includes(code));
  const bestHasDiscouraging = scored
    .filter((item) => item.tacticalScore === bestTactical)
    .every((item) => discouraging(item.codes));

  const result = scored.map((item): TrialCheckoutRoute => {
    if (item.isStandard) return { ...item, grade: 'S' };
    const byScore = gradeOf(item.tacticalScore, bestTactical);
    const grade: RouteGrade = !bestHasDiscouraging && discouraging(item.codes) ? 'C' : byScore;
    if (flags.belowTopReason && grade === 'C' && !item.codes.some(isNegativeCode)) {
      return { ...item, codes: [...item.codes, 'BELOW_TOP_ROUTE'], grade };
    }
    return { ...item, grade };
  });
  checkoutCache.set(cacheKey, result);
  return result;
}

/**
 * 1-4: MY ROUTE の最上位。通常評価で C のもの・ダブル→ダブル・本数を使う繋ぎの
 * シングルは最上位にしない（該当しない候補が 1 つも無ければ従来どおり）。
 */
export function myRouteTopTrial(
  remaining: number,
  dartsAvailable: number,
  preferredDoubles: readonly string[],
  flags: CheckoutV2Flags,
  restrictTop: boolean,
): { mine: TrialCheckoutRoute; normalGrade: RouteGrade } | null {
  const mine = rankCheckoutTrial(
    remaining,
    dartsAvailable,
    { preferredDoubles, applyStandardBonus: false },
    flags,
  );
  if (mine.length === 0) return null;
  const normal = rankCheckoutTrial(remaining, dartsAvailable, {}, flags);
  const gradeByKey = new Map(normal.map((route) => [route.key, route.grade]));
  // 得意ダブルへ持っていくために 1 本を足すルート（81 の T11 → S16 → D16 など）も
  // 最上位にしない。得意ダブルへ繋ぐのは 1 投目を外したあと（リカバリー）の場面に限る。
  const minPlain = minPlainDartsOf(remaining, dartsAvailable);
  const eligible = (route: TrialCheckoutRoute) =>
    gradeByKey.get(route.key) !== 'C' &&
    !route.codes.includes('NON_FINAL_DOUBLE') &&
    !route.codes.includes('SPENDS_EXTRA_DART') &&
    route.darts.length <= minPlain;
  const top = restrictTop ? (mine.find(eligible) ?? mine[0]) : mine[0];
  return { mine: top, normalGrade: gradeByKey.get(top.key) ?? 'C' };
}

// ---------------------------------------------------------------------------
// SETUP（171〜350）— 総当たり版
// ---------------------------------------------------------------------------

export interface SetupV2Flags {
  /** 1-3: ビジット最後の 1 投（縦ズレ）が外れてもテンパイが残れば加点する。 */
  readonly lastDartMissBonus: number;
  /** 1-3（参考）: 最後の 1 投の横ズレ。全部残れば +h、1 つも残らなければ −h。 */
  readonly lastDartNeighbor: number;
  /** 1-3（選択肢）: SETUP_THIN_TARGET の重み（現行 0）。ダブル 1 本あたり。 */
  readonly thinTargetWeight: number;
  /** 1-3: 同点なら主目標から始まる（主目標が先頭に続く本数が多い）ルートを先にする。 */
  readonly mainTargetTieBreak: boolean;
}

export const SETUP_FLAGS_OFF: SetupV2Flags = {
  lastDartMissBonus: 0,
  lastDartNeighbor: 0,
  thinTargetWeight: 0,
  mainTargetTieBreak: false,
};

const DART_COUNT = THROWABLE_DARTS.length;
const MAIN_TARGET = 'T20';
const MAIN_INDEX = THROWABLE_DARTS.findIndex((dart) => dart.id === MAIN_TARGET);

interface SequenceSet {
  readonly length: number;
  readonly count: number;
  readonly idx: Uint8Array;
  readonly total: Int16Array;
  readonly intrinsic: Float64Array;
  readonly thin: Uint8Array;
  readonly mainPrefix: Uint8Array;
  readonly lastScore: Int16Array;
}

const sequenceSets = new Map<number, SequenceSet>();

/** 長さ `length` の全シーケンス（62^length）を、残り点に依存しない値とともに持つ。 */
function sequenceSet(length: number): SequenceSet {
  const cached = sequenceSets.get(length);
  if (cached) return cached;
  const count = DART_COUNT ** length;
  const idx = new Uint8Array(count * length);
  const total = new Int16Array(count);
  const intrinsic = new Float64Array(count);
  const thin = new Uint8Array(count);
  const mainPrefix = new Uint8Array(count);
  const lastScore = new Int16Array(count);
  for (let n = 0; n < count; n += 1) {
    let rest = n;
    const darts: Dart[] = [];
    for (let i = 0; i < length; i += 1) {
      const d = rest % DART_COUNT;
      rest = Math.floor(rest / DART_COUNT);
      idx[n * length + (length - 1 - i)] = d;
    }
    for (let i = 0; i < length; i += 1) darts.push(THROWABLE_DARTS[idx[n * length + i]]);
    let t = 0;
    let difficulty = 0;
    let thinCount = 0;
    let sb = false;
    for (const dart of darts) {
      t += dart.score;
      difficulty += difficultyOf(dart);
      if (dart.kind === 'double') thinCount += 1;
      if (dart.id === 'SB') sb = true;
    }
    let value = -difficulty * SETUP_DIFFICULTY_WEIGHT;
    for (let i = 1; i < darts.length; i += 1) {
      if (targetKeyOf(darts[i]) === targetKeyOf(darts[i - 1])) {
        value += SETUP_REASON_WEIGHTS.SETUP_TARGET_CONTINUITY;
        break;
      }
    }
    const last = darts[darts.length - 1];
    if (darts.length >= 2 && (last.kind === 'single' || last.id === 'SB')) {
      if (darts.slice(0, -1).every((dart) => dart.id === MAIN_TARGET)) {
        value += SETUP_REASON_WEIGHTS.SETUP_THIRD_DART_ADJUST;
      }
    }
    if (sb) value += SETUP_REASON_WEIGHTS.SETUP_USES_SBULL;
    value += SETUP_REASON_WEIGHTS.SETUP_THIN_TARGET * thinCount;
    let prefix = 0;
    while (prefix < darts.length && darts[prefix].id === MAIN_TARGET) prefix += 1;
    total[n] = t;
    intrinsic[n] = value;
    thin[n] = thinCount;
    mainPrefix[n] = prefix;
    lastScore[n] = last.score;
  }
  const set = { length, count, idx, total, intrinsic, thin, mainPrefix, lastScore };
  sequenceSets.set(length, set);
  return set;
}

/** 残り 2〜350 で、狙い `dart` の縦ズレの外れ方。D は盤外（0 点）も含む。 */
function verticalMissesOf(dart: Dart): readonly number[] {
  if (dart.id === 'BULL') return [25];
  if (dart.id === 'SB' || dart.baseNumber === null) return [];
  const n = dart.baseNumber;
  if (dart.kind === 'triple') return [n];
  if (dart.kind === 'double') return [n, 0];
  return [3 * n, 2 * n];
}

function horizontalMissesOf(dart: Dart): readonly number[] {
  if (dart.baseNumber === null) return [];
  const factor = dart.kind === 'triple' ? 3 : dart.kind === 'double' ? 2 : 1;
  return neighborsOf(dart.baseNumber).map((neighbor) => neighbor * factor);
}

function isTenpaiLeave(leave: number): boolean {
  return leave >= 2 && leave <= MAX_CHECKOUT && isCheckoutable(leave, 3);
}

/** [pre * 62 + dartIndex] → 縦ズレしてもテンパイが残るか（1 / 0）。 */
const verticalKeeps = new Uint8Array(351 * DART_COUNT);
/** 横ズレ: 2 = すべて残る / 0 = 1 つも残らない / 1 = それ以外。 */
const horizontalKeeps = new Uint8Array(351 * DART_COUNT);
for (let pre = 0; pre <= 350; pre += 1) {
  for (let d = 0; d < DART_COUNT; d += 1) {
    const dart = THROWABLE_DARTS[d];
    const vertical = verticalMissesOf(dart);
    verticalKeeps[pre * DART_COUNT + d] =
      vertical.length > 0 && vertical.every((score) => isTenpaiLeave(pre - score)) ? 1 : 0;
    const horizontal = horizontalMissesOf(dart);
    const kept = horizontal.filter((score) => isTenpaiLeave(pre - score)).length;
    horizontalKeeps[pre * DART_COUNT + d] =
      horizontal.length === 0 ? 1 : kept === horizontal.length ? 2 : kept === 0 ? 0 : 1;
  }
}

export interface SetupTrialTop {
  readonly darts: readonly Dart[];
  readonly key: string;
  readonly score: number;
  readonly leave: number;
  readonly tier: 1 | 2 | 3 | 4;
  readonly lastMissKeeps: boolean;
}

export interface SetupTrialState {
  readonly top: SetupTrialTop;
  /** 上位 5 件（表示用）。 */
  readonly leaders: readonly SetupTrialTop[];
  /** 合法な全シーケンスの推奨度（シーケンス番号 → 'S'|'A'|'B'|'C'）。 */
  readonly grades: Uint8Array;
}

const GRADE_CODES: readonly RouteGrade[] = ['S', 'A', 'B', 'C'];
export function gradeFromCode(code: number): RouteGrade {
  return GRADE_CODES[code];
}

function dartsOf(set: SequenceSet, n: number): Dart[] {
  const result: Dart[] = [];
  for (let i = 0; i < set.length; i += 1) result.push(THROWABLE_DARTS[set.idx[n * set.length + i]]);
  return result;
}

/**
 * SETUP の第 1 候補を総当たりで求める（現行の 4 段のふるいを同じ順で適用する）。
 * grades の値: 0..3 = S..C、255 = 合法でない（Bust）。
 */
export function rankSetupTrial(
  remaining: number,
  dartsAvailable: number,
  flags: SetupV2Flags,
): SetupTrialState {
  const set = sequenceSet(dartsAvailable);
  const scores = new Float64Array(set.count);
  const tiers = new Uint8Array(set.count);
  const firstSafe = new Uint8Array(DART_COUNT);
  for (let d = 0; d < DART_COUNT; d += 1) {
    firstSafe[d] = isSingleMissTenpaiSafe(remaining, THROWABLE_DARTS[d], dartsAvailable) ? 1 : 0;
  }
  const safeTriples: number[] = [];
  for (let d = 0; d < DART_COUNT; d += 1) {
    if (THROWABLE_DARTS[d].kind === 'triple' && firstSafe[d]) safeTriples.push(d);
  }
  const mainNeedsChange = safeTriples.length > 0 && !safeTriples.includes(MAIN_INDEX);
  const allowedTripleFirst = mainNeedsChange
    ? [
        safeTriples.reduce((best, d) =>
          THROWABLE_DARTS[d].score > THROWABLE_DARTS[best].score ? d : best,
        ),
      ]
    : safeTriples;
  const allowedSet = new Set(allowedTripleFirst);

  let bestTier = 5;
  for (let n = 0; n < set.count; n += 1) {
    const leave = remaining - set.total[n];
    if (leave < 2) {
      tiers[n] = 0;
      continue;
    }
    const evaluation = evaluateLeave(leave);
    const lowScore = dartsAvailable === 3 && set.total[n] < 60 ? SETUP_REASON_WEIGHTS.SETUP_LOW_SCORE : 0;
    let score = evaluation.score + set.total[n] * SETUP_POINTS_WEIGHT + lowScore + set.intrinsic[n];
    const lastIndex = set.idx[n * set.length + set.length - 1];
    const pre = remaining - (set.total[n] - set.lastScore[n]);
    if (flags.lastDartMissBonus !== 0 && verticalKeeps[pre * DART_COUNT + lastIndex]) {
      score += flags.lastDartMissBonus;
    }
    if (flags.lastDartNeighbor !== 0) {
      const h = horizontalKeeps[pre * DART_COUNT + lastIndex];
      if (h === 2) score += flags.lastDartNeighbor;
      else if (h === 0) score -= flags.lastDartNeighbor;
    }
    if (flags.thinTargetWeight !== 0) score += flags.thinTargetWeight * set.thin[n];
    scores[n] = score;
    const first = set.idx[n * set.length];
    let tier = 4;
    if (evaluation.checkoutable) {
      tier = 3;
      if (firstSafe[first]) tier = 2;
      if (allowedSet.has(first)) tier = 1;
    }
    tiers[n] = tier;
    if (tier < bestTier) bestTier = tier;
  }
  // ふるいは「その段の条件を満たすものだけを見る」。段 2 は段 1 が空のとき、
  // 段 1 の候補を含めた「シングル落ちに耐える」全体を見る（現行の collect と同じ）。
  const inPool = (n: number): boolean => {
    const tier = tiers[n];
    if (tier === 0) return false;
    if (bestTier === 1) return tier === 1;
    if (bestTier === 2) return tier <= 2;
    if (bestTier === 3) return tier <= 3;
    return true;
  };
  let best = -Infinity;
  for (let n = 0; n < set.count; n += 1) if (inPool(n) && scores[n] > best) best = scores[n];

  // 上位 5 件だけを並べる（スコアの閾値で絞ってから並べ替える）。
  const candidates: { n: number; key: string }[] = [];
  let threshold = best;
  for (const margin of [0, 5, 15, 30]) {
    candidates.length = 0;
    threshold = best - margin;
    for (let n = 0; n < set.count; n += 1) {
      if (inPool(n) && scores[n] >= threshold) candidates.push({ n, key: routeKey(dartsOf(set, n)) });
    }
    if (candidates.length >= 5) break;
  }
  candidates.sort((a, b) => {
    if (scores[b.n] !== scores[a.n]) return scores[b.n] - scores[a.n];
    if (flags.mainTargetTieBreak && set.mainPrefix[a.n] !== set.mainPrefix[b.n]) {
      return set.mainPrefix[b.n] - set.mainPrefix[a.n];
    }
    return a.key.localeCompare(b.key);
  });
  const pool = candidates.map((item) => item.n);
  const toTop = (n: number): SetupTrialTop => {
    const darts = dartsOf(set, n);
    const lastIndex = set.idx[n * set.length + set.length - 1];
    const pre = remaining - (set.total[n] - set.lastScore[n]);
    return {
      darts,
      key: routeKey(darts),
      score: scores[n],
      leave: remaining - set.total[n],
      tier: tiers[n] as 1 | 2 | 3 | 4,
      lastMissKeeps: verticalKeeps[pre * DART_COUNT + lastIndex] === 1,
    };
  };
  const leaders = pool.slice(0, 5).map(toTop);

  const grades = new Uint8Array(set.count);
  for (let n = 0; n < set.count; n += 1) {
    if (tiers[n] === 0) {
      grades[n] = 255;
      continue;
    }
    const gap = best - scores[n];
    grades[n] = gap <= GRADE_THRESHOLDS.S ? 0 : gap <= GRADE_THRESHOLDS.A ? 1 : gap <= GRADE_THRESHOLDS.B ? 2 : 3;
  }
  return { top: leaders[0], leaders, grades };
}

/** シーケンス番号からルート文字列を作る（差分表の代表例用）。 */
export function setupRouteText(dartsAvailable: number, n: number): string {
  return dartsOf(sequenceSet(dartsAvailable), n)
    .map((dart) => dart.id)
    .join(' → ');
}

export function setupSequenceCount(dartsAvailable: number): number {
  return sequenceSet(dartsAvailable).count;
}

/** 試算で使う「上がりの的」一覧（参照用）。 */
export const FINISH_IDS = FINISHING_DARTS.map((dart) => dart.id);
