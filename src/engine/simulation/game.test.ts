import { describe, expect, it } from 'vitest';
import { MAX_PPR } from './accuracy';
import {
  MAX_ROUNDS,
  MAX_START_SCORE,
  MIN_START_SCORE,
  advanceRound,
  allThrows,
  canUndo,
  createGame,
  currentLeft,
  dartsLeftInRound,
  describeThrow,
  hasWrongEntry,
  needsScoreEntry,
  normalizeSettings,
  roundScoreOf,
  submitScore,
  throwAt,
  totalDarts,
  undoLastThrow,
  type SimulationGame,
  type SimulationSettings,
} from './game';

/** σ = 0 の完全プレイヤー。狙った的へ必ず入るので、進行の検証が決定論的になる。 */
function perfect(startScore: number): SimulationSettings {
  return {
    startScore,
    first9Ppr: MAX_PPR,
    averagePpr: MAX_PPR,
    missDirection: 'even',
    maxMiss: 'medium',
  };
}

function human(startScore: number): SimulationSettings {
  return {
    startScore,
    first9Ppr: 60,
    averagePpr: 55,
    missDirection: 'vertical',
    maxMiss: 'medium',
  };
}

/** 狙いを並べて投げる（進行の検証用）。 */
function throwMany(game: SimulationGame, segmentIds: readonly string[]): SimulationGame {
  return segmentIds.reduce((state, id) => throwAt(state, id), game);
}

describe('ゲームの作成と設定の正規化', () => {
  it('開始点数と PPR は安全な範囲へ収める', () => {
    const normalized = normalizeSettings({
      startScore: 99999,
      first9Ppr: 500,
      averagePpr: -20,
      missDirection: 'even',
      maxMiss: 'small',
    });
    expect(normalized.startScore).toBe(MAX_START_SCORE);
    expect(normalized.first9Ppr).toBe(MAX_PPR);
    expect(normalized.averagePpr).toBe(0);
    expect(normalizeSettings({ ...normalized, startScore: 0 }).startScore).toBe(MIN_START_SCORE);
  });

  it('301 / 501 / 701 / 任意の開始点で始められる', () => {
    for (const start of [301, 501, 701, 407]) {
      const game = createGame(perfect(start), 1);
      expect(game.left).toBe(start);
      expect(currentLeft(game)).toBe(start);
      expect(game.current?.round).toBe(1);
      expect(dartsLeftInRound(game.current)).toBe(3);
      expect(game.phase).toBe('aiming');
    }
  });
});

describe('1 投ごとの進行', () => {
  it('狙った区画へ入り、残り点が減る（σ = 0）', () => {
    let game = createGame(perfect(501), 42);
    game = throwAt(game, 'segment-t20');
    const record = game.current?.throws[0];
    expect(record?.intendedDartId).toBe('T20');
    expect(record?.actualDartId).toBe('T20');
    expect(record?.score).toBe(60);
    expect(record?.leftBefore).toBe(501);
    expect(record?.leftAfter).toBe(441);
    expect(currentLeft(game)).toBe(441);
    expect(dartsLeftInRound(game.current)).toBe(2);
  });

  it('MISS リングは狙えない（状態が変わらない）', () => {
    const game = createGame(perfect(501), 42);
    expect(throwAt(game, 'segment-miss')).toBe(game);
    expect(throwAt(game, 'segment-does-not-exist')).toBe(game);
  });

  it('3 投そろうと暗算入力の段階へ移る', () => {
    const game = throwMany(createGame(perfect(501), 1), [
      'segment-t20',
      'segment-t20',
      'segment-t20',
    ]);
    expect(game.phase).toBe('score-entry');
    expect(needsScoreEntry(game.current)).toBe(true);
    expect(roundScoreOf(game.current!)).toBe(180);
    // 盤面は無効になり、それ以上は投げられない。
    expect(throwAt(game, 'segment-t20')).toBe(game);
  });

  it('全投の記録を保持する（レビュー用の一次データ）', () => {
    const game = throwMany(createGame(perfect(170), 1), ['segment-t20', 'segment-t20']);
    const records = allThrows(game);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      round: 1,
      dartNumber: 1,
      dartIndex: 1,
      leftBefore: 170,
      intendedSegmentId: 'segment-t20',
      intendedDartId: 'T20',
      actualDartId: 'T20',
      score: 60,
      leftAfter: 110,
      bust: false,
      checkout: false,
    });
    expect(records[0].intendedPoint).toEqual(records[0].actualPoint);
    expect(records[1].dartNumber).toBe(2);
    expect(totalDarts(game)).toBe(2);
  });
});

describe('Double Out と BUST', () => {
  it('ダブルでちょうど 0 にすると上がり', () => {
    let game = throwMany(createGame(perfect(170), 1), [
      'segment-t20',
      'segment-t20',
      'segment-inner-bull',
    ]);
    expect(game.current?.checkout).toBe(true);
    expect(currentLeft(game)).toBe(0);
    game = advanceRound(submitScore(game, 170));
    expect(game.phase).toBe('finished');
    expect(game.left).toBe(0);
    expect(game.rounds).toHaveLength(1);
    expect(game.rounds[0].checkout).toBe(true);
  });

  it('残り点を下回ると BUST', () => {
    const game = throwAt(createGame(perfect(40), 1), 'segment-t20');
    expect(game.current?.bust).toBe(true);
    expect(game.current?.bustReason).toBe('BELOW_ZERO');
    expect(currentLeft(game)).toBe(40);
  });

  it('残り 1 になると BUST', () => {
    const game = throwAt(createGame(perfect(20), 1), 'segment-s19-inner');
    expect(game.current?.bust).toBe(true);
    expect(game.current?.bustReason).toBe('LEFT_ONE');
  });

  it('0 にしても最後がダブルでなければ BUST', () => {
    const game = throwAt(createGame(perfect(20), 1), 'segment-s20-outer');
    expect(game.current?.bust).toBe(true);
    expect(game.current?.bustReason).toBe('NOT_DOUBLE_FINISH');
  });

  it('BUST ではラウンド開始時の残りへ戻り、暗算入力は求めない', () => {
    let game = createGame(perfect(100), 1);
    game = throwAt(game, 'segment-t20'); // 100 → 40
    game = throwAt(game, 'segment-t20'); // 40 - 60 → BUST
    expect(game.phase).toBe('score-entry');
    expect(needsScoreEntry(game.current)).toBe(false);
    expect(roundScoreOf(game.current!)).toBe(0);
    game = advanceRound(game);
    expect(game.left).toBe(100);
    expect(game.rounds[0].scored).toBe(0);
    expect(game.rounds[0].leftAfter).toBe(100);
    expect(game.current?.round).toBe(2);
    expect(game.current?.leftBefore).toBe(100);
  });

  it('アウトボード（0 点）でもラウンドは続く', () => {
    // 狙い点が盤面の外へ出ることはないので、ここは BUST しない 0 点の確認。
    const game = throwAt(createGame(perfect(501), 1), 'segment-s1-inner');
    expect(game.current?.throws[0].score).toBe(1);
    expect(game.current?.bust).toBe(false);
  });
});

describe('暗算入力と CALCULATION MISS', () => {
  it('正しい合計を入れれば miss にならない', () => {
    let game = throwMany(createGame(perfect(501), 1), [
      'segment-t20',
      'segment-t20',
      'segment-s20-outer',
    ]);
    game = submitScore(game, 140);
    expect(game.current?.entry).toEqual({
      entered: 140,
      actual: 140,
      miss: false,
      wrongEntries: [],
    });
    game = advanceRound(game);
    expect(game.left).toBe(361);
  });

  it('違う合計では次のラウンドへ進めず、正解するまで入力を求める', () => {
    let game = throwMany(createGame(perfect(501), 1), [
      'segment-t20',
      'segment-t19',
      'segment-s5-inner',
    ]);
    const actual = 60 + 57 + 5;

    game = submitScore(game, actual + 4);
    expect(hasWrongEntry(game.current)).toBe(true);
    expect(game.current?.entry).toBeNull();
    expect(game.current?.wrongEntries).toEqual([actual + 4]);
    // まだ確定していないので進めない。
    expect(needsScoreEntry(game.current)).toBe(true);
    expect(advanceRound(game)).toBe(game);

    // 2 回目も間違えれば、そのぶん記録が増える。
    game = submitScore(game, actual - 1);
    expect(game.current?.wrongEntries).toEqual([actual + 4, actual - 1]);
    expect(advanceRound(game)).toBe(game);

    // 正解して初めて確定する。
    game = submitScore(game, actual);
    expect(game.current?.entry).toEqual({
      entered: actual,
      actual,
      miss: true,
      wrongEntries: [actual + 4, actual - 1],
    });
    expect(hasWrongEntry(game.current)).toBe(false);

    game = advanceRound(game);
    expect(game.left).toBe(501 - actual);
    expect(game.rounds[0].entry?.miss).toBe(true);
    expect(game.rounds[0].entry?.wrongEntries).toHaveLength(2);
  });

  it('UNDO すると、間違えた入力の記録も捨てる（合計が変わるため）', () => {
    let game = throwMany(createGame(human(501), 9), [
      'segment-t20',
      'segment-t20',
      'segment-t20',
    ]);
    game = submitScore(game, 1);
    expect(game.current?.wrongEntries).toHaveLength(1);
    game = undoLastThrow(game);
    expect(game.current?.wrongEntries).toEqual([]);
    expect(hasWrongEntry(game.current)).toBe(false);
  });

  it('入力前は次のラウンドへ進めない', () => {
    const game = throwMany(createGame(perfect(501), 1), [
      'segment-t20',
      'segment-t20',
      'segment-t20',
    ]);
    expect(advanceRound(game)).toBe(game);
  });

  it('正解を確定したあとは、もう入力を受け付けない', () => {
    const game = throwMany(createGame(perfect(501), 1), [
      'segment-t20',
      'segment-t20',
      'segment-t20',
    ]);
    const submitted = submitScore(game, 180);
    expect(submitted.current?.entry?.miss).toBe(false);
    expect(submitScore(submitted, 100)).toBe(submitted);
  });
});

describe('UNDO（直前の 1 投だけ）', () => {
  it('狙いと着弾をまとめて取り消し、同じ DART 番号から狙い直せる', () => {
    let game = throwAt(createGame(human(501), 777), 'segment-t20');
    expect(canUndo(game)).toBe(true);
    game = undoLastThrow(game);
    expect(game.current?.throws).toHaveLength(0);
    expect(game.phase).toBe('aiming');
    expect(currentLeft(game)).toBe(501);
    expect(dartsLeftInRound(game.current)).toBe(3);
  });

  it('UNDO しても乱数は巻き戻るので、結果の引き直しにはならない', () => {
    const start = createGame(human(501), 12345);
    const first = throwAt(start, 'segment-t20');
    const again = throwAt(undoLastThrow(first), 'segment-t20');
    expect(again.current?.throws[0].actualPoint).toEqual(first.current?.throws[0].actualPoint);
    expect(again.current?.throws[0].actualDartId).toBe(first.current?.throws[0].actualDartId);
  });

  it('3 投そろったあとでも、暗算入力の前なら戻せる', () => {
    let game = throwMany(createGame(human(501), 3), [
      'segment-t20',
      'segment-t20',
      'segment-t20',
    ]);
    expect(game.phase).toBe('score-entry');
    expect(canUndo(game)).toBe(true);
    game = undoLastThrow(game);
    expect(game.phase).toBe('aiming');
    expect(game.current?.throws).toHaveLength(2);
  });

  it('暗算入力を済ませたら、もう戻せない', () => {
    const game = submitScore(
      throwMany(createGame(perfect(501), 3), ['segment-t20', 'segment-t20', 'segment-t20']),
      180,
    );
    expect(canUndo(game)).toBe(false);
    expect(undoLastThrow(game)).toBe(game);
  });

  it('前のラウンドまでは戻せない', () => {
    const game = advanceRound(
      submitScore(
        throwMany(createGame(perfect(501), 3), ['segment-t20', 'segment-t20', 'segment-t20']),
        180,
      ),
    );
    expect(game.current?.round).toBe(2);
    expect(canUndo(game)).toBe(false);
  });

  it('1 投も投げていないときは戻せない', () => {
    expect(canUndo(createGame(perfect(501), 1))).toBe(false);
  });
});

describe('再現性（seed 固定）', () => {
  it('同じ seed・同じ狙いなら、着弾はまったく同じになる', () => {
    const aims = ['segment-t20', 'segment-t20', 'segment-t19'];
    const a = throwMany(createGame(human(501), 98765), aims);
    const b = throwMany(createGame(human(501), 98765), aims);
    expect(allThrows(b).map((r) => r.actualPoint)).toEqual(allThrows(a).map((r) => r.actualPoint));
  });

  it('seed が違えば着弾は変わる', () => {
    const aims = ['segment-t20', 'segment-t20', 'segment-t20'];
    const a = throwMany(createGame(human(501), 1), aims);
    const b = throwMany(createGame(human(501), 2), aims);
    expect(allThrows(b).map((r) => r.actualPoint)).not.toEqual(
      allThrows(a).map((r) => r.actualPoint),
    );
  });
});

describe('打ち切り', () => {
  it('MAX_ROUNDS に達したら、上がっていなくてもゲームを終える', () => {
    let game = createGame(perfect(3001), 1);
    // 1 ラウンド 180 点では 3001 を MAX_ROUNDS 以内に消化しきれない場面を作る。
    for (let round = 0; round < MAX_ROUNDS && game.phase !== 'finished'; round += 1) {
      game = throwMany(game, ['segment-s1-inner', 'segment-s1-inner', 'segment-s1-inner']);
      game = advanceRound(submitScore(game, 3));
    }
    expect(game.phase).toBe('finished');
    expect(game.abandoned).toBe(true);
    expect(game.rounds).toHaveLength(MAX_ROUNDS);
  });
});

describe('表示用の説明', () => {
  it('狙いと着弾を略記（S20 / T20 / D20）で表す', () => {
    const game = throwAt(createGame(perfect(501), 1), 'segment-t20');
    expect(describeThrow(game.current!.throws[0])).toEqual({ intended: 'T20', actual: 'T20' });

    const single = throwAt(createGame(perfect(501), 1), 'segment-s20-outer');
    expect(describeThrow(single.current!.throws[0])).toEqual({ intended: 'S20', actual: 'S20' });

    const double = throwAt(createGame(perfect(501), 1), 'segment-d16');
    expect(describeThrow(double.current!.throws[0])).toEqual({ intended: 'D16', actual: 'D16' });
  });

  it('BULL は SB / DB で表す', () => {
    const inner = throwAt(createGame(perfect(501), 1), 'segment-inner-bull');
    expect(describeThrow(inner.current!.throws[0])).toEqual({ intended: 'DB', actual: 'DB' });
    expect(inner.current!.throws[0].score).toBe(50);
  });

  it('アウターブルを押したら SB を狙い、狙い通りなら SB に入る', () => {
    // DB（中心）と SB（外側のリング）は別の的として扱う。
    const outer = throwAt(createGame(perfect(501), 1), 'segment-outer-bull');
    expect(describeThrow(outer.current!.throws[0])).toEqual({ intended: 'SB', actual: 'SB' });
    expect(outer.current!.throws[0].score).toBe(25);
  });
});

describe('内部の残り点は 1 投ごとに更新される（表示の固定とは別）', () => {
  it('LEFT BEFORE / LEFT AFTER が 1 投ごとに進む', () => {
    let game = createGame(perfect(501), 1);
    game = throwAt(game, 'segment-t20');
    game = throwAt(game, 'segment-t19');
    game = throwAt(game, 'segment-s5-outer');
    const [first, second, third] = game.current!.throws;

    expect(first.leftBefore).toBe(501);
    expect(first.leftAfter).toBe(441);
    expect(second.leftBefore).toBe(441);
    expect(second.leftAfter).toBe(384);
    expect(third.leftBefore).toBe(384);
    expect(third.leftAfter).toBe(379);
    // 内部の「いまの残り」も 1 投ごとに動いている。
    expect(currentLeft(game)).toBe(379);
  });

  it('ビジット開始時の残りは、そのビジットのあいだ変わらない（表示が参照する値）', () => {
    let game = createGame(perfect(501), 1);
    const leftBefore = game.current!.leftBefore;
    game = throwAt(game, 'segment-t20');
    expect(game.current!.leftBefore).toBe(leftBefore);
    game = throwAt(game, 'segment-t20');
    expect(game.current!.leftBefore).toBe(leftBefore);
    game = throwAt(game, 'segment-t20');
    expect(game.current!.leftBefore).toBe(leftBefore);
    // 得点を確定して次のビジットへ進んだときだけ変わる。
    game = advanceRound(submitScore(game, 180));
    expect(game.current!.leftBefore).toBe(321);
  });
});

describe('3 投目より前の Checkout / BUST でビジットを終える', () => {
  it('1 投目の Checkout でビジットが終わり、残りのダーツは投げられない', () => {
    let game = throwAt(createGame(perfect(40), 1), 'segment-d20');
    expect(game.current!.checkout).toBe(true);
    expect(game.current!.throws).toHaveLength(1);
    expect(game.phase).toBe('score-entry');
    // それ以上は投げられない。
    expect(throwAt(game, 'segment-t20')).toBe(game);
    // ビジット開始時の残りは 40 のまま（表示はこれを見る）。
    expect(game.current!.leftBefore).toBe(40);
    game = advanceRound(submitScore(game, 40));
    expect(game.phase).toBe('finished');
  });

  it('2 投目の Checkout でも同じ', () => {
    let game = createGame(perfect(100), 1);
    game = throwAt(game, 'segment-t20'); // 100 → 40
    game = throwAt(game, 'segment-d20'); // 40 → 0
    expect(game.current!.checkout).toBe(true);
    expect(game.current!.throws).toHaveLength(2);
    expect(throwAt(game, 'segment-t20')).toBe(game);
    expect(game.current!.leftBefore).toBe(100);
    game = advanceRound(submitScore(game, 100));
    expect(game.phase).toBe('finished');
  });

  it('1 投目の BUST でビジットが終わり、次のビジットは同じ残りで始まる', () => {
    let game = throwAt(createGame(perfect(40), 1), 'segment-t20');
    expect(game.current!.bust).toBe(true);
    expect(game.current!.throws).toHaveLength(1);
    expect(throwAt(game, 'segment-d20')).toBe(game);
    game = advanceRound(game);
    expect(game.current!.round).toBe(2);
    expect(game.current!.leftBefore).toBe(40);
  });

  it('2 投目の BUST でも同じ', () => {
    let game = createGame(perfect(100), 1);
    game = throwAt(game, 'segment-t20'); // 100 → 40
    game = throwAt(game, 'segment-t20'); // 40 - 60 → BUST
    expect(game.current!.bust).toBe(true);
    expect(game.current!.throws).toHaveLength(2);
    expect(throwAt(game, 'segment-d20')).toBe(game);
    game = advanceRound(game);
    expect(game.current!.round).toBe(2);
    expect(game.current!.leftBefore).toBe(100);
  });
});
