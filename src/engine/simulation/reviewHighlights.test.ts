import { describe, expect, it } from 'vitest';
import { MAX_PPR } from './accuracy';
import {
  MAX_ROUNDS,
  advanceRound,
  createGame,
  submitScore,
  throwAt,
  type SimulationGame,
  type SimulationSettings,
} from './game';
import {
  THROW_VERDICTS,
  buildGameReview,
  type GameReview,
  type GameSummary,
  type RoundReview,
  type ThrowReview,
  type ThrowVerdict,
} from './review';
import {
  IMPROVEMENT_PRIORITY,
  buildReviewHighlights,
  dartsLeftBefore,
  describeGameResultJa,
} from './reviewHighlights';

const PERFECT: SimulationSettings = {
  startScore: 501,
  first9Ppr: MAX_PPR,
  averagePpr: MAX_PPR,
  missDirection: 'even',
  maxMiss: 'medium',
};

function throwMany(game: SimulationGame, ids: readonly string[]): SimulationGame {
  return ids.reduce((state, id) => throwAt(state, id), game);
}

/** 判定だけを並べた合成レビュー（代表の選び方を確かめる用）。 */
function syntheticReview(rounds: ReadonlyArray<readonly ThrowVerdict[]>): GameReview {
  let dartIndex = 0;
  const roundReviews: RoundReview[] = rounds.map((verdicts, roundIndex) => ({
    round: roundIndex + 1,
    leftBefore: 300,
    scored: 0,
    leftAfter: 300,
    bust: false,
    checkout: false,
    entry: null,
    throws: verdicts.map((verdict, index): ThrowReview => {
      dartIndex += 1;
      return {
        record: {
          round: roundIndex + 1,
          dartNumber: index + 1,
          dartIndex,
          leftBefore: 300,
          intendedSegmentId: 'segment-t20',
          intendedDartId: 'T20',
          intendedPoint: { x: 0, y: 0 },
          actualPoint: { x: 0, y: 0 },
          actualDartId: 'T20',
          score: 60,
          leftAfter: 240,
          bust: false,
          bustReason: null,
          checkout: false,
          drawsBefore: 0,
        },
        verdict,
        grade: null,
        intendedLeave: 240,
        recommendedRouteText: null,
        recommendedDartId: null,
        noteJa: '',
      };
    }),
  }));
  const verdictCounts = Object.fromEntries(THROW_VERDICTS.map((verdict) => [verdict, 0])) as Record<
    ThrowVerdict,
    number
  >;
  for (const round of roundReviews) for (const item of round.throws) verdictCounts[item.verdict] += 1;
  const summary: GameSummary = {
    startScore: 501,
    totalDarts: dartIndex,
    ppr: 0,
    first9Ppr: 0,
    calculationMissCount: 0,
    bustCount: 0,
    checkoutDarts: null,
    checkoutScore: null,
    checkedOut: false,
    abandoned: false,
  };
  return { summary, rounds: roundReviews, verdictCounts };
}

describe('振り返りの代表（良かった判断・改善ポイント）', () => {
  it('40 → D20 の 1 投: 良い判断が 1 つ、改善ポイントはなし', () => {
    let game = createGame({ ...PERFECT, startScore: 40 }, 1);
    game = throwMany(game, ['segment-d20']);
    game = advanceRound(submitScore(game, 40));
    const highlights = buildReviewHighlights(buildGameReview(game));

    expect(highlights.good?.review.record.intendedDartId).toBe('D20');
    expect(highlights.good?.review.record.leftBefore).toBe(40);
    expect(highlights.improvement).toBeNull();
    expect(highlights.improvements).toHaveLength(0);
    expect(highlights.evaluatedCount).toBe(1);
    expect(highlights.nextFocusJa).toContain('見直す点はありませんでした');
  });

  it('残り 178 の 3 投目 T19 は、159 の理由と代案つきで改善ポイントになる', () => {
    let game = createGame({ ...PERFECT, startScore: 258 }, 1);
    game = throwMany(game, ['segment-t20', 'segment-s20-outer', 'segment-t19']);
    game = advanceRound(submitScore(game, 137));
    game = throwMany(game, ['segment-t20', 'segment-t15', 'segment-d8']);
    game = advanceRound(submitScore(game, 121));
    const review = buildGameReview(game);
    const highlights = buildReviewHighlights(review);

    const t19 = highlights.improvements.find(
      (focus) => focus.review.record.leftBefore === 178 && focus.review.record.dartNumber === 3,
    );
    expect(t19).toBeDefined();
    expect(t19?.review.verdict).toBe('BETTER_OPTION_AVAILABLE');
    expect(t19?.review.noteJa).toContain('159');
    // 狙い通りの残り（121）と実際の着弾を混同しない。
    expect(t19?.review.intendedLeave).toBe(121);
    expect(dartsLeftBefore(t19!.review)).toBe(1);
    // 代表は優先順位の最上位。
    const top = highlights.improvement!;
    for (const focus of highlights.improvements) {
      expect(IMPROVEMENT_PRIORITY[top.review.verdict]!).toBeLessThanOrEqual(
        IMPROVEMENT_PRIORITY[focus.review.verdict]!,
      );
    }
    expect(highlights.nextFocusJa.length).toBeGreaterThan(0);
  });

  it('実際の着弾だけ外れた投は、改善ポイントにしない', () => {
    // 40 から D20 を狙って S20 に落ちても、狙いは妥当。
    const settings = { ...PERFECT, startScore: 40, first9Ppr: 0, averagePpr: 0 };
    for (let seed = 1; seed <= 20; seed += 1) {
      const game = throwMany(createGame(settings, seed), ['segment-d20']);
      const highlights = buildReviewHighlights(
        buildGameReview({ ...game, rounds: [{ ...game.current!, scored: 0, leftAfter: 40, entry: null }] }),
      );
      expect(highlights.improvement).toBeNull();
    }
  });

  it('得点を伸ばす場面だけのゲームで、架空の良い判断を出さない', () => {
    let game = createGame(PERFECT, 1);
    game = throwMany(game, ['segment-t20', 'segment-t20', 'segment-t20']);
    game = advanceRound(submitScore(game, 180));
    const highlights = buildReviewHighlights(buildGameReview(game));

    expect(highlights.good).toBeNull();
    expect(highlights.improvement).toBeNull();
    expect(highlights.evaluatedCount).toBe(0);
    expect(highlights.scoringCount).toBe(3);
    expect(highlights.nextFocusJa).toContain('採点できた狙いがありませんでした');
  });

  it('優先順位は ボギー ＞ 上がり方・残し方 ＞ もっと良い狙い、同順位は早い投から', () => {
    const review = syntheticReview([
      ['BETTER_OPTION_AVAILABLE', 'SETUP_MISTAKE', 'GOOD_DECISION'],
      ['ARRANGEMENT_MISTAKE', 'BOGEY_CREATED', 'NOT_EVALUATED'],
      ['SCORING_PHASE', 'BOGEY_CREATED', 'GOOD_DECISION'],
    ]);
    const highlights = buildReviewHighlights(review);
    expect(highlights.improvements.map((focus) => focus.review.record.dartIndex)).toEqual([
      5, 8, 2, 4, 1,
    ]);
    expect(highlights.improvement?.review.record.dartIndex).toBe(5);
    expect(highlights.nextFocusJa).toContain('ボギー');
    // 良かった判断はゲームの最後に近いもの。
    expect(highlights.good?.review.record.dartIndex).toBe(9);
  });

  it('判定対象外と得点を伸ばす場面は、良い・改善のどちらの件数にも入れない', () => {
    const review = syntheticReview([
      ['NOT_EVALUATED', 'SCORING_PHASE', 'GOOD_DECISION'],
      ['NOT_EVALUATED', 'BETTER_OPTION_AVAILABLE'],
    ]);
    const highlights = buildReviewHighlights(review);
    expect(highlights.evaluatedCount).toBe(2);
    expect(highlights.goodCount).toBe(1);
    expect(highlights.improvementCount).toBe(1);
    expect(highlights.notEvaluatedCount).toBe(2);
    expect(highlights.scoringCount).toBe(1);
  });

  it('全投の並びと件数は、元のレビューから変えない', () => {
    const review = syntheticReview([
      ['BETTER_OPTION_AVAILABLE', 'BOGEY_CREATED', 'GOOD_DECISION'],
      ['SETUP_MISTAKE'],
    ]);
    const before = review.rounds.flatMap((round) => round.throws.map((item) => item.record.dartIndex));
    buildReviewHighlights(review);
    const after = review.rounds.flatMap((round) => round.throws.map((item) => item.record.dartIndex));
    expect(after).toEqual(before);
  });
});

describe('代案の出し方', () => {
  it('狙い通りで BUST する狙いには、良い判断になるおすすめをそのまま代案に出す', () => {
    // 40 から T20 → BUST。おすすめは D20。
    let game = createGame({ ...PERFECT, startScore: 40 }, 1);
    game = throwMany(game, ['segment-t20']);
    game = advanceRound(game);
    game = throwMany(game, ['segment-d20']);
    game = advanceRound(submitScore(game, 40));
    const highlights = buildReviewHighlights(buildGameReview(game));

    expect(highlights.improvement?.review.verdict).toBe('ARRANGEMENT_MISTAKE');
    expect(highlights.improvement?.alternative).toEqual({ kind: 'route', text: 'D20' });
  });

  it('残り 178 の最後の 1 投: 振り返りの評価と食い違う第 1 候補は代案に出さない', () => {
    for (const aim of ['segment-t19', 'segment-s18-outer']) {
      let game = createGame({ ...PERFECT, startScore: 258 }, 1);
      game = throwMany(game, ['segment-t20', 'segment-s20-outer', aim]);
      const review = buildGameReview({
        ...game,
        rounds: [{ ...game.current!, scored: 0, leftAfter: 0, entry: null }],
      });
      const focus = buildReviewHighlights(review).improvements.find(
        (item) => item.review.record.leftBefore === 178,
      );
      expect(focus?.review.verdict).toBe('BETTER_OPTION_AVAILABLE');
      // 第 1 候補（S18）は、同じ場面の振り返りでは良い判断に当たらない。
      expect(focus?.alternative).toEqual({ kind: 'in-note' });
    }
  });

  it('良かった判断には代案を付けない', () => {
    let game = createGame({ ...PERFECT, startScore: 40 }, 1);
    game = throwMany(game, ['segment-d20']);
    game = advanceRound(submitScore(game, 40));
    expect(buildReviewHighlights(buildGameReview(game)).good?.alternative).toEqual({ kind: 'none' });
  });
});

describe('ゲームの結果の 1 行', () => {
  it('上がったゲームと、上限で打ち切ったゲームを取り違えない', () => {
    const base = syntheticReview([['GOOD_DECISION']]).summary;
    expect(describeGameResultJa({ ...base, checkedOut: true })).toContain('上がりました');
    const abandoned = describeGameResultJa({ ...base, abandoned: true });
    expect(abandoned).toContain(`${MAX_ROUNDS} ビジット`);
    expect(abandoned).toContain('未完了');
    expect(abandoned).not.toContain('CHECKOUT');
  });
});
