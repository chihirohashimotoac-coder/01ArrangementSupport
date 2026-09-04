/**
 * CHECKOUT 不能時の「次ラウンドへの残し」を 1 件だけ選ぶ専用セレクタ。
 *
 * 通常の SETUP（171〜350）は「まだ上がりが遠い位置から、次ラウンドの 3 投
 * チェックアウトを作る」ための評価であり、取得点の重みが効く。
 * ところが CHECKOUT 中に上がれなくなった場面では、残りが既に十分小さく、
 * 「次ラウンドを何本で上がれるか」が結果を直接左右する。
 *
 * 例: 119 / 2 本
 *   T20 → S20 は 80 点取って 39 残し（次ラウンド最低 2 投）
 *   T20 → S19 は 79 点取って 40 残し（次ラウンド 1 投・D20）
 *   投げる難易度は実質同等なので、後者を選びたい。
 *
 * そのためここでは通常 SETUP の順位（rankSetupRoutes）をそのまま使わず、
 * 「残しが次ラウンド何本で上がれるか」を第一のふるいにする。
 * ただし新しいアレンジ表・確率モデル・重みは作らない。候補の生成は
 * 既存の sequenceTable()、難易度は既存の difficultyOf() / SEGMENT_DIFFICULTY、
 * 残しの質は既存の evaluateLeave() をそのまま使う。
 *
 * このモジュールは CHECKOUT ランキング・通常 SETUP ランキングのどちらにも
 * 手を入れない。得意ダブルも専用オプション（fallbackPreferredDoubles）で
 * 受け取り、既存の rankCheckoutRoutes() へは渡さない。
 */
import { routeKey, type Dart } from '../../domain/dart';
import {
  DARTS_PER_VISIT,
  MIN_CHECKOUT,
  minDartsToCheckout,
} from '../../domain/checkoutRules';
import { INNER_BULL_SCORE } from '../../domain/scoring';
import { DEFAULT_SETUP_MAIN_TARGET } from '../../data/rankingRules';
import { evaluateLeave } from '../setup/leaveQuality';
import { difficultyOf, sequenceTable, targetKeyOf } from '../setup/sequences';
import {
  evaluateSetupRoute,
  rankSetupRoutes,
  type RankedSetupRoute,
} from '../setup/enumerate';

/**
 * 次ラウンド 1 投で上がれる残りのうち、特に優先する「素直なダブル残し」。
 * すべて偶数で、外して半分になってもまたダブルが残る帯。
 */
export const NEXT_VISIT_PRIORITY_LEAVES: readonly number[] = [8, 12, 16, 20, 24, 28, 32, 36, 40];

/**
 * 残しの優先度クラス。
 *   A: 上の優先ダブル残し（次ラウンド 1 投）
 *   B: A 以外の 1 ダート上がり（BULL を除く）
 *   C: 次ラウンド 2 投以内で上がれる偶数残し（BULL 上がりの 50 もここ）
 *   D: 次ラウンド 3 投で上がれる偶数残し
 *   E: 上記を作れない場合の安全弁（上がれる奇数残し）
 */
export type NextVisitTier = 'A' | 'B' | 'C' | 'D' | 'E';

const TIER_ORDER: readonly NextVisitTier[] = ['A', 'B', 'C', 'D', 'E'];

/**
 * 残り点の優先度クラスを返す。3 本でも上がれない残り（ノーテン）は null。
 *
 * BULL（50）は 1 投で上がれるが的が最も小さいため A / B には入れず、
 * 既存の BULL 評価どおり 2 投以内の残しと同じ扱い（C）にする。
 */
export function nextVisitTierOf(leave: number): NextVisitTier | null {
  if (!Number.isInteger(leave) || leave < MIN_CHECKOUT) return null;
  const minDarts = minDartsToCheckout(leave);
  if (minDarts === null) return null;

  if (NEXT_VISIT_PRIORITY_LEAVES.includes(leave)) return 'A';
  if (minDarts === 1 && leave !== INNER_BULL_SCORE) return 'B';
  if (leave % 2 !== 0) return 'E';
  return minDarts <= 2 ? 'C' : 'D';
}

export interface NextVisitOptions {
  /** 続けて狙う主目標（既定は T20）。候補生成に使う既存の設定と同じ値。 */
  readonly mainTarget?: string;
  /**
   * NEXT VISIT だけで使う得意ダブル（順位順）。
   * 既存の CHECKOUT ランキング（preferredDoubles）とは意図的に別の名前にして、
   * STANDARD / OTHER ROUTES の順位へ影響しないことを型の上でも保証する。
   */
  readonly fallbackPreferredDoubles?: readonly string[];
}

export interface NextVisitCandidate {
  readonly darts: readonly Dart[];
  readonly key: string;
  readonly leave: number;
  readonly tier: NextVisitTier;
  /** いま投げるルートの難易度（既存 SEGMENT_DIFFICULTY の合計）。 */
  readonly difficulty: number;
  /** 狙う的を切り替える回数。 */
  readonly switchCount: number;
  /**
   * 既存 sequenceTable() が持つ、残り点に依存しない並び順の評価。
   * 難易度が同じ候補どうしでは「主目標を先に投げ、最後の 1 本で調整する」
   * といった既存の順番の good practice がここに現れる。
   */
  readonly intrinsic: number;
  /** 既存 evaluateLeave() による残しの質。 */
  readonly leaveScore: number;
  /** 得意ダブルの順位（0 = 第 1 希望）。対象外は最大値。 */
  readonly preferenceRank: number;
}

const NO_PREFERENCE = Number.MAX_SAFE_INTEGER;

/** その残りを上がるダブル（A / B の残しは必ず 1 投ダブル上がり）。 */
function finishingDoubleIdOf(leave: number): string | null {
  if (leave % 2 !== 0 || leave < 2 || leave > 40) return null;
  return `D${leave / 2}`;
}

/**
 * 候補の優先順位。数値が小さいほど上位。
 *
 * A / B（次ラウンド 1 投で上がれる残し）では
 *   1. いま投げるルートの難易度  2. 得意ダブル  3. 残しの質  4. 的の切替  5. キー
 * C / D / E では「小さい偶数を残したい」という実戦の要求を優先して
 *   1. いま投げるルートの難易度  2. 残しが小さい  3. 残しの質  4. キー
 *
 * どちらも第 1 基準は「いま投げるルートの難易度」。
 * 得意ダブルのために、いま余計なトリプルを要求してはいけない。
 */
export function compareNextVisitCandidates(a: NextVisitCandidate, b: NextVisitCandidate): number {
  const tier = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
  if (tier !== 0) return tier;

  if (a.difficulty !== b.difficulty) return a.difficulty - b.difficulty;

  if (a.tier === 'A' || a.tier === 'B') {
    if (a.preferenceRank !== b.preferenceRank) return a.preferenceRank - b.preferenceRank;
    if (a.leaveScore !== b.leaveScore) return b.leaveScore - a.leaveScore;
    if (a.switchCount !== b.switchCount) return a.switchCount - b.switchCount;
    if (a.intrinsic !== b.intrinsic) return b.intrinsic - a.intrinsic;
    return a.key.localeCompare(b.key);
  }

  if (a.leave !== b.leave) return a.leave - b.leave;
  if (a.leaveScore !== b.leaveScore) return b.leaveScore - a.leaveScore;
  if (a.intrinsic !== b.intrinsic) return b.intrinsic - a.intrinsic;
  return a.key.localeCompare(b.key);
}

/** ルートを 1 投ずつ再計算して、Bust・1 残しが起きないことを確かめる。 */
function isLegalLeaveRoute(remaining: number, darts: readonly Dart[], dartsLeft: number): boolean {
  if (darts.length === 0 || darts.length !== dartsLeft) return false;
  let left = remaining;
  for (const dart of darts) {
    if (dart.score <= 0) return false;
    left -= dart.score;
    if (left < MIN_CHECKOUT) return false;
  }
  return true;
}

function switchCountOf(darts: readonly Dart[]): number {
  let count = 0;
  for (let i = 1; i < darts.length; i += 1) {
    if (targetKeyOf(darts[i]) !== targetKeyOf(darts[i - 1])) count += 1;
  }
  return count;
}

/**
 * 候補を作る。
 *
 * 「物理的に作れる」= 残り本数ちょうどで投げ切れること。
 * 本数合わせの MISS は入れないので、候補の darts は必ず dartsLeft 本。
 */
export function buildNextVisitCandidates(
  remaining: number,
  dartsLeft: number,
  options: NextVisitOptions = {},
): readonly NextVisitCandidate[] {
  const mainTarget = options.mainTarget ?? DEFAULT_SETUP_MAIN_TARGET;
  const preferred = options.fallbackPreferredDoubles ?? [];
  const table = sequenceTable(dartsLeft, mainTarget);
  const candidates: NextVisitCandidate[] = [];

  for (let total = 0; total < table.length; total += 1) {
    const bucket = table[total];
    if (bucket.length === 0) continue;
    const leave = remaining - total;
    if (leave < MIN_CHECKOUT) continue;
    const tier = nextVisitTierOf(leave);
    if (tier === null) continue;

    const leaveScore = evaluateLeave(leave).score;
    const doubleId = finishingDoubleIdOf(leave);
    const index = doubleId === null ? -1 : preferred.indexOf(doubleId);
    const preferenceRank = index >= 0 ? index : NO_PREFERENCE;

    for (const entry of bucket) {
      if (!isLegalLeaveRoute(remaining, entry.darts, dartsLeft)) continue;
      candidates.push({
        darts: entry.darts,
        key: routeKey(entry.darts),
        leave,
        tier,
        difficulty: entry.darts.reduce((sum, dart) => sum + difficultyOf(dart), 0),
        switchCount: switchCountOf(entry.darts),
        intrinsic: entry.intrinsic,
        leaveScore,
        preferenceRank,
      });
    }
  }

  return candidates;
}

const cache = new Map<string, RankedSetupRoute | null>();

/**
 * CHECKOUT が成立しないときに、次ラウンドへ残すルートを 1 件だけ返す。
 *
 * 返す型は通常の SETUP と同じ RankedSetupRoute なので、UI・盤面ハイライトは
 * これまでの表示のまま使える（NEXT VISIT の見せ方は変えない）。
 */
export function selectNextVisitRoute(
  remaining: number,
  dartsLeft: number,
  options: NextVisitOptions = {},
): RankedSetupRoute | null {
  if (!Number.isInteger(remaining) || remaining < MIN_CHECKOUT) return null;
  const darts = Math.min(Math.max(dartsLeft, 0), DARTS_PER_VISIT);
  if (darts <= 0) return null;

  const mainTarget = options.mainTarget ?? DEFAULT_SETUP_MAIN_TARGET;
  const preferred = options.fallbackPreferredDoubles ?? [];
  const cacheKey = `${remaining}/${darts}/${mainTarget}/${preferred.join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const candidates = buildNextVisitCandidates(remaining, darts, {
    mainTarget,
    fallbackPreferredDoubles: preferred,
  });

  let best: RankedSetupRoute | null = null;
  if (candidates.length > 0) {
    const chosen = candidates.reduce((current, candidate) =>
      compareNextVisitCandidates(candidate, current) < 0 ? candidate : current,
    );
    best = evaluateSetupRoute(remaining, darts, chosen.darts, { mainTarget });
  }

  /*
   * 上がれる残しをどう投げても作れない場面（ノーテンしか残らない等）だけ、
   * これまでどおり通常 SETUP の第 1 候補へ落とす。
   * 「残しを 1 件は必ず出す」という v1.3.1 の約束を崩さないための安全弁。
   */
  if (best === null) {
    best = rankSetupRoutes(remaining, darts, { mainTarget, maxRoutes: 1 })[0] ?? null;
  }

  cache.set(cacheKey, best);
  return best;
}

/** テスト用にキャッシュを空にする。 */
export function clearNextVisitSelectionCache(): void {
  cache.clear();
}
