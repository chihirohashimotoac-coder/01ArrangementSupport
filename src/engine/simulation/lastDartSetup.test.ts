import { describe, expect, it } from 'vitest';
import { isBogey, isCheckoutable } from '../../domain/checkoutRules';
import { THROWABLE_DARTS } from '../../domain/dart';
import { analyzeLastDartSetup, recommendedLastDartTargets } from './lastDartSetup';

describe('残り 1 投で次のラウンドへ残す形（事実の計算）', () => {
  it('178 の T19 は、狙い通りならテンパイ・シングル落ちで Bogey', () => {
    const analysis = analyzeLastDartSetup(178);
    const t19 = analysis.optionFor('T19');
    expect(t19).not.toBeNull();
    expect(t19!.leaveOnHit).toBe(121);
    expect(t19!.hitTenpai).toBe(true);
    expect(t19!.leaveOnSingleMiss).toBe(159);
    expect(isBogey(159)).toBe(true);
    expect(t19!.singleMissTenpai).toBe(false);
  });

  it('178 の T20 / T18 は、シングルに落ちてもテンパイを保てる', () => {
    const analysis = analyzeLastDartSetup(178);
    const t20 = analysis.optionFor('T20')!;
    const t18 = analysis.optionFor('T18')!;
    expect([t20.leaveOnHit, t20.leaveOnSingleMiss]).toEqual([118, 158]);
    expect([t18.leaveOnHit, t18.leaveOnSingleMiss]).toEqual([124, 160]);
    expect([t20.singleMissTenpai, t18.singleMissTenpai]).toEqual([true, true]);
  });

  it('「シングル落ちでもテンパイ」は、計算した事実と一致する', () => {
    // 全残り点 × 全ターゲットを走査し、違反だけを集めて最後に 1 回 assert する。
    const violations: string[] = [];
    for (let left = 2; left <= 350; left += 1) {
      const analysis = analyzeLastDartSetup(left);
      for (const dart of THROWABLE_DARTS) {
        const option = analysis.optionFor(dart.id);
        if (option === null) continue;
        const expectedHit = option.leaveOnHit >= 2 && option.leaveOnHit <= 170
          && isCheckoutable(option.leaveOnHit, 3);
        if (option.hitTenpai !== expectedHit) {
          violations.push(`${left}/${dart.id}: hitTenpai=${option.hitTenpai}`);
        }
        if (dart.baseNumber === null) {
          if (option.leaveOnSingleMiss !== null || option.singleMissTenpai) {
            violations.push(`${left}/${dart.id}: BULL を単純落ち扱いしている`);
          }
          continue;
        }
        const miss = left - dart.baseNumber;
        const expectedMiss = miss >= 2 && miss <= 170 && isCheckoutable(miss, 3);
        if (option.leaveOnSingleMiss !== miss || option.singleMissTenpai !== expectedMiss) {
          violations.push(`${left}/${dart.id}: singleMiss=${option.leaveOnSingleMiss}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('安全なターゲットは得点の高い順に並ぶ（特定の残り点を優先しない）', () => {
    const outOfOrder: string[] = [];
    for (let left = 171; left <= 350; left += 1) {
      const targets = analyzeLastDartSetup(left).safeTargets;
      for (let i = 1; i < targets.length; i += 1) {
        if (targets[i - 1].dart.score < targets[i].dart.score) {
          outOfOrder.push(`${left}: ${targets[i - 1].dartId} → ${targets[i].dartId}`);
        }
      }
    }
    expect(outOfOrder).toEqual([]);
  });

  it('おすすめは 160 / 170 を特別扱いせず、トリプルエリアを先に出す', () => {
    const analysis = analyzeLastDartSetup(178);
    const recommended = recommendedLastDartTargets(analysis, 2);
    expect(recommended.map((option) => option.dartId)).toEqual(['T20', 'T18']);
    // 160 を残す S18 も「安全」ではあるが、トリプルより先には出さない。
    expect(analysis.safeTargets.some((option) => option.dartId === 'S18')).toBe(true);
    expect(recommended.some((option) => option.leaveOnHit === 160)).toBe(false);
  });

  it('181〜189 で、シングル落ちまで守れるトリプルを必ず 1 つ以上見つける', () => {
    const missing: number[] = [];
    for (let left = 181; left <= 189; left += 1) {
      if (analyzeLastDartSetup(left).safeTripleTargets.length === 0) missing.push(left);
    }
    expect(missing).toEqual([]);
  });

  it('上がってしまう的・Bust する的は「残す形」の候補にしない', () => {
    // 残り 40 は D20 で上がり、T20 は Bust。どちらも残す形の候補ではない。
    const analysis = analyzeLastDartSetup(40);
    expect(analysis.optionFor('D20')).toBeNull();
    expect(analysis.optionFor('T20')).toBeNull();
    expect(analysis.optionFor('S1')).not.toBeNull();
  });
});
