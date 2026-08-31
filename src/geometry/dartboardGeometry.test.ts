import { describe, expect, it } from 'vitest';
import {
  MIN_RING_WIDTH,
  RADII,
  VIEWBOX_RADIUS,
  buildNumberLabelPositions,
  buildSegmentPath,
  polarToCartesian,
} from './dartboardGeometry';
import { SEGMENTS, getSegmentById, representativeSegmentOf } from '../domain/segments';
import { THROWABLE_DARTS } from '../domain/dart';

describe('盤面の幾何', () => {
  it('半径が内側から外側へ単調に増える', () => {
    const order = [
      RADII.innerBull,
      RADII.outerBull,
      RADII.tripleInner,
      RADII.tripleOuter,
      RADII.doubleInner,
      RADII.doubleOuter,
      RADII.missOuter,
    ];
    for (let i = 1; i < order.length; i += 1) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(VIEWBOX_RADIUS).toBeGreaterThanOrEqual(RADII.missOuter);
  });

  it('タップ精度のためのリング幅を確保している', () => {
    expect(RADII.tripleOuter - RADII.tripleInner).toBeGreaterThanOrEqual(MIN_RING_WIDTH);
    expect(RADII.doubleOuter - RADII.doubleInner).toBeGreaterThanOrEqual(MIN_RING_WIDTH);
  });

  it('20 が真上（12時方向）に来る', () => {
    const labels = buildNumberLabelPositions();
    const twenty = labels.find((label) => label.value === 20)!;
    expect(twenty.x).toBeCloseTo(0, 6);
    expect(twenty.y).toBeLessThan(0);
  });

  it('polarToCartesian は -90 度で真上を返す', () => {
    const point = polarToCartesian(100, -90);
    expect(point.x).toBeCloseTo(0, 6);
    expect(point.y).toBeCloseTo(-100, 6);
  });

  it('全セグメントのパスを生成できる', () => {
    for (const segment of SEGMENTS) {
      expect(buildSegmentPath(segment).length, segment.id).toBeGreaterThan(10);
    }
  });
});

describe('セグメント定義', () => {
  it('83 区画（MISS + 20×4 + BULL 2）', () => {
    expect(SEGMENTS).toHaveLength(1 + 20 * 4 + 2);
  });

  it('id が一意', () => {
    expect(new Set(SEGMENTS.map((s) => s.id)).size).toBe(SEGMENTS.length);
  });

  it('すべての投げられるダートに対応する区画がある', () => {
    for (const dart of THROWABLE_DARTS) {
      expect(representativeSegmentOf(dart.id), dart.id).toBeDefined();
    }
  });

  it('シングルはアウターシングルを代表にする', () => {
    expect(representativeSegmentOf('S20')?.ring).toBe('outer-single');
  });

  it('インナー / アウターシングルは同じ Dart を指す', () => {
    expect(getSegmentById('segment-s20-inner')?.dart.id).toBe('S20');
    expect(getSegmentById('segment-s20-outer')?.dart.id).toBe('S20');
  });

  it('BULL は 50 点、アウターブルは 25 点', () => {
    expect(getSegmentById('segment-inner-bull')?.dart.score).toBe(50);
    expect(getSegmentById('segment-outer-bull')?.dart.score).toBe(25);
  });
});
