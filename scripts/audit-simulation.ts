/**
 * SIMULATION の散布モデルの統計監査。
 *
 *   npm run audit:simulation            … 検証だけ（既定）
 *   npm run audit:simulation -- --solve … PPR → σ のアンカーを逆算して表示する
 *
 * 通常の `npm run test` には高速な代表ケースだけを置き、
 * 大量試行はここへ分離している（TRAINING の audit と同じ方針）。
 */
import {
  MAX_PPR,
  SIGMA_ANCHORS,
  effectiveAveragePpr,
  finishingSigma,
  scoringSigma,
  sigmaForFirst9Ppr,
  sigmaForPpr,
  type MaxMissLevel,
  type MissDirection,
} from '../src/engine/simulation/accuracy';
import {
  measure,
  scatterStats,
  solveFinishingSigma,
  solveSigmaForPpr,
} from './lib/simulationHarness';

const START_SCORE = 501;
const CHECK_PPR = [40, 60, 80, 100, 120, 150, MAX_PPR];
const DIRECTIONS: readonly MissDirection[] = ['vertical', 'horizontal', 'even'];
const MAX_MISS: readonly MaxMissLevel[] = ['small', 'medium', 'large'];

function fixed(value: number, digits = 1): string {
  return value.toFixed(digits);
}

let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : '  NG  '} ${label} — ${detail}`);
}

/** --solve の 1 回の測定に使うゲーム数。 */
const SOLVE_GAMES = 800;

function solve(): void {
  const targets = SIGMA_ANCHORS.even.map((anchor) => anchor.ppr).filter((ppr) => ppr < MAX_PPR);
  const first9Solved = new Map<MissDirection, Map<number, number>>();

  for (const scope of ['game', 'first9'] as const) {
    console.log(
      scope === 'game'
        ? '## SIGMA_ANCHORS（精度一定で投げ切ったときのゲーム全体 PPR・固定戦略・501・最大ブレ 中）\n'
        : '\n## FIRST9_SIGMA_ANCHORS（得点の場面の σ。最初の 9 投の PPR・同条件）\n',
    );
    for (const direction of DIRECTIONS) {
      const rows: string[] = [];
      const solved = new Map<number, number>();
      for (const ppr of targets) {
        const sigma = Number(
          solveSigmaForPpr(
            ppr,
            { startScore: START_SCORE, direction, maxMiss: 'medium' },
            SOLVE_GAMES,
            22,
            scope,
          ).toFixed(1),
        );
        solved.set(ppr, sigma);
        rows.push(`    { ppr: ${ppr}, sigma: ${sigma.toFixed(1)} },`);
      }
      if (scope === 'first9') first9Solved.set(direction, solved);
      console.log(`  ${direction}: [`);
      console.log(rows.join('\n'));
      console.log(`    { ppr: MAX_PPR, sigma: 0 },`);
      console.log('  ],');
    }
  }

  /*
   * 着弾モデル v2（案 2）: 得点の場面は First9 の σ のまま、ゲーム全体の PPR が Average になる
   * 上がりの場面の σ を求める。上がりの σ は得点の σ より小さくしない。
   * cap は「First9 の精度のまま投げ切ったときのゲーム全体 PPR」で、Average の上限になる。
   */
  console.log('\n## FINISHING_SIGMA_TABLE（上がりの場面の σ。First9 ごと・Average ごと）\n');
  for (const direction of DIRECTIONS) {
    console.log(`  ${direction}: [`);
    const first9Rows = [...targets, MAX_PPR];
    for (const first9 of first9Rows) {
      const scoringSigma = first9 >= MAX_PPR ? 0 : first9Solved.get(direction)!.get(first9)!;
      const base = { startScore: START_SCORE, direction, maxMiss: 'medium' as const, scoringSigma };
      const cap =
        first9 >= MAX_PPR
          ? MAX_PPR
          : measure({ ...base, finishingSigma: scoringSigma }, SOLVE_GAMES, 20260916).ppr;
      const points = targets
        .filter((average) => average < cap - 1)
        .map((average) => {
          const sigma = solveFinishingSigma(average, base, SOLVE_GAMES, 20);
          return `{ ppr: ${average}, sigma: ${sigma.toFixed(1)} }`;
        });
      console.log(
        `    { first9: ${first9 >= MAX_PPR ? 'MAX_PPR' : first9}, cap: ${cap.toFixed(1)}, points: [${points.join(', ')}] },`,
      );
    }
    console.log('  ],');
  }
}

function auditCalibration(): void {
  console.log('\n## PPR キャリブレーション（精度一定で投げ切ったとき・SIGMA_ANCHORS）\n');
  for (const ppr of CHECK_PPR) {
    const sigma = sigmaForPpr(ppr, 'even');
    const result = measure(
      {
        startScore: START_SCORE,
        scoringSigma: sigma,
        finishingSigma: sigma,
        direction: 'even',
        maxMiss: 'medium',
      },
      1500,
      424242,
    );
    const diff = result.ppr - ppr;
    // 168 点満点の尺度で ±5 点以内なら「大幅な乖離ではない」とみなす。
    check(
      `Average ${String(ppr).padStart(3)}`,
      Math.abs(diff) <= 5,
      `実測 ${fixed(result.ppr)}（差 ${diff >= 0 ? '+' : ''}${fixed(diff)}） / 平均 ${fixed(result.averageDarts)} darts`,
    );
  }

  console.log('\n## First9 キャリブレーション（設定値 vs 最初の 9 投の実測）\n');
  for (const ppr of [40, 60, 80, 100, 120, 150]) {
    const sigma = sigmaForFirst9Ppr(ppr, 'even');
    const result = measure(
      {
        startScore: START_SCORE,
        scoringSigma: sigma,
        finishingSigma: sigma,
        direction: 'even',
        maxMiss: 'medium',
      },
      1500,
      424242,
    );
    const diff = result.first9Ppr - ppr;
    check(
      `First9 ${String(ppr).padStart(3)}`,
      Math.abs(diff) <= 5,
      `実測 ${fixed(result.first9Ppr)}（差 ${diff >= 0 ? '+' : ''}${fixed(diff)}）`,
    );
  }

  /*
   * 着弾モデル v2（案 2）: 実際の設定の組み合わせで投げ、First9 と Average の両方が
   * 設定（Average は上限に丸めた値）に近いことを見る。上がりの σ ≧ 得点の σ も確かめる。
   */
  console.log('\n## 実際の設定（First9 / Average）で投げたとき\n');
  console.log('  | 設定 First9 / Average | 使う Average | 得点の σ | 上がりの σ | 実測 First9 | 実測 Average |');
  console.log('  | --- | ---: | ---: | ---: | ---: | ---: |');
  const pairs: readonly (readonly [number, number])[] = [
    [40, 25],
    [60, 40],
    [60, 55],
    [70, 50],
    [80, 60],
    [100, 80],
    [120, 100],
    [150, 130],
  ];
  for (const [first9, average] of pairs) {
    for (const direction of DIRECTIONS) {
      const used = effectiveAveragePpr(first9, average, direction);
      const scoring = scoringSigma(first9, direction);
      const finishing = finishingSigma(first9, average, direction);
      const result = measure(
        { startScore: START_SCORE, scoringSigma: scoring, finishingSigma: finishing, direction, maxMiss: 'medium' },
        1500,
        424242,
      );
      if (direction === 'even') {
        console.log(
          `  | ${first9} / ${average} | ${fixed(used)} | ${fixed(scoring)} | ${fixed(finishing)} | ${fixed(result.first9Ppr)} | ${fixed(result.ppr)} |`,
        );
      }
      check(
        `${direction.padEnd(10)} ${first9} / ${average}`,
        Math.abs(result.first9Ppr - first9) <= 5 &&
          Math.abs(result.ppr - used) <= 5 &&
          finishing >= scoring,
        `First9 実測 ${fixed(result.first9Ppr)} / Average 実測 ${fixed(result.ppr)}（使う値 ${fixed(used)}）/ σ ${fixed(scoring)} → ${fixed(finishing)}`,
      );
    }
  }

  console.log('\n## 最大ブレを変えても PPR が大きく動かないこと\n');
  for (const maxMiss of MAX_MISS) {
    for (const ppr of [60, 100]) {
      const sigma = sigmaForPpr(ppr, 'even');
      const result = measure(
        {
          startScore: START_SCORE,
          scoringSigma: sigma,
          finishingSigma: sigma,
          direction: 'even',
          maxMiss,
        },
        1200,
        777,
      );
      check(
        `${maxMiss.padEnd(6)} / Average ${ppr}`,
        Math.abs(result.ppr - ppr) <= 7,
        `実測 ${fixed(result.ppr)}`,
      );
    }
  }

  console.log('\n## ブレ方向を変えても PPR が大きく動かないこと\n');
  for (const direction of DIRECTIONS) {
    for (const ppr of [60, 100]) {
      const sigma = sigmaForPpr(ppr, direction);
      const result = measure(
        {
          startScore: START_SCORE,
          scoringSigma: sigma,
          finishingSigma: sigma,
          direction,
          maxMiss: 'medium',
        },
        1200,
        31337,
      );
      check(
        `${direction.padEnd(10)} / Average ${ppr}`,
        Math.abs(result.ppr - ppr) <= 7,
        `実測 ${fixed(result.ppr)}`,
      );
    }
  }
}

function auditScatter(): void {
  console.log('\n## 散布の形（T20 を 20 万回狙う）\n');
  const samples = 200000;

  let previousSd = Number.POSITIVE_INFINITY;
  for (const ppr of CHECK_PPR) {
    const stats = scatterStats('T20', sigmaForPpr(ppr), 'even', 'medium', samples);
    const sd = Math.hypot(stats.sdX, stats.sdY);
    check(
      `PPR ${String(ppr).padStart(3)} の散布が単調に小さくなる`,
      sd <= previousSd,
      `RMS ${fixed(sd, 2)} mm / T20 命中 ${fixed(stats.hitRate * 100)}% / OUT BOARD ${fixed(stats.outBoardRate * 100, 2)}%`,
    );
    previousSd = sd;
  }

  console.log('\n## ブレ方向が座標へ反映されること（PPR 60）\n');
  const sigma60 = sigmaForPpr(60);
  for (const direction of DIRECTIONS) {
    const stats = scatterStats('T20', sigma60, direction, 'medium', samples);
    const ok =
      direction === 'vertical'
        ? stats.sdY > stats.sdX * 1.2
        : direction === 'horizontal'
          ? stats.sdX > stats.sdY * 1.2
          : Math.abs(stats.sdX - stats.sdY) / stats.sdX < 0.05;
    check(direction, ok, `σX ${fixed(stats.sdX, 2)} / σY ${fixed(stats.sdY, 2)}`);
  }

  console.log('\n## 最大ブレが外れ値の量に効くこと（PPR 60・狙いから 60 mm 以上）\n');
  let previousOutlier = -1;
  for (const maxMiss of MAX_MISS) {
    const stats = scatterStats('T20', sigma60, 'even', maxMiss, samples);
    check(
      maxMiss,
      stats.outlierRate > previousOutlier,
      `外れ値 ${fixed(stats.outlierRate * 100, 2)}% / OUT BOARD ${fixed(stats.outBoardRate * 100, 2)}%`,
    );
    previousOutlier = stats.outlierRate;
  }

  console.log('\n## Average 167 は 100% 狙い通り / 166 は固定にならない\n');
  const perfect = scatterStats('T20', sigmaForPpr(MAX_PPR), 'even', 'large', 20000);
  check(
    'Average 167 は着弾が 1 点に固定される',
    perfect.hitRate === 1 && perfect.meanRadius === 0,
    `T20 命中 ${fixed(perfect.hitRate * 100)}% / 狙いからのズレ ${fixed(perfect.meanRadius, 3)} mm`,
  );
  const almost = scatterStats('T20', sigmaForPpr(166), 'even', 'medium', 20000);
  // 166 では「着弾座標が毎回ばらつく」ことを見る（この精度だと区画はほぼ T20 のまま）。
  check(
    'Average 166 は着弾座標がばらつく',
    almost.meanRadius > 0,
    `狙いからのズレ 平均 ${fixed(almost.meanRadius, 3)} mm / T20 命中 ${fixed(almost.hitRate * 100, 2)}%`,
  );

  console.log('\n## BULL / ダブルも座標から自然に判定されること\n');
  const bull = scatterStats('BULL', sigmaForPpr(60), 'even', 'medium', samples);
  check('BULL を狙う', bull.hitRate > 0 && bull.hitRate < 1, `BULL 命中 ${fixed(bull.hitRate * 100)}%`);
  const double = scatterStats('D16', sigmaForPpr(60), 'even', 'medium', samples);
  check('D16 を狙う', double.hitRate > 0 && double.hitRate < 1, `D16 命中 ${fixed(double.hitRate * 100)}% / OUT BOARD ${fixed(double.outBoardRate * 100)}%`);
}

function main(): void {
  if (process.argv.includes('--solve')) {
    solve();
    return;
  }
  auditCalibration();
  auditScatter();
  console.log('');
  if (failures > 0) {
    console.error(`SIMULATION monitor: ${failures} 件の監査項目が基準を満たしていません。`);
    process.exitCode = 1;
    return;
  }
  console.log('SIMULATION monitor: すべての監査項目を満たしています。');
}

main();
