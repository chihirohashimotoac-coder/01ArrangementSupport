/**
 * v1.3.2「CHECKOUT 不能時の NEXT VISIT 選択」の仕様テスト。
 *
 * ここで守りたいことは 4 つ。
 *   1. 119 / 2 本のような場面で、次ラウンド 1 投で上がれる残しを選ぶこと
 *   2. 得意ダブルのために、いま余計に難しいルートを選ばないこと
 *   3. 上がれる場面（CHECKOUT）と通常 SETUP の結果を 1 ミリも変えないこと
 *   4. 全 507 状態で候補が合法であること
 *
 * 全数走査は違反を配列へ集めて最後に 1 回だけ assert する（テスト方針どおり）。
 */
import { describe, expect, it } from 'vitest';
import {
  NEXT_VISIT_PRIORITY_LEAVES,
  buildNextVisitCandidates,
  compareNextVisitCandidates,
  nextVisitTierOf,
  selectNextVisitRoute,
} from './nextVisitSelection';
import { suggestFor } from './suggest';
import { rankCheckoutRoutes } from '../ranking/checkoutRanking';
import { rankSetupRoutes } from '../setup/enumerate';
import { difficultyOf, sequenceTable } from '../setup/sequences';
import {
  DARTS_PER_VISIT,
  MAX_CHECKOUT,
  MAX_SETUP_REMAINING,
  MIN_CHECKOUT,
  isCheckoutable,
  minDartsToCheckout,
} from '../../domain/checkoutRules';
import { THROWABLE_DARTS } from '../../domain/dart';

const DARTS_LEFT = [1, 2, 3] as const;
const SEGMENT_IDS = new Set(THROWABLE_DARTS.map((dart) => dart.id));

/** 監査に使う得意ダブルのプロファイル（既定値・未設定・順位違い）。 */
const PREFERENCE_PROFILES: readonly (readonly string[] | undefined)[] = [
  undefined,
  [],
  ['D16', 'D20'],
  ['D20', 'D16'],
  ['D8', 'D20', 'D16'],
  ['D16', 'D20', 'D8', 'D10', 'D18'],
];

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

describe('残しの優先度クラス（Tier）', () => {
  it('優先ダブル残しは 8〜40 の 9 種で、すべて 1 投で上がれる偶数', () => {
    expect(NEXT_VISIT_PRIORITY_LEAVES).toEqual([8, 12, 16, 20, 24, 28, 32, 36, 40]);
    const bad = NEXT_VISIT_PRIORITY_LEAVES.filter(
      (leave) => leave % 2 !== 0 || minDartsToCheckout(leave) !== 1,
    );
    expect(bad).toEqual([]);
  });

  it('2〜170 のすべての残りで、クラス分けが定義どおりになる', () => {
    const violations: string[] = [];
    for (let leave = MIN_CHECKOUT; leave <= MAX_CHECKOUT; leave += 1) {
      const tier = nextVisitTierOf(leave);
      const minDarts = minDartsToCheckout(leave);
      if (minDarts === null) {
        if (tier !== null) violations.push(`${leave}: ノーテンなのに tier=${tier}`);
        continue;
      }
      if (NEXT_VISIT_PRIORITY_LEAVES.includes(leave)) {
        if (tier !== 'A') violations.push(`${leave}: 優先ダブル残しが A ではない（${tier}）`);
        continue;
      }
      if (minDarts === 1 && leave !== 50) {
        if (tier !== 'B') violations.push(`${leave}: 1 投上がりが B ではない（${tier}）`);
        continue;
      }
      if (leave % 2 !== 0) {
        if (tier !== 'E') violations.push(`${leave}: 奇数残しが E ではない（${tier}）`);
        continue;
      }
      const expected = minDarts <= 2 ? 'C' : 'D';
      if (tier !== expected) violations.push(`${leave}: ${expected} のはずが ${tier}`);
    }
    expect(violations).toEqual([]);
  });

  it('BULL（50）は 1 投で上がれても A / B へは入れない', () => {
    expect(minDartsToCheckout(50)).toBe(1);
    expect(nextVisitTierOf(50)).toBe('C');
  });

  it('ノーテンと 170 超は候補クラスを持たない', () => {
    expect(nextVisitTierOf(169)).toBeNull();
    expect(nextVisitTierOf(159)).toBeNull();
    expect(nextVisitTierOf(1)).toBeNull();
    expect(nextVisitTierOf(171)).toBeNull();
  });
});

describe('候補生成（既存 sequenceTable の再利用）', () => {
  it('取得点ごとの表には、必ず最小難易度のシーケンスが残っている', () => {
    // セレクタの第 1 基準は「いま投げるルートの難易度」なので、
    // 既存表の枝刈りで最小難易度が落ちていないことを前提として固定する。
    const violations: string[] = [];
    for (const dartCount of DARTS_LEFT) {
      const table = sequenceTable(dartCount, 'T20');
      const trueMin = new Array<number>(61 * dartCount + 1).fill(Number.POSITIVE_INFINITY);
      const walk = (depth: number, total: number, difficulty: number): void => {
        if (depth === 0) {
          if (difficulty < trueMin[total]) trueMin[total] = difficulty;
          return;
        }
        for (const dart of THROWABLE_DARTS) {
          walk(depth - 1, total + dart.score, difficulty + difficultyOf(dart));
        }
      };
      walk(dartCount, 0, 0);

      for (let total = 0; total < table.length; total += 1) {
        if (table[total].length === 0) continue;
        const bucketMin = Math.min(
          ...table[total].map((entry) =>
            entry.darts.reduce((sum, dart) => sum + difficultyOf(dart), 0),
          ),
        );
        if (bucketMin !== trueMin[total]) {
          violations.push(`${dartCount}本 / 取得 ${total}: ${bucketMin} != ${trueMin[total]}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('候補は残り本数ちょうどで、MISS も Bust も 1 残しも含まない', () => {
    const violations: string[] = [];
    for (const state of ALL_STATES) {
      for (const candidate of buildNextVisitCandidates(state.remaining, state.dartsLeft)) {
        if (candidate.darts.length !== state.dartsLeft) {
          violations.push(`${at(state)}: 本数 ${candidate.darts.length}`);
          continue;
        }
        let left = state.remaining;
        for (const dart of candidate.darts) {
          if (!SEGMENT_IDS.has(dart.id)) violations.push(`${at(state)}: ${dart.id} は投げられない`);
          left -= dart.score;
          if (left < MIN_CHECKOUT) {
            violations.push(`${at(state)}: 途中で ${left} になる`);
            break;
          }
        }
        if (left !== candidate.leave) violations.push(`${at(state)}: 残りが一致しない`);
        if (nextVisitTierOf(candidate.leave) === null) {
          violations.push(`${at(state)}: 上がれない残りが候補に入っている`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('Case 1 / 2: 119 残り 2 本（実機で見つかった事故）', () => {
  it('T20 → S19 を選び、40 残し（次ラウンド 1 投）を作る', () => {
    const suggestion = suggestFor(119, 2);
    expect(suggestion.mode).toBe('checkout');
    expect(suggestion.checkoutRoutes).toEqual([]);

    const route = suggestion.nextVisitRoute;
    expect(route).not.toBeNull();
    expect(route!.routeText).toBe('T20 → S19');
    expect(route!.scored).toBe(79);
    expect(route!.leave).toBe(40);
    expect(minDartsToCheckout(route!.leave)).toBe(1);
  });

  it('39 残し（T20 → S20）より上位である', () => {
    const candidates = buildNextVisitCandidates(119, 2);
    const better = candidates.find((c) => c.key === 'T20-S19');
    const worse = candidates.find((c) => c.key === 'T20-S20');
    expect(better?.leave).toBe(40);
    expect(worse?.leave).toBe(39);
    expect(compareNextVisitCandidates(better!, worse!)).toBeLessThan(0);
    // 39 は次ラウンド最低 2 投、40 は 1 投。
    expect(minDartsToCheckout(39)).toBe(2);
    expect(minDartsToCheckout(40)).toBe(1);
  });

  it('D16 が第 1 希望でも、トリプル 2 本の 32 残しを選ばない', () => {
    for (const preferred of [['D16'], ['D16', 'D20'], ['D16', 'D8', 'D20']]) {
      const route = selectNextVisitRoute(119, 2, { fallbackPreferredDoubles: preferred });
      expect(route!.routeText).toBe('T20 → S19');
      expect(route!.leave).toBe(40);
    }

    // 119 から 32 を残すにはトリプル 2 本が要る（T19 → T10 など）。
    // 得意ダブルは、その難易度差を覆さない。
    const candidates = buildNextVisitCandidates(119, 2, { fallbackPreferredDoubles: ['D16'] });
    const easy = candidates.find((c) => c.key === 'T20-S19')!;
    const toThirtyTwo = candidates.filter((c) => c.leave === 32);
    expect(toThirtyTwo.length).toBeGreaterThan(0);
    for (const hard of toThirtyTwo) {
      expect(hard.difficulty).toBeGreaterThan(easy.difficulty);
      expect(compareNextVisitCandidates(easy, hard)).toBeLessThan(0);
    }
  });
});

describe('Case 3: 難易度が同じなら得意ダブルが効く', () => {
  it('103 / 2 本では、D16 優先で 32 残し・D20 優先で 40 残しになる', () => {
    expect(rankCheckoutRoutes(103, 2)).toEqual([]);
    const withD16 = selectNextVisitRoute(103, 2, { fallbackPreferredDoubles: ['D16', 'D20'] })!;
    const withD20 = selectNextVisitRoute(103, 2, { fallbackPreferredDoubles: ['D20', 'D16'] })!;
    expect(withD16.leave).toBe(32);
    expect(withD20.leave).toBe(40);
    // どちらも「いま投げる難易度」は同じ（T20 + シングル）。
    expect(withD16.routeText).toBe('T20 → S11');
    expect(withD20.routeText).toBe('T20 → S3');
  });

  it('得意ダブルで残しが変わる状態が、実データで複数見つかる', () => {
    const changed = ALL_STATES.filter((state) => {
      if (rankCheckoutRoutes(state.remaining, state.dartsLeft).length > 0) return false;
      const a = selectNextVisitRoute(state.remaining, state.dartsLeft, {
        fallbackPreferredDoubles: ['D16', 'D20'],
      });
      const b = selectNextVisitRoute(state.remaining, state.dartsLeft, {
        fallbackPreferredDoubles: ['D20', 'D16'],
      });
      return a !== null && b !== null && a.key !== b.key;
    });
    expect(changed.length).toBeGreaterThan(0);
  });

  it('比較関数そのものが、難易度 → 得意ダブルの順で決める', () => {
    const base = {
      darts: [],
      leave: 32,
      tier: 'A' as const,
      switchCount: 0,
      leaveScore: 0,
      intrinsic: 0,
    };
    const easyNoPreference = { ...base, key: 'A', difficulty: 2, preferenceRank: 99 };
    const hardPreferred = { ...base, key: 'B', difficulty: 4, preferenceRank: 0 };
    // 難易度が違えば、得意ダブルより難易度が優先される。
    expect(compareNextVisitCandidates(easyNoPreference, hardPreferred)).toBeLessThan(0);

    const samePreferred = { ...base, key: 'B', difficulty: 2, preferenceRank: 0 };
    // 難易度が同じなら、得意ダブルが効く。
    expect(compareNextVisitCandidates(samePreferred, easyNoPreference)).toBeLessThan(0);
  });
});

describe('Case 4 / 5 / 7 / 9 / 10: 介入しない場面', () => {
  it('103 / 3 本は CHECKOUT のままで、NEXT VISIT を出さない', () => {
    const suggestion = suggestFor(103, 3);
    expect(suggestion.checkoutRoutes.length).toBeGreaterThan(0);
    expect(suggestion.nextVisitRoute).toBeNull();
  });

  it('103 から S19 で 84 / 2 本になっても、上がれるので出さない', () => {
    const suggestion = suggestFor(84, 2);
    expect(suggestion.checkoutRoutes.length).toBeGreaterThan(0);
    expect(suggestion.nextVisitRoute).toBeNull();
  });

  it('残り本数 0 では出さない', () => {
    expect(suggestFor(119, 0).nextVisitRoute).toBeNull();
    expect(selectNextVisitRoute(119, 0)).toBeNull();
  });

  it('305 → S20 の 285 / 2 本は、通常 SETUP と完全に一致する', () => {
    const suggestion = suggestFor(285, 2, { fallbackPreferredDoubles: ['D16', 'D20'] });
    expect(suggestion.mode).toBe('setup');
    expect(suggestion.nextVisitRoute).toBeNull();
    const expected = rankSetupRoutes(285, 2);
    expect(suggestion.setupRoutes.map((route) => route.key)).toEqual(
      expected.map((route) => route.key),
    );
  });
});

describe('Case 6: ノーテン 169 / 3 本', () => {
  it('NEXT VISIT があり、その残しは次ラウンド 3 投以内で上がれる', () => {
    const suggestion = suggestFor(169, 3);
    expect(suggestion.isBogey).toBe(true);
    expect(suggestion.checkoutRoutes).toEqual([]);
    const route = suggestion.nextVisitRoute!;
    expect(route.darts).toHaveLength(3);
    expect(169 - route.scored).toBe(route.leave);
    expect(isCheckoutable(route.leave, DARTS_PER_VISIT)).toBe(true);
    // 3 本使えるノーテンでは、1 投で上がれる残しまで作れる。
    expect(nextVisitTierOf(route.leave)).toBe('A');
  });
});

describe('Case 14: 全 507 状態の監査', () => {
  it('得意ダブルの設定を変えても、CHECKOUT の結果は 1 件も変わらない', () => {
    const violations: string[] = [];
    for (const state of ALL_STATES) {
      const base = suggestFor(state.remaining, state.dartsLeft);
      for (const profile of PREFERENCE_PROFILES) {
        const actual = suggestFor(state.remaining, state.dartsLeft, {
          fallbackPreferredDoubles: profile,
        });
        if (actual.checkoutRoutes.length !== base.checkoutRoutes.length) {
          violations.push(`${at(state)}: 件数が変わった（${JSON.stringify(profile)}）`);
          continue;
        }
        for (let i = 0; i < base.checkoutRoutes.length; i += 1) {
          if (
            actual.checkoutRoutes[i].key !== base.checkoutRoutes[i].key ||
            actual.checkoutRoutes[i].grade !== base.checkoutRoutes[i].grade ||
            actual.checkoutRoutes[i].score !== base.checkoutRoutes[i].score
          ) {
            violations.push(`${at(state)}: ${i} 番目が変わった（${JSON.stringify(profile)}）`);
            break;
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('どの設定でも、選ばれた残しは合法でセレクタの第 1 位である', () => {
    const violations: string[] = [];
    let covered = 0;

    for (const state of ALL_STATES) {
      if (rankCheckoutRoutes(state.remaining, state.dartsLeft).length > 0) continue;
      covered += 1;

      for (const profile of PREFERENCE_PROFILES) {
        const label = `${at(state)}（${JSON.stringify(profile)}）`;
        const route = selectNextVisitRoute(state.remaining, state.dartsLeft, {
          fallbackPreferredDoubles: profile,
        });
        if (route === null) {
          violations.push(`${label}: 残しが出ない`);
          continue;
        }

        // 本数ちょうど・全セグメントが実在・MISS なし。
        if (route.darts.length !== state.dartsLeft) violations.push(`${label}: 本数が違う`);
        for (const dart of route.darts) {
          if (!SEGMENT_IDS.has(dart.id)) violations.push(`${label}: ${dart.id}`);
        }

        // 取得点・残りをルートから再計算して一致を見る。
        let left = state.remaining;
        for (const dart of route.darts) {
          left -= dart.score;
          if (left < MIN_CHECKOUT) {
            violations.push(`${label}: 途中で ${left} になる`);
            break;
          }
        }
        if (left !== route.leave) violations.push(`${label}: 残りが一致しない`);
        if (state.remaining - route.scored !== route.leave) {
          violations.push(`${label}: 取得点と残りが噛み合わない`);
        }
        if (route.leave === 1 || route.leave < MIN_CHECKOUT) {
          violations.push(`${label}: 1 残し / 2 未満`);
        }

        // 上がれる残しであること。
        if (!isCheckoutable(route.leave, DARTS_PER_VISIT)) {
          violations.push(`${label}: 次ラウンドで上がれない残し`);
        }

        // 候補集合の中で、比較関数どおりの第 1 位であること。
        const candidates = buildNextVisitCandidates(state.remaining, state.dartsLeft, {
          fallbackPreferredDoubles: profile,
        });
        const top = candidates.reduce((best, candidate) =>
          compareNextVisitCandidates(candidate, best) < 0 ? candidate : best,
        );
        if (top.key !== route.key) violations.push(`${label}: 第 1 位と違う（${top.key}）`);
      }
    }

    expect(violations).toEqual([]);
    expect(covered).toBe(222);
  });
});

describe('Case 15: 通常 SETUP 171〜350 × 1〜3 本の完全回帰', () => {
  it('540 状態すべてで、suggestFor と rankSetupRoutes が一致する', () => {
    const violations: string[] = [];
    let covered = 0;

    for (let remaining = MAX_CHECKOUT + 1; remaining <= MAX_SETUP_REMAINING; remaining += 1) {
      for (const dartsLeft of DARTS_LEFT) {
        covered += 1;
        const expected = rankSetupRoutes(remaining, dartsLeft);
        for (const profile of PREFERENCE_PROFILES) {
          const suggestion = suggestFor(remaining, dartsLeft, {
            fallbackPreferredDoubles: profile,
          });
          if (suggestion.mode !== 'setup') {
            violations.push(`${remaining}/${dartsLeft}: mode=${suggestion.mode}`);
            continue;
          }
          if (suggestion.nextVisitRoute !== null) {
            violations.push(`${remaining}/${dartsLeft}: SETUP に NEXT VISIT が混ざった`);
          }
          if (suggestion.setupRoutes.length !== expected.length) {
            violations.push(`${remaining}/${dartsLeft}: 件数が違う`);
            continue;
          }
          for (let i = 0; i < expected.length; i += 1) {
            if (
              suggestion.setupRoutes[i].key !== expected[i].key ||
              suggestion.setupRoutes[i].leave !== expected[i].leave ||
              suggestion.setupRoutes[i].score !== expected[i].score ||
              suggestion.setupRoutes[i].grade !== expected[i].grade
            ) {
              violations.push(`${remaining}/${dartsLeft}: ${i} 番目が違う`);
              break;
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
    expect(covered).toBe(540);
  });
});
