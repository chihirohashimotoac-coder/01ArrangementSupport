import { describe, expect, it } from 'vitest';
import {
  canReachTenpai,
  evaluateSetupRoute,
  rankSetupRoutes,
  scoreSetupRoute,
  tonTrapWarning,
} from './enumerate';
import { BOGEY_NUMBERS } from '../../data/bogeyNumbers';
import { evaluateLeave, hasMemorableLastDigit, isTonTrap, leaveTierOf } from './leaveQuality';
import { parseRoute, routeTotal } from '../../domain/dart';
import {
  DARTS_PER_VISIT,
  MAX_SETUP_REMAINING,
  MAX_VISIT_SCORE,
  MAX_CHECKOUT,
  isBogey,
  isCheckoutable,
} from '../../domain/checkoutRules';
import {
  AFTER_180_CASES,
  LANDING_EXAMPLES,
  SBULL_CASES_A,
  SBULL_CASES_B,
  THIRD_DART_ADJUST_CASES,
  THIRD_DART_TRAP,
  TON_TRAP_CASES,
} from '../../data/setupReferenceCases';

describe('SETUP の範囲', () => {
  it('上限 350 は 180 + 170 として定義されている', () => {
    expect(MAX_SETUP_REMAINING).toBe(MAX_VISIT_SCORE + MAX_CHECKOUT);
    expect(MAX_SETUP_REMAINING).toBe(350);
  });

  it('171〜350 のすべてで候補を返せる', () => {
    const empty: number[] = [];
    for (let n = 171; n <= MAX_SETUP_REMAINING; n += 1) {
      if (rankSetupRoutes(n, DARTS_PER_VISIT, { maxRoutes: 5 }).length === 0) empty.push(n);
    }
    expect(empty).toEqual([]);
  });

  it('提案されたルートは Bust しない', () => {
    const failures: string[] = [];
    for (const n of [171, 200, 231, 269, 302, 340, 350]) {
      for (const route of rankSetupRoutes(n, DARTS_PER_VISIT)) {
        let left = n;
        for (const dart of route.darts) {
          left -= dart.score;
          if (left < 2) failures.push(`${n}: ${route.routeText}`);
        }
        if (left !== route.leave) failures.push(`${n}: leave 不一致 ${route.routeText}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('テンパイを作れる残りでは、最上位候補が必ずテンパイを残す', () => {
    const failures: number[] = [];
    for (let n = 171; n <= MAX_SETUP_REMAINING; n += 1) {
      if (!canReachTenpai(n, DARTS_PER_VISIT)) continue;
      const best = rankSetupRoutes(n, DARTS_PER_VISIT, { maxRoutes: 1 })[0];
      if (!isCheckoutable(best.leave, DARTS_PER_VISIT)) failures.push(n);
    }
    expect(failures).toEqual([]);
  });

  /**
   * 資料には無い性質だが、engine の探索から機械的に導かれる事実。
   * 「Bogey + 180」の残り点は、1 ビジットで何を取ってもテンパイにできない。
   */
  it('1 ビジットでテンパイを作れない残りは Bogey + 180 の 7 つだけ', () => {
    const unreachable: number[] = [];
    for (let n = 171; n <= MAX_SETUP_REMAINING; n += 1) {
      if (!canReachTenpai(n, DARTS_PER_VISIT)) unreachable.push(n);
    }
    expect(unreachable).toEqual([339, 342, 343, 345, 346, 348, 349]);
    expect(unreachable).toEqual(BOGEY_NUMBERS.map((n) => n + MAX_VISIT_SCORE));
  });

  it('テンパイを作れない残りでも、候補は返す（何も出せない状態にしない）', () => {
    for (const n of [339, 342, 349]) {
      const ranked = rankSetupRoutes(n, DARTS_PER_VISIT, { maxRoutes: 5 });
      expect(ranked.length, `${n}`).toBeGreaterThan(0);
    }
  });

  it('ランキングのスコアと、単体評価のスコアが一致する', () => {
    for (const n of [231, 271, 302, 340]) {
      for (const route of rankSetupRoutes(n, DARTS_PER_VISIT, { maxRoutes: 5 })) {
        const direct = scoreSetupRoute(n, route.darts, DARTS_PER_VISIT, 'T20');
        expect(direct.score, `${n}: ${route.routeText}`).toBeCloseTo(route.score, 6);
        expect(direct.leave).toBe(route.leave);
      }
    }
  });
});

describe('残り点の評価', () => {
  it('Bogey は最低評価になる', () => {
    expect(evaluateLeave(169).codes).toContain('LEAVES_BOGEY');
    expect(evaluateLeave(169).score).toBeLessThan(evaluateLeave(170).score);
  });

  it('170 を超える残りは範囲外として扱う', () => {
    expect(evaluateLeave(171).codes).toContain('LEAVE_ABOVE_CHECKOUT_RANGE');
    expect(leaveTierOf(171)).toBe('out-of-range');
  });

  it('単純な数値順（170 > 167 > 164 > 161 > 160）にはならない', () => {
    const scores = [170, 167, 164, 161, 160].map((n) => evaluateLeave(n).score);
    const descending = scores.every((v, i) => i === 0 || scores[i - 1] >= v);
    expect(descending).toBe(false);
  });

  it('160 は BULL を要求せず D20 で終われるため、170 より高く評価される', () => {
    expect(evaluateLeave(160).codes).not.toContain('LEAVE_REQUIRES_BULL');
    expect(evaluateLeave(170).codes).toContain('LEAVE_REQUIRES_BULL');
    expect(evaluateLeave(160).score).toBeGreaterThan(evaluateLeave(170).score);
  });

  it('0・1・4・7 の経験則は 159〜170 の帯だけで有効', () => {
    expect(hasMemorableLastDigit(164)).toBe(true);
    expect(hasMemorableLastDigit(160)).toBe(true);
    // 帯の外では、下一桁が 0/1/4/7 でも経験則の対象外。
    expect(hasMemorableLastDigit(140)).toBe(false);
    expect(hasMemorableLastDigit(157)).toBe(false);
  });

  it('帯の外では「下一桁が 2・3・5・6・8・9 なら上がれない」は成り立たない', () => {
    // 資料 (3) の経験則は 340 点台に限った話であることの確認。
    expect(isCheckoutable(152, DARTS_PER_VISIT)).toBe(true);
    expect(isCheckoutable(158, DARTS_PER_VISIT)).toBe(true);
  });
});

describe('資料 (3) 340点台と180後の残り', () => {
  it.each(AFTER_180_CASES)('$score → $leave の記載が計算と一致する', (testCase) => {
    expect(testCase.score - MAX_VISIT_SCORE).toBe(testCase.leave);
    expect(isCheckoutable(testCase.leave, DARTS_PER_VISIT)).toBe(testCase.documentedTenpai);
  });

  it('340点台で 180 後にテンパイになるのは 340 / 341 / 344 / 347 だけ', () => {
    const tenpai: number[] = [];
    for (let n = 340; n <= 349; n += 1) {
      if (isCheckoutable(n - MAX_VISIT_SCORE, DARTS_PER_VISIT)) tenpai.push(n);
    }
    expect(tenpai).toEqual([340, 341, 344, 347]);
  });
});

describe('資料 (4) とりあえずTONの罠', () => {
  it.each(TON_TRAP_CASES)('$remaining は TON 後に Bogey になる', (testCase) => {
    expect(testCase.remaining - 100).toBe(testCase.documentedLeaveAfterTon);
    expect(isBogey(testCase.documentedLeaveAfterTon)).toBe(true);
    expect(isTonTrap(testCase.remaining)).toBe(true);
    expect(tonTrapWarning(testCase.remaining)).toEqual({
      leaveAfterTon: testCase.documentedLeaveAfterTon,
    });
  });

  it('資料の一覧が、計算で求めた TON トラップの全件と一致する', () => {
    const computed: number[] = [];
    for (let n = 171; n <= MAX_SETUP_REMAINING; n += 1) if (isTonTrap(n)) computed.push(n);
    expect(computed.sort((a, b) => a - b)).toEqual(
      TON_TRAP_CASES.map((c) => c.remaining).sort((a, b) => a - b),
    );
  });

  it.each(LANDING_EXAMPLES)('$formula → $documentedLeave 残しが成立する', (example) => {
    const darts = parseRoute([...example.darts]);
    expect(darts.length).toBeLessThanOrEqual(DARTS_PER_VISIT);
    expect(routeTotal(darts)).toBe(example.documentedScore);
    expect(example.remaining - example.documentedScore).toBe(example.documentedLeave);
    expect(isCheckoutable(example.documentedLeave, DARTS_PER_VISIT)).toBe(true);
  });

  it('269 は 100 点だとノーテン、99 点なら 170 残し', () => {
    expect(isBogey(269 - 100)).toBe(true);
    expect(269 - 99).toBe(170);
    expect(isCheckoutable(170, DARTS_PER_VISIT)).toBe(true);
  });
});

describe('資料 (5) 302〜309 の3投目調整', () => {
  it.each(THIRD_DART_ADJUST_CASES)(
    '$remaining は T20×2 のあと S$documentedThirdDart で $documentedLeave 残し',
    (testCase) => {
      const afterTwoT20 = testCase.remaining - 120;
      expect(afterTwoT20 - testCase.documentedThirdDart).toBe(testCase.documentedLeave);
      expect(isCheckoutable(testCase.documentedLeave, DARTS_PER_VISIT)).toBe(true);
    },
  );

  it.each(THIRD_DART_ADJUST_CASES)(
    '$remaining: 残り 1 本の最上位候補が資料どおり S$documentedThirdDart になる',
    (testCase) => {
      const best = rankSetupRoutes(testCase.remaining - 120, 1, { maxRoutes: 1 })[0];
      expect(best.darts[0].id).toBe(`S${testCase.documentedThirdDart}`);
      expect(best.leave).toBe(testCase.documentedLeave);
    },
  );

  it.each(THIRD_DART_ADJUST_CASES)(
    '$remaining: 3 本の最上位候補が T20 → T20 → S$documentedThirdDart になる',
    (testCase) => {
      const best = rankSetupRoutes(testCase.remaining, DARTS_PER_VISIT, { maxRoutes: 1 })[0];
      expect(best.routeText).toBe(`T20 → T20 → S${testCase.documentedThirdDart}`);
      expect(best.leave).toBe(testCase.documentedLeave);
    },
  );

  it('302 の 3 投目を 20 にすると 162 が残りノーテンになる', () => {
    expect(302 - 120 - THIRD_DART_TRAP.badThirdDart).toBe(THIRD_DART_TRAP.badLeave);
    expect(isBogey(THIRD_DART_TRAP.badLeave)).toBe(true);
    const bad = evaluateSetupRoute(302, DARTS_PER_VISIT, parseRoute(['T20', 'T20', 'S20']))!;
    expect(bad.leave).toBe(162);
    expect(bad.reasons.map((r) => r.code)).toContain('LEAVES_BOGEY');
    expect(bad.grade).toBe('C');
  });

  it('302 で S18 に振る方が S20 より高く評価される', () => {
    const good = evaluateSetupRoute(302, DARTS_PER_VISIT, parseRoute(['T20', 'T20', 'S18']))!;
    const bad = evaluateSetupRoute(302, DARTS_PER_VISIT, parseRoute(['T20', 'T20', 'S20']))!;
    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.leave).toBe(164);
    expect(good.reasons.map((r) => r.code)).toContain('SETUP_THIRD_DART_ADJUST');
  });
});

describe('資料 (6) S-BULL を使った調整', () => {
  it.each([...SBULL_CASES_A, ...SBULL_CASES_B])(
    '$remaining: $darts が $documentedScore 点で $documentedLeave 残しになる',
    (testCase) => {
      const darts = parseRoute([...testCase.darts]);
      expect(darts).toHaveLength(3);
      expect(routeTotal(darts)).toBe(testCase.documentedScore);
      expect(testCase.remaining - testCase.documentedScore).toBe(testCase.documentedLeave);
      expect(isCheckoutable(testCase.documentedLeave, DARTS_PER_VISIT)).toBe(true);
      expect(isBogey(testCase.documentedLeave)).toBe(false);
    },
  );

  it.each([...SBULL_CASES_A, ...SBULL_CASES_B])(
    '$remaining: engine でも Bust せず、テンパイとして評価される',
    (testCase) => {
      const evaluated = evaluateSetupRoute(
        testCase.remaining,
        DARTS_PER_VISIT,
        parseRoute([...testCase.darts]),
      );
      expect(evaluated).not.toBeNull();
      expect(evaluated!.leave).toBe(testCase.documentedLeave);
      expect(evaluated!.reasons.map((r) => r.code)).toContain('LEAVES_CHECKOUTABLE');
      expect(evaluated!.reasons.map((r) => r.code)).toContain('SETUP_USES_SBULL');
    },
  );

  it('231〜235 はトリプルを使わずにテンパイを作れる', () => {
    for (const testCase of SBULL_CASES_A) {
      const darts = parseRoute([...testCase.darts]);
      expect(darts.every((d) => d.kind !== 'triple')).toBe(true);
    }
  });
});

describe('SETUP のリカバリー（残り本数が減った状態）', () => {
  it('305 から T20 を狙って S20 だった場合、残り 285 / 2 本で再計算できる', () => {
    const afterMiss = 305 - 20;
    expect(afterMiss).toBe(285);
    const ranked = rankSetupRoutes(afterMiss, 2);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].leave).toBeGreaterThanOrEqual(2);
  });

  /**
   * 285 は 2 本ではテンパイを作れない（到達できる取得点が 117 と 120 だけで、
   * 残りが 168 / 165 のいずれも Bogey になる）。
   * この事実を UI へ伝えられるよう、engine 側で判定できることを担保する。
   */
  it('285 は残り 2 本ではテンパイを作れない', () => {
    expect(canReachTenpai(285, 2)).toBe(false);
    expect(canReachTenpai(285, DARTS_PER_VISIT)).toBe(true);
  });

  it('残り本数が 0 なら候補は空', () => {
    expect(rankSetupRoutes(305, 0)).toEqual([]);
  });
});

describe('探索の速度', () => {
  it('171〜350 を全件探索しても 1 秒以内に終わる（表の構築を含む）', () => {
    const started = performance.now();
    for (let n = 171; n <= MAX_SETUP_REMAINING; n += 1) {
      rankSetupRoutes(n, DARTS_PER_VISIT, { maxRoutes: 10 });
    }
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('2 回目以降はキャッシュが効く', () => {
    rankSetupRoutes(302, DARTS_PER_VISIT, { maxRoutes: 10 });
    const started = performance.now();
    for (let i = 0; i < 50; i += 1) rankSetupRoutes(302, DARTS_PER_VISIT, { maxRoutes: 10 });
    expect(performance.now() - started).toBeLessThan(50);
  });
});
