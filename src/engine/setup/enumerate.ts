/**
 * SETUP（171〜350）のルート探索と評価。
 *
 * 目的は最大得点ではなく「次ラウンドに良い 3 本チェックアウトを残すこと」。
 * したがって取得点は評価軸のひとつでしかなく、残り点の質の方を強く重み付けする。
 *
 * 探索は 2 段構えにしている。
 *   Phase A: 全組み合わせを数値だけで評価する（文字列を作らない）
 *   Phase B: 上位だけ日本語の理由文を生成する
 * これにより 62^3 の総当たりでも体感遅延が出ない。
 */
import { formatRoute, routeKey, type Dart } from '../../domain/dart';
import {
  DARTS_PER_VISIT,
  MAX_SETUP_REMAINING,
  MIN_CHECKOUT,
} from '../../domain/checkoutRules';
import type { ReasonPolarity, SetupReasonCode } from '../../domain/reasonCodes';
import {
  DEFAULT_SETUP_MAIN_TARGET,
  GRADE_THRESHOLDS,
  SETUP_DIFFICULTY_WEIGHT,
  SETUP_LOW_SCORE_THRESHOLD,
  SETUP_POINTS_WEIGHT,
  SETUP_REASON_WEIGHTS,
  type RouteGrade,
} from '../../data/rankingRules';
import { renderSetupReason, type ReasonContext } from '../../data/explanations';
import { evaluateLeave, isTonTrap, leaveTierOf, type LeaveTier } from './leaveQuality';
import { difficultyOf, sequenceTable, targetKeyOf } from './sequences';

export interface SetupReason {
  readonly code: SetupReasonCode;
  readonly weight: number;
  readonly polarity: ReasonPolarity;
  readonly label: string;
  readonly summary: string;
  readonly detail: string | null;
}

export interface RankedSetupRoute {
  readonly darts: readonly Dart[];
  readonly key: string;
  readonly routeText: string;
  /** このビジットで取る点数。 */
  readonly scored: number;
  /** 次ラウンドへ残る点数。 */
  readonly leave: number;
  readonly leaveTier: LeaveTier;
  readonly score: number;
  readonly reasons: readonly SetupReason[];
  readonly grade: RouteGrade;
}

export interface SetupOptions {
  /** 続けて狙う主目標（既定は T20）。 */
  readonly mainTarget?: string;
  /** 返す候補の最大数。 */
  readonly maxRoutes?: number;
}

const DEFAULT_MAX_ROUTES = 40;
/** Phase B（理由文の生成）へ渡す上限。 */
const DETAILED_LIMIT = 60;

interface ScoredSetup {
  readonly codes: readonly SetupReasonCode[];
  readonly score: number;
  readonly scored: number;
  readonly leave: number;
  readonly continuityTargetId: string | null;
  readonly thinTargets: number;
}

/**
 * 1 ルートの SETUP スコアを計算する（文字列を作らない軽量版）。
 * ランキングでも単体評価でも同じこの関数を通し、採点のぶれをなくす。
 */
export function scoreSetupRoute(
  remaining: number,
  darts: readonly Dart[],
  dartsAvailable: number,
  mainTarget: string,
): ScoredSetup {
  const scored = darts.reduce((sum, dart) => sum + dart.score, 0);
  const leave = remaining - scored;
  const leaveEval = evaluateLeave(leave);
  const codes: SetupReasonCode[] = [...leaveEval.codes];

  let continuityTargetId: string | null = null;
  for (let i = 1; i < darts.length; i += 1) {
    if (targetKeyOf(darts[i]) === targetKeyOf(darts[i - 1])) {
      continuityTargetId = darts[i].id;
      break;
    }
  }
  if (continuityTargetId !== null) codes.push('SETUP_MAIN_TARGET_CONTINUITY');

  const last = darts[darts.length - 1];
  const headIsMainTarget =
    darts.length >= 2 && darts.slice(0, -1).every((dart) => dart.id === mainTarget);
  if ((last.kind === 'single' || last.id === 'SB') && headIsMainTarget) {
    codes.push('SETUP_THIRD_DART_ADJUST');
  }

  if (darts.some((dart) => dart.id === 'SB')) codes.push('SETUP_USES_SBULL');

  const thinTargets = darts.filter((dart) => dart.kind === 'double').length;
  if (thinTargets > 0) codes.push('SETUP_THIN_TARGET');

  // 「ビジットを丸ごと無駄にした」指標なので、3 本投げ切る場面でだけ評価する。
  if (
    dartsAvailable === DARTS_PER_VISIT &&
    darts.length === DARTS_PER_VISIT &&
    scored < SETUP_LOW_SCORE_THRESHOLD * DARTS_PER_VISIT
  ) {
    codes.push('SETUP_LOW_SCORE');
  }


  const reasonScore = codes.reduce(
    (sum, code) => sum + SETUP_REASON_WEIGHTS[code] * (code === 'SETUP_THIN_TARGET' ? thinTargets : 1),
    0,
  );
  const difficulty = darts.reduce((sum, dart) => sum + difficultyOf(dart), 0);
  const score =
    reasonScore + scored * SETUP_POINTS_WEIGHT - difficulty * SETUP_DIFFICULTY_WEIGHT;

  return { codes, score, scored, leave, continuityTargetId, thinTargets };
}

function buildReasons(evaluated: ScoredSetup, darts: readonly Dart[]): SetupReason[] {
  const leaveEval = evaluateLeave(evaluated.leave);
  const context: ReasonContext = {
    remaining: evaluated.leave,
    dartsAvailable: DARTS_PER_VISIT,
    routeText: formatRoute(darts),
    firstDartId: darts[0].id,
    finishDartId: darts[darts.length - 1].id,
    missDartId: null,
    missLeave: null,
    dartsAfterMiss: 0,
    missRecoveryText: leaveEval.standardRouteText,
    neighborNotes: [],
    verticalNotes: [],
    doubleReason: null,
    userPreferenceRank: null,
    switchCount: 0,
    continuityTargetId: evaluated.continuityTargetId,
  };

  return evaluated.codes.map((code) => {
    const rendered = renderSetupReason(code, context);
    const multiplier = code === 'SETUP_THIN_TARGET' ? evaluated.thinTargets : 1;
    return {
      code,
      weight: SETUP_REASON_WEIGHTS[code] * multiplier,
      polarity: rendered.polarity,
      label: rendered.label,
      summary: rendered.summary,
      detail: rendered.detail,
    };
  });
}

function gradeOf(score: number, best: number): RouteGrade {
  const gap = best - score;
  if (gap <= GRADE_THRESHOLDS.S) return 'S';
  if (gap <= GRADE_THRESHOLDS.A) return 'A';
  if (gap <= GRADE_THRESHOLDS.B) return 'B';
  return 'C';
}

const rankingCache = new Map<string, readonly RankedSetupRoute[]>();

/** ビジットを丸ごと無駄にしたか（3 本すべてを投げる場面でだけ評価する）。 */
function lowScorePenaltyOf(total: number, dartsAvailable: number, dartCount: number): number {
  if (dartsAvailable !== DARTS_PER_VISIT || dartCount !== DARTS_PER_VISIT) return 0;
  if (total >= SETUP_LOW_SCORE_THRESHOLD * DARTS_PER_VISIT) return 0;
  return SETUP_REASON_WEIGHTS.SETUP_LOW_SCORE;
}

/**
 * この残り・この本数で、次ラウンドのテンパイを作れるか。
 *
 * 作れない残り点が実在する（例: 339 は 3 本で何を取っても Bogey にしかならない）ため、
 * UI ではこの事実を伝える必要がある。
 */
export function canReachTenpai(remaining: number, dartsAvailable: number): boolean {
  const darts = Math.min(Math.max(dartsAvailable, 0), DARTS_PER_VISIT);
  if (darts <= 0) return false;
  const table = sequenceTable(darts, DEFAULT_SETUP_MAIN_TARGET);
  for (let total = 0; total < table.length; total += 1) {
    if (table[total].length === 0) continue;
    const leave = remaining - total;
    if (leave < MIN_CHECKOUT) continue;
    if (evaluateLeave(leave).checkoutable) return true;
  }
  return false;
}

/**
 * SETUP の候補を評価し、推奨度順に返す。
 *
 * スコアは「残りの質 + 取得点 × 係数 + シーケンス固有の評価」に分解できるので、
 * 取得点 0〜180 を走査し、取得点ごとの代表シーケンス（sequences.ts）を組み合わせる。
 * テンパイを作れる残りを優先し、1 つも作れない場合だけ条件を外して探索し直す。
 */
export function rankSetupRoutes(
  remaining: number,
  dartsAvailable: number,
  options: SetupOptions = {},
): readonly RankedSetupRoute[] {
  if (!Number.isInteger(remaining) || remaining < MIN_CHECKOUT || remaining > MAX_SETUP_REMAINING) {
    return [];
  }
  const darts = Math.min(Math.max(dartsAvailable, 0), DARTS_PER_VISIT);
  if (darts <= 0) return [];

  const mainTarget = options.mainTarget ?? DEFAULT_SETUP_MAIN_TARGET;
  const limit = options.maxRoutes ?? DEFAULT_MAX_ROUTES;
  const cacheKey = `${remaining}/${darts}/${mainTarget}`;
  const cached = rankingCache.get(cacheKey);
  if (cached) return cached.slice(0, limit);

  const table = sequenceTable(darts, mainTarget);

  interface Slot {
    readonly darts: readonly Dart[];
    readonly total: number;
    readonly leave: number;
    readonly score: number;
    readonly key: string;
  }

  const collect = (tenpaiOnly: boolean): Slot[] => {
    const found: Slot[] = [];
    for (let total = 0; total < table.length; total += 1) {
      const bucket = table[total];
      if (bucket.length === 0) continue;
      // 取得点は単調増加なので、最後の残りが 2 以上なら途中も 2 以上（Bust しない）。
      const leave = remaining - total;
      if (leave < MIN_CHECKOUT) continue;
      const leaveEval = evaluateLeave(leave);
      if (tenpaiOnly && !leaveEval.checkoutable) continue;

      const base =
        leaveEval.score +
        total * SETUP_POINTS_WEIGHT +
        lowScorePenaltyOf(total, dartsAvailable, darts);

      for (const entry of bucket) {
        found.push({
          darts: entry.darts,
          total,
          leave,
          score: base + entry.intrinsic,
          key: routeKey(entry.darts),
        });
      }
    }
    return found;
  };

  let slots = collect(true);
  if (slots.length === 0) slots = collect(false);
  if (slots.length === 0) return [];

  slots.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  const best = slots[0].score;
  const detailed: RankedSetupRoute[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    if (seen.has(slot.key)) continue;
    seen.add(slot.key);
    const evaluated = scoreSetupRoute(remaining, slot.darts, dartsAvailable, mainTarget);
    detailed.push({
      darts: slot.darts,
      key: slot.key,
      routeText: formatRoute(slot.darts),
      scored: slot.total,
      leave: slot.leave,
      leaveTier: leaveTierOf(slot.leave),
      score: slot.score,
      reasons: buildReasons(evaluated, slot.darts),
      grade: gradeOf(slot.score, best),
    });
    if (detailed.length >= DETAILED_LIMIT) break;
  }

  rankingCache.set(cacheKey, detailed);
  return detailed.slice(0, limit);
}

/**
 * 指定ルートの SETUP 評価（TRAINING の採点で使う）。
 * ランキング上位に入らないルートでも必ず評価できるよう、列挙を介さず直接計算する。
 */
export function evaluateSetupRoute(
  remaining: number,
  dartsAvailable: number,
  darts: readonly Dart[],
  options: SetupOptions = {},
): RankedSetupRoute | null {
  if (darts.length === 0) return null;
  const mainTarget = options.mainTarget ?? DEFAULT_SETUP_MAIN_TARGET;
  const available = Math.min(Math.max(dartsAvailable, 0), DARTS_PER_VISIT);
  if (darts.length > available) return null;

  // Bust するルートは評価対象にしない。
  let left = remaining;
  for (const dart of darts) {
    left -= dart.score;
    if (left < MIN_CHECKOUT) return null;
  }

  const evaluated = scoreSetupRoute(remaining, darts, available, mainTarget);
  const ranked = rankSetupRoutes(remaining, available, { ...options, maxRoutes: 1 });
  const best = ranked.length > 0 ? ranked[0].score : evaluated.score;

  return {
    darts,
    key: routeKey(darts),
    routeText: formatRoute(darts),
    scored: evaluated.scored,
    leave: evaluated.leave,
    leaveTier: leaveTierOf(evaluated.leave),
    score: evaluated.score,
    reasons: buildReasons(evaluated, darts),
    grade: gradeOf(evaluated.score, best),
  };
}

/**
 * 「とりあえず TON」の警告。
 * ちょうど 100 点を取ると Bogey になる残り点かどうかと、その場合の残りを返す。
 */
export function tonTrapWarning(remaining: number): { leaveAfterTon: number } | null {
  if (!isTonTrap(remaining)) return null;
  return { leaveAfterTon: remaining - 100 };
}

/** テスト用にキャッシュを空にする。 */
export function clearSetupRankingCache(): void {
  rankingCache.clear();
}
