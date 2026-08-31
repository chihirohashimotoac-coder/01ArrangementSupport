import { describe, expect, it } from 'vitest';
import { enumerateCheckoutRoutes, sampleCheckoutRoute } from './enumerate';
import { isFinishingDart, routeTotal } from '../../domain/dart';
import { DARTS_PER_VISIT, MAX_CHECKOUT, isBogey } from '../../domain/checkoutRules';
import { BOGEY_NUMBERS } from '../../data/bogeyNumbers';

describe('enumerateCheckoutRoutes', () => {
  /**
   * 2〜170 × 3 本の全ルートを 1 度だけ走査し、違反だけを集める。
   * 1 ルートごとに expect を呼ぶと数十万回の呼び出しになるため、集約して検証する。
   */
  const violations = (() => {
    const total: string[] = [];
    const finish: string[] = [];
    const dartCount: string[] = [];
    const bust: string[] = [];
    const segment: string[] = [];

    for (const available of [1, 2, 3]) {
      for (let left = 2; left <= MAX_CHECKOUT; left += 1) {
        for (const route of enumerateCheckoutRoutes(left, available)) {
          const label = `${left}/${available}: ${route.key}`;
          if (routeTotal(route.darts) !== left) total.push(label);
          if (!isFinishingDart(route.darts[route.darts.length - 1])) finish.push(label);
          if (route.darts.length > available) dartCount.push(label);
          for (const dart of route.darts) {
            if (dart.id === 'MISS' || dart.score <= 0) segment.push(label);
          }
          let remaining = left;
          for (let i = 0; i < route.darts.length - 1; i += 1) {
            remaining -= route.darts[i].score;
            if (remaining < 2) bust.push(label);
          }
        }
      }
    }
    return { total, finish, dartCount, bust, segment };
  })();

  it('すべてのルートが「合計 = LEFT」を満たす', () => {
    expect(violations.total).toEqual([]);
  });

  it('すべてのルートの最終ダートがダブルまたは BULL である', () => {
    expect(violations.finish).toEqual([]);
  });

  it('ダート数が残り本数を超えない', () => {
    expect(violations.dartCount).toEqual([]);
  });

  it('途中で Bust するルート（1 残し・マイナス）を返さない', () => {
    expect(violations.bust).toEqual([]);
  });

  it('存在しないセグメント（MISS）を含まない', () => {
    expect(violations.segment).toEqual([]);
  });

  it('Bogey Number ではルートが 0 件になる', () => {
    const withRoutes = BOGEY_NUMBERS.filter(
      (left) => enumerateCheckoutRoutes(left, DARTS_PER_VISIT).length > 0,
    );
    expect(withRoutes).toEqual([]);
  });

  it('ルートが存在しない = Bogey という関係が 2〜170 で一致する', () => {
    const mismatched: number[] = [];
    for (let left = 2; left <= MAX_CHECKOUT; left += 1) {
      const hasRoute = enumerateCheckoutRoutes(left, DARTS_PER_VISIT).length > 0;
      if (hasRoute === isBogey(left)) mismatched.push(left);
    }
    expect(mismatched).toEqual([]);
  });

  it('170 は T20 → T20 → BULL の 1 通りだけ', () => {
    const routes = enumerateCheckoutRoutes(170, 3);
    expect(routes).toHaveLength(1);
    expect(routes[0].key).toBe('T20-T20-BULL');
  });

  it('範囲外・不正な入力では空配列', () => {
    expect(enumerateCheckoutRoutes(1, 3)).toEqual([]);
    expect(enumerateCheckoutRoutes(171, 3)).toEqual([]);
    expect(enumerateCheckoutRoutes(100, 0)).toEqual([]);
    expect(enumerateCheckoutRoutes(1.5, 3)).toEqual([]);
  });

  it('sampleCheckoutRoute は最短本数のルートを返す', () => {
    expect(sampleCheckoutRoute(40, 3)?.key).toBe('D20');
    expect(sampleCheckoutRoute(104, 2)?.darts.length).toBe(2);
    expect(sampleCheckoutRoute(169, 3)).toBeNull();
  });
});
