/**
 * TRAINING の難易度分類。
 *
 * 出題の偏りを避けるために、候補を EASY / MEDIUM / HARD の 3 バケットへ
 * 決定論的に振り分ける。通常 Practice のランキングには一切影響しない
 * （TRAINING 側だけが参照する metadata）。
 */
import type { Dart } from '../../domain/dart';
import { DARTS_PER_VISIT } from '../../domain/checkoutRules';
import { getStandardRoute } from '../../data/standardCheckoutRoutes';
import { enumerateCheckoutRoutes, sampleCheckoutRoute } from '../checkout/enumerate';
import type { TrainingDifficulty } from './model';

/** 狙う的の識別子（BULL とアウターブルは同じ的）。 */
function targetKeyOf(dart: Dart): string {
  return dart.baseNumber === null ? 'BULL_AREA' : String(dart.baseNumber);
}

/** CHECKOUT の代表ルート（基準ルート。無ければ探索の代表 1 本）。 */
export function representativeCheckoutRoute(left: number, darts: number): readonly Dart[] | null {
  const standard = darts >= DARTS_PER_VISIT ? getStandardRoute(left) : null;
  if (standard && standard.darts.length <= darts) return standard.darts;
  return sampleCheckoutRoute(left, darts)?.darts ?? null;
}

/**
 * CHECKOUT の難易度ポイント（本仕様 22 節）。
 *
 *   (ルート長 - 1) + トリプル含有 + BULL 含有 + LEFT >= 100 + 的の切り替え 2 回以上
 */
export function checkoutDifficultyPoints(left: number, darts: number): number {
  const route = representativeCheckoutRoute(left, darts);
  if (route === null) return 0;

  let switches = 0;
  for (let i = 1; i < route.length; i += 1) {
    if (targetKeyOf(route[i]) !== targetKeyOf(route[i - 1])) switches += 1;
  }

  return (
    route.length -
    1 +
    (route.some((dart) => dart.kind === 'triple') ? 1 : 0) +
    (route.some((dart) => dart.baseNumber === null) ? 1 : 0) +
    (left >= 100 ? 1 : 0) +
    (switches >= 2 ? 1 : 0)
  );
}

export function checkoutDifficultyOf(left: number, darts: number): TrainingDifficulty {
  const points = checkoutDifficultyPoints(left, darts);
  if (points <= 1) return 'easy';
  if (points <= 3) return 'medium';
  return 'hard';
}

export interface CheckoutRouteShape {
  /** 最短で上がるのに必要な本数。 */
  readonly minLength: number;
  /** BULL を使わないルートが存在しない。 */
  readonly bullRequired: boolean;
  /** トリプルを使わないルートが存在しない。 */
  readonly tripleRequired: boolean;
}

const shapeCache = new Map<string, CheckoutRouteShape | null>();

/** 残り・本数に対する合法ルート全体の形（RECOVERY の難易度に使う）。 */
export function checkoutRouteShape(left: number, darts: number): CheckoutRouteShape | null {
  const cacheKey = `${left}/${darts}`;
  const cached = shapeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const routes = enumerateCheckoutRoutes(left, darts);
  if (routes.length === 0) {
    shapeCache.set(cacheKey, null);
    return null;
  }

  let minLength = Number.POSITIVE_INFINITY;
  let bullFree = false;
  let tripleFree = false;
  for (const route of routes) {
    minLength = Math.min(minLength, route.darts.length);
    if (!route.darts.some((dart) => dart.baseNumber === null)) bullFree = true;
    if (!route.darts.some((dart) => dart.kind === 'triple')) tripleFree = true;
  }
  const shape: CheckoutRouteShape = {
    minLength,
    bullRequired: !bullFree,
    tripleRequired: !tripleFree,
  };
  shapeCache.set(cacheKey, shape);
  return shape;
}

/**
 * RECOVERY の難易度（本仕様 25 節）。
 *
 * EASY   : 1 本で上がれる
 * MEDIUM : 2 本。BULL もトリプルも必須ではない
 * HARD   : BULL finish が必須、またはトリプルが必須
 */
export function recoveryDifficultyOf(left: number, darts: number): TrainingDifficulty {
  const shape = checkoutRouteShape(left, darts);
  if (shape === null) return 'medium';
  if (shape.minLength === 1) return 'easy';
  if (shape.bullRequired || shape.tripleRequired) return 'hard';
  return 'medium';
}

/** テスト用にキャッシュを空にする。 */
export function clearDifficultyCache(): void {
  shapeCache.clear();
}
