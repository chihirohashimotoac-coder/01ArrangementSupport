import { describe, expect, it } from 'vitest';
import { MAX_PPR } from './accuracy';
import {
  AVERAGE_HELP_JA,
  DIRECTION_GUIDE,
  FIRST9_HELP_JA,
  MAX_MISS_CRITERION_JA,
  MAX_MISS_GUIDE,
  PPR_GUIDE_ROWS,
  dartsFor501,
} from './settingsGuide';

describe('SIMULATION の設定説明', () => {
  it('目安投数は PPR の定義（501 ÷ PPR × 3）と一致する', () => {
    const wrong: string[] = [];
    for (const row of PPR_GUIDE_ROWS) {
      const expected = Math.round((501 / row.ppr) * 3);
      if (row.darts !== expected) wrong.push(`${row.ppr}: ${row.darts} ≠ ${expected}`);
    }
    expect(wrong).toEqual([]);
    // 上限の 167 は、501 をちょうど 9 投で上がる値。
    expect(Math.round(dartsFor501(MAX_PPR))).toBe(9);
  });

  it('目安は PPR の昇順で、投数は減っていく', () => {
    const pprs = PPR_GUIDE_ROWS.map((row) => row.ppr);
    expect([...pprs].sort((a, b) => a - b)).toEqual(pprs);
    const darts = PPR_GUIDE_ROWS.map((row) => row.darts);
    expect([...darts].sort((a, b) => b - a)).toEqual(darts);
  });

  it('First9 / Average の意味を、影響する範囲まで書いている', () => {
    expect(FIRST9_HELP_JA.meaning).toContain('9 投');
    expect(FIRST9_HELP_JA.meaning).toContain('序盤');
    expect(AVERAGE_HELP_JA.meaning).toContain('ゲーム全体');
    // 167 のときだけ完全一致、という条件を落とさない。
    expect(AVERAGE_HELP_JA.detail).toContain(`${MAX_PPR} のときだけ`);
    expect(AVERAGE_HELP_JA.detail).toContain(String(MAX_PPR - 1));
  });

  it('ブレ方向は、縦 = 同じナンバー内の上下・横 = 隣のナンバーとして説明する', () => {
    const vertical = DIRECTION_GUIDE.find((item) => item.value === 'vertical')!;
    const horizontal = DIRECTION_GUIDE.find((item) => item.value === 'horizontal')!;
    const even = DIRECTION_GUIDE.find((item) => item.value === 'even')!;
    expect(vertical.detail).toContain('同じナンバー');
    expect(vertical.detail).toContain('上下');
    expect(horizontal.detail).toContain('隣のナンバー');
    // 20 の隣は 1 と 5（盤面の並びから導いている）。
    expect(horizontal.detail).toContain('1');
    expect(horizontal.detail).toContain('5');
    expect(even.detail).toContain('かたより');
  });

  it('最大ブレは、外れ幅の違いと選ぶ基準を書いている', () => {
    const [small, medium, large] = MAX_MISS_GUIDE;
    expect(small.detail).toContain('隣接エリア');
    expect(medium.detail).toContain('たまに');
    // 大は「20 の 2 つ隣」＝ 18 / 12 方面まで飛ぶ。
    expect(large.detail).toContain('18');
    expect(large.detail).toContain('12');
    expect(large.detail).toContain('OUT BOARD');
    expect(MAX_MISS_CRITERION_JA).toContain('ひどく外した');
  });
});
