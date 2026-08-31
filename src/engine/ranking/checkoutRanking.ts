/**
 * チェックアウトルートの戦術評価。
 *
 * 数学的に成立するルートを同格に扱わず、data/rankingRules.ts の重みに従って
 * 説明可能なスコアを付ける。重みはこのファイルではなくデータ側にあり、
 * ここには「どの特徴を見るか」だけを書く。
 */
import { findDart, formatRoute, isFinishingDart, type Dart } from '../../domain/dart';
import { isBogey, isCheckoutable } from '../../domain/checkoutRules';
import type { CheckoutReasonCode, ReasonPolarity } from '../../domain/reasonCodes';
import {
  CHECKOUT_REASON_WEIGHTS,
  DART_COUNT_PENALTY,
  DOUBLE_QUALITY,
  GOOD_DOUBLE_TIERS,
  GRADE_THRESHOLDS,
  TRIPLE_COUNT_PENALTY,
  USER_DOUBLE_PREFERENCE_BONUS,
  WEAK_DOUBLE_TIERS,
  type RouteGrade,
} from '../../data/rankingRules';
import { renderCheckoutReason, type ReasonContext } from '../../data/explanations';
import { missVariantsOf } from '../../data/boardAdjacency';
import { getStandardRoute } from '../../data/standardCheckoutRoutes';
import { enumerateCheckoutRoutes, sampleCheckoutRoute, type CheckoutRoute } from '../checkout/enumerate';

export interface RouteReason {
  readonly code: CheckoutReasonCode;
  readonly weight: number;
  readonly polarity: ReasonPolarity;
  readonly label: string;
  readonly summary: string;
  readonly detail: string | null;
}

export interface RankedCheckoutRoute {
  readonly darts: readonly Dart[];
  readonly key: string;
  readonly routeText: string;
  /** 並び順に使う総合スコア（基準ルート加点を含む）。 */
  readonly score: number;
  /**
   * 基準ルート加点を除いた戦術スコア。
   * 「基準ルートだから良い」ではなく「戦術的にどうか」で採点するために使う。
   */
  readonly tacticalScore: number;
  readonly reasons: readonly RouteReason[];
  readonly isStandard: boolean;
  readonly grade: RouteGrade;
}

export interface CheckoutRankingOptions {
  /** MY ROUTE の得意ダブル（順位順）。例: ['D16', 'D20', 'D8']。 */
  readonly preferredDoubles?: readonly string[];
  /** 基準ルートへの加点を行うか。MY ROUTE では false にして好みを優先する。 */
  readonly applyStandardBonus?: boolean;
}

/** 狙う的の識別子。BULL とアウターブルは同じ的として扱う。 */
function targetKeyOf(dart: Dart): string {
  return dart.baseNumber === null ? 'BULL_AREA' : String(dart.baseNumber);
}

interface RouteFeatures {
  readonly route: CheckoutRoute;
  readonly codes: CheckoutReasonCode[];
  /** コードごとの重み倍率（EXTRA_TARGET_SWITCH のように複数回加算するもの用）。 */
  readonly multipliers: Map<CheckoutReasonCode, number>;
  readonly extraScore: number;
  readonly context: ReasonContext;
  readonly containsTriple: boolean;
  readonly containsBull: boolean;
  readonly singleMissSafe: boolean | null;
}

function analyze(
  route: CheckoutRoute,
  remaining: number,
  dartsAvailable: number,
  options: CheckoutRankingOptions,
  standardKey: string | null,
): RouteFeatures {
  const codes: CheckoutReasonCode[] = [];
  const multipliers = new Map<CheckoutReasonCode, number>();
  let extraScore = 0;

  const darts = route.darts;
  const first = darts[0];
  const finish = darts[darts.length - 1];
  const isStandard = standardKey !== null && route.key === standardKey;

  if (isStandard && options.applyStandardBonus !== false) codes.push('STANDARD_ROUTE');
  if (darts.length === 1) codes.push('FINISH_IN_ONE');
  if (darts.length < dartsAvailable) codes.push('FEWER_DARTS');

  // --- 縦ズレ（トリプル/ダブル → シングル）の安全性 ------------------------
  let missDartId: string | null = null;
  let missLeave: number | null = null;
  let missRecoveryText: string | null = null;
  let singleMissSafe: boolean | null = null;
  const dartsAfterMiss = dartsAvailable - 1;

  /** 着弾 dart で残りがいくつになり、そこから上がりが残るか。 */
  const leaveIsSafe = (landed: Dart): { leave: number; safe: boolean } => {
    const leave = remaining - landed.score;
    return { leave, safe: leave >= 2 && isCheckoutable(leave, dartsAfterMiss) };
  };

  const verticalNotes: string[] = [];

  if (dartsAfterMiss >= 1 && (first.kind === 'triple' || first.kind === 'double')) {
    const missDart = findDart(`S${first.baseNumber}`);
    if (missDart) {
      missDartId = missDart.id;
      const { leave, safe } = leaveIsSafe(missDart);
      missLeave = leave;
      singleMissSafe = safe;
      if (safe) {
        const sample = sampleCheckoutRoute(leave, dartsAfterMiss);
        missRecoveryText = sample ? formatRoute(sample.darts) : null;
        codes.push('SINGLE_MISS_SAFE');
      } else {
        codes.push('SINGLE_MISS_LOSES_CHECKOUT');
        if (isBogey(leave)) codes.push('SINGLE_MISS_LEAVES_BOGEY');
      }
    }
  }

  // シングル狙いには「トリプルから落ちる」リスクがない代わりに、
  // 上下のリング（トリプル / ダブル）へ抜ける可能性がある。
  // それでも上がりが残るなら、太い的を狙える利点として加点する。
  if (dartsAfterMiss >= 1 && first.kind === 'single' && first.baseNumber !== null) {
    const overshoots = [findDart(`T${first.baseNumber}`), findDart(`D${first.baseNumber}`)].filter(
      (dart): dart is Dart => dart !== undefined,
    );
    let allSafe = overshoots.length > 0;
    for (const dart of overshoots) {
      const { leave, safe } = leaveIsSafe(dart);
      if (!safe) allSafe = false;
      verticalNotes.push(
        safe
          ? `${dart.id} でも ${leave} 残りで上がりが残ります`
          : `${dart.id} だと ${Math.max(leave, 0)} 残りで上がれません`,
      );
    }
    if (allSafe) codes.push('SAFE_SINGLE_START');
  }

  // --- 横ズレ（隣ナンバー）の安全性 ---------------------------------------
  const neighborNotes: string[] = [];
  if (dartsAfterMiss >= 1) {
    const horizontal = missVariantsOf(first).filter((v) => v.direction === 'horizontal');
    let safeCount = 0;
    for (const variant of horizontal) {
      const leave = remaining - variant.dart.score;
      const safe = leave >= 2 && isCheckoutable(leave, dartsAfterMiss);
      if (safe) {
        safeCount += 1;
        const sample = sampleCheckoutRoute(leave, dartsAfterMiss);
        neighborNotes.push(
          `${variant.dart.id} なら ${leave} 残りで ${sample ? formatRoute(sample.darts) : '上がりが残ります'}`,
        );
      } else {
        neighborNotes.push(`${variant.dart.id} だと ${Math.max(leave, 0)} 残りで上がれません`);
      }
    }
    if (horizontal.length > 0) {
      if (safeCount === horizontal.length) codes.push('NEIGHBOR_SAFE');
      else if (safeCount === 0) codes.push('NEIGHBOR_RISK');
    }
  }

  // --- 上がりダブルの質 ----------------------------------------------------
  const quality = DOUBLE_QUALITY[finish.id];
  if (quality) {
    if (GOOD_DOUBLE_TIERS.includes(quality.tier)) codes.push('GOOD_DOUBLE');
    else if (WEAK_DOUBLE_TIERS.includes(quality.tier)) codes.push('WEAK_DOUBLE');
  }

  // --- MY ROUTE の得意ダブル ----------------------------------------------
  let userPreferenceRank: number | null = null;
  const preferred = options.preferredDoubles ?? [];
  const preferenceIndex = preferred.indexOf(finish.id);
  if (preferenceIndex >= 0) {
    userPreferenceRank = preferenceIndex + 1;
    const bonus =
      USER_DOUBLE_PREFERENCE_BONUS[
        Math.min(preferenceIndex, USER_DOUBLE_PREFERENCE_BONUS.length - 1)
      ];
    extraScore += bonus;
    codes.push('USER_DOUBLE_PREFERENCE');
  }

  // --- BULL 依存 -----------------------------------------------------------
  const containsBull = darts.some((dart) => dart.baseNumber === null);
  if (containsBull) codes.push('BULL_REQUIRED');

  // --- 的の継続 / 切り替え -------------------------------------------------
  let switchCount = 0;
  let continuityTargetId: string | null = null;
  for (let i = 1; i < darts.length; i += 1) {
    if (targetKeyOf(darts[i]) === targetKeyOf(darts[i - 1])) {
      if (continuityTargetId === null) continuityTargetId = darts[i].id;
    } else {
      switchCount += 1;
    }
  }
  if (continuityTargetId !== null) codes.push('TARGET_CONTINUITY');
  if (switchCount >= 2) {
    codes.push('EXTRA_TARGET_SWITCH');
    multipliers.set('EXTRA_TARGET_SWITCH', switchCount - 1);
  }

  // 最終ダート以外のダブル（繋ぎでダブルリングを狙っている本数）。
  const nonFinalDoubles = darts.slice(0, -1).filter((dart) => dart.kind === 'double').length;
  if (nonFinalDoubles > 0) {
    codes.push('NON_FINAL_DOUBLE');
    multipliers.set('NON_FINAL_DOUBLE', nonFinalDoubles);
  }

  const containsTriple = darts.some((dart) => dart.kind === 'triple');

  const context: ReasonContext = {
    remaining,
    dartsAvailable,
    routeText: formatRoute(darts),
    firstDartId: first.id,
    finishDartId: finish.id,
    missDartId,
    missLeave,
    dartsAfterMiss,
    missRecoveryText,
    neighborNotes,
    verticalNotes,
    doubleReason: quality?.reasonJa ?? null,
    userPreferenceRank,
    switchCount,
    continuityTargetId,
  };

  return {
    route,
    codes,
    multipliers,
    extraScore,
    context,
    containsTriple,
    containsBull,
    singleMissSafe,
  };
}

function buildReasons(
  codes: readonly CheckoutReasonCode[],
  multipliers: Map<CheckoutReasonCode, number>,
  context: ReasonContext,
): RouteReason[] {
  return codes.map((code) => {
    const rendered = renderCheckoutReason(code, context);
    const weight = CHECKOUT_REASON_WEIGHTS[code] * (multipliers.get(code) ?? 1);
    return {
      code,
      weight,
      polarity: rendered.polarity,
      label: rendered.label,
      summary: rendered.summary,
      detail: rendered.detail,
    };
  });
}

function gradeOf(score: number, bestScore: number): RouteGrade {
  const gap = bestScore - score;
  if (gap <= GRADE_THRESHOLDS.S) return 'S';
  if (gap <= GRADE_THRESHOLDS.A) return 'A';
  if (gap <= GRADE_THRESHOLDS.B) return 'B';
  return 'C';
}

/**
 * 残り点・残り本数に対する全ルートを評価し、推奨度順に並べて返す。
 * 同点のときはキー順で決定論的に並ぶ。
 */
export function rankCheckoutRoutes(
  remaining: number,
  dartsAvailable: number,
  options: CheckoutRankingOptions = {},
): readonly RankedCheckoutRoute[] {
  const routes = enumerateCheckoutRoutes(remaining, dartsAvailable);
  if (routes.length === 0) return [];

  const standard = getStandardRoute(remaining);
  const standardKey = standard ? standard.darts.map((d) => d.id).join('-') : null;

  const analyzed = routes.map((route) =>
    analyze(route, remaining, dartsAvailable, options, standardKey),
  );

  // --- 比較によって決まる理由コード（第2パス） ----------------------------
  const minTripleFreeLength = analyzed.reduce((min, item) => {
    if (item.containsTriple || item.containsBull) return min;
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
    const reasons = buildReasons(item.codes, item.multipliers, item.context);
    const reasonScore = reasons.reduce((sum, reason) => sum + reason.weight, 0);
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
      routeText: item.context.routeText,
      score,
      tacticalScore: score - standardBonus,
      reasons,
      isStandard: standardKey !== null && item.route.key === standardKey,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const bestTactical = scored.reduce((max, item) => Math.max(max, item.tacticalScore), -Infinity);

  return scored.map((item) => ({
    // 基準ルートは定義上つねに S。それ以外は戦術スコアの差で決める。
    ...item,
    grade: item.isStandard ? ('S' as const) : gradeOf(item.tacticalScore, bestTactical),
  }));
}

/** 指定ルートの評価だけを取り出す（TRAINING の採点で使う）。 */
export function evaluateCheckoutRoute(
  remaining: number,
  dartsAvailable: number,
  darts: readonly Dart[],
  options: CheckoutRankingOptions = {},
): RankedCheckoutRoute | null {
  const key = darts.map((d) => d.id).join('-');
  const ranked = rankCheckoutRoutes(remaining, dartsAvailable, options);
  return ranked.find((route) => route.key === key) ?? null;
}

/** ルートが合法な Double Out かどうか（採点で「成立はしている」を判定する）。 */
export function isFinishingRoute(darts: readonly Dart[]): boolean {
  return darts.length > 0 && isFinishingDart(darts[darts.length - 1]);
}
