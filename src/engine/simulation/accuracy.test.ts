import { describe, expect, it } from 'vitest';
import { measure, scatterStats } from '../../../scripts/lib/simulationHarness';
import {
  MAX_MISS_LEVELS,
  MAX_PPR,
  MISS_DIRECTIONS,
  SIGMA_ANCHORS,
  TRANSITION_DARTS,
  clampPpr,
  scatterProfile,
  sigmaForDart,
  sigmaForPpr,
} from './accuracy';

describe('PPR → 散布幅 σ', () => {
  it('PPR が高いほど σ は小さい（どの方向でも単調）', () => {
    const violations: string[] = [];
    for (const direction of MISS_DIRECTIONS) {
      for (let ppr = 0; ppr < MAX_PPR; ppr += 1) {
        const current = sigmaForPpr(ppr, direction);
        const next = sigmaForPpr(ppr + 1, direction);
        if (next > current) violations.push(`${direction} ${ppr} → ${ppr + 1}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('167 でだけ σ = 0 になり、166 では 0 にならない', () => {
    for (const direction of MISS_DIRECTIONS) {
      expect(sigmaForPpr(MAX_PPR, direction)).toBe(0);
      expect(sigmaForPpr(166, direction)).toBeGreaterThan(0);
    }
  });

  it('167 を超える入力・負の入力は範囲へ丸める', () => {
    expect(clampPpr(300)).toBe(MAX_PPR);
    expect(clampPpr(-10)).toBe(0);
    expect(clampPpr(Number.NaN)).toBe(0);
    expect(sigmaForPpr(500)).toBe(0);
  });

  it('アンカー表はどの方向も 167 で終わる', () => {
    for (const direction of MISS_DIRECTIONS) {
      const anchors = SIGMA_ANCHORS[direction];
      expect(anchors[anchors.length - 1]).toEqual({ ppr: MAX_PPR, sigma: 0 });
    }
  });

  it('アンカー点では表の値をそのまま返す', () => {
    const wrong: string[] = [];
    for (const direction of MISS_DIRECTIONS) {
      for (const anchor of SIGMA_ANCHORS[direction]) {
        const value = sigmaForPpr(anchor.ppr, direction);
        if (Math.abs(value - anchor.sigma) > 1e-9) {
          wrong.push(`${direction} ${anchor.ppr}: ${value} !== ${anchor.sigma}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('First9 と Average の使い分け', () => {
  const first9 = 100;
  const average = 50;

  it('1〜9 投目は First9 の σ をそのまま使う', () => {
    for (let dart = 1; dart <= 9; dart += 1) {
      expect(sigmaForDart(first9, average, dart)).toBeCloseTo(sigmaForPpr(first9), 10);
    }
  });

  it('10 投目以降は Average へ向かって滑らかに移る', () => {
    const start = sigmaForDart(first9, average, 9);
    const justAfter = sigmaForDart(first9, average, 10);
    const settled = sigmaForDart(first9, average, 9 + TRANSITION_DARTS);
    // 9 投目 → 10 投目で一気に変わらない（遷移 1 段ぶんだけ動く）。
    const totalGap = Math.abs(sigmaForPpr(average) - sigmaForPpr(first9));
    expect(Math.abs(justAfter - start)).toBeLessThan(totalGap);
    expect(Math.abs(justAfter - start)).toBeCloseTo(totalGap / TRANSITION_DARTS, 8);
    expect(settled).toBeCloseTo(sigmaForPpr(average), 10);
    expect(sigmaForDart(first9, average, 200)).toBeCloseTo(sigmaForPpr(average), 10);
  });

  it('Average が 167 ならゲーム全体で σ = 0（First9 が低くても）', () => {
    for (const dart of [1, 5, 9, 10, 40]) {
      expect(sigmaForDart(20, MAX_PPR, dart)).toBe(0);
    }
  });

  it('First9 だけ 167 でも、ゲーム全体が 100% 精度にはならない', () => {
    expect(sigmaForDart(MAX_PPR, 60, 5)).toBe(0);
    expect(sigmaForDart(MAX_PPR, 60, 20)).toBeGreaterThan(0);
  });
});

describe('ブレ方向と最大ブレ', () => {
  it('縦ブレは σY > σX、横ブレは σX > σY、均等は同じ', () => {
    const vertical = scatterProfile(10, 'vertical', 'medium');
    const horizontal = scatterProfile(10, 'horizontal', 'medium');
    const even = scatterProfile(10, 'even', 'medium');
    expect(vertical.sigmaY).toBeGreaterThan(vertical.sigmaX);
    expect(horizontal.sigmaX).toBeGreaterThan(horizontal.sigmaY);
    expect(even.sigmaX).toBeCloseTo(even.sigmaY, 10);
  });

  it('方向を変えても散布の面積（σx·σy）は変わらない', () => {
    const areas = MISS_DIRECTIONS.map((direction) => {
      const profile = scatterProfile(10, direction, 'medium');
      return profile.sigmaX * profile.sigmaY;
    });
    for (const area of areas) expect(area).toBeCloseTo(100, 8);
  });

  it('最大ブレを上げても通常成分は変わらず、大ミスの確率と幅だけが増える', () => {
    const profiles = MAX_MISS_LEVELS.map((level) => scatterProfile(10, 'even', level));
    for (const profile of profiles) expect(profile.sigmaX).toBeCloseTo(10, 10);
    for (let i = 1; i < profiles.length; i += 1) {
      expect(profiles[i].outlierRate).toBeGreaterThan(profiles[i - 1].outlierRate);
      expect(profiles[i].outlierScale).toBeGreaterThan(profiles[i - 1].outlierScale);
    }
  });

  it('σ = 0 なら散布はまったく生じない', () => {
    const profile = scatterProfile(0, 'vertical', 'large');
    expect(profile.sigmaX).toBe(0);
    expect(profile.sigmaY).toBe(0);
  });
});

/*
 * ここから先は実際に大量に投げて確かめる。
 * 本格的な監査は `npm run audit:simulation` にあり、ここには
 * 「代表ケースがモデルの前提を満たしているか」だけを高速に置く。
 */
describe('着弾分布（代表ケース）', () => {
  const SAMPLES = 20000;

  it('ブレ方向が実際の座標分布へ反映される', () => {
    const sigma = sigmaForPpr(60);
    const vertical = scatterStats('T20', sigma, 'vertical', 'medium', SAMPLES);
    const horizontal = scatterStats('T20', sigma, 'horizontal', 'medium', SAMPLES);
    const even = scatterStats('T20', sigma, 'even', 'medium', SAMPLES);
    expect(vertical.sdY).toBeGreaterThan(vertical.sdX * 1.2);
    expect(horizontal.sdX).toBeGreaterThan(horizontal.sdY * 1.2);
    expect(Math.abs(even.sdX - even.sdY) / even.sdX).toBeLessThan(0.1);
  });

  it('PPR が高いほど散布は小さくなる', () => {
    const violations: string[] = [];
    let previous = Number.POSITIVE_INFINITY;
    for (const ppr of [40, 60, 80, 100, 120, 150, MAX_PPR]) {
      const stats = scatterStats('T20', sigmaForPpr(ppr), 'even', 'medium', SAMPLES);
      if (stats.meanRadius > previous) violations.push(`PPR ${ppr}`);
      previous = stats.meanRadius;
    }
    expect(violations).toEqual([]);
  });

  it('最大ブレを上げると外れ値と OUT BOARD が増える', () => {
    const sigma = sigmaForPpr(60);
    const small = scatterStats('T20', sigma, 'even', 'small', SAMPLES);
    const medium = scatterStats('T20', sigma, 'even', 'medium', SAMPLES);
    const large = scatterStats('T20', sigma, 'even', 'large', SAMPLES);
    expect(medium.outlierRate).toBeGreaterThan(small.outlierRate);
    expect(large.outlierRate).toBeGreaterThan(medium.outlierRate);
    expect(large.outBoardRate).toBeGreaterThan(small.outBoardRate);
  });

  it('Average 167 は狙い通り 100%、166 は着弾がばらつく', () => {
    const perfect = scatterStats('T20', sigmaForPpr(MAX_PPR), 'even', 'large', 2000);
    expect(perfect.hitRate).toBe(1);
    expect(perfect.meanRadius).toBe(0);
    const almost = scatterStats('T20', sigmaForPpr(166), 'even', 'medium', 2000);
    expect(almost.meanRadius).toBeGreaterThan(0);
  });

  it('BULL とダブルも、確率表ではなく座標から自然に判定される', () => {
    const sigma = sigmaForPpr(60);
    const bull = scatterStats('BULL', sigma, 'even', 'medium', SAMPLES);
    expect(bull.hitRate).toBeGreaterThan(0);
    expect(bull.hitRate).toBeLessThan(1);
    const double = scatterStats('D16', sigma, 'even', 'medium', SAMPLES);
    expect(double.hitRate).toBeGreaterThan(0);
    expect(double.hitRate).toBeLessThan(1);
    // ダブルを狙えば、外れたぶんの一部は必ず盤外へ出る。
    expect(double.outBoardRate).toBeGreaterThan(0);
  });
});

describe('PPR キャリブレーション（固定戦略の 501）', () => {
  /*
   * 設定 PPR とシミュレーション結果が大きく乖離しないことの回帰テスト。
   * 本数を絞った高速版で、全面的な監査は `npm run audit:simulation`。
   */
  const TOLERANCE = 6;

  it(
    '設定 Average に対して、実測 PPR が ±6 に収まる',
    () => {
      const deviations: string[] = [];
      for (const ppr of [40, 60, 100, 150]) {
        const sigma = sigmaForPpr(ppr);
        const result = measure(
          {
            startScore: 501,
            first9Sigma: sigma,
            averageSigma: sigma,
            direction: 'even',
            maxMiss: 'medium',
          },
          400,
          20260916,
        );
        if (Math.abs(result.ppr - ppr) > TOLERANCE) {
          deviations.push(`Average ${ppr} → 実測 ${result.ppr.toFixed(1)}`);
        }
      }
      expect(deviations).toEqual([]);
    },
    30000,
  );

  it(
    'ブレ方向・最大ブレを変えても、実測 PPR は大きく動かない',
    () => {
      const deviations: string[] = [];
      const ppr = 60;
      for (const direction of MISS_DIRECTIONS) {
        for (const maxMiss of MAX_MISS_LEVELS) {
          const sigma = sigmaForPpr(ppr, direction);
          const result = measure(
            {
              startScore: 501,
              first9Sigma: sigma,
              averageSigma: sigma,
              direction,
              maxMiss,
            },
            300,
            4242,
          );
          if (Math.abs(result.ppr - ppr) > TOLERANCE) {
            deviations.push(`${direction}/${maxMiss} → ${result.ppr.toFixed(1)}`);
          }
        }
      }
      expect(deviations).toEqual([]);
    },
    30000,
  );

  it(
    'Average 167 は 9 ダーツで上がりきる',
    () => {
      const result = measure(
        {
          startScore: 501,
          first9Sigma: 0,
          averageSigma: 0,
          direction: 'even',
          maxMiss: 'medium',
        },
        20,
        7,
      );
      expect(result.averageDarts).toBe(9);
      expect(result.ppr).toBeCloseTo(MAX_PPR, 6);
      expect(result.checkoutRate).toBe(1);
    },
    30000,
  );
});
