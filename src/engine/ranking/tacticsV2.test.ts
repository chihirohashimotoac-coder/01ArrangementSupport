/**
 * 戦術 v2（2026-11-01 オーナー承認 / docs/APPROVALS.md A-27〜A-30）の CHECKOUT 回帰テスト。
 *
 * 全件走査は違反を配列に集め、最後に 1 回だけ assert する（CLAUDE.md §5）。
 */
import { describe, expect, it } from 'vitest';
import { parseRoute } from '../../domain/dart';
import { MAX_CHECKOUT } from '../../domain/checkoutRules';
import { getStandardRoute, getStandardRouteFor } from '../../data/standardCheckoutRoutes';
import { TWO_DART_STANDARD_ROUTES } from '../../data/twoDartStandardRoutes';
import { evaluateCheckoutRoute, rankCheckoutRoutes, selectMyRoute } from './checkoutRanking';

const codesOf = (remaining: number, darts: number, route: readonly string[]) =>
  evaluateCheckoutRoute(remaining, darts, parseRoute([...route]))!.reasons.map((reason) => reason.code);

describe('1-1 L-H1: BULL 始動の外れ（BULL → S-BULL）', () => {
  it.each([
    [100, 2, ['BULL', 'BULL']],
    [136, 3, ['BULL', 'BULL', 'D18']],
    [90, 2, ['BULL', 'D20']],
  ] as const)('%i / %i 本の %j は S-BULL へ外れると上がれないことを減点する', (remaining, darts, route) => {
    expect(codesOf(remaining, darts, route)).toContain('SINGLE_MISS_LOSES_CHECKOUT');
  });

  it('100 / 2 本の BULL → BULL は S ではなくなる（基準ルート T20 → D20 より戦術評価が低い）', () => {
    const route = evaluateCheckoutRoute(100, 2, parseRoute(['BULL', 'BULL']))!;
    expect(route.grade).not.toBe('S');
  });

  it('S-BULL へ外れても上がれる BULL 始動は SINGLE_MISS_SAFE（50 / 3 本の BULL → 25 / 2 本）', () => {
    expect(codesOf(50, 3, ['BULL'])).toContain('SINGLE_MISS_SAFE');
  });
});

describe('1-2 L-H2: ダブル→ダブルを「トリプル不要」の代替に数えない', () => {
  it('80 / 2 本の T20 → D10 に UNNECESSARY_TRIPLE を付けない（代替は D20 → D20 だけ）', () => {
    expect(codesOf(80, 2, ['T20', 'D10'])).not.toContain('UNNECESSARY_TRIPLE');
  });

  it('2〜170 × 1〜3 本で、基準ルートに UNNECESSARY_TRIPLE が付く状態は 0', () => {
    const violations: string[] = [];
    for (let remaining = 2; remaining <= MAX_CHECKOUT; remaining += 1) {
      for (let darts = 1; darts <= 3; darts += 1) {
        const standard = rankCheckoutRoutes(remaining, darts).find((route) => route.isStandard);
        if (standard?.reasons.some((reason) => reason.code === 'UNNECESSARY_TRIPLE')) {
          violations.push(`${remaining}/${darts}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('1-4 L-M1: MY ROUTE と「本数を使う繋ぎのシングル」', () => {
  it('81 / 3 本の S1 → T16 → D16 には SAFE_SINGLE_START を付けず、SPENDS_EXTRA_DART で減点する', () => {
    const codes = codesOf(81, 3, ['S1', 'T16', 'D16']);
    expect(codes).toContain('SPENDS_EXTRA_DART');
    expect(codes).not.toContain('SAFE_SINGLE_START');
  });

  it('50 の基準ルート S18 → D16 は対象外（1 本で上がるには BULL が要る）', () => {
    expect(codesOf(50, 2, ['S18', 'D16'])).not.toContain('SPENDS_EXTRA_DART');
  });

  it.each([
    [81, 3, ['D16', 'D20'], 'T15-D18'],
    [80, 2, ['D20'], 'T16-D16'],
    [72, 2, ['D20'], 'T12-D18'],
  ] as const)('%i / %i 本・得意 %j の MY ROUTE は %s（ダブル→ダブル・繋ぎのシングルにしない）', (remaining, darts, preferred, key) => {
    expect(selectMyRoute(remaining, darts, preferred)?.key).toBe(key);
  });

  /*
   * 代表の設定（D20）だけを全件で見る。15 通りの設定での全件確認は重いので
   * `npm run audit:tactics-v2`（scripts 側）で行う。
   */
  it('得意ダブル D20 で、MY ROUTE の最上位は通常評価で C にならない', { timeout: 20_000 }, () => {
    const settings = [['D20']];
    const violations: string[] = [];
    for (const preferred of settings) {
      for (let remaining = 2; remaining <= MAX_CHECKOUT; remaining += 1) {
        for (let darts = 1; darts <= 3; darts += 1) {
          const mine = selectMyRoute(remaining, darts, preferred);
          if (mine === null) continue;
          const normal = rankCheckoutRoutes(remaining, darts).find((route) => route.key === mine.key);
          const hasNonFinalDouble = mine.reasons.some((reason) => reason.code === 'NON_FINAL_DOUBLE');
          if (normal?.grade === 'C' || hasNonFinalDouble) {
            violations.push(`${preferred.join('/')} ${remaining}/${darts} ${mine.key}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('1-5: 残り 2 本の 51〜70 の基準ルート', () => {
  it('導出規則は 51〜60 が S(残り−40) → D20、61〜70 が S(残り−50) → D-BULL', () => {
    expect(TWO_DART_STANDARD_ROUTES.find((row) => row.left === 51)?.darts).toEqual(['S11', 'D20']);
    expect(TWO_DART_STANDARD_ROUTES.find((row) => row.left === 60)?.darts).toEqual(['S20', 'D20']);
    expect(TWO_DART_STANDARD_ROUTES.find((row) => row.left === 61)?.darts).toEqual(['S11', 'BULL']);
    expect(TWO_DART_STANDARD_ROUTES.find((row) => row.left === 70)?.darts).toEqual(['S20', 'BULL']);
  });

  it('残り 2 本の 51〜70 では、その基準ルートが第 1 候補', () => {
    const violations: string[] = [];
    for (let remaining = 51; remaining <= 70; remaining += 1) {
      const expected = getStandardRouteFor(remaining, 2)!.darts.map((dart) => dart.id).join('-');
      const top = rankCheckoutRoutes(remaining, 2)[0];
      if (top.key !== expected || !top.isStandard) violations.push(`${remaining}: ${top.key}`);
    }
    expect(violations).toEqual([]);
  });

  it('残り 3 本・1 本では Excel / 2〜40 の基準ルートのまま（getStandardRoute は無変更）', () => {
    expect(getStandardRouteFor(61, 3)?.darts.map((dart) => dart.id)).toEqual(['T15', 'D8']);
    expect(getStandardRoute(61)?.darts.map((dart) => dart.id)).toEqual(['T15', 'D8']);
    expect(rankCheckoutRoutes(61, 3)[0].key).toBe('T15-D8');
    expect(rankCheckoutRoutes(52, 3)[0].key).toBe('S20-D16');
  });
});

describe('1-8 L-M2: C には必ず否定理由がある', () => {
  it('2〜170 × 1〜3 本の全ルートで、C に否定理由が 1 つ以上ある', () => {
    const violations: string[] = [];
    let cCount = 0;
    for (let remaining = 2; remaining <= MAX_CHECKOUT; remaining += 1) {
      for (let darts = 1; darts <= 3; darts += 1) {
        for (const route of rankCheckoutRoutes(remaining, darts)) {
          if (route.grade !== 'C') continue;
          cCount += 1;
          if (!route.reasons.some((reason) => reason.polarity === 'negative')) {
            violations.push(`${remaining}/${darts} ${route.key}`);
          }
        }
      }
    }
    expect(cCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('40 / 3 本の S8 → D16 は「最上位のルートより評価が低い」を示す', () => {
    const route = evaluateCheckoutRoute(40, 3, parseRoute(['S8', 'D16']))!;
    expect(route.grade).toBe('C');
    const reason = route.reasons.find((item) => item.code === 'BELOW_TOP_ROUTE')
      ?? route.reasons.find((item) => item.polarity === 'negative');
    expect(reason).toBeDefined();
  });
});

describe('1-10: 外れてちょうど上がる場合は上がりとして扱う', () => {
  it('40 / 2 本の D5 → D15 は、隣の D20 へ外れると 0 で上がりなので NEIGHBOR_SAFE を外さない', () => {
    expect(codesOf(40, 2, ['D5', 'D15'])).toContain('NEIGHBOR_SAFE');
  });
});
