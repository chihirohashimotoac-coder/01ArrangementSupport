import { describe, expect, it } from 'vitest';
import {
  STANDARD_ROUTES,
  getStandardRoute,
  type StandardRouteEntry,
} from './standardCheckoutRoutes';
import { EXCEL_STANDARD_ROWS } from './standardCheckoutRoutes.generated';
import { DERIVED_LOW_ROUTES } from './lowStandardRoutes';
import { BOGEY_NUMBERS } from './bogeyNumbers';
import {
  DARTS_PER_VISIT,
  MAX_CHECKOUT,
  isBogey,
  isLegalCheckoutRoute,
} from '../domain/checkoutRules';
import { isFinishingDart, routeTotal } from '../domain/dart';

/**
 * Excel 側の「OK」を信用せず、アプリ側でも全件を再計算する。
 * 1 件でも外れたらここで落ちる。
 */
function assertRouteIsLegal(entry: StandardRouteEntry, darts: StandardRouteEntry['darts']) {
  expect(routeTotal(darts), `LEFT=${entry.left} の合計`).toBe(entry.left);
  expect(isFinishingDart(darts[darts.length - 1]), `LEFT=${entry.left} の最終ダート`).toBe(true);
  expect(darts.length, `LEFT=${entry.left} の本数`).toBeLessThanOrEqual(DARTS_PER_VISIT);
  expect(isLegalCheckoutRoute(entry.left, darts, DARTS_PER_VISIT), `LEFT=${entry.left}`).toBe(true);
}

describe('Excel 由来の基準ルート（41〜170）', () => {
  it('123 件を読み込んでいる', () => {
    expect(EXCEL_STANDARD_ROWS).toHaveLength(123);
  });

  it('LEFT は 41〜170 で、欠けているのは Bogey Number だけ', () => {
    const lefts = new Set(EXCEL_STANDARD_ROWS.map((row) => row.left));
    const missing: number[] = [];
    for (let n = 41; n <= MAX_CHECKOUT; n += 1) if (!lefts.has(n)) missing.push(n);
    expect(missing).toEqual([...BOGEY_NUMBERS]);
  });

  it('全 123 件が合計・最終ダート・本数・途中Bustの検算を通る', () => {
    const failures: string[] = [];
    for (const entry of STANDARD_ROUTES) {
      if (entry.source !== 'excel-first-candidate') continue;
      if (routeTotal(entry.darts) !== entry.left) failures.push(`${entry.left}: 合計不一致`);
      if (!isFinishingDart(entry.darts[entry.darts.length - 1])) {
        failures.push(`${entry.left}: 最終ダートがダブル/BULLでない`);
      }
      if (!isLegalCheckoutRoute(entry.left, entry.darts, DARTS_PER_VISIT)) {
        failures.push(`${entry.left}: ルールに反する`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('第2〜第5候補は、成立する場合すべて指定のダブルで終わる', () => {
    const failures: string[] = [];
    for (const entry of STANDARD_ROUTES) {
      for (const alt of entry.alternatives) {
        if (alt.darts === null) continue;
        const last = alt.darts[alt.darts.length - 1];
        if (last.id !== alt.finish) {
          failures.push(`${entry.left} の ${alt.finish} 列が ${last.id} 終わり`);
        }
        if (routeTotal(alt.darts) !== entry.left) {
          failures.push(`${entry.left} の ${alt.finish} 列の合計が一致しない`);
        }
        if (!isLegalCheckoutRoute(entry.left, alt.darts, DARTS_PER_VISIT)) {
          failures.push(`${entry.left} の ${alt.finish} 列がルールに反する`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('「第1候補と同一」の行は、実際に第1候補と同じルートである', () => {
    for (const entry of STANDARD_ROUTES) {
      for (const alt of entry.alternatives) {
        if (!alt.sameAsStandard) continue;
        expect(alt.darts?.map((d) => d.id)).toEqual(entry.darts.map((d) => d.id));
      }
    }
  });

  it('「—」（不成立）の候補は、本当に 3 本以内で成立しない', () => {
    // 3 本以内でその Double 終わりが作れないことを、独立に総当たりで確認する。
    const failures: string[] = [];
    for (const entry of STANDARD_ROUTES) {
      for (const alt of entry.alternatives) {
        if (alt.darts !== null) continue;
        const finishScore = Number(alt.finish.slice(1)) * 2;
        if (existsRouteEndingWith(entry.left, finishScore)) {
          failures.push(`${entry.left} は ${alt.finish} 終わりが 3 本以内で成立する`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

/** 残り left を 3 本以内・指定得点のダブルで終わらせられるか総当たりで確認する。 */
function existsRouteEndingWith(left: number, finishScore: number): boolean {
  const rest = left - finishScore;
  if (rest === 0) return true;
  if (rest < 0) return false;
  const scores = new Set<number>();
  for (let n = 1; n <= 20; n += 1) {
    scores.add(n);
    scores.add(n * 2);
    scores.add(n * 3);
  }
  scores.add(25);
  scores.add(50);
  if (scores.has(rest)) return true;
  for (const a of scores) {
    if (scores.has(rest - a)) return true;
  }
  return false;
}

describe('導出した基準ルート（2〜40）', () => {
  it('2〜40 をすべて網羅する', () => {
    expect(DERIVED_LOW_ROUTES.map((r) => r.left)).toEqual(
      Array.from({ length: 39 }, (_, i) => i + 2),
    );
  });

  it('すべて合法な Double Out ルートである', () => {
    for (const entry of STANDARD_ROUTES) {
      if (entry.source !== 'derived-rule-v1') continue;
      assertRouteIsLegal(entry, entry.darts);
    }
  });

  it('レビュー待ちであることが記録されている', () => {
    for (const entry of STANDARD_ROUTES) {
      if (entry.left > 40) continue;
      expect(entry.source).toBe('derived-rule-v1');
      expect(entry.reviewStatus).toBe('pending-human-review');
    }
  });

  it('偶数はダブル 1 本、奇数はシングル + ダブルの 2 本', () => {
    for (const row of DERIVED_LOW_ROUTES) {
      if (row.left % 2 === 0) {
        expect(row.darts, `${row.left}`).toEqual([`D${row.left / 2}`]);
      } else {
        expect(row.darts.length, `${row.left}`).toBe(2);
        expect(row.darts[0].startsWith('S'), `${row.left}`).toBe(true);
      }
    }
  });

  it('導出結果が期待するスナップショットと一致する（ルール変更の検知）', () => {
    const odd = DERIVED_LOW_ROUTES.filter((r) => r.left % 2 === 1).map(
      (r) => `${r.left}: ${r.darts.join(' + ')}`,
    );
    expect(odd).toEqual([
      '3: S1 + D1',
      '5: S1 + D2',
      '7: S3 + D2',
      '9: S1 + D4',
      '11: S3 + D4',
      '13: S5 + D4',
      '15: S7 + D4',
      '17: S1 + D8',
      '19: S3 + D8',
      '21: S5 + D8',
      '23: S7 + D8',
      '25: S9 + D8',
      '27: S11 + D8',
      '29: S13 + D8',
      '31: S15 + D8',
      '33: S1 + D16',
      '35: S3 + D16',
      '37: S5 + D16',
      '39: S7 + D16',
    ]);
  });
});

describe('統合アクセサ', () => {
  it('2〜170 のうち Bogey 以外すべてに基準ルートがある', () => {
    const missing: number[] = [];
    for (let n = 2; n <= MAX_CHECKOUT; n += 1) {
      if (isBogey(n)) continue;
      if (getStandardRoute(n) === null) missing.push(n);
    }
    expect(missing).toEqual([]);
  });

  it('Bogey には基準ルートが存在しない', () => {
    for (const n of BOGEY_NUMBERS) expect(getStandardRoute(n)).toBeNull();
  });

  it('添付資料の代表ケースが Excel の第1候補と一致する', () => {
    expect(getStandardRoute(103)?.darts.map((d) => d.id)).toEqual(['T19', 'S6', 'D20']);
    expect(getStandardRoute(122)?.darts.map((d) => d.id)).toEqual(['T18', 'S18', 'BULL']);
    expect(getStandardRoute(170)?.darts.map((d) => d.id)).toEqual(['T20', 'T20', 'BULL']);
    expect(getStandardRoute(167)?.darts.map((d) => d.id)).toEqual(['T20', 'T19', 'BULL']);
    expect(getStandardRoute(164)?.darts.map((d) => d.id)).toEqual(['T20', 'T18', 'BULL']);
    expect(getStandardRoute(161)?.darts.map((d) => d.id)).toEqual(['T20', 'T17', 'BULL']);
    expect(getStandardRoute(160)?.darts.map((d) => d.id)).toEqual(['T20', 'T20', 'D20']);
    expect(getStandardRoute(46)?.darts.map((d) => d.id)).toEqual(['S6', 'D20']);
    expect(getStandardRoute(61)?.darts.map((d) => d.id)).toEqual(['T15', 'D8']);
    expect(getStandardRoute(99)?.darts.map((d) => d.id)).toEqual(['T19', 'S10', 'D16']);
  });
});
