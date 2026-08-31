/**
 * ダーツボードの SVG 座標計算。
 * 中心を原点 (0, 0) とし、viewBox は正方形。外部画像は一切使用しない。
 *
 * 半径は実寸比をそのまま使わず、スマートフォンでのタップ精度を優先して
 * BULL・トリプル・ダブルを実寸比より大きく取っている。
 * （Darts Calculator の実装を、このリポジトリ用にコピーして独立管理している）
 */
import { BOARD_NUMBERS, angleRangeOf, centerAngleOf } from '../domain/boardNumbers';
import type { SegmentDefinition } from '../domain/segments';

export const RADII = {
  innerBull: 16,
  outerBull: 34,
  tripleInner: 90,
  tripleOuter: 110,
  doubleInner: 148,
  doubleOuter: 170,
  /** MISS キャッチ領域の外周。ここより外側は入力を発生させない。 */
  missOuter: 205,
  /** 外周のナンバーを配置する半径。 */
  numberRing: 188,
} as const;

/** タップ精度のために確保するリング幅の下限（SVG 単位）。 */
export const MIN_RING_WIDTH = 18;

export const VIEWBOX_RADIUS = 210;
export const VIEWBOX = `${-VIEWBOX_RADIUS} ${-VIEWBOX_RADIUS} ${VIEWBOX_RADIUS * 2} ${VIEWBOX_RADIUS * 2}`;

export interface Point {
  x: number;
  y: number;
}

/** 極座標（半径・角度[度]）を直交座標へ変換する。 */
export function polarToCartesian(radius: number, angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: radius * Math.cos(rad), y: radius * Math.sin(rad) };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pointToString(point: Point): string {
  return `${round(point.x)} ${round(point.y)}`;
}

/** 円環扇形（アニュラーセクター）のパスを生成する。 */
export function annularSectorPath(
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  const outerStart = polarToCartesian(outerRadius, startAngle);
  const outerEnd = polarToCartesian(outerRadius, endAngle);
  const innerEnd = polarToCartesian(innerRadius, endAngle);
  const innerStart = polarToCartesian(innerRadius, startAngle);

  return [
    `M ${pointToString(outerStart)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${pointToString(outerEnd)}`,
    `L ${pointToString(innerEnd)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${pointToString(innerStart)}`,
    'Z',
  ].join(' ');
}

/** 円（塗りつぶし）のパスを生成する。 */
export function circlePath(radius: number): string {
  return [
    `M ${round(-radius)} 0`,
    `A ${radius} ${radius} 0 1 0 ${round(radius)} 0`,
    `A ${radius} ${radius} 0 1 0 ${round(-radius)} 0`,
    'Z',
  ].join(' ');
}

/** 円環（ドーナツ）のパスを生成する。MISS キャッチ領域に使う。 */
export function ringPath(innerRadius: number, outerRadius: number): string {
  return [
    `M ${round(-outerRadius)} 0`,
    `A ${outerRadius} ${outerRadius} 0 1 0 ${round(outerRadius)} 0`,
    `A ${outerRadius} ${outerRadius} 0 1 0 ${round(-outerRadius)} 0`,
    'Z',
    `M ${round(-innerRadius)} 0`,
    `A ${innerRadius} ${innerRadius} 0 1 1 ${round(innerRadius)} 0`,
    `A ${innerRadius} ${innerRadius} 0 1 1 ${round(-innerRadius)} 0`,
    'Z',
  ].join(' ');
}

/** セグメント定義から SVG パス文字列を生成する。 */
export function buildSegmentPath(segment: SegmentDefinition): string {
  switch (segment.ring) {
    case 'inner-bull':
      return circlePath(RADII.innerBull);
    case 'outer-bull':
      return circlePath(RADII.outerBull);
    case 'miss':
      return ringPath(RADII.doubleOuter, RADII.missOuter);
    default: {
      if (segment.index === null) {
        throw new Error(`wedge segment requires index: ${segment.id}`);
      }
      const { start, end } = angleRangeOf(segment.index);
      switch (segment.ring) {
        case 'inner-single':
          return annularSectorPath(RADII.outerBull, RADII.tripleInner, start, end);
        case 'triple':
          return annularSectorPath(RADII.tripleInner, RADII.tripleOuter, start, end);
        case 'outer-single':
          return annularSectorPath(RADII.tripleOuter, RADII.doubleInner, start, end);
        case 'double':
          return annularSectorPath(RADII.doubleInner, RADII.doubleOuter, start, end);
      }
    }
  }
}

export interface NumberLabelPosition {
  value: number;
  x: number;
  y: number;
}

/** 外周に表示する 1〜20 のナンバー位置。 */
export function buildNumberLabelPositions(): NumberLabelPosition[] {
  return BOARD_NUMBERS.map((value, index) => {
    const { x, y } = polarToCartesian(RADII.numberRing, centerAngleOf(index));
    return { value, x: round(x), y: round(y) };
  });
}

/** ウェッジ境界のワイヤー線（視認性のための区切り線）。 */
export function buildWireLines(): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  return BOARD_NUMBERS.map((_, index) => {
    const angle = angleRangeOf(index).start;
    const from = polarToCartesian(RADII.outerBull, angle);
    const to = polarToCartesian(RADII.doubleOuter, angle);
    return { x1: round(from.x), y1: round(from.y), x2: round(to.x), y2: round(to.y) };
  });
}
