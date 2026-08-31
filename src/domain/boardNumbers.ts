/**
 * ダーツボードのナンバー配置と、そこから導かれる幾何・隣接情報。
 *
 * 盤面上部（12時方向）を 20 とし、時計回りに並ぶ標準配置。
 * SVG へ直接数値を書き込まず、この配列を唯一の情報源として
 * セグメント定義・座標計算・隣接評価のすべてを生成する。
 */
export const BOARD_NUMBERS = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
] as const;

export type BoardNumber = (typeof BOARD_NUMBERS)[number];

/** 1 セグメントあたりの角度（度）。20 分割なので 18 度。 */
export const SEGMENT_ANGLE = 360 / BOARD_NUMBERS.length;

/**
 * 配列インデックスから、そのウェッジの中心角度（度）を返す。
 * SVG の座標系は y 軸が下向きなので、真上は -90 度。
 */
export function centerAngleOf(index: number): number {
  return -90 + SEGMENT_ANGLE * index;
}

/** 指定インデックスのウェッジの開始・終了角度（度）を返す。 */
export function angleRangeOf(index: number): { start: number; end: number } {
  const center = centerAngleOf(index);
  return { start: center - SEGMENT_ANGLE / 2, end: center + SEGMENT_ANGLE / 2 };
}

const INDEX_BY_NUMBER = new Map<number, number>(
  BOARD_NUMBERS.map((value, index) => [value, index]),
);

/** 表示数字（1〜20）から BOARD_NUMBERS 上のインデックスを返す。 */
export function indexOfNumber(value: number): number {
  const index = INDEX_BY_NUMBER.get(value);
  if (index === undefined) {
    throw new Error(`盤面に存在しないナンバーです: ${value}`);
  }
  return index;
}

/** 盤面が 1〜20 をちょうど 1 回ずつ含むことを保証する（データ破損検知用）。 */
export function isBoardNumberSetValid(): boolean {
  const unique = new Set(BOARD_NUMBERS);
  if (unique.size !== 20) return false;
  for (let n = 1; n <= 20; n += 1) {
    if (!unique.has(n as BoardNumber)) return false;
  }
  return true;
}
