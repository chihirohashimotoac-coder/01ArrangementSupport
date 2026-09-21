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

/*
 * 動画「アレンジディスカッション#1」の CHECKOUT ケースの Golden test。
 * 出典: https://www.youtube.com/watch?v=687FgfVnINs
 * 経緯は docs/VIDEO_ARRANGEMENT_DISCUSSION_01.md に記録してある。
 *
 * 61 / 2 本の基準ルートは **変更しない**。
 * 動画は T11 → D14（S11 でも BULL が残る）を推すが、41〜170 の基準ルートは
 * 添付 Excel の第1候補を Source of Truth とする人間承認済みの仕様であり
 * （docs/CHECKOUT_DATA_POLICY.md §1 / docs/APPROVALS.md）、
 * ここで engine が T11 を主表示へ繰り上げてはいけない。
 * その代わり、T11 → D14 が安全な代替として実在し、engine 自身が
 * T15 → D8 の弱点を理由コードで説明できていることを固定する。
 */
describe('動画ケース: 121 からのチェックアウト', () => {
  it('V-121-1: 121 の基準ルートは T20 → S11 → BULL のまま', () => {
    expect(getStandardRoute(121)?.darts.map((d) => d.id)).toEqual(['T20', 'S11', 'BULL']);
    const ranked = rankCheckoutRoutes(121, 3);
    expect(ranked[0].routeText).toBe('T20 → S11 → BULL');
    expect(ranked[0].isStandard).toBe(true);
  });

  it('V-121-1: T20 始動は S20 へ落ちても 101 / 2 本でまだ上がれる', () => {
    expect(121 - 20).toBe(101);
    expect(isCheckoutable(101, 2)).toBe(true);
    expect(codesOf(121, ['T20', 'S11', 'BULL'])).toContain('SINGLE_MISS_SAFE');
  });

  it('V-121-2: 動画の T20 → T11 → D14 も合法で、第一ターゲットは安全と評価される', () => {
    const route = evaluateCheckoutRoute(121, 3, parseRoute(['T20', 'T11', 'D14']))!;
    expect(route.darts.map((d) => d.id)).toEqual(['T20', 'T11', 'D14']);
    expect(route.reasons.map((r) => r.code)).toContain('SINGLE_MISS_SAFE');
    // 候補一覧に実在する（選べば実戦入力で追従できる）。
    expect(rankCheckoutRoutes(121, 3).some((r) => r.key === 'T20-T11-D14')).toBe(true);
  });

  it('V-101-1: S20 へ落ちた 101 / 2 本では T17 → BULL が第 1 候補', () => {
    const ranked = rankCheckoutRoutes(101, 2);
    expect(ranked[0].routeText).toBe('T17 → BULL');
  });

  it('V-61-1: 61 / 2 本の基準ルートは T15 → D8 のまま（動画へ寄せない）', () => {
    const ranked = rankCheckoutRoutes(61, 2);
    expect(ranked[0].routeText).toBe('T15 → D8');
    expect(ranked[0].isStandard).toBe(true);
    expect(getStandardRoute(61)?.darts.map((d) => d.id)).toEqual(['T15', 'D8']);
  });

  it('V-61-1: T11 → D14 は最上位の OTHER ROUTE として実在し、安全と評価される', () => {
    const others = rankCheckoutRoutes(61, 2).filter((route) => !route.isStandard);
    expect(others[0].routeText).toBe('T11 → D14');

    const t11 = evaluateCheckoutRoute(61, 2, parseRoute(['T11', 'D14']))!;
    const t15 = evaluateCheckoutRoute(61, 2, parseRoute(['T15', 'D8']))!;
    expect(t11.reasons.map((r) => r.code)).toContain('SINGLE_MISS_SAFE');
    expect(t15.reasons.map((r) => r.code)).toContain('SINGLE_MISS_LOSES_CHECKOUT');
    expect(t15.reasons.map((r) => r.code)).toContain('SAFER_START_EXISTS');

    /*
     * 戦術評価（基準ルート加点を除いた tacticalScore）では T11 が上。
     * それでも主表示は STANDARD のまま、というのが現行の製品方針。
     * 主表示を入れ替えるには別 RFC と人間の承認が必要
     * （docs/VIDEO_ARRANGEMENT_DISCUSSION_01.md §5）。
     */
    expect(t11.tacticalScore).toBeGreaterThan(t15.tacticalScore);
    expect(t15.score).toBeGreaterThan(t11.score);
  });

  it('V-61-1: 動画の算術どおり、S11 でも BULL が残り、S15 では上がれない', () => {
    expect(61 - 33).toBe(28);
    expect(rankCheckoutRoutes(28, 1)[0].routeText).toBe('D14');
    // T11 が S11 へ落ちても 50 が残り、BULL の 1 本上がりが生きている。
    expect(61 - 11).toBe(50);
    expect(rankCheckoutRoutes(50, 1)[0].routeText).toBe('BULL');
    // T15 が S15 へ落ちると 46 / 1 本で、もう上がれない。
    expect(61 - 15).toBe(46);
    expect(isCheckoutable(46, 1)).toBe(false);
  });
});
