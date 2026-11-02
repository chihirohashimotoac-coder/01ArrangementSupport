import { describe, expect, it } from 'vitest';
import {
  BOARD_TOP_MARGIN_PX,
  ENTRY_BAR_RESERVE_REM,
  entryScrollOffset,
  type EntryLayout,
} from './entryBarLayout';

/** 幅 390px の実測に近い寸法（まとまりの先頭から盤面まで 179px、盤面 340px、隙間 12px）。 */
const base: EntryLayout = {
  sectionTop: 0,
  boardTop: 179,
  boardBottom: 519,
  gap: 12,
  barHeight: 79,
  reserve: 256,
  viewportHeight: 844,
};

describe('entryScrollOffset', () => {
  it('ENTRY_BAR_RESERVE_REM は候補 2 つの帯（約 255px）を覆う', () => {
    expect(ENTRY_BAR_RESERVE_REM * 16).toBeGreaterThanOrEqual(255);
  });

  it('盤面と確保した帯が画面に収まるときは、ずらさない', () => {
    // 519 + 12 + 256 = 787 ≦ 844
    expect(entryScrollOffset(base)).toBe(0);
  });

  it('収まらないときは、確保した帯の下端が画面の下端に来るまでずらす', () => {
    // iPhone の Safari 相当（高さ 664）: 787 − 664 = 123
    expect(entryScrollOffset({ ...base, viewportHeight: 664 })).toBe(123);
  });

  it('帯がいま確保より高いときは、いまの高さで合わせる', () => {
    // 519 + 12 + 300 = 831、831 − 664 = 167
    expect(entryScrollOffset({ ...base, barHeight: 300, viewportHeight: 664 })).toBe(167);
  });

  it('盤面の上端が画面の上へ出るほどはずらさない', () => {
    // 787 − 400 = 387 だが、盤面の上端（179）から余白を引いた量で止める。
    expect(entryScrollOffset({ ...base, viewportHeight: 400 })).toBe(179 - BOARD_TOP_MARGIN_PX);
  });

  it('まとまりの位置がどこにあっても、まとまりの先頭からの相対で計算する', () => {
    const shifted = { ...base, sectionTop: 500, boardTop: 679, boardBottom: 1019, viewportHeight: 664 };
    expect(entryScrollOffset(shifted)).toBe(123);
  });
});
