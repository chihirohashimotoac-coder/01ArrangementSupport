import { describe, expect, it } from 'vitest';
import {
  canReachTenpai,
  evaluateSetupRoute,
  isSingleMissTenpaiSafe,
  rankSetupRoutes,
  scoreSetupRoute,
  singleMissDartOf,
  tonTrapWarning,
} from './enumerate';
import { BOGEY_NUMBERS } from '../../data/bogeyNumbers';
import { evaluateLeave, hasMemorableLastDigit, isTonTrap, leaveTierOf } from './leaveQuality';
import {
  THROWABLE_DARTS,
  TRIPLE_DARTS,
  parseRoute,
  requireDart,
  routeTotal,
} from '../../domain/dart';
import {
  DARTS_PER_VISIT,
  MAX_SETUP_REMAINING,
  MAX_VISIT_SCORE,
  MAX_CHECKOUT,
  MIN_CHECKOUT,
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

  /*
   * v1.3.7: 3 本フルの最上位は「狙う得点用トリプル」から始まる。
   *
   * v1.3.4 でシングル落ち耐性を明示的なふるいに入れたとき、このテストは
   * 3 本フルの最上位を `S18 → T20 → T20`（302）のように固定していた。
   * しかしシングル落ち耐性は「得点用トリプルを狙い、同ナンバーのシングルへ
   * 落ちた」場合の評価であって、S18 そのものを狙う理由にはならない。
   * S18 は T18 を狙った結果としての実着弾であり、そこからの立て直しは
   * 実着弾後に改めて計算する。
   *
   * 資料が示す「3 投目をどこへ振るか」の答え（残り 1 本の判断）は
   * 上のテストで変わらず担保している。ここで見るのは 1 投目の狙いの方。
   */
  it.each(THIRD_DART_ADJUST_CASES)(
    '$remaining: 3 本の最上位候補は、安全な得点用トリプルを第一ターゲットにする',
    (testCase) => {
      const best = rankSetupRoutes(testCase.remaining, DARTS_PER_VISIT, { maxRoutes: 1 })[0];
      const first = best.darts[0];
      expect(first.kind).toBe('triple');
      expect(isSingleMissTenpaiSafe(testCase.remaining, first, DARTS_PER_VISIT)).toBe(true);
      // 狙いどおり入れば、次ラウンドで上がれる残りを作れる。
      expect(isCheckoutable(best.leave, DARTS_PER_VISIT)).toBe(true);
    },
  );

  /*
   * 第一ターゲットは「どのトリプルを狙うか」であって、完成ルートの固定ではない。
   * したがってここではルート全文ではなく 1 投目だけを検証する。
   * T20 を捨てざるを得ない場面で選ぶのは、シングルへ落ちても立て直せる
   * 得点用トリプルのうち、いちばん点が高いもの。
   */
  it.each([
    { remaining: 302, expected: 'T18' },
    { remaining: 303, expected: 'T19' },
    { remaining: 305, expected: 'T18' },
    { remaining: 306, expected: 'T19' },
    { remaining: 308, expected: 'T18' },
    { remaining: 309, expected: 'T19' },
  ])('$remaining の第一ターゲットは $expected になる（v1.3.7）', ({ remaining, expected }) => {
    expect(rankSetupRoutes(remaining, DARTS_PER_VISIT, { maxRoutes: 1 })[0].darts[0].id).toBe(
      expected,
    );
  });

  it.each([300, 301, 304, 307])(
    '%i は T20 のシングル落ちでも安全なので、これまでどおり T20 から始める',
    (remaining) => {
      const best = rankSetupRoutes(remaining, DARTS_PER_VISIT, { maxRoutes: 1 })[0];
      expect(best.darts[0].id).toBe('T20');
      expect(isSingleMissTenpaiSafe(remaining, best.darts[0], DARTS_PER_VISIT)).toBe(true);
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

describe('残り点の分類（PR #1 レビュー指摘の回帰テスト）', () => {
  it('3 本投げても 170 を超える残りは out-of-range であり、テンパイではない', () => {
    const evaluated = evaluateSetupRoute(350, DARTS_PER_VISIT, parseRoute(['S1', 'S1', 'S1']));
    expect(evaluated).not.toBeNull();
    expect(evaluated!.leave).toBe(347);
    expect(evaluated!.leaveTier).toBe('out-of-range');
    expect(isCheckoutable(evaluated!.leave, DARTS_PER_VISIT)).toBe(false);
    expect(evaluated!.reasons.map((r) => r.code)).toContain('LEAVE_ABOVE_CHECKOUT_RANGE');
    expect(evaluated!.reasons.map((r) => r.code)).not.toContain('LEAVES_CHECKOUTABLE');
  });

  it('leaveTier は残り点の実態と一致する', () => {
    expect(leaveTierOf(170)).toBe('premium');
    expect(leaveTierOf(169)).toBe('bogey');
    expect(leaveTierOf(171)).toBe('out-of-range');
    expect(leaveTierOf(110)).toBe('good');
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

/**
 * v1.3.4: 第一ターゲットのシングル落ち耐性。
 *
 * SETUP の評価は「狙いどおり入ったときの最終 leave」だけを見ていた。
 * 実戦でいちばん起きるミス（トリプル狙い → 同ナンバーのシングル）を通しても
 * テンパイへの道が残るか、という観点を明示的な戦術ふるいとして足した。
 */
describe('v1.3.4 single-miss tenpai safety', () => {
  /** 指示で挙がった「19 / 18 系へ振るべき」残り点。 */
  const UNSAFE_T20_STARTS = [299, 302, 303, 305, 306, 308, 309] as const;
  /** T20 のシングル落ちでも問題ない残り点（変更してはいけない）。 */
  const SAFE_T20_STARTS = [300, 301, 304, 307] as const;

  it.each(UNSAFE_T20_STARTS)('%i は T20 始動が危険で、安全な代替が実在する', (start) => {
    const t20 = requireDart('T20');
    expect(isSingleMissTenpaiSafe(start, t20, DARTS_PER_VISIT)).toBe(false);
    // S20 へ落ちた時点で、残り 2 本ではテンパイを作れない。
    expect(canReachTenpai(start - 20, DARTS_PER_VISIT - 1)).toBe(false);

    // 18 / 19 系のうち少なくとも一方は安全。
    const safeAlternatives = ['T18', 'T19']
      .map((id) => requireDart(id))
      .filter((dart) => isSingleMissTenpaiSafe(start, dart, DARTS_PER_VISIT));
    expect(safeAlternatives.length).toBeGreaterThan(0);
  });

  it.each(UNSAFE_T20_STARTS)('%i の最上位は、安全な開始ターゲットになる', (start) => {
    const best = rankSetupRoutes(start, DARTS_PER_VISIT, { maxRoutes: 1 })[0];
    expect(isSingleMissTenpaiSafe(start, best.darts[0], DARTS_PER_VISIT)).toBe(true);
    // 18 / 19 系から始まる。
    expect([18, 19]).toContain(best.darts[0].baseNumber);
    // 次のラウンドで上がれる残りであることは変わらない。
    expect(isCheckoutable(best.leave, DARTS_PER_VISIT)).toBe(true);
  });

  it.each(SAFE_T20_STARTS)('%i は T20 始動のままにする（安全性のために振らない）', (start) => {
    const t20 = requireDart('T20');
    expect(isSingleMissTenpaiSafe(start, t20, DARTS_PER_VISIT)).toBe(true);
    const best = rankSetupRoutes(start, DARTS_PER_VISIT, { maxRoutes: 1 })[0];
    expect(best.darts[0].id).toBe('T20');
  });

  it('残り 1 本ではこのふるいが効かず、資料どおりの 3 投目調整が残る', () => {
    // 外した時点でビジットが終わるので、どのルートも safe にならない。
    for (const id of ['T20', 'S20', 'T18']) {
      expect(isSingleMissTenpaiSafe(182, requireDart(id), 1)).toBe(false);
    }
    // それでも 182 → S18（164 残し）という答えは変わらない。
    expect(rankSetupRoutes(182, 1, { maxRoutes: 1 })[0].darts[0].id).toBe('S18');
  });

  it('BULL エリアはこのモデルの対象外（安全と決めつけない）', () => {
    expect(singleMissDartOf(requireDart('BULL'))).toBeNull();
    expect(singleMissDartOf(requireDart('SB'))).toBeNull();
    expect(isSingleMissTenpaiSafe(312, requireDart('BULL'), DARTS_PER_VISIT)).toBe(false);
  });

  it('SETUP 171〜350 × 1〜3 本で、安全性判定と候補が矛盾しない', () => {
    const violations: string[] = [];
    for (let remaining = 171; remaining <= MAX_SETUP_REMAINING; remaining += 1) {
      for (const darts of [1, 2, 3] as const) {
        const routes = rankSetupRoutes(remaining, darts, { maxRoutes: 20 });
        if (routes.length === 0) {
          violations.push(`${remaining}/${darts}: 候補 0 件`);
          continue;
        }
        const best = routes[0];
        const safeExists = THROWABLE_DARTS.some(
          (dart) =>
            remaining - dart.score >= MIN_CHECKOUT &&
            isSingleMissTenpaiSafe(remaining, dart, darts) &&
            canReachTenpai(remaining - dart.score, darts - 1),
        );
        const bestIsSafe = isSingleMissTenpaiSafe(remaining, best.darts[0], darts);
        // 安全な開始ターゲットがあるのにテンパイも作れる場合、最上位は安全側。
        if (safeExists && canReachTenpai(remaining, darts) && !bestIsSafe) {
          violations.push(`${remaining}/${darts}: 安全な代替があるのに ${best.routeText}`);
        }
        // 安全な開始ターゲットが無くても候補は消えない。
        if (!safeExists && routes.length === 0) {
          violations.push(`${remaining}/${darts}: unsafe しか無い状態で候補が消えた`);
        }
      }
    }
    expect(violations.slice(0, 10)).toEqual([]);
  });
});

/*
 * v1.3.7: 「狙う的」と「実際の着弾」を混同しない。
 *
 * v1.3.4 のテストは `S19 → T20 → T20` を正解として固定していたため、
 * 「第一ターゲットに S19 を選ぶ」という誤りを検出できなかった。
 * ここでは *何を狙うのか* を検証する。
 */
describe('v1.3.7 第一ターゲットは「狙う得点用トリプル」', () => {
  /** T20 のシングル落ちが行き止まりになる残り点。 */
  const UNSAFE_T20_STARTS = [299, 302, 303, 305, 306, 308, 309] as const;
  /** T20 のシングル落ちでも立て直せる残り点（振り直してはいけない）。 */
  const SAFE_T20_STARTS = [300, 301, 304, 307] as const;

  it.each(UNSAFE_T20_STARTS)('%i の第一ターゲットは S18 / S19 ではない', (start) => {
    const first = rankSetupRoutes(start, DARTS_PER_VISIT, { maxRoutes: 1 })[0].darts[0];
    expect(first.id).not.toBe('S18');
    expect(first.id).not.toBe('S19');
    expect(first.kind).not.toBe('single');
    expect(first.kind).not.toBe('double');
  });

  it.each(UNSAFE_T20_STARTS)('%i の第一ターゲットは 18 / 19 系の得点用トリプル', (start) => {
    const first = rankSetupRoutes(start, DARTS_PER_VISIT, { maxRoutes: 1 })[0].darts[0];
    expect(first.kind).toBe('triple');
    expect([18, 19]).toContain(first.baseNumber);
  });

  it.each(UNSAFE_T20_STARTS)(
    '%i: 狙ったトリプルがシングルへ落ちても、テンパイ経路が残る',
    (start) => {
      const first = rankSetupRoutes(start, DARTS_PER_VISIT, { maxRoutes: 1 })[0].darts[0];
      expect(isSingleMissTenpaiSafe(start, first, DARTS_PER_VISIT)).toBe(true);

      // 実着弾（同ナンバーのシングル）から、残り本数で立て直せる。
      const miss = singleMissDartOf(first)!;
      const afterMiss = start - miss.score;
      expect(canReachTenpai(afterMiss, DARTS_PER_VISIT - 1)).toBe(true);

      // 立て直しは固定ルートではなく、実着弾後の状態を既存エンジンで再計算する。
      const recovery = rankSetupRoutes(afterMiss, DARTS_PER_VISIT - 1, { maxRoutes: 1 })[0];
      expect(recovery).toBeDefined();
      expect(isCheckoutable(recovery.leave, DARTS_PER_VISIT)).toBe(true);
    },
  );

  it('299 は T19 を狙い、S19 へ落ちたら 280 / 2 本から 160 を作れる', () => {
    expect(rankSetupRoutes(299, DARTS_PER_VISIT, { maxRoutes: 1 })[0].darts[0].id).toBe('T19');

    // T19 を狙って S19 に落ちた実着弾。ここから先は既存の評価で決める。
    expect(299 - 19).toBe(280);
    const recovery = rankSetupRoutes(280, 2, { maxRoutes: 1 })[0];
    expect(recovery.darts.map((dart) => dart.id)).toEqual(['T20', 'T20']);
    expect(recovery.leave).toBe(160);
  });

  it.each(SAFE_T20_STARTS)('%i は T20 が安全なので 18 / 19 系へ振り替えない', (start) => {
    const first = rankSetupRoutes(start, DARTS_PER_VISIT, { maxRoutes: 1 })[0].darts[0];
    expect(first.id).toBe('T20');
    expect([18, 19]).not.toContain(first.baseNumber);
  });

  it('T20 を捨てる場面では、安全なトリプルのうち最も点の高いものを狙う', () => {
    const violations: string[] = [];
    for (let remaining = 171; remaining <= MAX_SETUP_REMAINING; remaining += 1) {
      const safe = TRIPLE_DARTS.filter((dart) =>
        isSingleMissTenpaiSafe(remaining, dart, DARTS_PER_VISIT),
      );
      if (safe.length === 0) continue;
      if (safe.some((dart) => dart.id === 'T20')) continue;

      const best = rankSetupRoutes(remaining, DARTS_PER_VISIT, { maxRoutes: 1 })[0];
      const top = safe.reduce((a, b) => (b.score > a.score ? b : a));
      if (best.darts[0].id !== top.id) {
        violations.push(`${remaining}: ${best.darts[0].id} ではなく ${top.id} を狙うべき`);
      }
    }
    expect(violations).toEqual([]);
  });

  /*
   * 「主目標が安全なら振り直さない」は、シングル落ち耐性を理由に振り直さない、
   * という意味であって「必ず T20 から投げる」ではない（docs/APPROVALS.md A-18）。
   * 残りの質は取得点より重い（A-7）ので、T20 が安全でも別のトリプルの方が
   * 良い残しを作れる残り点では、そちらが第 1 候補になる。
   * この区別を取り違えて T20 を強制すると、承認済みの重みが良いと評価する
   * 残しを捨てることになるため、その差をここで固定しておく。
   */
  it('T20 が安全でも、より良い残しを作れるトリプルがあればそちらを狙う', () => {
    const t20 = requireDart('T20');
    expect(isSingleMissTenpaiSafe(279, t20, DARTS_PER_VISIT)).toBe(true);

    const best = rankSetupRoutes(279, DARTS_PER_VISIT, { maxRoutes: 1 })[0];
    // 1 投目は得点用トリプル（v1.3.7 の修正点）。ただし T20 とは限らない。
    expect(best.darts[0].kind).toBe('triple');
    expect(best.leave).toBe(160);

    // T20 始動の最良ルートは 139 残しにしかならず、評価も下がる。
    const rest = rankSetupRoutes(279 - t20.score, DARTS_PER_VISIT - 1, {
      maxRoutes: 1,
      includeSingleMissUnsafe: true,
    })[0];
    const forced = evaluateSetupRoute(279, DARTS_PER_VISIT, [t20, ...rest.darts], {
      includeSingleMissUnsafe: true,
    })!;
    expect(forced.leave).toBe(139);
    expect(best.score).toBeGreaterThan(forced.score);
  });

  it('SETUP 171〜350 × 1〜3 本: 安全な得点用トリプルがあるなら S / D から始めない', () => {
    const violations: string[] = [];
    for (let remaining = 171; remaining <= MAX_SETUP_REMAINING; remaining += 1) {
      for (const darts of [1, 2, 3] as const) {
        const safe = TRIPLE_DARTS.filter((dart) =>
          isSingleMissTenpaiSafe(remaining, dart, darts),
        );
        if (safe.length === 0) continue;
        const best = rankSetupRoutes(remaining, darts, { maxRoutes: 1 })[0];
        if (best.darts[0].kind !== 'triple') {
          violations.push(`${remaining}/${darts}: ${best.routeText}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('SETUP 171〜350 × 1〜3 本: Bust も 1 残しも作らず、leave が一致する', () => {
    const violations: string[] = [];
    for (let remaining = 171; remaining <= MAX_SETUP_REMAINING; remaining += 1) {
      for (const darts of [1, 2, 3] as const) {
        for (const route of rankSetupRoutes(remaining, darts, { maxRoutes: 20 })) {
          let left = remaining;
          let busted = false;
          for (const dart of route.darts) {
            left -= dart.score;
            if (left < MIN_CHECKOUT) busted = true;
          }
          if (busted) violations.push(`${remaining}/${darts}: ${route.routeText} が Bust / 1 残し`);
          if (left !== route.leave) {
            violations.push(`${remaining}/${darts}: ${route.routeText} の leave が不一致`);
          }
          if (route.darts.length > darts) {
            violations.push(`${remaining}/${darts}: ${route.routeText} は本数超過`);
          }
        }
      }
    }
    expect(violations.slice(0, 10)).toEqual([]);
  });

  it('SETUP 171〜350 × 1〜3 本: テンパイを作れる場面では BEST がテンパイを残す', () => {
    const violations: string[] = [];
    for (let remaining = 171; remaining <= MAX_SETUP_REMAINING; remaining += 1) {
      for (const darts of [1, 2, 3] as const) {
        if (!canReachTenpai(remaining, darts)) continue;
        const best = rankSetupRoutes(remaining, darts, { maxRoutes: 1 })[0];
        if (!isCheckoutable(best.leave, DARTS_PER_VISIT)) {
          violations.push(`${remaining}/${darts}: ${best.routeText} → ${best.leave}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('残り 1 本の第三投調整は、このふるいの対象外のまま', () => {
    // 外した時点でビジットが終わるので、1 本の場面では safe が成立しない。
    for (const testCase of THIRD_DART_ADJUST_CASES) {
      const best = rankSetupRoutes(testCase.remaining - 120, 1, { maxRoutes: 1 })[0];
      expect(best.darts[0].id).toBe(`S${testCase.documentedThirdDart}`);
      expect(best.leave).toBe(testCase.documentedLeave);
    }
  });

  it('BULL 関連の既存挙動を壊さない', () => {
    // BULL エリアは「同ナンバーのシングルへ落ちる」モデルの対象外のまま。
    expect(singleMissDartOf(requireDart('BULL'))).toBeNull();
    expect(singleMissDartOf(requireDart('SB'))).toBeNull();
    // S-BULL を使った資料どおりの調整は、これまでどおり成立する。
    for (const testCase of [...SBULL_CASES_A, ...SBULL_CASES_B]) {
      const evaluated = evaluateSetupRoute(
        testCase.remaining,
        DARTS_PER_VISIT,
        parseRoute([...testCase.darts]),
      );
      expect(evaluated).not.toBeNull();
      expect(evaluated!.leave).toBe(testCase.documentedLeave);
    }
  });
});
