/**
 * SIMULATION の散布モデルを検証・キャリブレーションするための試行ハーネス。
 *
 * production bundle へは入れない（`src/` ではなく `scripts/` に置く）。
 * ここから使うのは `src/engine/simulation/**` と既存エンジンの公開 API だけで、
 * 既存のロジックへは一切手を入れない。
 *
 * ## ターゲット選択戦略を固定する理由
 *
 * 実ゲームの PPR は「本人のアレンジ判断」でも動いてしまう。モデルの σ を
 * 逆算するときにそれが混ざると何を測っているのか分からなくなるので、
 * **アプリのおすすめをそのまま投げる固定戦略**のプレイヤーで測る。
 * 戦略は (残り, 残り本数) だけで決まる決定論的な関数なので、memo 化できる。
 */
import { DARTS_PER_VISIT, MAX_SETUP_REMAINING, applyDart } from '../../src/domain/checkoutRules';
import { requireDart } from '../../src/domain/dart';
import type { SegmentDefinition } from '../../src/domain/segments';
import { DEFAULT_SETUP_MAIN_TARGET } from '../../src/data/rankingRules';
import { suggestFor } from '../../src/engine/recovery/suggest';
import { aimSegmentForDart, radiusOf } from '../../src/engine/simulation/boardGeometry';
import { throwWithSigma } from '../../src/engine/simulation/throwSimulator';
import { createRandom } from '../../src/engine/training/random';
import type {
  MaxMissLevel,
  MissDirection,
} from '../../src/engine/simulation/accuracy';

const aimCache = new Map<string, SegmentDefinition>();

/** 主目標（既定は T20）を狙う区画。 */
function mainTargetSegment(): SegmentDefinition {
  const segment = aimSegmentForDart(DEFAULT_SETUP_MAIN_TARGET);
  if (segment === undefined) throw new Error('主目標の区画が見つかりません。');
  return segment;
}

/**
 * 固定戦略：アプリの推奨の 1 投目をそのまま狙う。
 *
 * 351 以上（アプリの対象外）は主目標 T20 を狙う。
 */
export function referenceAim(remaining: number, dartsLeft: number): SegmentDefinition {
  const key = `${remaining}/${dartsLeft}`;
  const cached = aimCache.get(key);
  if (cached !== undefined) return cached;

  let segment: SegmentDefinition | undefined;
  if (remaining > MAX_SETUP_REMAINING) {
    segment = mainTargetSegment();
  } else {
    const suggestion = suggestFor(remaining, dartsLeft);
    const dartId =
      suggestion.checkoutRoutes[0]?.darts[0]?.id ??
      suggestion.nextVisitProposals[0]?.route.darts[0]?.id ??
      suggestion.setupRoutes[0]?.darts[0]?.id ??
      null;
    segment = dartId === null ? mainTargetSegment() : aimSegmentForDart(dartId);
  }
  const resolved = segment ?? mainTargetSegment();
  aimCache.set(key, resolved);
  return resolved;
}

export interface GameOptions {
  readonly startScore: number;
  /** 1〜9 投目の σ（mm）。 */
  readonly first9Sigma: number;
  /** 10 投目以降の σ（mm）。 */
  readonly averageSigma: number;
  readonly direction: MissDirection;
  readonly maxMiss: MaxMissLevel;
  /** 打ち切りラウンド数。 */
  readonly maxRounds?: number;
}

export interface GameOutcome {
  readonly darts: number;
  /** 実際に減った合計点（BUST ラウンドは 0）。 */
  readonly scored: number;
  readonly first9Scored: number;
  readonly first9Darts: number;
  readonly checkedOut: boolean;
  readonly bustRounds: number;
}

/** First9 → Average の遷移（`accuracy.ts` の `sigmaForDart` と同じ形）。 */
function sigmaAt(options: GameOptions, dartIndex: number, transition = 6): number {
  if (dartIndex <= 9) return options.first9Sigma;
  const step = Math.min(dartIndex - 9, transition);
  const weight = 1 - step / transition;
  return options.first9Sigma * weight + options.averageSigma * (1 - weight);
}

/** 固定戦略で 1 ゲーム投げ切る。 */
export function playGame(options: GameOptions, seed: number): GameOutcome {
  const random = createRandom(seed);
  const maxRounds = options.maxRounds ?? 100;
  let left = options.startScore;
  let darts = 0;
  let scored = 0;
  let bustRounds = 0;
  let checkedOut = false;
  /** 通し投数 → 最終的に数えられた得点（BUST ラウンドは 0）。 */
  const countedScores: number[] = [];

  for (let round = 1; round <= maxRounds && !checkedOut; round += 1) {
    const roundStart = left;
    const roundDartIndices: number[] = [];
    let roundScore = 0;
    let bust = false;

    for (let dart = 0; dart < DARTS_PER_VISIT; dart += 1) {
      const segment = referenceAim(left, DARTS_PER_VISIT - dart);
      darts += 1;
      const sigma = sigmaAt(options, darts);
      const result = throwWithSigma(segment, sigma, options.direction, options.maxMiss, random);
      const applied = applyDart(left, result.landing.dart);
      roundDartIndices.push(darts);
      countedScores[darts] = result.landing.dart.score;

      if (applied.outcome === 'bust') {
        bust = true;
        break;
      }
      roundScore += result.landing.dart.score;
      left = applied.remainingAfter;
      if (applied.outcome === 'checkout') {
        checkedOut = true;
        break;
      }
    }

    if (bust) {
      bustRounds += 1;
      left = roundStart;
      // BUST したラウンドは 1 投目から得点にならない。
      for (const index of roundDartIndices) countedScores[index] = 0;
    } else {
      scored += roundScore;
    }
  }

  const first9Darts = Math.min(darts, 9);
  let first9Scored = 0;
  for (let index = 1; index <= first9Darts; index += 1) first9Scored += countedScores[index] ?? 0;

  return { darts, scored, first9Scored, first9Darts, checkedOut, bustRounds };
}

export interface Measurement {
  readonly games: number;
  readonly ppr: number;
  readonly first9Ppr: number;
  readonly averageDarts: number;
  readonly checkoutRate: number;
  readonly bustPerGame: number;
}

/** 大量試行して PPR を測る。 */
export function measure(options: GameOptions, games: number, seed = 1): Measurement {
  let totalScored = 0;
  let totalDarts = 0;
  let first9Scored = 0;
  let first9Darts = 0;
  let checkedOut = 0;
  let busts = 0;
  for (let i = 0; i < games; i += 1) {
    const outcome = playGame(options, seed + i * 7919);
    totalScored += outcome.scored;
    totalDarts += outcome.darts;
    first9Scored += outcome.first9Scored;
    first9Darts += outcome.first9Darts;
    if (outcome.checkedOut) checkedOut += 1;
    busts += outcome.bustRounds;
  }
  return {
    games,
    ppr: totalDarts > 0 ? (totalScored / totalDarts) * 3 : 0,
    first9Ppr: first9Darts > 0 ? (first9Scored / first9Darts) * 3 : 0,
    averageDarts: totalDarts / games,
    checkoutRate: checkedOut / games,
    bustPerGame: busts / games,
  };
}

/**
 * 目標 PPR になる σ を二分探索で求める。
 *
 * σ が大きいほど PPR は単調に下がるので、二分探索が使える。
 */
export function solveSigmaForPpr(
  targetPpr: number,
  base: Omit<GameOptions, 'first9Sigma' | 'averageSigma'>,
  games = 400,
  iterations = 22,
): number {
  let low = 0;
  let high = 220;
  for (let i = 0; i < iterations; i += 1) {
    const mid = (low + high) / 2;
    const result = measure({ ...base, first9Sigma: mid, averageSigma: mid }, games, 20260916);
    if (result.ppr > targetPpr) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export interface ScatterStats {
  readonly samples: number;
  readonly sdX: number;
  readonly sdY: number;
  readonly meanRadius: number;
  /** 狙い点から 60 mm 以上外れた割合（大ミスの目安）。 */
  readonly outlierRate: number;
  readonly outBoardRate: number;
  readonly hitRate: number;
}

/** ある的を狙い続けたときの散布を測る（モデル検証用）。 */
export function scatterStats(
  dartId: string,
  sigma: number,
  direction: MissDirection,
  maxMiss: MaxMissLevel,
  samples: number,
  seed = 12345,
): ScatterStats {
  const segment = aimSegmentForDart(dartId);
  if (segment === undefined) throw new Error(`狙えない的です: ${dartId}`);
  const random = createRandom(seed);
  let sumX2 = 0;
  let sumY2 = 0;
  let sumR = 0;
  let outliers = 0;
  let outBoard = 0;
  let hits = 0;
  const target = requireDart(dartId);

  for (let i = 0; i < samples; i += 1) {
    const result = throwWithSigma(segment, sigma, direction, maxMiss, random);
    const dx = result.actualPoint.x - result.intendedPoint.x;
    const dy = result.actualPoint.y - result.intendedPoint.y;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
    const offset = Math.hypot(dx, dy);
    sumR += offset;
    if (offset >= 60) outliers += 1;
    if (radiusOf(result.actualPoint) > 170) outBoard += 1;
    if (result.landing.dart.id === target.id) hits += 1;
  }

  return {
    samples,
    sdX: Math.sqrt(sumX2 / samples),
    sdY: Math.sqrt(sumY2 / samples),
    meanRadius: sumR / samples,
    outlierRate: outliers / samples,
    outBoardRate: outBoard / samples,
    hitRate: hits / samples,
  };
}
