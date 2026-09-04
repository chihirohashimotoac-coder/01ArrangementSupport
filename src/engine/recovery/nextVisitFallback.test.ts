/**
 * 「CHECKOUT 不能時の NEXT VISIT」の回帰テスト。
 *
 * v1.3.2 で残しの選び方だけを専用セレクタへ移した。ここで守るのは
 * 「上がれる場面は 1 ミリも変わっていない」ことと「残しは常に合法」であること。
 *
 * 目的は 2 つ。
 *   1. CHECKOUT が成立する状態の挙動が、これまでと 1 ミリも変わっていないこと
 *   2. CHECKOUT が 0 件になる状態でだけ、合法な残しが 1 件返ること
 *
 * 走査は 2〜170 × 1〜3 本 = 507 状態の全数。違反は配列へ集め、最後に 1 回だけ
 * assert する（テスト方針どおり、数万回の expect を回さない）。
 */
import { describe, expect, it } from 'vitest';
import { suggestFor } from './suggest';
import { createVisit, recordThrow } from './visit';
import { requireDart, THROWABLE_DARTS } from '../../domain/dart';
import { rankCheckoutRoutes } from '../ranking/checkoutRanking';
import { rankSetupRoutes } from '../setup/enumerate';
import { selectNextVisitRoute } from './nextVisitSelection';
import { evaluateLeave } from '../setup/leaveQuality';
import { MAX_CHECKOUT, MIN_CHECKOUT, isBogey } from '../../domain/checkoutRules';

const DARTS_LEFT = [1, 2, 3] as const;
const SEGMENT_IDS = new Set(THROWABLE_DARTS.map((dart) => dart.id));

interface State {
  readonly remaining: number;
  readonly dartsLeft: number;
}

const ALL_STATES: readonly State[] = (() => {
  const states: State[] = [];
  for (let remaining = MIN_CHECKOUT; remaining <= MAX_CHECKOUT; remaining += 1) {
    for (const dartsLeft of DARTS_LEFT) states.push({ remaining, dartsLeft });
  }
  return states;
})();

const at = (state: State) => `${state.remaining}/${state.dartsLeft}本`;

describe('CHECKOUT 2〜170 × 1〜3 本の全 507 状態', () => {
  it('走査対象がちょうど 507 状態ある', () => {
    expect(ALL_STATES).toHaveLength(507);
    expect(new Set(ALL_STATES.map(at)).size).toBe(507);
  });

  it('CHECKOUT ルートがある状態では、既存のランキングと完全に一致する', () => {
    const violations: string[] = [];
    let covered = 0;

    for (const state of ALL_STATES) {
      const expected = rankCheckoutRoutes(state.remaining, state.dartsLeft);
      if (expected.length === 0) continue;
      covered += 1;

      const suggestion = suggestFor(state.remaining, state.dartsLeft);
      const actual = suggestion.checkoutRoutes;

      if (suggestion.mode !== 'checkout') violations.push(`${at(state)}: mode=${suggestion.mode}`);
      if (actual.length !== expected.length) {
        violations.push(`${at(state)}: 件数 ${actual.length} != ${expected.length}`);
        continue;
      }
      for (let i = 0; i < expected.length; i += 1) {
        if (actual[i].key !== expected[i].key) {
          violations.push(`${at(state)}: ${i} 番目 ${actual[i].key} != ${expected[i].key}`);
          break;
        }
        if (actual[i].grade !== expected[i].grade) {
          violations.push(`${at(state)}: ${i} 番目の grade ${actual[i].grade} != ${expected[i].grade}`);
          break;
        }
        if (actual[i].isStandard !== expected[i].isStandard) {
          violations.push(`${at(state)}: ${i} 番目の STANDARD 判定が変わっている`);
          break;
        }
      }
      // 上がれる場面へ fallback を混ぜない。
      if (suggestion.nextVisitRoute !== null) {
        violations.push(`${at(state)}: 上がれるのに NEXT VISIT が出ている`);
      }
      if (suggestion.unavailableReason !== null) {
        violations.push(`${at(state)}: 上がれるのに unavailableReason がある`);
      }
    }

    expect(violations).toEqual([]);
    // 507 状態のうち、上がれるのは 285 状態。ここが変わったら CHECKOUT 判定が動いている。
    expect(covered).toBe(285);
  });

  it('CHECKOUT ルートが 0 件の状態では、合法な NEXT VISIT を 1 件だけ返す', () => {
    const violations: string[] = [];
    let covered = 0;

    for (const state of ALL_STATES) {
      if (rankCheckoutRoutes(state.remaining, state.dartsLeft).length > 0) continue;
      covered += 1;

      const suggestion = suggestFor(state.remaining, state.dartsLeft);
      if (suggestion.mode !== 'checkout') {
        violations.push(`${at(state)}: mode が checkout ではない（${suggestion.mode}）`);
        continue;
      }
      if (suggestion.checkoutRoutes.length !== 0) {
        violations.push(`${at(state)}: CHECKOUT 候補が混ざっている`);
      }
      if (suggestion.setupRoutes.length !== 0) {
        violations.push(`${at(state)}: setupRoutes を使ってしまっている`);
      }

      const route = suggestion.nextVisitRoute;
      if (route === null) {
        violations.push(`${at(state)}: NEXT VISIT が出ていない`);
        continue;
      }

      // 本数・セグメント・数値の健全性。
      if (route.darts.length === 0 || route.darts.length > state.dartsLeft) {
        violations.push(`${at(state)}: 本数 ${route.darts.length} が残り本数を超えている`);
      }
      for (const dart of route.darts) {
        if (!SEGMENT_IDS.has(dart.id)) violations.push(`${at(state)}: 未知のセグメント ${dart.id}`);
      }
      if (!Number.isInteger(route.scored) || !Number.isInteger(route.leave)) {
        violations.push(`${at(state)}: scored / leave が整数ではない`);
        continue;
      }
      if (route.scored < 0 || route.leave < 0) {
        violations.push(`${at(state)}: 負数がある（${route.scored} / ${route.leave}）`);
      }
      if (route.routeText.length === 0 || route.key.length === 0) {
        violations.push(`${at(state)}: 表示用の文字列が空`);
      }

      // 取得点と残りを、ルートから独立に再計算する。
      const recomputedScored = route.darts.reduce((sum, dart) => sum + dart.score, 0);
      if (recomputedScored !== route.scored) {
        violations.push(`${at(state)}: 取得点 ${route.scored} != ${recomputedScored}`);
      }
      if (state.remaining - recomputedScored !== route.leave) {
        violations.push(
          `${at(state)}: 残り ${route.leave} != ${state.remaining} - ${recomputedScored}`,
        );
      }

      // 1 残し・Bust を作らない（途中経過も含めて確認する）。
      let left = state.remaining;
      for (const dart of route.darts) {
        left -= dart.score;
        if (left < MIN_CHECKOUT) {
          violations.push(`${at(state)}: 途中で ${left} になり Bust する`);
          break;
        }
      }
      if (route.leave === 1) violations.push(`${at(state)}: 1 残しになっている`);
      if (route.leave < MIN_CHECKOUT) violations.push(`${at(state)}: 残りが 2 未満`);

      // 残しの評価は、独自判定ではなく既存の SETUP 評価と一致していること。
      const leaveEval = evaluateLeave(route.leave);
      if (route.leaveTier === 'bogey' && !leaveEval.isBogey) {
        violations.push(`${at(state)}: leaveTier が既存評価と食い違う`);
      }
      if (leaveEval.checkoutable && route.leaveTier === 'bogey') {
        violations.push(`${at(state)}: 上がれる残りを bogey と表示している`);
      }

      // v1.3.2: 残しの選び方は NEXT VISIT 専用セレクタが決める。
      const expected = selectNextVisitRoute(state.remaining, state.dartsLeft);
      if (!expected || expected.key !== route.key) {
        violations.push(`${at(state)}: NEXT VISIT セレクタの選択と違う`);
      }

      // テンパイを作れる状況なら、必ずテンパイを残す（既存 SETUP の方針どおり）。
      const canLeaveTenpai = rankSetupRoutes(state.remaining, state.dartsLeft).some((candidate) =>
        evaluateLeave(candidate.leave).checkoutable,
      );
      if (canLeaveTenpai && !leaveEval.checkoutable) {
        violations.push(`${at(state)}: テンパイを作れるのに作っていない`);
      }
    }

    expect(violations).toEqual([]);
    // 169（ノーテン）や 150 / 1 本など、上がれない状態は 222 ある（285 + 222 = 507）。
    expect(covered).toBe(222);
  });

  it('ノーテンの状態はすべて 3 本でも NEXT VISIT を返す', () => {
    const bogeys = ALL_STATES.filter((state) => isBogey(state.remaining));
    const missing = bogeys.filter((state) => suggestFor(state.remaining, state.dartsLeft).nextVisitRoute === null);
    expect(missing).toEqual([]);
    expect(bogeys.length).toBeGreaterThan(0);
  });
});

describe('NEXT VISIT を出す条件（固定ケース）', () => {
  it('150 / 1 本では CHECKOUT が 0 件になり、NEXT VISIT を返す', () => {
    const suggestion = suggestFor(150, 1);
    expect(suggestion.mode).toBe('checkout');
    expect(suggestion.checkoutRoutes).toEqual([]);
    expect(suggestion.nextVisitRoute).not.toBeNull();
    expect(suggestion.nextVisitRoute!.darts.length).toBeLessThanOrEqual(1);
    expect(suggestion.unavailableReason).toContain('上がれません');
  });

  it('169 / 3 本（ノーテン）でも NEXT VISIT を返す', () => {
    const suggestion = suggestFor(169, 3);
    expect(suggestion.isBogey).toBe(true);
    expect(suggestion.checkoutRoutes).toEqual([]);
    expect(suggestion.unavailableReason).toContain('ノーテン');
    const route = suggestion.nextVisitRoute;
    expect(route).not.toBeNull();
    expect(169 - route!.scored).toBe(route!.leave);
  });

  it('103 / 3 本は通常どおり CHECKOUT で、NEXT VISIT を出さない', () => {
    const suggestion = suggestFor(103, 3);
    expect(suggestion.mode).toBe('checkout');
    expect(suggestion.checkoutRoutes.length).toBeGreaterThan(0);
    expect(suggestion.nextVisitRoute).toBeNull();
  });

  it('103 から S19 で 84 / 2 本になっても、上がれるので NEXT VISIT を出さない', () => {
    let visit = createVisit(103);
    visit = recordThrow(visit, requireDart('S19'));
    expect(visit.remaining).toBe(84);
    expect(visit.dartsLeft).toBe(2);

    const suggestion = suggestFor(visit.remaining, visit.dartsLeft);
    expect(suggestion.checkoutRoutes.length).toBeGreaterThan(0);
    expect(suggestion.nextVisitRoute).toBeNull();
  });

  it('305 から S20 で 285 / 2 本は、これまでどおり SETUP モード', () => {
    let visit = createVisit(305);
    visit = recordThrow(visit, requireDart('S20'));
    const suggestion = suggestFor(visit.remaining, visit.dartsLeft);
    expect(suggestion.mode).toBe('setup');
    expect(suggestion.setupRoutes.length).toBeGreaterThan(0);
    expect(suggestion.nextVisitRoute).toBeNull();
  });

  it('残り本数が 0 なら NEXT VISIT を出さない', () => {
    const suggestion = suggestFor(150, 0);
    expect(suggestion.mode).toBe('unavailable');
    expect(suggestion.nextVisitRoute).toBeNull();
  });

  it('Bust 後（開始時の残りへ戻り、残り 0 本）でも NEXT VISIT を出さない', () => {
    let visit = createVisit(40);
    visit = recordThrow(visit, requireDart('T20'));
    expect(visit.status).toBe('bust');
    const suggestion = suggestFor(visit.remaining, visit.dartsLeft);
    expect(suggestion.nextVisitRoute).toBeNull();
  });

  it('チェックアウト成立後（残り 0）でも NEXT VISIT を出さない', () => {
    let visit = createVisit(40);
    visit = recordThrow(visit, requireDart('D20'));
    expect(visit.status).toBe('checkout');
    const suggestion = suggestFor(visit.remaining, visit.dartsLeft);
    expect(suggestion.mode).toBe('unavailable');
    expect(suggestion.nextVisitRoute).toBeNull();
  });

  it('SETUP 領域（171 以上）では NEXT VISIT を使わない', () => {
    for (const remaining of [171, 269, 305, 339, 350]) {
      const suggestion = suggestFor(remaining, 3);
      expect(suggestion.mode).toBe('setup');
      expect(suggestion.nextVisitRoute).toBeNull();
    }
  });
});
