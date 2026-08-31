import { describe, expect, it } from 'vitest';
import { evaluateCheckoutRoute, rankCheckoutRoutes } from './checkoutRanking';
import { parseRoute } from '../../domain/dart';
import { MAX_CHECKOUT, isBogey, isCheckoutable } from '../../domain/checkoutRules';
import { getStandardRoute } from '../../data/standardCheckoutRoutes';

function codesOf(remaining: number, darts: readonly string[], available = 3) {
  const route = evaluateCheckoutRoute(remaining, available, parseRoute([...darts]));
  expect(route, `${remaining}: ${darts.join('-')}`).not.toBeNull();
  return route!.reasons.map((reason) => reason.code);
}

describe('基準ルートの扱い', () => {
  it('2〜170 のすべてで、基準ルートが第 1 候補として並ぶ', () => {
    const failures: string[] = [];
    for (let left = 2; left <= MAX_CHECKOUT; left += 1) {
      const standard = getStandardRoute(left);
      if (!standard) continue;
      const ranked = rankCheckoutRoutes(left, 3);
      if (ranked.length === 0 || !ranked[0].isStandard) {
        failures.push(`${left}: 先頭が ${ranked[0]?.routeText ?? 'なし'}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('基準ルートは常に S ランク', () => {
    for (let left = 2; left <= MAX_CHECKOUT; left += 1) {
      if (!getStandardRoute(left)) continue;
      const ranked = rankCheckoutRoutes(left, 3);
      expect(ranked[0].grade, `${left}`).toBe('S');
    }
  });

  it('数学的に成立するルートは、最低でも C ランクが付く（不正解にしない）', () => {
    const ranked = rankCheckoutRoutes(103, 3);
    expect(ranked.length).toBeGreaterThan(100);
    for (const route of ranked) {
      expect(['S', 'A', 'B', 'C']).toContain(route.grade);
    }
  });

  it('Bogey ではルートが 0 件', () => {
    expect(rankCheckoutRoutes(169, 3)).toEqual([]);
  });
});

/**
 * 添付資料の中心的な戦術ケース。
 * T18 始動と T20 始動の差を、engine が理由コードとして説明できることを検証する。
 */
describe('122 の回帰テスト', () => {
  it('基準ルートは T18 → S18 → BULL', () => {
    expect(getStandardRoute(122)?.darts.map((d) => d.id)).toEqual(['T18', 'S18', 'BULL']);
  });

  it('T18 を狙って S18 に落ちると 104 が残り、残り 2 本で上がれる', () => {
    const leave = 122 - 18;
    expect(leave).toBe(104);
    expect(isCheckoutable(leave, 2)).toBe(true);
  });

  it('T20 を狙って S20 に落ちると 102 が残り、残り 2 本では上がれない', () => {
    const leave = 122 - 20;
    expect(leave).toBe(102);
    expect(isCheckoutable(leave, 2)).toBe(false);
  });

  it('T18 始動には SINGLE_MISS_SAFE が付く', () => {
    expect(codesOf(122, ['T18', 'S18', 'BULL'])).toContain('SINGLE_MISS_SAFE');
  });

  it('T20 始動には SINGLE_MISS_LOSES_CHECKOUT が付く', () => {
    const codes = codesOf(122, ['T20', 'T14', 'D10']);
    expect(codes).toContain('SINGLE_MISS_LOSES_CHECKOUT');
    expect(codes).not.toContain('SINGLE_MISS_SAFE');
  });

  it('T20 始動には「より安全な開始がある」が付く', () => {
    expect(codesOf(122, ['T20', 'T14', 'D10'])).toContain('SAFER_START_EXISTS');
  });

  it('T18 始動が T20 始動より高く評価される', () => {
    const t18 = evaluateCheckoutRoute(122, 3, parseRoute(['T18', 'S18', 'BULL']))!;
    const t20 = evaluateCheckoutRoute(122, 3, parseRoute(['T20', 'T14', 'D10']))!;
    expect(t18.score).toBeGreaterThan(t20.score);
    expect(t18.tacticalScore).toBeGreaterThan(t20.tacticalScore);
  });

  it('T18 始動の説明文に「104」と「残り 2 本」が含まれる', () => {
    const route = evaluateCheckoutRoute(122, 3, parseRoute(['T18', 'S18', 'BULL']))!;
    const reason = route.reasons.find((r) => r.code === 'SINGLE_MISS_SAFE')!;
    expect(reason.summary).toContain('104');
    expect(reason.detail).toContain('2 本');
  });
});

describe('46 の盤面隣接テスト', () => {
  it('S6 開始は隣の S10 へ横ズレしても 36 残りで D18 が成立する', () => {
    expect(46 - 10).toBe(36);
    expect(isCheckoutable(36, 2)).toBe(true);
  });

  it('S6 → D20 に NEIGHBOR_SAFE が付き、説明に S10 と 36 が現れる', () => {
    const route = evaluateCheckoutRoute(46, 3, parseRoute(['S6', 'D20']))!;
    const codes = route.reasons.map((r) => r.code);
    expect(codes).toContain('NEIGHBOR_SAFE');
    const reason = route.reasons.find((r) => r.code === 'NEIGHBOR_SAFE')!;
    expect(reason.detail).toContain('S10');
    expect(reason.detail).toContain('36');
  });
});

describe('その他の固定ケース', () => {
  it.each([41, 43, 46, 50, 61, 99, 103, 122, 160, 161, 164, 167, 170])(
    '%i は基準ルートが存在し、先頭に並ぶ',
    (left) => {
      const ranked = rankCheckoutRoutes(left, 3);
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0].isStandard).toBe(true);
      expect(isBogey(left)).toBe(false);
    },
  );

  it('40 は D20 の 1 本上がりが最上位で、FINISH_IN_ONE が付く', () => {
    const ranked = rankCheckoutRoutes(40, 3);
    expect(ranked[0].routeText).toBe('D20');
    expect(ranked[0].reasons.map((r) => r.code)).toContain('FINISH_IN_ONE');
  });

  it('繋ぎでダブルを狙うルートには NON_FINAL_DOUBLE が付く', () => {
    expect(codesOf(46, ['D11', 'D12'])).toContain('NON_FINAL_DOUBLE');
  });

  it('トリプル不要な場面では UNNECESSARY_TRIPLE が付く', () => {
    expect(codesOf(46, ['T10', 'D8'])).toContain('UNNECESSARY_TRIPLE');
  });

  it('BULL を含むルートには BULL_REQUIRED が付く', () => {
    expect(codesOf(170, ['T20', 'T20', 'BULL'])).toContain('BULL_REQUIRED');
  });

  it('奇数ダブル上がりには WEAK_DOUBLE が付く', () => {
    expect(codesOf(95, ['T19', 'D19'])).toContain('WEAK_DOUBLE');
  });
});

describe('MY ROUTE（得意ダブル）', () => {
  it('得意ダブルを設定すると、そのダブル終わりが上位へ来る', () => {
    const ranked = rankCheckoutRoutes(103, 3, {
      preferredDoubles: ['D16'],
      applyStandardBonus: false,
    });
    expect(ranked[0].darts[ranked[0].darts.length - 1].id).toBe('D16');
  });

  it('得意ダブルの設定は STANDARD の並びを変えない', () => {
    const standardRanking = rankCheckoutRoutes(103, 3);
    expect(standardRanking[0].isStandard).toBe(true);
    expect(standardRanking[0].routeText).toBe('T19 → S6 → D20');
  });

  it('得意ダブルには USER_DOUBLE_PREFERENCE が付く', () => {
    const route = evaluateCheckoutRoute(103, 3, parseRoute(['T20', 'S11', 'D16']), {
      preferredDoubles: ['D16'],
      applyStandardBonus: false,
    })!;
    expect(route.reasons.map((r) => r.code)).toContain('USER_DOUBLE_PREFERENCE');
  });

  it('BULL も得意ターゲットとして指定できる', () => {
    const ranked = rankCheckoutRoutes(110, 2, {
      preferredDoubles: ['BULL'],
      applyStandardBonus: false,
    });
    expect(ranked[0].darts[ranked[0].darts.length - 1].id).toBe('BULL');
  });
});
