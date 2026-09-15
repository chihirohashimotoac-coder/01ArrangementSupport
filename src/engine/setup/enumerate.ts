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
import { findDart, formatRoute, routeKey, type Dart } from '../../domain/dart';
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
import {
  difficultyOf,
  scoringTripleFirstSequenceTables,
  sequenceTable,
  targetKeyOf,
  type SequenceTable,
} from './sequences';
import { isSingleMissTenpaiSafe, singleMissDartOf } from './tenpai';

export { canReachTenpai, isSingleMissTenpaiSafe, singleMissDartOf } from './tenpai';

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
  /**
   * 第一ターゲットのシングル落ち耐性によるふるいを外す。
   *
   * 通常の推奨（Practice / NEXT VISIT / TRAINING の採点）では使わない。
   * TRAINING の「1 投目をどこへ狙うか」を教材にするときだけ、
   * **危険な開始ターゲットも含めた候補**が要るので、この入口から取る。
   */
  readonly includeSingleMissUnsafe?: boolean;
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
  /** 第一ターゲットが同ナンバーのシングルへ落ちたときの状況（表示用）。 */
  readonly singleMiss: { dartId: string; leave: number; dartsAfter: number } | null;
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
  if (continuityTargetId !== null) codes.push('SETUP_TARGET_CONTINUITY');

  const last = darts[darts.length - 1];
  const headIsMainTarget =
    darts.length >= 2 && darts.slice(0, -1).every((dart) => dart.id === mainTarget);
  if ((last.kind === 'single' || last.id === 'SB') && headIsMainTarget) {
    codes.push('SETUP_THIRD_DART_ADJUST');
  }

  if (darts.some((dart) => dart.id === 'SB')) codes.push('SETUP_USES_SBULL');

  const thinTargets = darts.filter((dart) => dart.kind === 'double').length;
  if (thinTargets > 0) codes.push('SETUP_THIN_TARGET');

  /*
   * 第一ターゲットのシングル落ち耐性。
   * まだ投げ直せる本数がある場面でだけ意味を持つ観点なので、残り 1 本では付けない。
   * 重みは 0（docs/APPROVALS.md A-9）。順位は rankSetupRoutes 側の明示的な
   * ふるいで決まり、ここでは「なぜそうなのか」を表示するためのコードだけを持つ。
   */
  const missDart = dartsAvailable >= 2 ? singleMissDartOf(darts[0]) : null;
  const singleMiss =
    missDart === null
      ? null
      : {
          dartId: missDart.id,
          leave: remaining - missDart.score,
          dartsAfter: dartsAvailable - 1,
        };
  if (singleMiss !== null) {
    codes.push(
      isSingleMissTenpaiSafe(remaining, darts[0], dartsAvailable)
        ? 'SETUP_SINGLE_MISS_TENPAI_SAFE'
        : 'SETUP_SINGLE_MISS_DEAD_END',
    );
  }

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

  return { codes, score, scored, leave, continuityTargetId, thinTargets, singleMiss };
}

function buildReasons(evaluated: ScoredSetup, darts: readonly Dart[]): SetupReason[] {
  const leaveEval = evaluateLeave(evaluated.leave);
  const context: ReasonContext = {
    remaining: evaluated.leave,
    dartsAvailable: DARTS_PER_VISIT,
    routeText: formatRoute(darts),
    firstDartId: darts[0].id,
    finishDartId: darts[darts.length - 1].id,
    missDartId: evaluated.singleMiss?.dartId ?? null,
    missLeave: evaluated.singleMiss?.leave ?? null,
    dartsAfterMiss: evaluated.singleMiss?.dartsAfter ?? 0,
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
  const allowUnsafe = options.includeSingleMissUnsafe === true;
  const cacheKey = `${remaining}/${darts}/${mainTarget}/${allowUnsafe ? 'any' : 'safe'}`;
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

  const collect = (
    tables: readonly SequenceTable[],
    tenpaiOnly: boolean,
    singleMissSafeOnly: boolean,
  ): Slot[] => {
    const found: Slot[] = [];
    for (const source of tables) {
      for (let total = 0; total < source.length; total += 1) {
        const bucket = source[total];
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
          if (
            singleMissSafeOnly &&
            !isSingleMissTenpaiSafe(remaining, entry.darts[0], darts)
          ) {
            continue;
          }
          found.push({
            darts: entry.darts,
            total,
            leave,
            score: base + entry.intrinsic,
            key: routeKey(entry.darts),
          });
        }
      }
    }
    return found;
  };

  /**
   * 得点用トリプル（T1〜T20）から始まり、そのトリプルが同ナンバーのシングルへ
   * 落ちてもテンパイを作れるルートだけを集める。
   *
   * シングル落ち耐性は「得点のためにトリプルを狙い、同じナンバーのシングルへ
   * 落ちた」場合の評価なので、第一ターゲットの選択でもその意味論をそのまま使う。
   * 安全なトリプルが 1 つも無ければ空を返し、呼び出し側が次のふるいへ落ちる。
   *
   * 主目標（既定 T20）そのものが安全なら、第一ターゲットを振り直す理由がない。
   * そのときは安全な得点用トリプル全体を候補にし、どれを狙うかは従来どおり
   * ビジット全体の評価（残りの質 → 取得点 → 難易度）に任せる。
   *
   * 主目標が安全でないとき **だけ**、狙う的を 1 つに絞る。振り直しを迫られた
   * 場面で選ぶのは「シングルへ落ちても立て直せるトリプルのうち、いちばん点が
   * 高いもの」。T20 を捨てるなら捨てる点は最小限にする、という戦術で、
   * TRAINING の SETUP / FIRST DART が教える推奨（安全な的のうち取得点順）と
   * 同じ考え方にあたる。残り点ごとの例外表は持たない。
   */
  const collectSafeScoringTripleFirst = (): Slot[] => {
    const safeFirst: { readonly dart: Dart; readonly source: SequenceTable }[] = [];
    for (const [dartId, source] of scoringTripleFirstSequenceTables(darts, mainTarget)) {
      const first = findDart(dartId);
      if (first === undefined) continue;
      if (!isSingleMissTenpaiSafe(remaining, first, darts)) continue;
      safeFirst.push({ dart: first, source });
    }
    if (safeFirst.length === 0) return [];

    const mainDart = findDart(mainTarget);
    const mainTargetNeedsChange =
      mainDart !== undefined &&
      mainDart.kind === 'triple' &&
      !safeFirst.some((item) => item.dart.id === mainDart.id);

    const pool = mainTargetNeedsChange
      ? [safeFirst.reduce((best, item) => (item.dart.score > best.dart.score ? item : best))]
      : safeFirst;

    return collect(
      pool.map((item) => item.source),
      true,
      false,
    );
  };

  /*
   * ふるいは 4 段。重みをいじって順位を作るのではなく、
   * 「戦術上その条件を満たすものだけを見る」という明示的な比較にしてある。
   *
   *   1. テンパイを残せて、かつ **得点用トリプルから始まり**、
   *      そのトリプルがシングルへ落ちても立て直せる
   *   2. テンパイを残せて、第一ターゲットがシングルへ落ちても立て直せる
   *      （安全な得点用トリプルが 1 つも無い場合）
   *   3. テンパイを残せる
   *   4. 条件なし（テンパイを作れない残り点）
   *
   * 1 を最上段に置くのが v1.3.7 の意味論修正。シングル落ち耐性は
   * 「得点用トリプルを狙って同ナンバーのシングルへ落ちた」場合の評価なので、
   * S19 のようにシングルそのものを狙うルートは、外しても着弾が変わらないという
   * 理由だけで「耐性がある」と扱われてしまう。それを第一ターゲットの選択理由に
   * しないために、安全な得点用トリプルがあるならそちらから選ぶ。
   * S19 は「T19 を狙った結果としての実着弾」であり、その後の再計算は
   * これまでどおり残り点・残り本数に対する通常の評価で行う。
   *
   * 残り 1 本の場面では、外した時点でビジットが終わるため 1 と 2 は必ず空になり、
   * これまでどおり 3 が使われる。302〜309 のラスト 1 投調整は変わらない。
   */
  let slots = allowUnsafe ? [] : collectSafeScoringTripleFirst();
  if (slots.length === 0 && !allowUnsafe) slots = collect([table], true, true);
  if (slots.length === 0) slots = collect([table], true, false);
  if (slots.length === 0) slots = collect([table], false, false);
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
