/**
 * 「ビジット最後の 1 投で、次のラウンドへ残す形を作る」場面の分析。
 *
 * ## なぜ既存の SETUP 順位と別に分析するのか
 *
 * SETUP エンジンのシングル落ち耐性（`engine/setup/tenpai.ts` の
 * `isSingleMissTenpaiSafe`）は、**まだ投げ直せる本数がある場面**でだけ働く。
 * 残り 1 本では外した時点でビジットが終わるため `canReachTenpai(..., 0)` が
 * false になり、どのルートも safe にならない。つまり残り 1 投の場面では
 * 「トリプルを狙い、同ナンバーのシングルへ落ちても次のラウンドは 3 本で
 * 上がれるか」という観点がどこにも無く、ランキングは
 * **狙い通り入ったときの残り点の質**だけで順位を決めている。
 *
 * その結果、残り 178 / 1 投では次の 3 つが同じ「推奨度 B」に並ぶ。
 *
 * | 狙い | 狙い通り | シングル落ち |
 * | --- | --- | --- |
 * | T19 | 121（3 本で上がれる） | **159（Bogey）** |
 * | T20 | 118（3 本で上がれる） | 158（3 本で上がれる） |
 * | T18 | 124（3 本で上がれる） | 160（3 本で上がれる） |
 *
 * 実戦では T19 だけが明確に劣るのに、レビューは 3 つとも同じ文面で
 * 「より良い狙いがありました。おすすめは S18 → 160」と言っていた。
 *
 * ここでは**承認済みの戦術順位に触れず**、当初は SIMULATION のレビュー用に
 * 作った分析を、最後の1本の実戦推奨とも共有する。計算に使うのは既存の公開 API
 * （`applyDart` / `isCheckoutable` / `isBogey`）だけで、ランキングの重みや
 * 基準ルートは読まない。
 *
 * ## 評価軸
 *
 * 残り 1 投で次のラウンドへ残す場面では、**次のラウンドに 3 本使って
 * Checkout できる数字を作れるか**を軸にする。特定の残り点（160 / 170 など）を
 * 特別扱いはしない。
 *
 *   1. 狙い通り入ったときの残りが 3 本で上がれる（＝テンパイを作れる）
 *   2. 同ナンバーのシングルへ落ちても、その残りが 3 本で上がれる
 *
 * 1 と 2 の両方を満たす的を「シングル落ちでもテンパイ」と呼ぶ。
 * トリプルならさらに良い残りになり、外しても最低限テンパイは保てる、という
 * 実戦の狙い方にあたる。
 */
import {
  MAX_CHECKOUT,
  MIN_CHECKOUT,
  applyDart,
  isBogey,
  isCheckoutable,
} from '../../domain/checkoutRules';
import { THROWABLE_DARTS, type Dart } from '../../domain/dart';

/** 残り 1 投で狙える的ひとつぶんの見立て。 */
export interface LastDartOption {
  readonly dartId: string;
  readonly dart: Dart;
  /** 狙い通り入ったときの残り。 */
  readonly leaveOnHit: number;
  /** 狙い通り入ると次のラウンドに 3 本で上がれるか。 */
  readonly hitTenpai: boolean;
  /**
   * 同ナンバーのシングルへ落ちたときの残り。
   *
   * BULL エリア（DB / SB）は null。盤面の中心を外した 1 投がどこへ入るかは
   * ウェッジのように決まらず、「同ナンバーのシングル」というモデルが
   * 当てはまらないため（`engine/setup/tenpai.ts` と同じ扱い）。
   */
  readonly leaveOnSingleMiss: number | null;
  /** シングルへ落ちても 3 本で上がれる残りか。落ち先を決められない的は false。 */
  readonly singleMissTenpai: boolean;
  /** 狙い通り入ると Bogey Number を作るか。 */
  readonly createsBogey: boolean;
}

export interface LastDartSetupAnalysis {
  readonly left: number;
  /** この 1 投でテンパイを作れる的（Bust しないものだけ）。 */
  readonly tenpaiTargets: readonly LastDartOption[];
  /** テンパイを作れて、シングルへ落ちてもテンパイを保てる的（得点の高い順）。 */
  readonly safeTargets: readonly LastDartOption[];
  /** `safeTargets` のうちトリプルだけ（得点の高い順）。 */
  readonly safeTripleTargets: readonly LastDartOption[];
  /** この 1 投でテンパイを作れる的がひとつでもあるか。 */
  readonly hasTenpaiTargets: boolean;
  /** 指定した的の見立て。Bust する的・盤外は null。 */
  optionFor(dartId: string): LastDartOption | null;
}

/** 残り点が「次のラウンドに 3 本で上がれる」か。 */
function isTenpai(leave: number): boolean {
  if (leave < MIN_CHECKOUT || leave > MAX_CHECKOUT) return false;
  return isCheckoutable(leave, 3);
}

function optionOf(left: number, dart: Dart): LastDartOption | null {
  const outcome = applyDart(left, dart);
  // 上がる的・Bust する的は「次のラウンドへ残す形」の評価対象ではない。
  if (outcome.outcome !== 'continue') return null;

  const leaveOnHit = outcome.remainingAfter;
  const leaveOnSingleMiss = dart.baseNumber === null ? null : left - dart.baseNumber;

  return {
    dartId: dart.id,
    dart,
    leaveOnHit,
    hitTenpai: isTenpai(leaveOnHit),
    leaveOnSingleMiss,
    singleMissTenpai: leaveOnSingleMiss !== null && isTenpai(leaveOnSingleMiss),
    createsBogey: isBogey(leaveOnHit),
  };
}

const cache = new Map<number, LastDartSetupAnalysis>();

/**
 * 残り `left` を 1 投で整える場面を分析する。
 *
 * 盤面の的を総当たりするが、**順位づけには使わない**。ここで作るのは
 * 「テンパイを作れるか / シングルへ落ちても保てるか」という事実だけで、
 * どのルートを推奨するかは従来どおり承認済みのエンジンが決める。
 */
export function analyzeLastDartSetup(left: number): LastDartSetupAnalysis {
  const cached = cache.get(left);
  if (cached) return cached;

  const options = new Map<string, LastDartOption>();
  for (const dart of THROWABLE_DARTS) {
    const option = optionOf(left, dart);
    if (option !== null) options.set(dart.id, option);
  }

  /*
   * 並びは「得点の高い順」。残り点の質で並べると 160 / 170 のような特定の
   * 数字ばかりが上位に来てしまうので、同じ安全さなら点を稼げる的を先に出す。
   * 同点は的の ID で決め、実行ごとに順番が変わらないようにする。
   */
  const byScore = (a: LastDartOption, b: LastDartOption): number =>
    b.dart.score - a.dart.score || a.dartId.localeCompare(b.dartId);

  const tenpaiTargets = [...options.values()].filter((option) => option.hitTenpai).sort(byScore);
  const safeTargets = tenpaiTargets.filter((option) => option.singleMissTenpai);

  const analysis: LastDartSetupAnalysis = {
    left,
    tenpaiTargets,
    safeTargets,
    safeTripleTargets: safeTargets.filter((option) => option.dart.kind === 'triple'),
    hasTenpaiTargets: tenpaiTargets.length > 0,
    optionFor: (dartId) => options.get(dartId) ?? null,
  };
  cache.set(left, analysis);
  return analysis;
}

/** テスト用にキャッシュを空にする。 */
export function clearLastDartSetupCache(): void {
  cache.clear();
}

/** 説明文へ添える推奨ターゲット（最大 `limit` 件）。 */
export function recommendedLastDartTargets(
  analysis: LastDartSetupAnalysis,
  limit = 2,
  exclude?: string,
): readonly LastDartOption[] {
  /*
   * トリプルを先に出す。「シングルでもテンパイ、トリプルならさらに良い残り」が
   * 残り 1 投の狙い方なので、教材としてはトリプルエリアを示したい。
   * 安全なトリプルが無いときはシングルなどを含めた一覧から、
   * シングル落ちまで守れる的が 1 つも無い残り点（191〜230 など）では
   * 「せめてテンパイを作れる的」から出す。
   */
  const source =
    analysis.safeTripleTargets.length > 0
      ? analysis.safeTripleTargets
      : analysis.safeTargets.length > 0
        ? analysis.safeTargets
        : analysis.tenpaiTargets;
  return source.filter((option) => option.dartId !== exclude).slice(0, limit);
}
