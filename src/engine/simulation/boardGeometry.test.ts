import { describe, expect, it } from 'vitest';
import { BOARD_NUMBERS, centerAngleOf } from '../../domain/boardNumbers';
import { getSegmentById, type SegmentRing } from '../../domain/segments';
import { RADII as DISPLAY_RADII } from '../../geometry/dartboardGeometry';
import { createRandom } from '../training/random';
import {
  REAL_RADII,
  aimPointOf,
  aimSegmentForDart,
  angleOf,
  fromPolar,
  landingAt,
  radiusOf,
  ringOfRadius,
  toDisplayPoint,
  wedgeIndexOfAngle,
} from './boardGeometry';

function requireSegment(id: string) {
  const segment = getSegmentById(id);
  if (segment === undefined) throw new Error(`区画が見つかりません: ${id}`);
  return segment;
}

/** 表示（SVG）座標から、表示側の半径表だけを使ってリングを求める。 */
function displayRing(x: number, y: number): SegmentRing {
  const radius = Math.hypot(x, y);
  if (radius <= DISPLAY_RADII.innerBull) return 'inner-bull';
  if (radius <= DISPLAY_RADII.outerBull) return 'outer-bull';
  if (radius <= DISPLAY_RADII.tripleInner) return 'inner-single';
  if (radius <= DISPLAY_RADII.tripleOuter) return 'triple';
  if (radius <= DISPLAY_RADII.doubleInner) return 'outer-single';
  if (radius <= DISPLAY_RADII.doubleOuter) return 'double';
  return 'miss';
}

describe('実寸ボードの得点判定', () => {
  it('中心は BULL、その外側はアウターブル', () => {
    expect(landingAt({ x: 0, y: 0 }).dart.id).toBe('BULL');
    expect(landingAt({ x: 0, y: 6.3 }).dart.id).toBe('BULL');
    expect(landingAt({ x: 0, y: 10 }).dart.id).toBe('SB');
    expect(landingAt({ x: 0, y: 15.8 }).dart.id).toBe('SB');
  });

  it('真上（-90 度）は 20 のウェッジ', () => {
    // 表示側と同じ約束（y 軸は下向き）。真上は y が負。
    expect(landingAt(fromPolar(103, -90)).dart.id).toBe('T20');
    expect(landingAt(fromPolar(57, -90)).dart.id).toBe('S20');
    expect(landingAt(fromPolar(166, -90)).dart.id).toBe('D20');
    expect(landingAt(fromPolar(130, -90)).dart.id).toBe('S20');
  });

  it('ダブル外周より外は OUT BOARD（0 点）', () => {
    const landing = landingAt(fromPolar(REAL_RADII.doubleOuter + 0.5, -90));
    expect(landing.dart.id).toBe('MISS');
    expect(landing.dart.score).toBe(0);
    expect(landing.outBoard).toBe(true);
  });

  it('20 個すべてのウェッジが、盤面の並び順どおりに判定される', () => {
    const mismatches: string[] = [];
    BOARD_NUMBERS.forEach((value, index) => {
      const landing = landingAt(fromPolar(103, centerAngleOf(index)));
      if (landing.dart.id !== `T${value}`) {
        mismatches.push(`index ${index}: ${landing.dart.id} !== T${value}`);
      }
    });
    expect(mismatches).toEqual([]);
  });

  it('ウェッジの境界（±9 度）でナンバーが切り替わる', () => {
    // 20 は index 0、その右隣（時計回り）は 1。
    expect(landingAt(fromPolar(103, -90 + 8.9)).dart.id).toBe('T20');
    expect(landingAt(fromPolar(103, -90 + 9.1)).dart.id).toBe('T1');
    expect(landingAt(fromPolar(103, -90 - 9.1)).dart.id).toBe('T5');
  });

  it('角度からウェッジ番号を求める写像は 0〜19 に収まる', () => {
    const outOfRange: number[] = [];
    for (let angle = -720; angle <= 720; angle += 0.5) {
      const index = wedgeIndexOfAngle(angle);
      if (!Number.isInteger(index) || index < 0 || index > 19) outOfRange.push(angle);
    }
    expect(outOfRange).toEqual([]);
  });

  it('リング判定は半径の順に並ぶ', () => {
    expect(ringOfRadius(0)).toBe('inner-bull');
    expect(ringOfRadius(20)).toBe('inner-single');
    expect(ringOfRadius(103)).toBe('triple');
    expect(ringOfRadius(130)).toBe('outer-single');
    expect(ringOfRadius(166)).toBe('double');
    expect(ringOfRadius(200)).toBe('miss');
  });
});

describe('狙い点', () => {
  it('狙い点は、その区画の中に入る', () => {
    const wrong: string[] = [];
    for (const id of ['segment-t20', 'segment-d16', 'segment-s19-inner', 'segment-s19-outer']) {
      const segment = requireSegment(id);
      const landing = landingAt(aimPointOf(segment));
      if (landing.dart.id !== segment.dart.id) wrong.push(`${id}: ${landing.dart.id}`);
    }
    expect(wrong).toEqual([]);
  });

  it('BULL は内外を区別する（DB は中心、SB はリングの中ほど）', () => {
    expect(aimPointOf(requireSegment('segment-inner-bull'))).toEqual({ x: 0, y: 0 });

    const outer = aimPointOf(requireSegment('segment-outer-bull'));
    const radius = radiusOf(outer);
    expect(radius).toBeGreaterThan(REAL_RADII.innerBull);
    expect(radius).toBeLessThan(REAL_RADII.outerBull);
    // 狙い通りに入れば SB（25 点）であること。
    expect(landingAt(outer).dart.id).toBe('SB');
  });

  it('MISS リングは狙えない', () => {
    expect(() => aimPointOf(requireSegment('segment-miss'))).toThrow();
  });

  it('ダブルの狙い点はリングのやや内側（外すなら内側へ外す狙い方）', () => {
    const radius = radiusOf(aimPointOf(requireSegment('segment-d16')));
    expect(radius).toBeGreaterThan(REAL_RADII.doubleInner);
    expect(radius).toBeLessThan((REAL_RADII.doubleInner + REAL_RADII.doubleOuter) / 2);
  });

  it('1 投の表記から狙う区画が決まる（シングルはインナー側）', () => {
    expect(aimSegmentForDart('T20')?.id).toBe('segment-t20');
    expect(aimSegmentForDart('D16')?.id).toBe('segment-d16');
    expect(aimSegmentForDart('S5')?.id).toBe('segment-s5-inner');
    expect(aimSegmentForDart('BULL')?.id).toBe('segment-inner-bull');
    expect(aimSegmentForDart('SB')?.id).toBe('segment-outer-bull');
    expect(aimSegmentForDart('MISS')).toBeUndefined();
  });
});

describe('実寸 → 表示座標の写像', () => {
  it('リングの境界が、表示側のリングの境界へ移る', () => {
    const pairs: ReadonlyArray<[number, number]> = [
      [REAL_RADII.innerBull, DISPLAY_RADII.innerBull],
      [REAL_RADII.outerBull, DISPLAY_RADII.outerBull],
      [REAL_RADII.tripleInner, DISPLAY_RADII.tripleInner],
      [REAL_RADII.tripleOuter, DISPLAY_RADII.tripleOuter],
      [REAL_RADII.doubleInner, DISPLAY_RADII.doubleInner],
      [REAL_RADII.doubleOuter, DISPLAY_RADII.doubleOuter],
      [REAL_RADII.boardEdge, DISPLAY_RADII.missOuter],
    ];
    const wrong: string[] = [];
    for (const [real, display] of pairs) {
      const mapped = radiusOf(toDisplayPoint(fromPolar(real, -90)));
      if (Math.abs(mapped - display) > 1e-6) wrong.push(`${real} → ${mapped} (期待 ${display})`);
    }
    expect(wrong).toEqual([]);
  });

  it('角度は変わらない', () => {
    const wrong: number[] = [];
    for (let angle = -180; angle < 180; angle += 7) {
      const mapped = angleOf(toDisplayPoint(fromPolar(120, angle)));
      if (Math.abs(mapped - angle) > 1e-6) wrong.push(angle);
    }
    expect(wrong).toEqual([]);
  });

  it('得点判定と表示位置が必ず一致する（2 万点の無作為着弾）', () => {
    const random = createRandom(20260916);
    const mismatches: string[] = [];
    for (let i = 0; i < 20000; i += 1) {
      // 盤面の外まで含めて散らす。
      const radius = random.next() * 260;
      const angle = random.next() * 360 - 180;
      const point = fromPolar(radius, angle);
      const landing = landingAt(point);
      const display = toDisplayPoint(point);
      const expected = landing.ring;
      const actual = displayRing(display.x, display.y);
      if (expected !== actual) mismatches.push(`r=${radius.toFixed(3)} ${expected} !== ${actual}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('盤面の外へ大きく外れた着弾も、表示の外周に収まる', () => {
    const display = toDisplayPoint(fromPolar(900, 30));
    expect(radiusOf(display)).toBeCloseTo(DISPLAY_RADII.missOuter, 6);
  });
});
