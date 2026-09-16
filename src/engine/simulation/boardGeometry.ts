/**
 * SIMULATION 専用の「実寸ダーツボード」座標系。
 *
 * ## なぜ表示用の座標系と分けるのか
 *
 * 表示用の `src/geometry/dartboardGeometry.ts` は、スマートフォンでのタップ精度を
 * 優先して BULL・トリプル・ダブルを実寸比より太く描いている。そのままの座標系で
 * 着弾をシミュレーションすると「トリプルが実物の 2.5 倍の幅」になり、
 * 命中率のモデルが実戦とかけ離れる。
 *
 * そこでこのファイルでは **実寸（mm）のボード**を唯一の物理モデルとして持ち、
 * 得点判定も実寸側で行う。画面へ出すときは `toDisplayPoint()` で表示座標へ写す。
 * この写像は「半径だけを区間ごとに線形変換し、角度は変えない」ため、
 * リングの境界がリングの境界へ移る。つまり **得点判定と表示位置は必ず一致する**
 * （T20 と判定された着弾が画面上でシングルの位置に描かれることはない）。
 *
 * 角度の約束は表示側と同じ（真上 = -90 度、y 軸は下向き、時計回りに 18 度ずつ）。
 *
 * 実寸は WDF / PDC の標準ボード寸法による。
 * - インナーブル 直径 12.7 mm、アウターブル 直径 31.8 mm
 * - トリプル / ダブルのリング幅 8 mm（ワイヤー内側で計測）
 * - ダブル外周の直径 340 mm、盤面全体の直径 451 mm
 * 出典: WDF Playing Rules / Darts Regulation Authority のボード規格。
 * https://dartswdf.com/rules
 */
import { BOARD_NUMBERS, SEGMENT_ANGLE, centerAngleOf } from '../../domain/boardNumbers';
import { MISS_DART, requireDart, type Dart } from '../../domain/dart';
import { getSegmentById, type SegmentDefinition, type SegmentRing } from '../../domain/segments';
import { RADII as DISPLAY_RADII } from '../../geometry/dartboardGeometry';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 実寸（mm）での各リングの半径。中心からの距離。 */
export const REAL_RADII = {
  /** インナーブル（50 点）の外周。 */
  innerBull: 6.35,
  /** アウターブル（25 点）の外周。 */
  outerBull: 15.9,
  /** トリプルリングの内周。 */
  tripleInner: 99,
  /** トリプルリングの外周。 */
  tripleOuter: 107,
  /** ダブルリングの内周。 */
  doubleInner: 162,
  /** ダブルリングの外周。ここより外は 0 点（OUT BOARD）。 */
  doubleOuter: 170,
  /** 盤面（プレイングサーフェス）の外縁。ここより外へ飛んだ着弾も 0 点。 */
  boardEdge: 225.5,
} as const;

/**
 * 実寸半径 → 表示半径の対応表。
 *
 * 各リングの境界どうしを対応させる。境界の間は線形に伸縮するので、
 * 「実寸でトリプル」なら「表示でもトリプル」になる。
 */
const RADIUS_MAP: ReadonlyArray<{ real: number; display: number }> = [
  { real: 0, display: 0 },
  { real: REAL_RADII.innerBull, display: DISPLAY_RADII.innerBull },
  { real: REAL_RADII.outerBull, display: DISPLAY_RADII.outerBull },
  { real: REAL_RADII.tripleInner, display: DISPLAY_RADII.tripleInner },
  { real: REAL_RADII.tripleOuter, display: DISPLAY_RADII.tripleOuter },
  { real: REAL_RADII.doubleInner, display: DISPLAY_RADII.doubleInner },
  { real: REAL_RADII.doubleOuter, display: DISPLAY_RADII.doubleOuter },
  { real: REAL_RADII.boardEdge, display: DISPLAY_RADII.missOuter },
];

const DEG = 180 / Math.PI;

/** 実寸座標の半径（mm）。 */
export function radiusOf(point: Point): number {
  return Math.hypot(point.x, point.y);
}

/** 実寸座標の角度（度）。真上が -90 度。 */
export function angleOf(point: Point): number {
  return Math.atan2(point.y, point.x) * DEG;
}

/** 極座標（半径 mm・角度[度]）から実寸座標へ。 */
export function fromPolar(radius: number, angleDeg: number): Point {
  const rad = angleDeg / DEG;
  return { x: radius * Math.cos(rad), y: radius * Math.sin(rad) };
}

/**
 * 角度から BOARD_NUMBERS 上のインデックスを返す。
 *
 * 表示側の `angleRangeOf(index)` が中心 ± 9 度なので、その逆写像になる。
 */
export function wedgeIndexOfAngle(angleDeg: number): number {
  const normalized = (((angleDeg + 90) % 360) + 360) % 360;
  return Math.floor(normalized / SEGMENT_ANGLE + 0.5) % BOARD_NUMBERS.length;
}

/** 実寸座標がどのリングにあたるか。 */
export function ringOfRadius(radius: number): SegmentRing {
  if (radius <= REAL_RADII.innerBull) return 'inner-bull';
  if (radius <= REAL_RADII.outerBull) return 'outer-bull';
  if (radius <= REAL_RADII.tripleInner) return 'inner-single';
  if (radius <= REAL_RADII.tripleOuter) return 'triple';
  if (radius <= REAL_RADII.doubleInner) return 'outer-single';
  if (radius <= REAL_RADII.doubleOuter) return 'double';
  return 'miss';
}

export interface Landing {
  /** 実寸（mm）の着弾座標。 */
  readonly point: Point;
  /** 着弾した区画のリング。 */
  readonly ring: SegmentRing;
  /** 1〜20 の表示数字。BULL / OUT BOARD は null。 */
  readonly baseNumber: number | null;
  /** 得点としての 1 投。 */
  readonly dart: Dart;
  /** ダブル外周より外か（OUT BOARD）。 */
  readonly outBoard: boolean;
}

/**
 * 実寸座標から「何に刺さったか」を判定する。
 *
 * 得点ベースの確率表は一切使わず、**座標だけ**から決める。
 */
export function landingAt(point: Point): Landing {
  const radius = radiusOf(point);
  const ring = ringOfRadius(radius);

  if (ring === 'inner-bull') {
    return { point, ring, baseNumber: null, dart: requireDart('BULL'), outBoard: false };
  }
  if (ring === 'outer-bull') {
    return { point, ring, baseNumber: null, dart: requireDart('SB'), outBoard: false };
  }
  if (ring === 'miss') {
    return { point, ring, baseNumber: null, dart: MISS_DART, outBoard: true };
  }

  const baseNumber = BOARD_NUMBERS[wedgeIndexOfAngle(angleOf(point))];
  const prefix = ring === 'triple' ? 'T' : ring === 'double' ? 'D' : 'S';
  return {
    point,
    ring,
    baseNumber,
    dart: requireDart(`${prefix}${baseNumber}`),
    outBoard: false,
  };
}

/**
 * 狙った区画の「狙い点」（実寸座標）。
 *
 * その区画の中央を狙う。**BULL は内外を区別する。**
 *
 * - インナーブル（DB / 50 点）… 中心そのもの
 * - アウターブル（SB / 25 点）… リングの半径の中ほど
 *
 * アウターブルはドーナツ状なので「中央」が一意に決まらない。角度は真上
 * （20 の方向）に固定する。どの角度を選んでも SB であることに変わりはなく、
 * 決定論的であればよいため。
 */
export function aimPointOf(segment: SegmentDefinition): Point {
  switch (segment.ring) {
    case 'inner-bull':
      return { x: 0, y: 0 };
    case 'outer-bull':
      return fromPolar((REAL_RADII.innerBull + REAL_RADII.outerBull) / 2, -90);
    case 'miss':
      throw new Error('MISS リングは狙う的にできません。');
    default: {
      if (segment.index === null) {
        throw new Error(`ウェッジ区画には index が必要です: ${segment.id}`);
      }
      const radius = aimRadiusOfRing(segment.ring);
      return fromPolar(radius, centerAngleOf(segment.index));
    }
  }
}

/**
 * 「この 1 投を狙う」と言われたとき、盤面のどの区画を狙うか。
 *
 * シングルは **インナーシングル**（BULL とトリプルの間）を選ぶ。
 * アウターシングルはダブルリングと接していて、外すと Bust しやすいため、
 * 実戦で「S20 を狙う」と言えば普通はインナー側を指す。
 * BULL は DB（50 点）と SB（25 点）をそれぞれの区画へ分ける。
 *
 * ユーザーが盤面をタップして狙うときは、この関数ではなくタップした区画が
 * そのまま狙い（インナー / アウターの選択もユーザーの判断）になる。
 */
export function aimSegmentForDart(dartId: string): SegmentDefinition | undefined {
  if (dartId === 'BULL') return getSegmentById('segment-inner-bull');
  if (dartId === 'SB') return getSegmentById('segment-outer-bull');
  const match = /^([SDT])(\d{1,2})$/.exec(dartId);
  if (match === null) return undefined;
  const [, prefix, number] = match;
  if (prefix === 'S') return getSegmentById(`segment-s${number}-inner`);
  return getSegmentById(`segment-${prefix.toLowerCase()}${number}`);
}

function aimRadiusOfRing(ring: SegmentRing): number {
  switch (ring) {
    case 'inner-single':
      return (REAL_RADII.outerBull + REAL_RADII.tripleInner) / 2;
    case 'triple':
      return (REAL_RADII.tripleInner + REAL_RADII.tripleOuter) / 2;
    case 'outer-single':
      return (REAL_RADII.tripleOuter + REAL_RADII.doubleInner) / 2;
    case 'double':
      /*
       * ダブルだけはリングの中央ではなく、**やや内側**（内周から 1/4）を狙う。
       * 中央を狙うと半径方向の誤差の半分がそのまま盤外へ出てしまう。
       * 実戦では「外すなら内側（シングル）へ外したい」ので内寄りに構えるため、
       * その狙い方をモデルにも反映する。
       */
      return REAL_RADII.doubleInner + (REAL_RADII.doubleOuter - REAL_RADII.doubleInner) / 4;
    default:
      return 0;
  }
}

/**
 * 実寸座標 → 表示（SVG）座標。
 *
 * 角度はそのまま、半径だけを `RADIUS_MAP` の区間ごとに線形変換する。
 * 盤面のさらに外側（boardEdge より外）は、表示の外周でクランプして
 * 「盤外へ大きく外した」ことが分かる位置に置く。
 */
export function toDisplayPoint(point: Point): Point {
  const radius = radiusOf(point);
  if (radius === 0) return { x: 0, y: 0 };
  const displayRadius = mapRadius(radius);
  const scale = displayRadius / radius;
  return { x: point.x * scale, y: point.y * scale };
}

function mapRadius(radius: number): number {
  const last = RADIUS_MAP[RADIUS_MAP.length - 1];
  if (radius >= last.real) return last.display;
  for (let i = 1; i < RADIUS_MAP.length; i += 1) {
    const from = RADIUS_MAP[i - 1];
    const to = RADIUS_MAP[i];
    if (radius <= to.real) {
      const t = (radius - from.real) / (to.real - from.real);
      return from.display + t * (to.display - from.display);
    }
  }
  return last.display;
}
