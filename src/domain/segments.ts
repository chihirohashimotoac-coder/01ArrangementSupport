/**
 * SVG ダーツボード上の領域定義。
 *
 * 「盤面のどこか」を表す SVG 上の区画と、「1 投として何点か」を表す Dart を
 * 明確に分ける。インナーシングルとアウターシングルは SVG 上は別区画だが、
 * 得点計算ではどちらも同じ Dart（S{n}）を指す。
 *
 * 幾何と描画のしくみは Darts Calculator の実装を参考に、
 * このリポジトリ用にコピーして独立管理している（共通パッケージ化はしない）。
 */
import { BOARD_NUMBERS } from './boardNumbers';
import { MISS_DART, requireDart, type Dart } from './dart';

export type SegmentRing =
  | 'inner-single'
  | 'triple'
  | 'outer-single'
  | 'double'
  | 'outer-bull'
  | 'inner-bull'
  | 'miss';

/** 盤面の配色グループ。実際の色は CSS 側で解決する。 */
export type SegmentColorGroup = 'dark' | 'light' | 'red' | 'green' | 'miss';

export interface SegmentDefinition {
  /** E2E テスト・DOM 参照で使う安定した識別子（例: segment-t20）。 */
  readonly id: string;
  readonly ring: SegmentRing;
  /** この区画に刺さったときの 1 投。 */
  readonly dart: Dart;
  /** 1〜20 の表示数字。BULL / MISS は null。 */
  readonly baseNumber: number | null;
  /** BOARD_NUMBERS 上のインデックス。BULL / MISS は null。 */
  readonly index: number | null;
  readonly colorGroup: SegmentColorGroup;
  readonly ariaLabel: string;
}

function wedgeSegment(
  index: number,
  ring: 'inner-single' | 'triple' | 'outer-single' | 'double',
): SegmentDefinition {
  const baseNumber = BOARD_NUMBERS[index];
  const prefix = ring === 'triple' ? 'T' : ring === 'double' ? 'D' : 'S';
  const dart = requireDart(`${prefix}${baseNumber}`);
  const id =
    ring === 'inner-single'
      ? `segment-s${baseNumber}-inner`
      : ring === 'outer-single'
        ? `segment-s${baseNumber}-outer`
        : `segment-${prefix.toLowerCase()}${baseNumber}`;

  // 20 を含む偶数インデックスを黒／赤系、奇数インデックスを白／緑系にする。
  const isDarkWedge = index % 2 === 0;
  const colorGroup: SegmentColorGroup =
    ring === 'triple' || ring === 'double'
      ? isDarkWedge
        ? 'red'
        : 'green'
      : isDarkWedge
        ? 'dark'
        : 'light';

  return {
    id,
    ring,
    dart,
    baseNumber,
    index,
    colorGroup,
    ariaLabel: `${dart.nameJa}、${dart.score}点`,
  };
}

const MISS_SEGMENT: SegmentDefinition = {
  id: 'segment-miss',
  ring: 'miss',
  dart: MISS_DART,
  baseNumber: null,
  index: null,
  colorGroup: 'miss',
  ariaLabel: 'ミス、0点',
};

const OUTER_BULL_SEGMENT: SegmentDefinition = {
  id: 'segment-outer-bull',
  ring: 'outer-bull',
  dart: requireDart('SB'),
  baseNumber: null,
  index: null,
  colorGroup: 'green',
  ariaLabel: 'アウターブル、25点',
};

const INNER_BULL_SEGMENT: SegmentDefinition = {
  id: 'segment-inner-bull',
  ring: 'inner-bull',
  dart: requireDart('BULL'),
  baseNumber: null,
  index: null,
  colorGroup: 'red',
  ariaLabel: 'ブル、50点',
};

/**
 * 全 83 区画。描画順（背面 → 前面）でもあるため、
 * MISS リング → ウェッジ → BULL の順に並べている。
 */
export const SEGMENTS: readonly SegmentDefinition[] = [
  MISS_SEGMENT,
  ...BOARD_NUMBERS.flatMap((_, index) => [
    wedgeSegment(index, 'inner-single'),
    wedgeSegment(index, 'triple'),
    wedgeSegment(index, 'outer-single'),
    wedgeSegment(index, 'double'),
  ]),
  OUTER_BULL_SEGMENT,
  INNER_BULL_SEGMENT,
];

const BY_ID = new Map(SEGMENTS.map((segment) => [segment.id, segment]));

export function getSegmentById(id: string): SegmentDefinition | undefined {
  return BY_ID.get(id);
}

/**
 * Dart から、盤面上でその的を代表する区画を返す。
 * シングルはアウターシングル（太い外側）を代表とする。
 */
export function representativeSegmentOf(dartId: string): SegmentDefinition | undefined {
  return SEGMENTS.find((segment) => {
    if (segment.dart.id !== dartId) return false;
    return segment.ring !== 'inner-single';
  });
}
