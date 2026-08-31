/**
 * 盤面の物理配置に基づく「ズレ」のデータ。
 *
 * ルートの安全性評価に使う。ここでは事実（どこへズレうるか）だけを持ち、
 * その良し悪しの重み付けは data/rankingRules.ts が持つ。
 */
import { BOARD_NUMBERS, indexOfNumber } from '../domain/boardNumbers';
import { findDart, type Dart } from '../domain/dart';

export interface NumberNeighbors {
  readonly number: number;
  /** 盤面で反時計回り側の隣。 */
  readonly counterClockwise: number;
  /** 盤面で時計回り側の隣。 */
  readonly clockwise: number;
}

/** 1〜20 それぞれの左右の隣ナンバー。BOARD_NUMBERS から機械的に導出する。 */
export const NUMBER_NEIGHBORS: ReadonlyMap<number, NumberNeighbors> = new Map(
  BOARD_NUMBERS.map((value) => {
    const index = indexOfNumber(value);
    const size = BOARD_NUMBERS.length;
    return [
      value,
      {
        number: value,
        counterClockwise: BOARD_NUMBERS[(index - 1 + size) % size],
        clockwise: BOARD_NUMBERS[(index + 1) % size],
      },
    ];
  }),
);

/** 指定ナンバーの左右の隣（例: 20 → [5, 1]）。 */
export function neighborsOf(value: number): readonly [number, number] {
  const entry = NUMBER_NEIGHBORS.get(value);
  if (!entry) throw new Error(`盤面に存在しないナンバーです: ${value}`);
  return [entry.counterClockwise, entry.clockwise];
}

/** ズレの方向。 */
export type MissDirection =
  /** 横ズレ: 隣のウェッジの同じリング（例: T20 → T5 / T1）。 */
  | 'horizontal'
  /** 縦ズレ: 同じウェッジの別リング（例: T20 → S20）。 */
  | 'vertical';

export interface MissVariant {
  readonly dart: Dart;
  readonly direction: MissDirection;
  /** 説明生成に使う短いラベル。 */
  readonly labelJa: string;
}

/**
 * 狙ったセグメントから「実戦で起きやすいズレ」を列挙する。
 *
 * - 縦ズレ: トリプル/ダブルを狙ってシングルへ落ちる（最頻出）。
 * - 横ズレ: 隣ナンバーの同じリングへ入る。
 *
 * BULL / アウターブルは横ズレの相手が特定できないため、
 * 縦ズレ（BULL → アウターブル）のみを扱う。
 */
export function missVariantsOf(target: Dart): readonly MissVariant[] {
  const variants: MissVariant[] = [];

  if (target.id === 'BULL') {
    const outer = findDart('SB');
    if (outer) {
      variants.push({ dart: outer, direction: 'vertical', labelJa: 'アウターブルへ外す' });
    }
    return variants;
  }
  if (target.id === 'SB' || target.baseNumber === null) return variants;

  // 縦ズレ: トリプル・ダブルからシングルへ。
  if (target.kind === 'triple' || target.kind === 'double') {
    const single = findDart(`S${target.baseNumber}`);
    if (single) {
      variants.push({
        dart: single,
        direction: 'vertical',
        labelJa: `S${target.baseNumber} へ落とす`,
      });
    }
  }

  // 横ズレ: 隣ナンバーの同じリングへ。
  const prefix = target.kind === 'triple' ? 'T' : target.kind === 'double' ? 'D' : 'S';
  for (const neighbor of neighborsOf(target.baseNumber)) {
    const dart = findDart(`${prefix}${neighbor}`);
    if (dart) {
      variants.push({
        dart,
        direction: 'horizontal',
        labelJa: `隣の ${dart.id} へ横ズレ`,
      });
    }
  }
  return variants;
}
