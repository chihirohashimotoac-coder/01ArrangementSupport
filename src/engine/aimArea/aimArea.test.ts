import { describe, expect, it } from 'vitest';
import { AIM_AREAS } from '../../data/aimAreas';
import {
  aimAreaCautionJa,
  aimAreaLeadJa,
  aimAreaNotesJa,
  aimAreaTitleJa,
  aimLandingOutcomeJa,
} from '../../data/aimAreaExplanations';
import { neighborsOf } from '../../data/boardAdjacency';
import { BOGEY_NUMBERS } from '../../data/bogeyNumbers';
import { getStandardRoute } from '../../data/standardCheckoutRoutes';
import { BOARD_NUMBERS } from '../../domain/boardNumbers';
import {
  MAX_CHECKOUT,
  isBogey,
  isCheckoutable,
  isLegalCheckoutRoute,
} from '../../domain/checkoutRules';
import {
  DOUBLE_DARTS,
  FINISHING_DARTS,
  SINGLE_DARTS,
  TRIPLE_DARTS,
  requireDart,
} from '../../domain/dart';
import { rankCheckoutRoutes } from '../ranking/checkoutRanking';
import { createVisit, recordThrow } from '../recovery/visit';
import { analyzeAimArea, classifyLanding, isClockwiseRun, type AimLanding } from './aimArea';

/** 期待値。Bust は 'BUST'、それ以外は [残り, 分類, 上がりのダート or null]。 */
type Expect = 'BUST' | readonly [number, AimLanding['kind'], string | null];

/**
 * 42 / 46 / 48 / 39 のエリア内 30 着弾（S / T / D）を、手で計算した値で固定する。
 * 開始 3 本（着弾後 2 本）と開始 2 本（着弾後 1 本）の 2 状態。
 */
const FIXED: Readonly<Record<number, Readonly<Record<string, { three: Expect; two: Expect }>>>> = {
  42: {
    S6: { three: [36, 'finish-next-dart', 'D18'], two: [36, 'finish-next-dart', 'D18'] },
    T6: { three: [24, 'finish-next-dart', 'D12'], two: [24, 'finish-next-dart', 'D12'] },
    D6: { three: [30, 'finish-next-dart', 'D15'], two: [30, 'finish-next-dart', 'D15'] },
    S10: { three: [32, 'finish-next-dart', 'D16'], two: [32, 'finish-next-dart', 'D16'] },
    T10: { three: [12, 'finish-next-dart', 'D6'], two: [12, 'finish-next-dart', 'D6'] },
    D10: { three: [22, 'finish-next-dart', 'D11'], two: [22, 'finish-next-dart', 'D11'] },
  },
  46: {
    S6: { three: [40, 'finish-next-dart', 'D20'], two: [40, 'finish-next-dart', 'D20'] },
    T6: { three: [28, 'finish-next-dart', 'D14'], two: [28, 'finish-next-dart', 'D14'] },
    D6: { three: [34, 'finish-next-dart', 'D17'], two: [34, 'finish-next-dart', 'D17'] },
    S10: { three: [36, 'finish-next-dart', 'D18'], two: [36, 'finish-next-dart', 'D18'] },
    T10: { three: [16, 'finish-next-dart', 'D8'], two: [16, 'finish-next-dart', 'D8'] },
    D10: { three: [26, 'finish-next-dart', 'D13'], two: [26, 'finish-next-dart', 'D13'] },
  },
  48: {
    S8: { three: [40, 'finish-next-dart', 'D20'], two: [40, 'finish-next-dart', 'D20'] },
    T8: { three: [24, 'finish-next-dart', 'D12'], two: [24, 'finish-next-dart', 'D12'] },
    D8: { three: [32, 'finish-next-dart', 'D16'], two: [32, 'finish-next-dart', 'D16'] },
    S16: { three: [32, 'finish-next-dart', 'D16'], two: [32, 'finish-next-dart', 'D16'] },
    T16: { three: 'BUST', two: 'BUST' },
    D16: { three: [16, 'finish-next-dart', 'D8'], two: [16, 'finish-next-dart', 'D8'] },
  },
  39: {
    S7: { three: [32, 'finish-next-dart', 'D16'], two: [32, 'finish-next-dart', 'D16'] },
    T7: { three: [18, 'finish-next-dart', 'D9'], two: [18, 'finish-next-dart', 'D9'] },
    D7: { three: [25, 'finish-in-two', null], two: [25, 'next-visit', null] },
    S19: { three: [20, 'finish-next-dart', 'D10'], two: [20, 'finish-next-dart', 'D10'] },
    T19: { three: 'BUST', two: 'BUST' },
    D19: { three: 'BUST', two: 'BUST' },
    S3: { three: [36, 'finish-next-dart', 'D18'], two: [36, 'finish-next-dart', 'D18'] },
    T3: { three: [30, 'finish-next-dart', 'D15'], two: [30, 'finish-next-dart', 'D15'] },
    D3: { three: [33, 'finish-in-two', null], two: [33, 'next-visit', null] },
    S17: { three: [22, 'finish-next-dart', 'D11'], two: [22, 'finish-next-dart', 'D11'] },
    T17: { three: 'BUST', two: 'BUST' },
    D17: { three: [5, 'finish-in-two', null], two: [5, 'next-visit', null] },
  },
};

function landingOf(left: number, dartsLeft: number, dartId: string): AimLanding {
  const analysis = analyzeAimArea(left, dartsLeft);
  const landing = analysis?.landings.find(
    (item) => item.dart.id === dartId && item.role !== 'outside',
  );
  if (!landing) throw new Error(`${left}/${dartsLeft} に ${dartId} がありません`);
  return landing;
}

function actualOf(landing: AimLanding): Expect {
  return landing.kind === 'bust' ? 'BUST' : [landing.leave!, landing.kind, landing.finishDartId];
}

describe('盤面の狙い方: データ定義', () => {
  it('対象は 42 / 46 / 48 / 39 / 43 の 5 点だけ', () => {
    expect(AIM_AREAS.map((area) => area.left)).toEqual([42, 46, 48, 39, 43]);
    for (const area of AIM_AREAS) {
      expect(area.targetRing).toBe('single');
      expect(area.scope).toBe('educational');
    }
  });

  it('エリアのナンバーは盤面上で時計回りに連続し、39 は盤面の順で 17 → 3 → 19 → 7', () => {
    for (const area of AIM_AREAS) {
      expect(isClockwiseRun(area.numbers), `${area.left}`).toBe(true);
    }
    expect(analyzeAimArea(39, 3)!.orderedNumbers).toEqual([17, 3, 19, 7]);
    expect(analyzeAimArea(39, 3)!.outsideNumbers).toEqual([2, 16]);
    expect(analyzeAimArea(48, 3)!.orderedNumbers).toEqual([16, 8]);
    expect(analyzeAimArea(48, 3)!.outsideNumbers).toEqual([7, 11]);
  });

  it('隣接は BOARD_NUMBERS から導かれ、20 組で環状に閉じる（20 と 1 も隣）', () => {
    const pairs = new Set<string>();
    for (const value of BOARD_NUMBERS) {
      const [, clockwise] = neighborsOf(value);
      pairs.add([value, clockwise].sort((a, b) => a - b).join('-'));
      expect(neighborsOf(clockwise)[0]).toBe(value);
    }
    expect(pairs.size).toBe(20);
    expect(pairs.has('1-20')).toBe(true);
  });

  it('基準ルートの 1 投目は、どの点でもエリアのシングル', () => {
    const expected: Record<number, string> = { 42: 'S10', 46: 'S6', 48: 'S16', 39: 'S7', 43: 'S3' };
    for (const area of AIM_AREAS) {
      const standard = getStandardRoute(area.left)!;
      expect(standard.darts[0].id).toBe(expected[area.left]);
      const marked = analyzeAimArea(area.left, 3)!.landings.filter((item) => item.isStandardFirstDart);
      expect(marked.map((item) => [item.dart.id, item.role])).toEqual([[expected[area.left], 'area']]);
    }
  });

  it('対象外の残り点では何も返さない', () => {
    const targets = new Set(AIM_AREAS.map((area) => area.left));
    const unexpected: string[] = [];
    for (let left = 2; left <= MAX_CHECKOUT; left += 1) {
      for (let darts = 1; darts <= 3; darts += 1) {
        const analysis = analyzeAimArea(left, darts);
        if ((analysis !== null) !== targets.has(left)) unexpected.push(`${left}/${darts}`);
      }
    }
    expect(unexpected).toEqual([]);
    expect(analyzeAimArea(42, 0)).toBeNull();
  });
});

describe('盤面の狙い方: 42 / 46 / 48 / 39 の固定 30 着弾', () => {
  it('開始 3 本・開始 2 本で、残り・上がり・Bust が手計算と一致する', () => {
    const mismatches: string[] = [];
    let count = 0;
    for (const [left, table] of Object.entries(FIXED)) {
      for (const [dartId, expected] of Object.entries(table)) {
        for (const [dartsLeft, want] of [
          [3, expected.three],
          [2, expected.two],
        ] as const) {
          count += 1;
          const got = actualOf(landingOf(Number(left), dartsLeft, dartId));
          if (JSON.stringify(got) !== JSON.stringify(want)) {
            mismatches.push(`${left}/${dartsLeft} ${dartId}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
          }
        }
      }
    }
    expect(count).toBe(60);
    expect(mismatches).toEqual([]);
  });

  it('エリアの一覧は各点の S / T / D をもれなく含む', () => {
    for (const [left, table] of Object.entries(FIXED)) {
      const ids = analyzeAimArea(Number(left), 3)!
        .landings.filter((item) => item.role !== 'outside')
        .map((item) => item.dart.id)
        .sort();
      expect(ids).toEqual(Object.keys(table).sort());
    }
  });

  it('48 の T16 は 0 点ちょうどでも最後がトリプルなので BUST', () => {
    for (const darts of [3, 2, 1]) {
      const t16 = landingOf(48, darts, 'T16');
      expect(t16.kind).toBe('bust');
      expect(t16.bustReason).toBe('NOT_DOUBLE_FINISH');
      expect(t16.leave).toBeNull();
      expect(analyzeAimArea(48, darts)!.bustDartIds).toEqual(['T16']);
    }
  });

  it('39 の T19 / T17 は超過、D19 は 1 残りで BUST', () => {
    expect(landingOf(39, 3, 'T19')).toMatchObject({ bustReason: 'BELOW_ZERO', difference: -18 });
    expect(landingOf(39, 3, 'T17')).toMatchObject({ bustReason: 'BELOW_ZERO', difference: -12 });
    expect(landingOf(39, 3, 'D19')).toMatchObject({ bustReason: 'LEFT_ONE', difference: 1 });
    // 盤面の順（17 → 3 → 19 → 7）に並ぶ。
    expect(analyzeAimArea(39, 3)!.bustDartIds).toEqual(['T17', 'T19', 'D19']);
  });

  it('39 の 17 は他のナンバーと同じ扱いで、S17 → 22 → D11、T17 は BUST という事実だけを持つ', () => {
    const analysis = analyzeAimArea(39, 3)!;
    const seventeen = analysis.landings.filter((item) => item.number === 17);
    expect(seventeen.map((item) => [item.dart.id, item.role, item.kind, item.leave, item.finishDartId])).toEqual([
      ['S17', 'area', 'finish-next-dart', 22, 'D11'],
      ['T17', 'area', 'bust', null, null],
      ['D17', 'area', 'finish-in-two', 5, null],
    ]);
    // エリア内は 1 つの区分だけ（主従の区分を持たない）。
    for (const area of AIM_AREAS) {
      const roles = new Set(analyzeAimArea(area.left, 3)!.landings.map((item) => item.role));
      expect([...roles].sort(), `${area.left}`).toEqual(['area', 'outside']);
    }
  });

  it('Bust したらビジット開始時の残りへ戻る（48 / T16、39 / T19・T17・D19）', () => {
    const cases: [number, string][] = [
      [48, 'T16'],
      [39, 'T19'],
      [39, 'T17'],
      [39, 'D19'],
    ];
    for (const [left, dartId] of cases) {
      const visit = recordThrow(createVisit(left), requireDart(dartId));
      expect(visit.status, `${left} ${dartId}`).toBe('bust');
      expect(visit.remaining, `${left} ${dartId}`).toBe(left);
    }
  });

  it('あと 2 本の例は、合法でその残りに一致する（39 の D7 → 25 は S9 → D8）', () => {
    expect(landingOf(39, 3, 'D7').exampleRouteIds).toEqual(['S9', 'D8']);
    expect(landingOf(39, 3, 'D3').exampleRouteIds).toEqual(['S1', 'D16']);
    expect(landingOf(39, 3, 'D17').exampleRouteIds).toEqual(['S1', 'D2']);
  });

  it('エリアのシングルは、開始 2・3 本ならすべて次の 1 本でダブルが残る', () => {
    for (const area of AIM_AREAS) {
      for (const darts of [3, 2]) {
        expect(analyzeAimArea(area.left, darts)!.areaSinglesFinishNextDart, `${area.left}/${darts}`).toBe(true);
      }
    }
  });
});

describe('盤面の狙い方: 43 と、エリアの外', () => {
  it('43 は S3 → D20、S19 → D12、S7 → D18、T19 は BUST', () => {
    expect(actualOf(landingOf(43, 3, 'S3'))).toEqual([40, 'finish-next-dart', 'D20']);
    expect(actualOf(landingOf(43, 3, 'S19'))).toEqual([24, 'finish-next-dart', 'D12']);
    expect(actualOf(landingOf(43, 3, 'S7'))).toEqual([36, 'finish-next-dart', 'D18']);
    expect(landingOf(43, 3, 'T19')).toMatchObject({ kind: 'bust', bustReason: 'BELOW_ZERO', difference: -14 });
    expect(analyzeAimArea(43, 3)!.bustDartIds).toEqual(['T19']);
  });

  it('42 の外の S13 / S15 は、開始 3 本でも次の 1 本では上がれない', () => {
    const outside = analyzeAimArea(42, 3)!.landings.filter((item) => item.role === 'outside');
    expect(outside.map((item) => [item.dart.id, item.leave, item.kind])).toEqual([
      ['S13', 29, 'finish-in-two'],
      ['S15', 27, 'finish-in-two'],
    ]);
  });
});

describe('盤面の狙い方: 残り 1 本', () => {
  it('どの対象点でも「今回の 3 投で上がる」扱いを出さない', () => {
    const offending: string[] = [];
    for (const area of AIM_AREAS) {
      const analysis = analyzeAimArea(area.left, 1)!;
      expect(analysis.canFinishThisVisit).toBe(false);
      expect(analysis.areaSinglesFinishNextDart).toBe(false);
      for (const landing of analysis.landings) {
        if (['checkout', 'finish-next-dart', 'finish-in-two'].includes(landing.kind)) {
          offending.push(`${area.left} ${landing.dart.id} ${landing.kind}`);
        }
      }
      expect(aimAreaNotesJa(analysis)).toEqual([]);
      expect(aimAreaLeadJa(analysis)).toMatch(/上がれません/);
      expect(aimAreaLeadJa(analysis)).toMatch(/NEXT VISIT/);
    }
    expect(offending).toEqual([]);
  });
});

describe('盤面の狙い方: 30,420 通りの第一着弾の不変条件', () => {
  it('2〜170 × 1〜3 本 × S / T / D 1〜20 のすべてでルールと矛盾しない', () => {
    const violations: string[] = [];
    const bogeyLeaves = new Set<number>();
    const finishIds = new Set(FINISHING_DARTS.map((dart) => dart.id));
    let count = 0;

    for (let left = 2; left <= MAX_CHECKOUT; left += 1) {
      for (let darts = 1; darts <= 3; darts += 1) {
        for (const dart of [...SINGLE_DARTS, ...TRIPLE_DARTS, ...DOUBLE_DARTS]) {
          count += 1;
          const got = classifyLanding(left, darts, dart);
          const diff = left - dart.score;
          const tag = `${left}/${darts} ${dart.id}`;
          const shouldBust = diff < 0 || diff === 1 || (diff === 0 && dart.kind !== 'double');

          if (got.difference !== diff) violations.push(`${tag}: difference`);
          if (got.dartsAfter !== darts - 1) violations.push(`${tag}: dartsAfter`);
          if ((got.kind === 'bust') !== shouldBust) violations.push(`${tag}: bust=${got.kind}`);
          if (got.kind === 'bust') {
            if (got.leave !== null) violations.push(`${tag}: bust leave`);
            continue;
          }
          if (got.leave !== diff) violations.push(`${tag}: leave`);
          const leave = diff;
          const after = darts - 1;

          switch (got.kind) {
            case 'checkout':
              if (leave !== 0 || dart.kind !== 'double') violations.push(`${tag}: checkout`);
              break;
            case 'finish-next-dart': {
              const finish = got.finishDartId ? requireDart(got.finishDartId) : null;
              if (after < 1 || !finish || !finishIds.has(finish.id) || finish.score !== leave) {
                violations.push(`${tag}: finish-next-dart ${got.finishDartId}`);
              }
              break;
            }
            case 'finish-in-two': {
              const route = (got.exampleRouteIds ?? []).map(requireDart);
              if (after !== 2 || isCheckoutable(leave, 1) || !isLegalCheckoutRoute(leave, route, 2)) {
                violations.push(`${tag}: finish-in-two ${got.exampleRouteIds}`);
              }
              break;
            }
            case 'next-visit':
              if (isCheckoutable(leave, after) || !isCheckoutable(leave, 3)) {
                violations.push(`${tag}: next-visit`);
              }
              break;
            case 'bogey':
              bogeyLeaves.add(leave);
              if (!isBogey(leave) || isCheckoutable(leave, after)) violations.push(`${tag}: bogey`);
              break;
            case 'above-range':
              if (leave <= MAX_CHECKOUT) violations.push(`${tag}: above-range`);
              break;
          }
          if (got.kind !== 'finish-next-dart' && got.finishDartId !== null) {
            violations.push(`${tag}: stray finish`);
          }
        }
      }
    }

    expect(count).toBe(30_420);
    expect(violations).toEqual([]);
    // 第一着弾で 170 を超える残りは生まれない。Bogey は 1 ビジットの Bogey 集合に含まれる。
    for (const leave of bogeyLeaves) expect(BOGEY_NUMBERS).toContain(leave);
  });
});

describe('盤面の狙い方: 表示文', () => {
  it('たたんだ状態の注意は、Bust する的があるときだけ', () => {
    expect(aimAreaCautionJa(analyzeAimArea(42, 3)!)).toBeNull();
    expect(aimAreaCautionJa(analyzeAimArea(46, 3)!)).toBeNull();
    expect(aimAreaCautionJa(analyzeAimArea(48, 3)!)).toBe(
      '注意：T16 に入ると BUST（0 点ちょうどでも最後がダブルではないため）',
    );
    expect(aimAreaCautionJa(analyzeAimArea(39, 3)!)).toBe('注意：T17・T19・D19 に入ると BUST');
    expect(aimAreaCautionJa(analyzeAimArea(43, 2)!)).toBe('注意：T19 に入ると BUST（点数を超えるため）');
  });

  it('見出しは盤面の順にナンバーを並べ、17 を別扱いしない', () => {
    expect(aimAreaTitleJa(analyzeAimArea(42, 3)!)).toBe('6・10 のシングル');
    expect(aimAreaTitleJa(analyzeAimArea(48, 3)!)).toBe('16・8 のシングル');
    expect(aimAreaTitleJa(analyzeAimArea(39, 3)!)).toBe('17・3・19・7 のシングル');
    expect(aimAreaTitleJa(analyzeAimArea(43, 3)!)).toBe('3・19・7 のシングル');
  });

  it('着弾ごとの結果の言い方', () => {
    expect(aimLandingOutcomeJa(landingOf(42, 3, 'S6'))).toBe('残り 36 → 次の 1 本で D18');
    expect(aimLandingOutcomeJa(landingOf(48, 3, 'T16'))).toBe('0 点ちょうど。最後がダブルではないので BUST');
    expect(aimLandingOutcomeJa(landingOf(39, 3, 'T19'))).toBe('残り点を 18 点超えるので BUST');
    expect(aimLandingOutcomeJa(landingOf(39, 3, 'T17'))).toBe('残り点を 12 点超えるので BUST');
    expect(aimLandingOutcomeJa(landingOf(43, 3, 'T19'))).toBe('残り点を 14 点超えるので BUST');
    expect(aimLandingOutcomeJa(landingOf(39, 3, 'D19'))).toBe('残り 1 で BUST');
    expect(aimLandingOutcomeJa(landingOf(39, 3, 'D7'))).toBe('残り 25 → あと 2 本（例 S9 → D8）');
    expect(aimLandingOutcomeJa(landingOf(39, 2, 'D7'))).toBe(
      '残り 25 → 残り 1 本では上がれない（次ラウンド向け）',
    );
    expect(aimLandingOutcomeJa(landingOf(39, 1, 'S7'))).toBe('残り 32（このビジットはここまで）');
  });

  it('補足は計算から組み立て、奇数ダブル・エリアの外を事実として伝える', () => {
    const notes42 = aimAreaNotesJa(analyzeAimArea(42, 3)!).join('\n');
    expect(notes42).toMatch(/D6 → D15/);
    expect(notes42).toMatch(/D10 → D11/);
    expect(notes42).toMatch(/S13 \/ S15/);
    expect(aimAreaNotesJa(analyzeAimArea(48, 3)!).join('\n')).not.toMatch(/奇数ダブル/);
    // 17 も他のナンバーと同じ基準で並ぶ（S17 → D11 は奇数ダブルの一つとして出る）。
    expect(aimAreaNotesJa(analyzeAimArea(39, 3)!)).toContain(
      'どれも上がりは残りますが、S17 → D11、T3 → D15、T7 → D9 は奇数ダブルが残ります。',
    );
  });

  it('確率・プロ使用・勝率や、未承認の推奨を断定しない', () => {
    // 承認されていない戦術判断（「勧める／勧めない」「同格」「条件付き」「基本／拡張」）も書かない。
    const banned = /プロ|高確率|勝率|%|必ず得|数学的に正しい|勧め|同格|条件付き|拡張|基本のエリア/;
    for (const area of AIM_AREAS) {
      for (const darts of [1, 2, 3]) {
        const analysis = analyzeAimArea(area.left, darts)!;
        const text = [
          aimAreaTitleJa(analysis),
          aimAreaCautionJa(analysis) ?? '',
          aimAreaLeadJa(analysis),
          ...aimAreaNotesJa(analysis),
          ...analysis.landings.map(aimLandingOutcomeJa),
        ].join('\n');
        expect(text, `${area.left}/${darts}`).not.toMatch(banned);
      }
    }
  });
});

describe('盤面の狙い方: 既存のランキングへ影響しない', () => {
  it('計算の前後で 42 / 46 / 48 / 39 / 43 の CHECKOUT 候補の並び・採点が変わらない', () => {
    const snapshot = () =>
      AIM_AREAS.flatMap((area) =>
        [1, 2, 3].map((darts) =>
          rankCheckoutRoutes(area.left, darts).map((route) => [
            route.key,
            route.score,
            route.grade,
            route.reasons.map((reason) => reason.code).join(','),
          ]),
        ),
      );
    const before = JSON.stringify(snapshot());
    for (const area of AIM_AREAS) for (const darts of [1, 2, 3]) analyzeAimArea(area.left, darts);
    expect(JSON.stringify(snapshot())).toBe(before);
  });
});
