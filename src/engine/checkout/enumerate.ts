/**
 * チェックアウトルートの列挙。
 *
 * 添付 Excel に載っているルートだけでなく、残り点と残り本数から
 * 数学的に成立する Double Out ルートをすべて探索できる。
 * ここでは戦術的な良し悪しは一切判断しない（ranking の責務）。
 */
import { FINISHING_DARTS, THROWABLE_DARTS, routeKey, type Dart } from '../../domain/dart';
import {
  DARTS_PER_VISIT,
  MAX_CHECKOUT,
  MIN_CHECKOUT,
  isCheckoutable,
} from '../../domain/checkoutRules';

export interface CheckoutRoute {
  readonly darts: readonly Dart[];
  /** 重複排除・安定ソート用のキー。 */
  readonly key: string;
}

const cache = new Map<string, readonly CheckoutRoute[]>();

/**
 * 残り `remaining` 点を `dartsAvailable` 本以内で上がる合法ルートをすべて返す。
 *
 * 探索は「残りが 2 未満になる枝」と「残り本数で上がれない枝」を刈るため、
 * 3 本の探索でも数ミリ秒で終わる。結果は (remaining, dartsAvailable) 単位で
 * キャッシュし、同じ問い合わせで再探索しない。
 */
export function enumerateCheckoutRoutes(
  remaining: number,
  dartsAvailable: number,
): readonly CheckoutRoute[] {
  if (!Number.isInteger(remaining) || remaining < MIN_CHECKOUT || remaining > MAX_CHECKOUT) {
    return [];
  }
  const darts = Math.min(Math.max(dartsAvailable, 0), DARTS_PER_VISIT);
  if (darts <= 0) return [];

  const cacheKey = `${remaining}/${darts}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const results: CheckoutRoute[] = [];
  const acc: Dart[] = [];

  const search = (left: number, dartsLeft: number): void => {
    // この 1 本で上がれるパターン。
    for (const dart of FINISHING_DARTS) {
      if (dart.score === left) {
        const route = [...acc, dart];
        results.push({ darts: route, key: routeKey(route) });
      }
    }
    if (dartsLeft <= 1) return;

    for (const dart of THROWABLE_DARTS) {
      const next = left - dart.score;
      // 途中で残り 2 未満になる枝は Double Out できないので刈る。
      if (next < MIN_CHECKOUT) continue;
      if (!isCheckoutable(next, dartsLeft - 1)) continue;
      acc.push(dart);
      search(next, dartsLeft - 1);
      acc.pop();
    }
  };

  search(remaining, darts);

  // キーで安定ソートしておき、以降の処理の決定性を保証する。
  results.sort((a, b) => (a.darts.length - b.darts.length) || a.key.localeCompare(b.key));
  const frozen: readonly CheckoutRoute[] = results;
  cache.set(cacheKey, frozen);
  return frozen;
}

/**
 * 残り点・残り本数に対する代表的な 1 ルートを返す（説明文の生成に使う）。
 * 「最短本数・そのなかでキー順が先頭」という決定論的な選び方をする。
 */
export function sampleCheckoutRoute(
  remaining: number,
  dartsAvailable: number,
): CheckoutRoute | null {
  const routes = enumerateCheckoutRoutes(remaining, dartsAvailable);
  return routes.length > 0 ? routes[0] : null;
}

/** テスト用にキャッシュを空にする。 */
export function clearCheckoutRouteCache(): void {
  cache.clear();
}
