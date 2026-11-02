/**
 * 1-6 L-M4: 狙いどおりに入っているあいだは計画を続ける（docs/APPROVALS.md A-32）。
 *
 * 状態の一覧は docs/reports/tactics-v2-diff.md §1-6（CHECKOUT 13 状態）と §2-4（SETUP）。
 */
import { describe, expect, it } from 'vitest';
import { findDart, parseRoute } from '../../domain/dart';
import { MAX_CHECKOUT, MAX_SETUP_REMAINING } from '../../domain/checkoutRules';
import { suggestFor } from './suggest';
import { createReferenceVisit, createVisit, recordThrow, undoThrow, type VisitState } from './visit';
import { followVisitPlan, recommendedDartIdsOf } from './visitPlan';

const throwAll = (visit: VisitState, ids: readonly string[]) =>
  ids.reduce((state, id) => recordThrow(state, findDart(id)!), visit);

/** 監査で計画と再計算が食い違っていた CHECKOUT の 13 状態（修正前のランキング）。 */
const CHECKOUT_CASES = [107, 110, 119, 121, 122, 123, 124, 126, 127, 130, 139, 142, 150];

describe('計画の続き（CHECKOUT）', () => {
  it.each(CHECKOUT_CASES)('%i / 3 本: 計画どおりに入るたび、計画の残りを推奨にする', (start) => {
    const plan = recommendedDartIdsOf(suggestFor(start, 3))!;
    expect(plan.length).toBeGreaterThanOrEqual(2);
    let visit = createVisit(start);
    for (let step = 1; step < plan.length; step += 1) {
      visit = recordThrow(visit, findDart(plan[step - 1])!);
      const follow = followVisitPlan(visit);
      expect(follow?.remainingDartIds).toEqual(plan.slice(step));
      // 計画の残りは、いまの残り・本数で本当に上がれるルートである。
      const left = parseRoute([...plan.slice(step)]).reduce((sum, dart) => sum - dart.score, visit.remaining);
      expect(left).toBe(0);
    }
  });

  it('107 / 3 本 T19 → S10 → D20: T19 のあとは S10 → D20 を推奨、S18 → D16 は別例', () => {
    expect(recommendedDartIdsOf(suggestFor(107, 3))).toEqual(['T19', 'S10', 'D20']);
    const follow = followVisitPlan(throwAll(createVisit(107), ['T19']));
    expect(follow).toEqual({
      planDartIds: ['T19', 'S10', 'D20'],
      remainingDartIds: ['S10', 'D20'],
      alternativeDartIds: ['S18', 'D16'],
    });
  });

  it('計画と再計算が同じなら別例は出さない（100 / 3 本 T20 → D20 で T20 のあと）', () => {
    const follow = followVisitPlan(throwAll(createVisit(100), ['T20']));
    expect(follow?.remainingDartIds).toEqual(['D20']);
    expect(follow?.alternativeDartIds).toBeNull();
  });

  it('外したら計画をやめる（107 で T19 を狙い S19 に入った）', () => {
    expect(followVisitPlan(throwAll(createVisit(107), ['S19']))).toBeNull();
  });

  it('まだ投げていない・Undo で戻った・上がった・Bust はどれも null', () => {
    expect(followVisitPlan(createVisit(107))).toBeNull();
    expect(followVisitPlan(undoThrow(throwAll(createVisit(107), ['T19'])))).toBeNull();
    expect(followVisitPlan(throwAll(createVisit(40), ['D20']))).toBeNull();
    expect(followVisitPlan(throwAll(createVisit(40), ['T20']))).toBeNull();
    expect(followVisitPlan(null)).toBeNull();
  });

  it('途中参照（2 本から）でも、参照開始時の第 1 候補を計画にする', () => {
    const start = createReferenceVisit(130, 2);
    const plan = recommendedDartIdsOf(suggestFor(130, 2))!;
    const follow = followVisitPlan(recordThrow(start, findDart(plan[0])!));
    expect(follow?.remainingDartIds).toEqual(plan.slice(1));
  });
});

describe('計画の続き（SETUP）', () => {
  it('248 / 2 本 T18 → T18: T18 のあと（194 / 1 本）は T18 を推奨し、再計算の D17 は別例', () => {
    expect(recommendedDartIdsOf(suggestFor(248, 2))).toEqual(['T18', 'T18']);
    const follow = followVisitPlan(throwAll(createReferenceVisit(248, 2), ['T18']));
    expect(follow?.remainingDartIds).toEqual(['T18']);
    expect(follow?.alternativeDartIds).toEqual(['D17']);
  });

  it('171 / 2 本 T20 → S20: 111 / 1 本（NEXT VISIT）へ入っても計画の S20 を続ける', () => {
    expect(recommendedDartIdsOf(suggestFor(171, 2))).toEqual(['T20', 'S20']);
    const visit = throwAll(createReferenceVisit(171, 2), ['T20']);
    expect(visit.remaining).toBeLessThanOrEqual(MAX_CHECKOUT);
    const follow = followVisitPlan(visit);
    expect(follow?.remainingDartIds).toEqual(['S20']);
    expect(follow?.alternativeDartIds).toEqual(recommendedDartIdsOf(suggestFor(111, 1)));
  });

  it('302 / 3 本 T18 → T20 → S18（資料 (5)）: 計画どおりなら最後は S18 で 170 残し', () => {
    const plan = recommendedDartIdsOf(suggestFor(302, 3))!;
    expect(plan).toEqual(['T18', 'T20', 'S18']);
    const follow = followVisitPlan(throwAll(createVisit(302), ['T18', 'T20']));
    expect(follow?.remainingDartIds).toEqual(['S18']);
  });
});

describe('全件', () => {
  it('2〜350 × 2〜3 本: 計画どおりに入っているあいだ、推奨は常に計画の残りで、Bust も 1 残しも作らない', { timeout: 30_000 }, () => {
    const violations: string[] = [];
    for (let start = 2; start <= MAX_SETUP_REMAINING; start += 1) {
      for (const darts of [2, 3] as const) {
        const plan = recommendedDartIdsOf(suggestFor(start, darts));
        if (plan === null || plan.length < 2) continue;
        let visit = createReferenceVisit(start, darts);
        for (let step = 1; step < plan.length; step += 1) {
          visit = recordThrow(visit, findDart(plan[step - 1])!);
          if (visit.status !== 'in-progress') {
            violations.push(`${start}/${darts} ${plan.join('-')}: ${step} 投目で ${visit.status}`);
            break;
          }
          const follow = followVisitPlan(visit);
          if (follow === null || follow.remainingDartIds.join() !== plan.slice(step).join()) {
            violations.push(`${start}/${darts} ${plan.join('-')}: ${step} 投目のあと ${follow?.remainingDartIds.join('-')}`);
            break;
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
