import { describe, expect, it } from 'vitest';
import { ALL_DARTS, THROWABLE_DARTS } from '../../domain/dart';
import { displayRouteText, displayTargetId } from './notation';

describe('SIMULATION の表記', () => {
  it('シングル / ダブル / トリプルは Sxx / Dxx / Txx', () => {
    expect(displayTargetId('S20')).toBe('S20');
    expect(displayTargetId('D20')).toBe('D20');
    expect(displayTargetId('T20')).toBe('T20');
    expect(displayTargetId('S1')).toBe('S1');
    expect(displayTargetId('D16')).toBe('D16');
  });

  it('アウターブルは SB、インナーブルは DB', () => {
    expect(displayTargetId('SB')).toBe('SB');
    expect(displayTargetId('BULL')).toBe('DB');
  });

  it('盤外は MISS', () => {
    expect(displayTargetId('MISS')).toBe('MISS');
  });

  it('全 63 種が略記だけになる（読み下しが混ざらない）', () => {
    const pattern = /^([SDT](?:[1-9]|1\d|20)|SB|DB|MISS)$/;
    const wrong: string[] = [];
    for (const dart of ALL_DARTS) {
      const label = displayTargetId(dart.id);
      if (!pattern.test(label)) wrong.push(`${dart.id} → ${label}`);
    }
    expect(wrong).toEqual([]);
    // 狙える的は 62 種 + MISS。
    expect(THROWABLE_DARTS).toHaveLength(62);
    expect(ALL_DARTS).toHaveLength(63);
  });

  it('内部 ID は書き換えない（表示だけの写像）', () => {
    // BULL 以外は入力と出力が同じ。
    const changed = ALL_DARTS.filter((dart) => displayTargetId(dart.id) !== dart.id);
    expect(changed.map((dart) => dart.id)).toEqual(['BULL']);
  });

  it('ルート表示も同じ規則になる', () => {
    expect(displayRouteText('T20 → T20 → BULL')).toBe('T20 → T20 → DB');
    expect(displayRouteText('T19 → S6 → D20')).toBe('T19 → S6 → D20');
    expect(displayRouteText('BULL')).toBe('DB');
    expect(displayRouteText('SB → D16')).toBe('SB → D16');
  });
});
