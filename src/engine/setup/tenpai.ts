/**
 * 「このビジットでテンパイを作れるか」の判定。
 *
 * 2 つの問いを同じ計算で扱う。
 *
 *   1. canReachTenpai(remaining, darts)
 *      残り `remaining` から `darts` 本で、次ラウンドに 3 本以内で上がれる残りを作れるか。
 *   2. isSingleMissTenpaiSafe(remaining, firstDart, darts)
 *      **第一ターゲットが同ナンバーのシングルへ落ちても**、残り本数で 1 を満たせるか。
 *
 * 2 は 1 を 1 段ずらして呼ぶだけで、新しい探索エンジンも確率モデルも持たない。
 * SETUP の評価は「狙いどおり入ったときの最終 leave」だけを見ていたが、
 * 実戦でいちばん起きるミス（トリプル狙い → 同ナンバーのシングル）を通しても
 * まだテンパイへの道が残るか、という観点をここで足す。
 *
 * 例: 299 / 3 本
 *   T20 始動 → S20 へ落ちると 279 / 2 本。2 本で作れる残りは 159・162・165・168・169 で
 *              すべて Bogey。このビジット中にテンパイを作れなくなる。
 *   T19 始動 → S19 へ落ちても 280 / 2 本。T20 → T20 で 160 を残せる。
 */
import { findDart, type Dart } from '../../domain/dart';
import { DARTS_PER_VISIT, MIN_CHECKOUT } from '../../domain/checkoutRules';
import { DEFAULT_SETUP_MAIN_TARGET } from '../../data/rankingRules';
import { evaluateLeave } from './leaveQuality';
import { sequenceTable } from './sequences';

const reachCache = new Map<string, boolean>();

/**
 * この残り・この本数で、次ラウンドのテンパイを作れるか。
 *
 * 作れない残り点が実在する（例: 339 は 3 本で何を取っても Bogey にしかならない）ため、
 * UI ではこの事実を伝える必要がある。
 */
export function canReachTenpai(remaining: number, dartsAvailable: number): boolean {
  const darts = Math.min(Math.max(dartsAvailable, 0), DARTS_PER_VISIT);
  if (darts <= 0) return false;
  if (!Number.isInteger(remaining) || remaining < MIN_CHECKOUT) return false;

  const cacheKey = `${remaining}/${darts}`;
  const cached = reachCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const table = sequenceTable(darts, DEFAULT_SETUP_MAIN_TARGET);
  let reachable = false;
  for (let total = 0; total < table.length && !reachable; total += 1) {
    if (table[total].length === 0) continue;
    const leave = remaining - total;
    if (leave < MIN_CHECKOUT) continue;
    if (evaluateLeave(leave).checkoutable) reachable = true;
  }

  reachCache.set(cacheKey, reachable);
  return reachable;
}

/**
 * その的を狙って「いちばん起きるミス」をしたときに、実際に入る的。
 *
 * トリプル狙いは同じウェッジのシングル面へ落ちる。ダブル狙いも同じ。
 * シングル狙いは狙った面そのものなので、自分自身を返す。
 *
 * BULL エリア（BULL / S-BULL）は null を返す。盤面の中心を外した 1 投が
 * どこへ入るかはウェッジのように決まらず、「同ナンバーのシングル」という
 * モデルが当てはまらないためで、安全と決めつけない側へ倒している。
 * SETUP の得点手段として BULL を選ばない、という既存の方針
 * （SEGMENT_DIFFICULTY / docs/SETUP_THEORY.md §8）とも向きが揃う。
 * ラスト 1 投の S-BULL 調整（231〜235 / 271〜275）はこの判定の対象外なので、
 * これまでどおり評価される。
 *
 * 隣ナンバーへの横ズレはここではモデル化しない（CHECKOUT 側の
 * NEIGHBOR_SAFE / NEIGHBOR_RISK が扱う観点で、SETUP の第一ターゲット選択とは別軸）。
 */
export function singleMissDartOf(dart: Dart): Dart | null {
  if (dart.baseNumber === null) return null;
  return findDart(`S${dart.baseNumber}`) ?? null;
}

/**
 * 第一ターゲットが同ナンバーのシングルへ落ちても、このビジット中に
 * テンパイを作れるか。
 *
 * 残り本数が 1 本しかない場面（3 投目の調整）では、外した時点でビジットが
 * 終わるので `canReachTenpai(..., 0)` が false になり、どのルートも safe に
 * ならない。つまりこの判定は「まだ投げ直せる本数がある場面」でだけ効く。
 * ラスト 1 投の調整（302〜309 など）の既存判断はそのまま残る。
 */
export function isSingleMissTenpaiSafe(
  remaining: number,
  firstDart: Dart,
  dartsAvailable: number,
): boolean {
  const darts = Math.min(Math.max(dartsAvailable, 0), DARTS_PER_VISIT);
  if (darts <= 1) return false;
  const miss = singleMissDartOf(firstDart);
  if (miss === null) return false;
  const after = remaining - miss.score;
  if (after < MIN_CHECKOUT) return false;
  return canReachTenpai(after, darts - 1);
}

/** テスト用にキャッシュを空にする。 */
export function clearTenpaiCache(): void {
  reachCache.clear();
  lastMissCache.clear();
}

/** その残りが次のラウンドのテンパイ（3 本以内で上がれる 170 以下）か。 */
function isTenpaiLeave(leave: number): boolean {
  return leave >= MIN_CHECKOUT && leave <= 170 && evaluateLeave(leave).checkoutable;
}

/**
 * 狙い `dart` の縦ズレで入りうる点数（戦術 v2 / docs/APPROVALS.md A-29）。
 * CHECKOUT の外れ判定と同じ boardAdjacency の考え方で、
 *   T → 同じナンバーの S、D → 同じナンバーの S または盤外（0 点）、
 *   S → 同じナンバーの T / D（抜け）、D-BULL → S-BULL。S-BULL は対象外。
 */
function verticalMissScoresOf(dart: Dart): readonly number[] {
  if (dart.id === 'BULL') return [25];
  if (dart.id === 'SB' || dart.baseNumber === null) return [];
  const n = dart.baseNumber;
  if (dart.kind === 'triple') return [n];
  if (dart.kind === 'double') return [n, 0];
  return [3 * n, 2 * n];
}

/** 最後の的ごとに、直前の残り（添字）→ 0 未計算 / 1 残らない / 2 残る。 */
const lastMissCache = new Map<string, Uint8Array>();
const LAST_MISS_CACHE_SIZE = 512;

/**
 * ビジット最後の 1 投が縦ズレしても、次のラウンドのテンパイが残るか（戦術 v2 / A-29）。
 *
 * @param before 最後の 1 投を投げる直前の残り
 * @param dart 最後の 1 投で狙う的
 */
export function lastDartMissKeepsTenpai(before: number, dart: Dart): boolean {
  let byBefore = lastMissCache.get(dart.id);
  if (byBefore === undefined) {
    byBefore = new Uint8Array(LAST_MISS_CACHE_SIZE);
    lastMissCache.set(dart.id, byBefore);
  }
  const inRange = Number.isInteger(before) && before >= 0 && before < LAST_MISS_CACHE_SIZE;
  if (inRange && byBefore[before] !== 0) return byBefore[before] === 2;
  const misses = verticalMissScoresOf(dart);
  const keeps = misses.length > 0 && misses.every((score) => isTenpaiLeave(before - score));
  if (inRange) byBefore[before] = keeps ? 2 : 1;
  return keeps;
}
