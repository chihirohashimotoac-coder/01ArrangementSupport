/**
 * SIMULATION の進行（ゲーム状態機械）。
 *
 * 既存の 01 ルール判定（`domain/checkoutRules.ts` の `applyDart`）をそのまま使い、
 * Double Out / BUST の解釈はアプリ全体で 1 つに保つ。ここが持つのは
 * 「ラウンド・投数・暗算入力・UNDO」という SIMULATION 固有の進行だけ。
 *
 * 状態はすべて **プレーンなデータ**にしてある（乱数器も seed と消費数で表す）。
 * そのため UNDO は「1 投前のデータへ戻す」だけで済み、同じ的へ投げ直せば
 * 必ず同じ着弾になる（UNDO で結果を引き直せてしまう抜け道を作らない）。
 */
import { DARTS_PER_VISIT, applyDart, type BustReason } from '../../domain/checkoutRules';
import { requireDart } from '../../domain/dart';
import { getSegmentById, type SegmentDefinition } from '../../domain/segments';
import { createRandom, type RandomSource } from '../training/random';
import type { Point } from './boardGeometry';
import { simulateThrow, type ThrowAbility } from './throwSimulator';
import { clampPpr, type MaxMissLevel, type MissDirection } from './accuracy';

/** 開始点数として選べる既定値。 */
export const PRESET_START_SCORES: readonly number[] = [301, 501, 701];
export const DEFAULT_START_SCORE = 501;
/** CUSTOM 開始点の上限。エンジンの上限ではなく、入力ミス避けの実用上の枠。 */
export const MAX_START_SCORE = 3001;
export const MIN_START_SCORE = 2;

/**
 * 1 ゲームのラウンド数の上限。
 *
 * 能力が極端に低い設定でも必ず終わるようにするための安全弁。
 * 実戦で到達することはまずない。
 */
export const MAX_ROUNDS = 100;

export interface SimulationSettings {
  readonly startScore: number;
  readonly first9Ppr: number;
  readonly averagePpr: number;
  readonly missDirection: MissDirection;
  readonly maxMiss: MaxMissLevel;
}

/** 1 投の記録（レビュー用の一次データ）。 */
export interface ThrowRecord {
  /** 1 から数えるラウンド。 */
  readonly round: number;
  /** ラウンド内の何投目か（1〜3）。 */
  readonly dartNumber: number;
  /** ゲーム全体での通し投数（1 から）。 */
  readonly dartIndex: number;
  readonly leftBefore: number;
  /** 狙った区画の ID（例: segment-t20）。 */
  readonly intendedSegmentId: string;
  /** 狙いを 1 投として表した ID（例: T20）。 */
  readonly intendedDartId: string;
  readonly intendedPoint: Point;
  readonly actualPoint: Point;
  /** 実際に刺さった 1 投の ID（例: S20 / MISS）。 */
  readonly actualDartId: string;
  readonly score: number;
  /** この 1 投のあとの残り（BUST のときは leftBefore のまま）。 */
  readonly leftAfter: number;
  readonly bust: boolean;
  readonly bustReason: BustReason | null;
  readonly checkout: boolean;
  /** この 1 投を投げる直前までに消費していた乱数の回数（UNDO の巻き戻し用）。 */
  readonly drawsBefore: number;
}

/** 暗算入力の結果。 */
export interface ScoreEntry {
  readonly entered: number;
  readonly actual: number;
  readonly miss: boolean;
}

/** 進行中のラウンド。 */
export interface ActiveRound {
  readonly round: number;
  readonly leftBefore: number;
  readonly throws: readonly ThrowRecord[];
  readonly bust: boolean;
  readonly bustReason: BustReason | null;
  readonly checkout: boolean;
  /** 3 投投げ切った／上がった／BUST した。 */
  readonly complete: boolean;
  /** 暗算入力の結果。未入力は null。BUST のラウンドでは入力を求めない。 */
  readonly entry: ScoreEntry | null;
}

/** 確定したラウンド。 */
export interface RoundRecord {
  readonly round: number;
  readonly leftBefore: number;
  readonly throws: readonly ThrowRecord[];
  /** このラウンドで実際に減った点数（BUST なら 0）。 */
  readonly scored: number;
  readonly leftAfter: number;
  readonly bust: boolean;
  readonly bustReason: BustReason | null;
  readonly checkout: boolean;
  readonly entry: ScoreEntry | null;
}

export type SimulationPhase = 'aiming' | 'score-entry' | 'finished';

export interface SimulationGame {
  readonly settings: SimulationSettings;
  readonly seed: number;
  /** これまでに消費した乱数の回数。UNDO で巻き戻す。 */
  readonly draws: number;
  readonly phase: SimulationPhase;
  readonly left: number;
  readonly rounds: readonly RoundRecord[];
  readonly current: ActiveRound | null;
  /** 上がらずに MAX_ROUNDS で打ち切ったか。 */
  readonly abandoned: boolean;
}

/** 入力値を安全な範囲へ収める。 */
export function normalizeSettings(settings: SimulationSettings): SimulationSettings {
  const raw = Math.round(settings.startScore);
  const startScore = Number.isFinite(raw)
    ? Math.min(Math.max(raw, MIN_START_SCORE), MAX_START_SCORE)
    : DEFAULT_START_SCORE;
  return {
    startScore,
    first9Ppr: clampPpr(settings.first9Ppr),
    averagePpr: clampPpr(settings.averagePpr),
    missDirection: settings.missDirection,
    maxMiss: settings.maxMiss,
  };
}

function abilityOf(settings: SimulationSettings): ThrowAbility {
  return {
    first9Ppr: settings.first9Ppr,
    averagePpr: settings.averagePpr,
    missDirection: settings.missDirection,
    maxMiss: settings.maxMiss,
  };
}

/**
 * seed から `skip` 回ぶん進めた乱数器と、消費数のカウンタを作る。
 *
 * mulberry32 は状態が 1 つの整数なので、同じ seed で同じ回数だけ空打ちすれば
 * まったく同じ続きになる。1 ゲームで消費するのは高々数百回なので、
 * 空打ちのコストは無視できる。
 */
function resumeRandom(seed: number, skip: number): { source: RandomSource; used: () => number } {
  const base = createRandom(seed);
  for (let i = 0; i < skip; i += 1) base.next();
  let count = 0;
  const source: RandomSource = {
    next: () => {
      count += 1;
      return base.next();
    },
    nextInt: (min, max) => {
      count += 1;
      return base.nextInt(min, max);
    },
    pick: (items) => {
      count += 1;
      return base.pick(items);
    },
  };
  return { source, used: () => count };
}

function newRound(round: number, leftBefore: number): ActiveRound {
  return {
    round,
    leftBefore,
    throws: [],
    bust: false,
    bustReason: null,
    checkout: false,
    complete: false,
    entry: null,
  };
}

/** ゲームを作る。seed を省略すると呼び出し側で決める（UI 側は毎回変える）。 */
export function createGame(settings: SimulationSettings, seed: number): SimulationGame {
  const normalized = normalizeSettings(settings);
  return {
    settings: normalized,
    seed: seed >>> 0,
    draws: 0,
    phase: 'aiming',
    left: normalized.startScore,
    rounds: [],
    current: newRound(1, normalized.startScore),
    abandoned: false,
  };
}

/** このラウンドで残っている投数。 */
export function dartsLeftInRound(round: ActiveRound | null): number {
  if (round === null) return 0;
  return Math.max(DARTS_PER_VISIT - round.throws.length, 0);
}

/** 現在の残り点（ラウンド途中はその時点の残り）。 */
export function currentLeft(game: SimulationGame): number {
  const round = game.current;
  if (round === null) return game.left;
  if (round.bust) return round.leftBefore;
  const last = round.throws[round.throws.length - 1];
  return last === undefined ? round.leftBefore : last.leftAfter;
}

/** ゲーム全体での通し投数。 */
export function totalDarts(game: SimulationGame): number {
  const committed = game.rounds.reduce((sum, round) => sum + round.throws.length, 0);
  return committed + (game.current?.throws.length ?? 0);
}

/** UNDO できるか。暗算入力を済ませたあとは戻せない（状態の不整合を避ける）。 */
export function canUndo(game: SimulationGame): boolean {
  if (game.phase === 'finished') return false;
  if (game.current === null || game.current.throws.length === 0) return false;
  return game.current.entry === null;
}

/**
 * 1 投を投げる。
 *
 * @param segmentId 狙った区画の ID。MISS リングは狙えない。
 */
export function throwAt(game: SimulationGame, segmentId: string): SimulationGame {
  if (game.phase !== 'aiming' || game.current === null) return game;
  const segment = getSegmentById(segmentId);
  if (segment === undefined || segment.ring === 'miss') return game;
  return throwAtSegment(game, segment);
}

function throwAtSegment(game: SimulationGame, segment: SegmentDefinition): SimulationGame {
  const round = game.current;
  if (round === null) return game;

  const { source, used } = resumeRandom(game.seed, game.draws);
  const dartIndex = totalDarts(game) + 1;
  const leftBefore = currentLeft(game);
  const simulated = simulateThrow(segment, abilityOf(game.settings), dartIndex, source);
  const result = applyDart(leftBefore, simulated.landing.dart);

  const record: ThrowRecord = {
    round: round.round,
    dartNumber: round.throws.length + 1,
    dartIndex,
    leftBefore,
    intendedSegmentId: segment.id,
    intendedDartId: segment.dart.id,
    intendedPoint: simulated.intendedPoint,
    actualPoint: simulated.actualPoint,
    actualDartId: simulated.landing.dart.id,
    score: simulated.landing.dart.score,
    leftAfter: result.remainingAfter,
    bust: result.outcome === 'bust',
    bustReason: result.bustReason,
    checkout: result.outcome === 'checkout',
    drawsBefore: game.draws,
  };

  const throws = [...round.throws, record];
  const complete =
    record.bust || record.checkout || throws.length >= DARTS_PER_VISIT;

  const nextRound: ActiveRound = {
    ...round,
    throws,
    bust: record.bust,
    bustReason: record.bustReason,
    checkout: record.checkout,
    complete,
    // BUST のラウンドは 3 投そろわないので暗算入力を求めない（得点は 0）。
    entry: null,
  };

  return {
    ...game,
    draws: game.draws + used(),
    phase: complete ? 'score-entry' : 'aiming',
    current: nextRound,
  };
}

/** 直前の 1 投を取り消す。 */
export function undoLastThrow(game: SimulationGame): SimulationGame {
  if (!canUndo(game) || game.current === null) return game;
  const throws = game.current.throws.slice(0, -1);
  const last = game.current.throws[game.current.throws.length - 1];
  return {
    ...game,
    // その 1 投で消費した乱数だけを戻す。
    draws: last.drawsBefore,
    phase: 'aiming',
    current: {
      ...game.current,
      throws,
      bust: false,
      bustReason: null,
      checkout: false,
      complete: false,
      entry: null,
    },
  };
}

/** このラウンドで実際に減る点数。BUST は 0。 */
export function roundScoreOf(round: ActiveRound | RoundRecord): number {
  if (round.bust) return 0;
  return round.throws.reduce((sum, record) => sum + record.score, 0);
}

/** 暗算入力を求めるラウンドか。BUST では求めない。 */
export function needsScoreEntry(round: ActiveRound | null): boolean {
  return round !== null && round.complete && !round.bust && round.entry === null;
}

/**
 * 暗算した 3 投合計を入力する。
 *
 * 内部の正しい合計と違っても、進行には必ず正しい合計を使う。
 */
export function submitScore(game: SimulationGame, entered: number): SimulationGame {
  if (game.phase !== 'score-entry' || game.current === null) return game;
  if (!needsScoreEntry(game.current)) return game;
  const actual = roundScoreOf(game.current);
  return {
    ...game,
    current: {
      ...game.current,
      entry: { entered, actual, miss: entered !== actual },
    },
  };
}

/** 次のラウンドへ進む（上がっていればゲーム終了）。 */
export function advanceRound(game: SimulationGame): SimulationGame {
  if (game.phase !== 'score-entry' || game.current === null) return game;
  if (needsScoreEntry(game.current)) return game;

  const round = game.current;
  const scored = roundScoreOf(round);
  const leftAfter = round.bust ? round.leftBefore : round.leftBefore - scored;
  const committed: RoundRecord = {
    round: round.round,
    leftBefore: round.leftBefore,
    throws: round.throws,
    scored,
    leftAfter,
    bust: round.bust,
    bustReason: round.bustReason,
    checkout: round.checkout,
    entry: round.entry,
  };

  const rounds = [...game.rounds, committed];
  if (round.checkout) {
    return { ...game, phase: 'finished', left: 0, rounds, current: null };
  }
  if (round.round >= MAX_ROUNDS) {
    return { ...game, phase: 'finished', left: leftAfter, rounds, current: null, abandoned: true };
  }
  return {
    ...game,
    phase: 'aiming',
    left: leftAfter,
    rounds,
    current: newRound(round.round + 1, leftAfter),
  };
}

/** 全投の一覧（確定ラウンド + 進行中）。 */
export function allThrows(game: SimulationGame): readonly ThrowRecord[] {
  return [...game.rounds.flatMap((round) => round.throws), ...(game.current?.throws ?? [])];
}

/**
 * ある 1 投が最終的に得点として数えられたか（BUST ラウンドは 0）。
 * PPR の計算で使う。
 */
export function countedScoreOf(round: RoundRecord, record: ThrowRecord): number {
  return round.bust ? 0 : record.score;
}

/** 表示用に、1 投の「狙い」と「着弾」を日本語で表す。 */
export function describeThrow(record: ThrowRecord): { intended: string; actual: string } {
  return {
    intended: requireDart(record.intendedDartId).nameJa,
    actual: record.actualDartId === 'MISS' ? 'アウトボード' : requireDart(record.actualDartId).nameJa,
  };
}
