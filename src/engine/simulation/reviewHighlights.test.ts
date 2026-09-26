import { describe, expect, it } from 'vitest';
import { MAX_PPR } from './accuracy';
import { suggestFor } from '../recovery/suggest';
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
  reviewThrow,
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
  suggestionsOf,
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
        comparison: null,
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

describe('振り返りが比べた代案と、アプリの第 1 案（v1.4.8）', () => {
  /** 1 投だけの記録（判定の確認用）。 */
  const single = (leftBefore: number, intendedDartId: string, dartsLeft: number) => ({
    round: 1,
    dartNumber: 4 - dartsLeft,
    dartIndex: 4 - dartsLeft,
    leftBefore,
    intendedSegmentId: 'x',
    intendedDartId,
    intendedPoint: { x: 0, y: 0 },
    actualPoint: { x: 0, y: 0 },
    actualDartId: intendedDartId,
    score: 0,
    leftAfter: leftBefore,
    bust: false,
    bustReason: null,
    checkout: false,
    drawsBefore: 0,
  });

  it('狙い通りで BUST する狙い: 代案はアプリの第 1 案そのもの（1 行にまとめる）', () => {
    // 40 から T20 → BUST。おすすめは D20。
    let game = createGame({ ...PERFECT, startScore: 40 }, 1);
    game = throwMany(game, ['segment-t20']);
    game = advanceRound(game);
    game = throwMany(game, ['segment-d20']);
    game = advanceRound(submitScore(game, 40));
    const highlights = buildReviewHighlights(buildGameReview(game));

    expect(highlights.improvement?.review.verdict).toBe('ARRANGEMENT_MISTAKE');
    const suggestions = highlights.improvement?.suggestions;
    expect(suggestions?.comparison).toMatchObject({ basis: 'APP_ROUTE', dartIds: ['D20'] });
    expect(suggestions?.appFirstRelation).toBe('SAME_AS_COMPARISON');
    expect(suggestions?.comparisonLineJa).toBe('振り返りが比べた代案: D20（アプリの第 1 案と同じ）');
    expect(suggestions?.appFirstLineJa).toBeNull();
  });

  it('残り 178 の最後の 1 投で S18: 実戦推奨 T18 と代案を1行にまとめる', () => {
    const review = reviewThrow(single(178, 'S18', 1));
    expect(review.verdict).toBe('BETTER_OPTION_AVAILABLE');
    expect(suggestFor(178, 1).setupRoutes[0].darts[0].id).toBe('S18');
    expect(review.recommendedDartId).toBe('T18');
    const suggestions = suggestionsOf(review);
    // 代案は振り返りの判定根拠（同じナンバーのトリプル、A-21）。
    expect(suggestions.comparison).toMatchObject({
      basis: 'LAST_DART_SAME_NUMBER_TRIPLE',
      dartIds: ['T18'],
      leaveOnHit: 124,
      missDartId: 'S18',
      leaveOnSingleMiss: 160,
    });
    expect(suggestions.comparisonLineJa).toBe(
      '振り返りが比べた代案: T18（狙い通りなら残り 124・S18 に落ちても残り 160）（アプリの第 1 案と同じ）',
    );
    expect(suggestions.appFirstRelation).toBe('SAME_AS_COMPARISON');
    expect(suggestions.appFirstLineJa).toBeNull();
  });

  it('残り 102 の最後の 1 投で S20（A-22）: 上位互換の的が実戦推奨と一致する', () => {
    const review = reviewThrow(single(102, 'S20', 1));
    expect(review.verdict).toBe('BETTER_OPTION_AVAILABLE');
    expect(review.recommendedDartId).toBe('T20');
    const suggestions = suggestionsOf(review);
    expect(suggestions.comparison?.basis).toBe('LAST_DART_LEAVE_PROFILE');
    expect(suggestions.comparison?.dartIds[0]).toBe('T20');
    expect(suggestions.comparisonLineJa).toContain('振り返りが比べた代案: T20（狙い通りなら残り 42');
    expect(suggestions.appFirstRelation).toBe('SAME_AS_COMPARISON');
    expect(suggestions.comparisonLineJa).toContain('アプリの第 1 案と同じ');
    expect(suggestions.appFirstLineJa).toBeNull();
  });

  it('残り 178 の最後の 1 投で T19: 代案 T20 と実戦推奨 T18 を区別する', () => {
    const review = reviewThrow(single(178, 'T19', 1));
    const suggestions = suggestionsOf(review);
    expect(suggestions.comparison?.basis).toBe('LAST_DART_TENPAI');
    expect(suggestions.comparison?.dartIds[0]).toBe('T20');
    expect(suggestions.appFirstRelation).toBe('DIFFERENT');
    expect(suggestions.appFirstLineJa).toContain('この場面のアプリの第 1 案: T18');
    expect(suggestions.appFirstLineJa).toContain('振り返りは上の代案とも比べています');
    expect(suggestions.appFirstLineJa).not.toContain('参考');
  });

  it('最後の 1 投でダブルを狙った場面: 基準例 S11 ではなく実戦推奨 T11 を示す（残り 171 の D2）', () => {
    const review = reviewThrow(single(171, 'D2', 1));
    // 基準例 S11 は、同じ場面の振り返りでは T11 に上位互換を取られる（A-21）。
    expect(suggestFor(171, 1).setupRoutes[0].darts[0].id).toBe('S11');
    expect(review.recommendedDartId).toBe('T11');
    expect(reviewThrow(single(171, 'S11', 1)).verdict).toBe('BETTER_OPTION_AVAILABLE');
    expect(review.comparison?.basis).toBe('APP_ROUTE');
    const target = review.comparison!.dartIds[0];
    expect(target).toBe('T11');
    expect(reviewThrow(single(171, target, 1)).verdict).toBe('GOOD_DECISION');
    expect(suggestionsOf(review).appFirstRelation).toBe('SAME_AS_COMPARISON');
    expect(review.noteJa).toContain('おすすめは T11');
    expect(review.noteJa).not.toContain('おすすめは S11');
  });

  it('良かった判断には代案を付けない', () => {
    let game = createGame({ ...PERFECT, startScore: 40 }, 1);
    game = throwMany(game, ['segment-d20']);
    game = advanceRound(submitScore(game, 40));
    expect(buildReviewHighlights(buildGameReview(game)).good?.suggestions).toBeNull();
  });
});

describe('次のゲームで意識すること', () => {
  it('ボギー以外は理由を決め打ちせず、改善ポイントの説明へ任せる', () => {
    // 残り 5 の S3 は、基準ルート S1 → D2 との比較で「もっと良い狙いあり」。
    // 外れたときの残りが理由ではないので、その規則を教えない。
    let game = createGame({ ...PERFECT, startScore: 5 }, 1);
    game = throwMany(game, ['segment-s3-outer', 'segment-d1']);
    game = advanceRound(submitScore(game, 5));
    const highlights = buildReviewHighlights(buildGameReview(game));

    expect(highlights.improvement?.review.verdict).toBe('BETTER_OPTION_AVAILABLE');
    expect(highlights.nextFocusJa).not.toContain('外れた');
    expect(highlights.nextFocusJa).toContain('改善ポイントの説明を参照');

    for (const verdict of ['ARRANGEMENT_MISTAKE', 'SETUP_MISTAKE'] as const) {
      const text = buildReviewHighlights(syntheticReview([[verdict]])).nextFocusJa;
      expect(text).not.toContain('BUST');
      expect(text).not.toContain('外れた');
      expect(text).toContain('改善ポイントの説明を参照');
    }
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
