import { describe, expect, it } from 'vitest';
import { isBogey } from '../../domain/checkoutRules';
import { rankSetupRoutes } from '../setup/enumerate';
import { rankCheckoutRoutes } from '../ranking/checkoutRanking';
import { suggestFor } from '../recovery/suggest';
import { MAX_PPR } from './accuracy';
import {
  advanceRound,
  createGame,
  submitScore,
  throwAt,
  type SimulationGame,
  type SimulationSettings,
  type ThrowRecord,
} from './game';
import { buildGameReview, reviewThrow } from './review';

const PERFECT: SimulationSettings = {
  startScore: 501,
  first9Ppr: MAX_PPR,
  averagePpr: MAX_PPR,
  missDirection: 'even',
  maxMiss: 'medium',
};

/**
 * レビュー判定だけを確かめるための 1 投の記録。
 * 「狙い」と「着弾」を自由に組み合わせられるようにしている。
 */
function record(
  leftBefore: number,
  intendedDartId: string,
  actualDartId: string,
  dartNumber = 1,
): ThrowRecord {
  return {
    round: 1,
    dartNumber,
    dartIndex: dartNumber,
    leftBefore,
    intendedSegmentId: `segment-${intendedDartId.toLowerCase()}`,
    intendedDartId,
    intendedPoint: { x: 0, y: 0 },
    actualPoint: { x: 0, y: 0 },
    actualDartId,
    score: 0,
    leftAfter: leftBefore,
    bust: false,
    bustReason: null,
    checkout: false,
    drawsBefore: 0,
  };
}

/** その場面でアプリが 1 投目に推奨する的。 */
function recommendedFirstDart(left: number, dartsLeft: number): string {
  const suggestion = suggestFor(left, dartsLeft);
  const id =
    suggestion.checkoutRoutes[0]?.darts[0]?.id ??
    suggestion.nextVisitProposals[0]?.route.darts[0]?.id ??
    suggestion.setupRoutes[0]?.darts[0]?.id;
  if (id === undefined) throw new Error(`推奨が得られません: ${left} / ${dartsLeft}`);
  return id;
}

function throwMany(game: SimulationGame, ids: readonly string[]): SimulationGame {
  return ids.reduce((state, id) => throwAt(state, id), game);
}

describe('評価するのは狙いだけ（着弾ミスと判断ミスを混同しない）', () => {
  it('同じ狙いなら、着弾がどこであっても判定は変わらない', () => {
    const left = 125;
    const intended = recommendedFirstDart(left, 3);
    const onTarget = reviewThrow(record(left, intended, intended));
    const wayOff = reviewThrow(record(left, intended, 'S5'));
    const outBoard = reviewThrow(record(left, intended, 'MISS'));

    expect(onTarget.verdict).toBe('GOOD_DECISION');
    expect(wayOff.verdict).toBe(onTarget.verdict);
    expect(outBoard.verdict).toBe(onTarget.verdict);
    expect(wayOff.noteJa).toBe(onTarget.noteJa);
  });

  it('推奨の 1 投目を狙えば、どの残りでも GOOD DECISION になる', () => {
    const notGood: string[] = [];
    for (let left = 2; left <= 170; left += 1) {
      if (isBogey(left)) continue;
      const intended = recommendedFirstDart(left, 3);
      const result = reviewThrow(record(left, intended, 'S1'));
      if (result.verdict !== 'GOOD_DECISION') {
        notGood.push(`${left}: ${intended} → ${result.verdict}`);
      }
    }
    expect(notGood).toEqual([]);
  });

  it('候補一覧の表示件数（40 件）で切って判定しない', () => {
    /*
     * 回帰テスト（Codex レビュー P1）。
     * 171 の T16 → S20 → T20 は推奨度 A だが、41 番目以降にあるため
     * 表示件数のまま判定すると SETUP MISTAKE になってしまっていた。
     */
    const full = rankSetupRoutes(171, 3, { maxRoutes: 100000 });
    const t16 = full.filter((route) => route.darts[0].id === 'T16');
    expect(t16.length).toBeGreaterThan(0);
    expect(t16.some((route) => route.grade === 'S' || route.grade === 'A')).toBe(true);
    // 既定の 40 件には入っていない（この前提が崩れたらテストの意味が変わる）。
    expect(rankSetupRoutes(171, 3).some((route) => route.darts[0].id === 'T16')).toBe(false);

    const result = reviewThrow(record(171, 'T16', 'S16'));
    expect(result.verdict).toBe('GOOD_DECISION');
  });

  it('候補一覧に入っている S / A の 1 投目は、どの残りでも GOOD DECISION', () => {
    const notGood: string[] = [];
    for (let left = 171; left <= 350; left += 1) {
      const ranked = rankSetupRoutes(left, 3, { maxRoutes: 100000 });
      const good = ranked.filter((route) => route.grade === 'S' || route.grade === 'A');
      const firstDarts = [...new Set(good.map((route) => route.darts[0].id))];
      for (const id of firstDarts) {
        const verdict = reviewThrow(record(left, id, 'MISS')).verdict;
        if (verdict !== 'GOOD_DECISION') notGood.push(`${left}: ${id} → ${verdict}`);
      }
    }
    expect(notGood).toEqual([]);
  });

  it('SETUP 領域（171〜350）でも、推奨の 1 投目は GOOD DECISION', () => {
    const notGood: string[] = [];
    for (let left = 171; left <= 350; left += 1) {
      const intended = recommendedFirstDart(left, 3);
      const result = reviewThrow(record(left, intended, 'MISS'));
      if (result.verdict !== 'GOOD_DECISION') {
        notGood.push(`${left}: ${intended} → ${result.verdict}`);
      }
    }
    expect(notGood).toEqual([]);
  });
});

describe('分類', () => {
  it('351 以上はアレンジ判断の対象外（SCORING）', () => {
    const result = reviewThrow(record(501, 'T20', 'T20'));
    expect(result.verdict).toBe('SCORING_PHASE');
    expect(result.grade).toBeNull();
    expect(result.noteJa).toContain('対象外');
  });

  it('狙い通り入ると Bust する的は ARRANGEMENT MISTAKE', () => {
    const result = reviewThrow(record(40, 'T20', 'S20'));
    expect(result.verdict).toBe('ARRANGEMENT_MISTAKE');
    expect(result.intendedLeave).toBeNull();
    expect(result.noteJa).toContain('Bust');
  });

  it('残り 1 になる狙いも Bust として指摘する', () => {
    const result = reviewThrow(record(20, 'S19', 'S19'));
    expect(result.verdict).toBe('ARRANGEMENT_MISTAKE');
    expect(result.noteJa).toContain('残り 1');
  });

  it('ビジット最後の 1 投で Bogey を残す狙いは BOGEY CREATED', () => {
    // 170 から S11 を狙うと 159（3 本あっても上がれない）。
    expect(isBogey(159)).toBe(true);
    const result = reviewThrow(record(170, 'S11', 'S11', 3));
    expect(result.verdict).toBe('BOGEY_CREATED');
    expect(result.intendedLeave).toBe(159);
    expect(result.noteJa).toContain('ノーテン');
  });

  it('ビジット途中で一時的に Bogey を通るのは判断ミスにしない', () => {
    // 219 から T20（推奨）を狙うと一度 159 を通るが、残り 2 本で作り直せる。
    expect(isBogey(159)).toBe(true);
    const result = reviewThrow(record(219, 'T20', 'T20', 1));
    expect(result.intendedLeave).toBe(159);
    expect(result.verdict).toBe('GOOD_DECISION');
  });

  it('CHECKOUT では、候補に無い狙いを ARRANGEMENT MISTAKE と言い切れる', () => {
    /*
     * CHECKOUT のランキングは全ルートの列挙なので、
     * 一覧に無い＝その 1 投目から上がる組み立てが無い、と断定できる。
     * 170 から S11 を狙うと 159 で、残り 2 本では上がれない。
     */
    expect(rankCheckoutRoutes(170, 3).some((route) => route.darts[0].id === 'S11')).toBe(false);
    const result = reviewThrow(record(170, 'S11', 'S11'));
    expect(result.verdict).toBe('ARRANGEMENT_MISTAKE');
    expect(result.recommendedDartId).not.toBeNull();
    expect(result.noteJa).toContain('上がる組み立てがありません');
  });

  it('成立はするが非推奨（推奨度 C）の狙いも ARRANGEMENT MISTAKE', () => {
    const result = reviewThrow(record(40, 'S3', 'S3'));
    expect(result.verdict).toBe('ARRANGEMENT_MISTAKE');
    expect(result.grade).toBe('C');
    expect(result.noteJa).toContain('非推奨');
  });

  it('SETUP では、候補に無いだけの狙いをミスと言い切らない', () => {
    /*
     * SETUP の候補は承認済みの戦術のふるいを通った一覧で、盤面の全 62 通りを
     * 評価したものではない。「一覧に無い」を不正解の根拠にしない。
     */
    const result = reviewThrow(record(301, 'S1', 'S1'));
    expect(result.verdict).toBe('NOT_EVALUATED');
    expect(result.noteJa).toContain('断定していません');
    // それでも、アプリならどう組み立てたかは示す。
    expect(result.recommendedRouteText).not.toBeNull();
  });

  it('おすすめのルートと 1 投目を必ず添える（判定できる場面では）', () => {
    const result = reviewThrow(record(125, 'S3', 'S3'));
    expect(result.recommendedRouteText).not.toBeNull();
    expect(result.recommendedDartId).not.toBeNull();
    expect(result.noteJa).toContain(result.recommendedRouteText!);
  });

  it('MY ROUTE に沿った狙いを不正解にしない', () => {
    /*
     * 得意ダブルを設定すると MY ROUTE の 1 投目が変わり、かつその 1 投目が
     * 標準ランキングでは S / A ではない場面を探す（設定がなければ
     * GOOD DECISION にならない場面 ＝ 設定でしか救われない場面）。
     */
    const preferredDoubles = ['D10'];
    let found: { left: number; myRoute: string } | null = null;
    for (let left = 2; left <= 170 && found === null; left += 1) {
      const standard = rankCheckoutRoutes(left, 3);
      const my = rankCheckoutRoutes(left, 3, { preferredDoubles, applyStandardBonus: false });
      if (standard.length === 0 || my.length === 0) continue;
      const myFirst = my[0].darts[0].id;
      if (standard[0].darts[0].id === myFirst) continue;
      // 標準ランキングでの、その 1 投目の最良グレード。
      const grades = standard
        .filter((route) => route.darts[0].id === myFirst)
        .map((route) => route.grade);
      if (grades.includes('S') || grades.includes('A')) continue;
      found = { left, myRoute: myFirst };
    }
    expect(found).not.toBeNull();
    const { left, myRoute } = found!;

    // 設定が無ければ GOOD DECISION にはならない。
    expect(reviewThrow(record(left, myRoute, 'S1')).verdict).not.toBe('GOOD_DECISION');
    // 得意ダブルを設定していれば GOOD DECISION。
    const withPreference = reviewThrow(record(left, myRoute, 'S1'), { preferredDoubles });
    expect(withPreference.verdict).toBe('GOOD_DECISION');
    expect(withPreference.noteJa).toContain('MY ROUTE');
  });

  it('NEXT VISIT の残し候補にも得意ダブルが効く', () => {
    /*
     * 回帰テスト（Codex レビュー P2）。
     * suggestFor が NEXT VISIT で読むのは fallbackPreferredDoubles なので、
     * preferredDoubles を渡すだけでは MY ROUTE が無視されていた。
     */
    const withPreference = reviewThrow(record(41, 'S1', 'S1', 3), {
      preferredDoubles: ['D20'],
    });
    expect(withPreference.intendedLeave).toBe(40);
    expect(withPreference.verdict).toBe('GOOD_DECISION');
    expect(withPreference.recommendedRouteText).toContain('S1');
  });
});

describe('GAME REVIEW の集計', () => {
  it('9 ダーツで上がった完全プレイを正しく要約する', () => {
    // 501 = T20×3 → 321 = T20×3 → 141 = T20 + T19 + D12
    let game = createGame(PERFECT, 1);
    game = throwMany(game, ['segment-t20', 'segment-t20', 'segment-t20']);
    game = advanceRound(submitScore(game, 180));
    game = throwMany(game, ['segment-t20', 'segment-t20', 'segment-t20']);
    game = advanceRound(submitScore(game, 180));
    game = throwMany(game, ['segment-t20', 'segment-t19', 'segment-d12']);
    game = advanceRound(submitScore(game, 141));

    expect(game.phase).toBe('finished');
    const review = buildGameReview(game);
    expect(review.summary.startScore).toBe(501);
    expect(review.summary.totalDarts).toBe(9);
    expect(review.summary.ppr).toBeCloseTo(MAX_PPR, 6);
    expect(review.summary.first9Ppr).toBeCloseTo(MAX_PPR, 6);
    expect(review.summary.calculationMissCount).toBe(0);
    expect(review.summary.bustCount).toBe(0);
    expect(review.summary.checkedOut).toBe(true);
    expect(review.summary.checkoutDarts).toBe(3);
    expect(review.summary.checkoutScore).toBe(141);
    expect(review.rounds).toHaveLength(3);
    expect(review.rounds[2].throws).toHaveLength(3);
  });

  it('BUST したラウンドは 0 点として PPR に効く', () => {
    let game = createGame({ ...PERFECT, startScore: 100 }, 1);
    // 1 ラウンド目: T20 → 40、T20 で BUST。
    game = throwMany(game, ['segment-t20', 'segment-t20']);
    game = advanceRound(game);
    expect(game.left).toBe(100);
    // 2 ラウンド目: T20 → 40、D20 で上がり。
    game = throwMany(game, ['segment-t20', 'segment-d20']);
    game = advanceRound(submitScore(game, 100));

    const review = buildGameReview(game);
    expect(review.summary.bustCount).toBe(1);
    expect(review.summary.totalDarts).toBe(4);
    // 100 点を 4 本で消化 → 100 / 4 × 3 = 75。
    expect(review.summary.ppr).toBeCloseTo(75, 6);
    expect(review.rounds[0].scored).toBe(0);
  });

  it('CALCULATION MISS の回数を数え、そのラウンドへ印を残す', () => {
    let game = createGame({ ...PERFECT, startScore: 180 }, 1);
    game = throwMany(game, ['segment-t20', 'segment-t20', 'segment-s20-outer']);
    game = advanceRound(submitScore(game, 145)); // 正しくは 140
    game = throwMany(game, ['segment-d20']);
    game = advanceRound(submitScore(game, 40));

    const review = buildGameReview(game);
    expect(review.summary.calculationMissCount).toBe(1);
    expect(review.rounds[0].entry).toEqual({ entered: 145, actual: 140, miss: true });
    expect(review.summary.checkoutDarts).toBe(1);
    expect(review.summary.checkoutScore).toBe(40);
  });

  it('分類ごとの件数を数える', () => {
    let game = createGame({ ...PERFECT, startScore: 170 }, 1);
    game = throwMany(game, ['segment-t20', 'segment-t20', 'segment-inner-bull']);
    game = advanceRound(submitScore(game, 170));

    const review = buildGameReview(game);
    const total = Object.values(review.verdictCounts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(3);
    expect(review.verdictCounts.GOOD_DECISION).toBeGreaterThan(0);
  });

  it('上がっていないゲームでも要約を作れる', () => {
    let game = createGame({ ...PERFECT, startScore: 501 }, 1);
    game = throwMany(game, ['segment-t20', 'segment-t20', 'segment-t20']);
    game = advanceRound(submitScore(game, 180));
    const review = buildGameReview(game);
    expect(review.summary.checkedOut).toBe(false);
    expect(review.summary.checkoutDarts).toBeNull();
    expect(review.summary.checkoutScore).toBeNull();
    expect(review.summary.totalDarts).toBe(3);
  });
});
