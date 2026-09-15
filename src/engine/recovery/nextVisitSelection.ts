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
import {
  difficultyOf,
  mainTargetFirstSequenceTable,
  sequenceTable,
  targetKeyOf,
  type SequenceEntry,
} from '../setup/sequences';
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
  /**
   * 第 1 希望の得意ダブルちょうどで上がれる残しか。
   *
   * 得意ダブルの設定は順位付きのリストだが、「残しの質より優先する」のは
   * **第 1 希望だけ**にする。第 2 希望以下まで残しの質より優先すると、
   * 既定値（D16 → D20 → D8 → D10 → D18）がそのまま戦術判断になってしまい、
   * ユーザーが何も設定していないのに 16 残しより 40 残しが選ばれる（v1.3.5）。
   */
  readonly primaryPreferredFinish: boolean;
  /**
   * 得意ダブルの順位（0 = 第 1 希望）。対象外は最大値。
   * 第 2 希望以下は、残しの質が完全に並んだときの同点処理にだけ使う。
   */
  readonly preferenceRank: number;
  /**
   * 主目標（T20 など）から投げ始めるルートか。
   *
   * 「どの順で狙うか」の話なので、投げる本数が 2 本以上のときだけ true になりうる。
   * 残り 1 本は順番の問題ではなく「どこへ振るか」の問題なので、
   * この軸では差を付けず、残しの質（halvingDepth など）で決める。
   */
  readonly mainTargetFirst: boolean;
  /** 残しを半分にし続けられる回数（32 → 16 → 8 → 4 → 2 なら 5）。 */
  readonly halvingDepth: number;
}

const NO_PREFERENCE = Number.MAX_SAFE_INTEGER;

/**
 * 残しを「半分にし続けられる」回数。
 *
 *   32 → 16 → 8 → 4 → 2 なら 5、16 → 8 → 4 → 2 なら 4、
 *   40 → 20 → 10 で止まるので 3、28 → 14 で止まるので 2。
 *
 * 深いほど、次ラウンドでダブルを 1 本外しても「また偶数のダブル」が残り、
 * 立て直しが続く。これは新しい戦術思想ではなく、
 *  - `src/data/lowStandardRoutes.ts` の R2（奇数は 32 → 16 → 8 → 4 → 2 の順に
 *    立て直しやすいダブルを作る / docs/APPROVALS.md A-4 で承認済み）
 *  - `DOUBLE_QUALITY` が D16 を excellent とする理由（「half が続き、外しても
 *    立て直しやすい」）
 * と同じ考え方を、NEXT VISIT の残し選びで使えるよう数値にしたもの。
 */
export function halvingDepthOf(leave: number): number {
  if (!Number.isInteger(leave) || leave < 2) return 0;
  let depth = 0;
  let value = leave;
  while (value >= 2 && value % 2 === 0) {
    depth += 1;
    value /= 2;
  }
  return depth;
}

/** その残りを上がるダブル（A / B の残しは必ず 1 投ダブル上がり）。 */
function finishingDoubleIdOf(leave: number): string | null {
  if (leave % 2 !== 0 || leave < 2 || leave > 40) return null;
  return `D${leave / 2}`;
}

/**
 * 候補の優先順位。数値が小さいほど上位。
 *
 * 共通の前半（tier → 難易度 → 主目標始動）が、v1.3.4 で入れた
 * **MAIN TARGET FIRST** にあたる。
 *
 *   1. NEXT VISIT Tier（残しが次ラウンド何本で上がれるか）
 *   2. いま投げるルートの難易度
 *   3. 主目標（既定 T20）から自然に始められるか
 *
 * そのうえで
 *   A / B（次ラウンド 1 投で上がれる残し）
 *     4. 第 1 希望の得意ダブル  5. 残しの質  6. 上がりダブルの扱いやすさ
 *     7. 第 2 希望以下の得意ダブル（同点処理）
 *     8. 取得点が多い（= 残しが小さい）  9. 的の切替  10. 順番の good practice  11. キー
 *   C / D / E
 *     4. 残しが小さい  5. 残しの質  6. 順番の good practice  7. キー
 *
 * 第 1 基準はどちらも Tier、次が「いま投げるルートの難易度」。
 * 得意ダブルのために、いま余計なトリプルを要求してはいけない。
 *
 * 得意ダブルが効くのは **第 1 希望だけ**（v1.3.5）。順位付きリスト全体を
 * 残しの質より上に置くと、既定値（D16 → D20 → D8 → D10 → D18）が
 * そのまま戦術判断になり、130 / 2 本で 16 残し（D8・第 3 希望）より
 * 40 残し（D20・第 2 希望）が選ばれてしまう。
 *
 * 3 番目に主目標始動を置くのは、同じ取得点・同じ残し・同じ難易度なら
 * 実戦で最初に狙うのは主目標だからで、ここを決めずに残すと最後の
 * 表記の辞書順が戦術判断を決めてしまう（T11 → T20 のような並び）。
 * 残り 1 本の場面は「順番」の問題ではないので、この軸は効かない。
 */
export function compareNextVisitCandidates(a: NextVisitCandidate, b: NextVisitCandidate): number {
  const tier = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
  if (tier !== 0) return tier;

  if (a.difficulty !== b.difficulty) return a.difficulty - b.difficulty;

  if (a.mainTargetFirst !== b.mainTargetFirst) return a.mainTargetFirst ? -1 : 1;

  if (a.tier === 'A' || a.tier === 'B') {
    if (a.primaryPreferredFinish !== b.primaryPreferredFinish) {
      return a.primaryPreferredFinish ? -1 : 1;
    }
    if (a.leaveScore !== b.leaveScore) return b.leaveScore - a.leaveScore;
    if (a.halvingDepth !== b.halvingDepth) return b.halvingDepth - a.halvingDepth;
    // 残しの質がまったく並んだときだけ、第 2 希望以下の得意ダブルを見る。
    if (a.preferenceRank !== b.preferenceRank) return a.preferenceRank - b.preferenceRank;
    // ここまで同じなら、取得点の多い方（= 残しの小さい方）を取る。
    if (a.leave !== b.leave) return a.leave - b.leave;
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
  const candidates: NextVisitCandidate[] = [];
  const seen = new Set<string>();

  const addBucket = (bucket: readonly SequenceEntry[], total: number): void => {
    if (bucket.length === 0) return;
    const leave = remaining - total;
    if (leave < MIN_CHECKOUT) return;
    const tier = nextVisitTierOf(leave);
    if (tier === null) return;

    const leaveScore = evaluateLeave(leave).score;
    const doubleId = finishingDoubleIdOf(leave);
    const index = doubleId === null ? -1 : preferred.indexOf(doubleId);
    const preferenceRank = index >= 0 ? index : NO_PREFERENCE;
    const primaryPreferredFinish = index === 0;
    const halvingDepth = halvingDepthOf(leave);

    for (const entry of bucket) {
      if (!isLegalLeaveRoute(remaining, entry.darts, dartsLeft)) continue;
      const key = routeKey(entry.darts);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        darts: entry.darts,
        key,
        leave,
        tier,
        difficulty: entry.darts.reduce((sum, dart) => sum + difficultyOf(dart), 0),
        switchCount: switchCountOf(entry.darts),
        intrinsic: entry.intrinsic,
        leaveScore,
        primaryPreferredFinish,
        preferenceRank,
        mainTargetFirst: entry.darts.length >= 2 && entry.darts[0].id === mainTarget,
        halvingDepth,
      });
    }
  };

  /*
   * 候補は 2 つの表から作る。
   *
   *  - sequenceTable(): 取得点ごとの代表シーケンス（既存）
   *  - mainTargetFirstSequenceTable(): 主目標始動のシーケンス（枝刈りなし）
   *
   * 前者は取得点ごとに上位 8 件へ枝刈りし、同点は表記の辞書順で残す。
   * そのため「主目標から入る同点のルート」が表から落ちることがあり
   * （例: 125 / 2 本の T20 → T11）、比較の前に候補そのものが無くなる。
   * 主目標始動だけを別に全件持つことで、辞書順ではなく戦術で選べるようにする。
   */
  const table = sequenceTable(dartsLeft, mainTarget);
  for (let total = 0; total < table.length; total += 1) addBucket(table[total], total);

  const mainFirst = mainTargetFirstSequenceTable(dartsLeft, mainTarget);
  for (let total = 0; total < mainFirst.length; total += 1) addBucket(mainFirst[total], total);

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
