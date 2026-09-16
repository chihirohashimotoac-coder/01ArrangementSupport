/**
 * 1 投の着弾シミュレーション。
 *
 * 狙った区画 → 狙い点（実寸 mm） → 散布 → 着弾座標 → 座標から得点判定、
 * という順で進む。得点から逆に確率を決めることはしない。
 *
 * 乱数は `engine/training/random.ts` の mulberry32 を再利用する。
 * seed を与えれば同じ着弾列が必ず再現できる（テスト用）。
 */
import type { SegmentDefinition } from '../../domain/segments';
import { createRandom, type RandomSource } from '../training/random';
import {
  aimPointOf,
  landingAt,
  type Landing,
  type Point,
} from './boardGeometry';
import {
  scatterProfile,
  sigmaForDart,
  type MaxMissLevel,
  type MissDirection,
  type ScatterProfile,
} from './accuracy';

export interface ThrowAbility {
  readonly first9Ppr: number;
  readonly averagePpr: number;
  readonly missDirection: MissDirection;
  readonly maxMiss: MaxMissLevel;
}

export interface SimulatedThrow {
  /** 狙い点（実寸 mm）。 */
  readonly intendedPoint: Point;
  /** 着弾点（実寸 mm）。 */
  readonly actualPoint: Point;
  /** 着弾の判定結果。 */
  readonly landing: Landing;
  /** この 1 投に使った散布幅（全体 RMS, mm）。表示はしないが検証に使う。 */
  readonly sigma: number;
}

/** 標準正規分布を 1 つ返す（Box-Muller 法）。 */
export function nextGaussian(random: RandomSource): number {
  // log(0) を避けるため、0 を引いたときだけ引き直す。
  let u = random.next();
  while (u <= Number.EPSILON) u = random.next();
  const v = random.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 狙い点に散布を加えて着弾点を作る。
 *
 * 低確率で大ミス成分（倍率 `outlierScale`）に切り替わる。
 */
export function scatterPoint(
  intended: Point,
  profile: ScatterProfile,
  random: RandomSource,
): Point {
  if (profile.sigmaX <= 0 && profile.sigmaY <= 0) return intended;
  const big = random.next() < profile.outlierRate;
  const factor = big ? profile.outlierScale : 1;
  return {
    x: intended.x + nextGaussian(random) * profile.sigmaX * factor,
    y: intended.y + nextGaussian(random) * profile.sigmaY * factor,
  };
}

/**
 * 散布幅 σ を直接指定して 1 投を投げる。
 *
 * キャリブレーション（σ ↔ PPR の逆算）では PPR ではなく σ を動かしたいので、
 * この入口を用意している。通常の進行では `simulateThrow()` を使う。
 */
export function throwWithSigma(
  segment: SegmentDefinition,
  sigma: number,
  direction: MissDirection,
  maxMiss: MaxMissLevel,
  random: RandomSource,
): SimulatedThrow {
  const intendedPoint = aimPointOf(segment);
  const profile = scatterProfile(sigma, direction, maxMiss);
  const actualPoint = scatterPoint(intendedPoint, profile, random);
  return { intendedPoint, actualPoint, landing: landingAt(actualPoint), sigma };
}

/**
 * 1 投を投げる。
 *
 * @param segment 狙った区画（盤面でタップしたところ）。
 * @param ability プレイヤー能力。
 * @param dartIndex 1 から数えた通し投数（First9 の反映に使う）。
 */
export function simulateThrow(
  segment: SegmentDefinition,
  ability: ThrowAbility,
  dartIndex: number,
  random: RandomSource,
): SimulatedThrow {
  const sigma = sigmaForDart(
    ability.first9Ppr,
    ability.averagePpr,
    dartIndex,
    ability.missDirection,
  );
  return throwWithSigma(segment, sigma, ability.missDirection, ability.maxMiss, random);
}

/** 本番の 1 ゲームぶんの seed を作る（テストからは固定値を渡す）。 */
export function createGameSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

export { createRandom };
export type { RandomSource };
