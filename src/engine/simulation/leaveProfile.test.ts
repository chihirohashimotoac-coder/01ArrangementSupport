import { describe, expect, it } from 'vitest';
import { AIM_AREAS } from '../../data/aimAreas';
import { isCheckoutable } from '../../domain/checkoutRules';
import { requireDart } from '../../domain/dart';
import { canReachTenpai, isSingleMissTenpaiSafe } from '../setup/tenpai';
import { dominatesLeavePair, nextVisitLeaveProfileOf } from './leaveProfile';
import { analyzeSetupRecovery, lastDartTenpaiExamples } from './setupRecovery';

const kindOf = (leave: number) => nextVisitLeaveProfileOf(leave).kind;
const rankOf = (leave: number) => nextVisitLeaveProfileOf(leave).rank;

describe('Next Visit Leave Profile（事実の分類）', () => {
  it('外側のダブルで直接上がれる残りを最上位にする', () => {
    expect(kindOf(40)).toBe('DIRECT_DOUBLE');
    expect(kindOf(32)).toBe('DIRECT_DOUBLE');
    expect(nextVisitLeaveProfileOf(40).exampleDartIds).toEqual(['D20']);
  });

  it('BULL（50）は外側ダブルと同じ最上位にしない', () => {
    expect(kindOf(50)).not.toBe('DIRECT_DOUBLE');
    expect(rankOf(50)).toBeGreaterThan(rankOf(40));
  });

  it('承認済みの「盤面の狙い方」の 5 点だけを AIM_AREA にし、段階はシングル → ダブルと同じ', () => {
    const areaLefts = AIM_AREAS.map((area) => area.left).sort((a, b) => a - b);
    expect(areaLefts).toEqual([39, 42, 43, 46, 48]);
    const found: number[] = [];
    for (let leave = 2; leave <= 170; leave += 1) {
      if (kindOf(leave) === 'AIM_AREA') found.push(leave);
    }
    expect(found).toEqual(areaLefts);
    for (const leave of areaLefts) expect(rankOf(leave)).toBe(rankOf(56));
  });

  it('シングル 1 本で外側のダブルが残る残りと、先にトリプルが要る残りを分ける', () => {
    expect(kindOf(56)).toBe('SINGLE_TO_DOUBLE');
    expect(nextVisitLeaveProfileOf(56).exampleDartIds).toEqual(['S16', 'D20']);
    expect(kindOf(59)).toBe('SINGLE_TO_DOUBLE');
    expect(kindOf(96)).toBe('TWO_DART_OTHER');
    expect(nextVisitLeaveProfileOf(96).exampleDartIds).toEqual(['T20', 'D18']);
    expect(kindOf(100)).toBe('TWO_DART_OTHER');
    expect(rankOf(56)).toBeLessThan(rankOf(96));
  });

  it('残りが小さいだけでは上にしない（68 と 100 はどちらも先にトリプルが要る）', () => {
    expect(kindOf(68)).toBe('TWO_DART_OTHER');
    expect(rankOf(68)).toBe(rankOf(100));
  });

  it('3 本の上がり・上がれない残りを分ける', () => {
    expect(kindOf(118)).toBe('THREE_DART');
    expect(kindOf(159)).toBe('NO_CHECKOUT');
    expect(kindOf(171)).toBe('NO_CHECKOUT');
  });

  it('2〜170 の全件で、分類が Double Out のルール計算と矛盾しない', () => {
    const wrong: string[] = [];
    for (let leave = 2; leave <= 170; leave += 1) {
      const kind = kindOf(leave);
      const expectedDirect = leave <= 40 && leave % 2 === 0;
      if ((kind === 'DIRECT_DOUBLE') !== expectedDirect) wrong.push(`${leave}: ${kind}`);
      if (kind === 'NO_CHECKOUT' && isCheckoutable(leave, 3)) wrong.push(`${leave}: 上がれるのに NO_CHECKOUT`);
      if (kind === 'THREE_DART' && isCheckoutable(leave, 2)) wrong.push(`${leave}: 2 本で上がれるのに THREE_DART`);
      if (rankOf(leave) <= rankOf(96) && !isCheckoutable(leave, 2)) wrong.push(`${leave}: 2 本で上がれない`);
    }
    expect(wrong).toEqual([]);
  });

  it('上位互換は「両方で悪化せず、一方で改善」のときだけ', () => {
    const pair = (hit: number, miss: number) => ({
      hit: nextVisitLeaveProfileOf(hit),
      miss: nextVisitLeaveProfileOf(miss),
    });
    // 116: T20（56 / 96）は S16（100 / 100）の上位互換。
    expect(dominatesLeavePair(pair(56, 96), pair(100, 100))).toBe(true);
    // 同じ組は上位互換ではない。
    expect(dominatesLeavePair(pair(56, 96), pair(56, 96))).toBe(false);
    // 一方で良く一方で悪い組は上位互換にしない。
    expect(dominatesLeavePair(pair(40, 118), pair(56, 96))).toBe(false);
  });
});

describe('SETUP のシングル落ち回復（既存の tenpai 計算の再利用）', () => {
  it('A / B は canReachTenpai / isSingleMissTenpaiSafe と一致する', () => {
    const wrong: string[] = [];
    for (const left of [239, 243, 249, 280, 301]) {
      for (const dartsLeft of [2, 3]) {
        const t20 = requireDart('T20');
        const { intended } = analyzeSetupRecovery(left, t20, dartsLeft);
        if (intended.hitCanReachTenpai !== canReachTenpai(left - 60, dartsLeft - 1)) {
          wrong.push(`${left}/${dartsLeft}: A`);
        }
        if (intended.singleMissCanReachTenpai !== isSingleMissTenpaiSafe(left, t20, dartsLeft)) {
          wrong.push(`${left}/${dartsLeft}: B`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('243 / 残り 2 本: T20 は S20 落ちで詰み、T19 は S19 落ちでも回復できる', () => {
    const analysis = analyzeSetupRecovery(243, requireDart('T20'), 2);
    expect(analysis.intended.leaveOnSingleMiss).toBe(223);
    expect(analysis.intended.hitCanReachTenpai).toBe(true);
    expect(analysis.intended.singleMissCanReachTenpai).toBe(false);
    expect(analysis.safeAlternatives[0].dart.id).toBe('T19');
    expect(analysis.safeAlternatives[0].leaveOnSingleMiss).toBe(224);
  });

  it('224 から最後の 1 本で作れるテンパイの例は T20 → 164・T19 → 167・T18 → 170', () => {
    expect(lastDartTenpaiExamples(224)).toEqual([
      { dartId: 'T20', leave: 164 },
      { dartId: 'T19', leave: 167 },
      { dartId: 'T18', leave: 170 },
    ]);
    // 223 からはどの的でも作れない。
    expect(lastDartTenpaiExamples(223)).toEqual([]);
  });
});
