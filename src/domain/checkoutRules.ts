/**
 * スティールダーツ 01 / Double Out のルール判定。
 *
 * ここに置くのは「ルール上こうである」という事実だけで、
 * 戦術的な良し悪し（ランキング）は engine/ranking 側の責務とする。
 */
import { THROWABLE_DARTS, isFinishingDart, type Dart } from './dart';

/** 3 本で到達しうる最大のチェックアウト。T20 + T20 + BULL = 170。 */
export const MAX_CHECKOUT = 170;
/** チェックアウトの下限。Double Out なので D1 = 2。 */
export const MIN_CHECKOUT = 2;
/** 1 ビジット（3 投）の最大得点。T20 × 3 = 180。 */
export const MAX_VISIT_SCORE = 180;
/**
 * SETUP モードが扱う上限。
 * 180（1 ビジット最大）+ 170（3 ダートチェックアウト最大）= 350。
 */
export const MAX_SETUP_REMAINING = MAX_VISIT_SCORE + MAX_CHECKOUT;

/** 1 ビジットの本数。 */
export const DARTS_PER_VISIT = 3;

const TABLE_MAX = MAX_SETUP_REMAINING;

/**
 * checkoutTable[d][r] = 残り r 点を d 本以内で Double Out できるか。
 * d は 0〜3。純粋な動的計画法で構築し、ハードコードした表は持たない。
 */
const checkoutTable: boolean[][] = (() => {
  const table: boolean[][] = [];
  for (let d = 0; d <= DARTS_PER_VISIT; d += 1) {
    table.push(new Array<boolean>(TABLE_MAX + 1).fill(false));
  }

  // 1 本: 最終ダートが Double または BULL で、ちょうど 0 になること。
  for (const dart of THROWABLE_DARTS) {
    if (!isFinishingDart(dart)) continue;
    if (dart.score <= TABLE_MAX) table[1][dart.score] = true;
  }

  for (let d = 2; d <= DARTS_PER_VISIT; d += 1) {
    for (let r = MIN_CHECKOUT; r <= TABLE_MAX; r += 1) {
      if (table[d - 1][r]) {
        table[d][r] = true;
        continue;
      }
      for (const dart of THROWABLE_DARTS) {
        const next = r - dart.score;
        // 途中のダート後の残りは 2 点以上でなければならない（1 残しは Bust）。
        if (next < MIN_CHECKOUT) continue;
        if (table[d - 1][next]) {
          table[d][r] = true;
          break;
        }
      }
    }
  }
  return table;
})();

/** 残り `remaining` 点を `darts` 本以内で Double Out できるか。 */
export function isCheckoutable(remaining: number, darts: number): boolean {
  if (!Number.isInteger(remaining) || remaining < 0) return false;
  if (darts <= 0 || remaining > TABLE_MAX) return false;
  const d = Math.min(darts, DARTS_PER_VISIT);
  return checkoutTable[d][remaining] === true;
}

/** 残り `remaining` 点のチェックアウトに最低何本必要か。3 本で不可能なら null。 */
export function minDartsToCheckout(remaining: number): 1 | 2 | 3 | null {
  for (const d of [1, 2, 3] as const) {
    if (isCheckoutable(remaining, d)) return d;
  }
  return null;
}

/**
 * Bogey Number（3 本あってもチェックアウトできない残り点）か。
 *
 * 1 点および 170 以下の到達不能値がこれに当たる。170 を超える値は
 * 「そもそも 1 ビジットで上がれない領域」なので、SETUP 側の判定で扱う。
 */
export function isBogey(remaining: number): boolean {
  if (!Number.isInteger(remaining)) return false;
  if (remaining <= 0) return false;
  if (remaining > MAX_CHECKOUT) return false;
  return !isCheckoutable(remaining, DARTS_PER_VISIT);
}

/** 1 投の結果。 */
export type ThrowOutcome = 'continue' | 'checkout' | 'bust';

export interface ThrowResult {
  outcome: ThrowOutcome;
  /** Bust の場合はビジット開始時の残りへ戻すため、この値は使わない。 */
  remainingAfter: number;
  /** Bust の理由コード。 */
  bustReason: BustReason | null;
}

export type BustReason = 'BELOW_ZERO' | 'LEFT_ONE' | 'NOT_DOUBLE_FINISH';

/**
 * 1 投を適用した結果を返す。Double Out ルールに従う。
 *
 * - 残りが 0 未満になる → Bust
 * - 残りが 1 になる     → Bust（Double で上がれないため）
 * - 残りが 0 かつ最終ダートが Double / BULL ではない → Bust
 * - 残りが 0 かつ最終ダートが Double / BULL         → チェックアウト成立
 */
export function applyDart(remaining: number, dart: Dart): ThrowResult {
  const next = remaining - dart.score;
  if (next < 0) {
    return { outcome: 'bust', remainingAfter: remaining, bustReason: 'BELOW_ZERO' };
  }
  if (next === 1) {
    return { outcome: 'bust', remainingAfter: remaining, bustReason: 'LEFT_ONE' };
  }
  if (next === 0) {
    return isFinishingDart(dart)
      ? { outcome: 'checkout', remainingAfter: 0, bustReason: null }
      : { outcome: 'bust', remainingAfter: remaining, bustReason: 'NOT_DOUBLE_FINISH' };
  }
  return { outcome: 'continue', remainingAfter: next, bustReason: null };
}

/**
 * ルートが「残り `remaining` 点・`dartsAvailable` 本」の条件下で
 * 合法な Double Out ルートかどうかを検証する。
 */
export function isLegalCheckoutRoute(
  remaining: number,
  darts: readonly Dart[],
  dartsAvailable: number,
): boolean {
  if (darts.length === 0 || darts.length > dartsAvailable) return false;
  let left = remaining;
  for (let i = 0; i < darts.length; i += 1) {
    const result = applyDart(left, darts[i]);
    if (result.outcome === 'bust') return false;
    if (result.outcome === 'checkout') return i === darts.length - 1;
    left = result.remainingAfter;
  }
  // 全部投げ切っても 0 になっていない。
  return false;
}
