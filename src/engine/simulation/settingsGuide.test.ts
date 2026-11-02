import { describe, expect, it } from 'vitest';
import { MAX_PPR } from './accuracy';
import {
  AVERAGE_HELP_JA,
  averageCapNoticeJa,
  DIRECTION_CRITERION_JA,
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

  it('First9 / Average の意味を、影響する範囲まで書いている（着弾モデル v2 / 案 2）', () => {
    expect(FIRST9_HELP_JA.meaning).toContain('得点の場面（残りが 171 以上）');
    expect(FIRST9_HELP_JA.detail).toContain('9 投');
    expect(AVERAGE_HELP_JA.meaning).toContain('ゲーム全体');
    expect(AVERAGE_HELP_JA.meaning).toContain('上がりの場面（残り 170 以下）');
    // 上がりの精度を得点の精度より高くしない・上限がある、を落とさない。
    expect(AVERAGE_HELP_JA.detail).toContain('上限');
    // 167 のときだけ完全一致、という条件を落とさない。
    expect(AVERAGE_HELP_JA.detail).toContain(`どちらも ${MAX_PPR} にしたときだけ`);
    expect(AVERAGE_HELP_JA.detail).toContain(String(MAX_PPR - 1));
  });

  it('AVERAGE を丸めるときの説明は、上限と理由を書く', () => {
    const text = averageCapNoticeJa(60, 47.3);
    expect(text).toBe(
      'FIRST 9 が 60 のとき、AVERAGE の上限は約 47 です。' +
        '上がりの場面の精度を得点の場面より高くしないため、この設定は AVERAGE 47 として投げます。',
    );
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

  it('散布が盤面固定の軸であることを、説明に落とさない', () => {
    /*
     * `scatterProfile` は σx / σy を**盤面の XY 軸**へかける（狙いの向きで
     * 回転しない）。「縦＝同じナンバー内・横＝隣のナンバー」が成り立つのは
     * 盤面の上下にあるナンバーを狙うときだけで、左右のナンバー（6 / 11）では
     * 向きが入れ替わる。この但し書きを説明から落とさない。
     */
    const vertical = DIRECTION_GUIDE.find((item) => item.value === 'vertical')!;
    const horizontal = DIRECTION_GUIDE.find((item) => item.value === 'horizontal')!;
    for (const detail of [vertical.detail, horizontal.detail]) {
      expect(detail).toContain('盤面の左右にあるナンバー');
      expect(detail).toContain('6');
      expect(detail).toContain('11');
    }
    expect(DIRECTION_CRITERION_JA).toContain('盤面に対する上下・左右');
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
