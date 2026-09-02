import { describe, expect, it } from 'vitest';
import { parseRoute, requireDart } from '../../domain/dart';
import { isBogey, isCheckoutable } from '../../domain/checkoutRules';
import { THIRD_DART_ADJUST_CASES, THIRD_DART_TRAP } from '../../data/setupReferenceCases';
import { buildSetupAdjustmentQuestion, buildSetupFullQuestion } from './questions';
import {
  adjustmentOutcomes,
  leaveVerdictOf,
  recommendedAdjustment,
  setupAdjustmentCandidates,
  setupFullCandidates,
  type SetupAdjustmentCandidate,
} from './setupQuestions';
import { gradeAnswer } from './grade';
import { buildFeedback } from './feedback';
import type { TrainingQuestion } from './model';

const FULL_RANGE = { min: 171, max: 350 };

function findAdjustment(start: number, actualIds: readonly string[]): SetupAdjustmentCandidate {
  const found = setupAdjustmentCandidates(FULL_RANGE).find(
    (candidate) =>
      candidate.startRemaining === start &&
      candidate.contextualThrows.map((item) => item.actualDartId).join(',') === actualIds.join(','),
  );
  if (!found) throw new Error(`SETUP 1 投調整の候補が見つかりません: ${start} / ${actualIds}`);
  return found;
}

function adjustmentQuestion(start: number, actualIds: readonly string[]): TrainingQuestion {
  return buildSetupAdjustmentQuestion(findAdjustment(start, actualIds), 0);
}

describe('SETUP 1 投調整（226 / 必須ケース A）', () => {
  const candidate = findAdjustment(226, ['S20', 'S20']);
  const question = adjustmentQuestion(226, ['S20', 'S20']);

  it('226 から S20 が 2 本で、現在の残りは 186 になる', () => {
    expect(candidate.contextTotal).toBe(40);
    expect(candidate.currentRemaining).toBe(186);
    expect(question.startRemaining).toBe(226);
    expect(question.currentRemaining).toBe(186);
    expect(question.dartsAvailable).toBe(1);
  });

  it('ここまでの 2 投は「実際に入った結果」として保持し、回答には含めない', () => {
    expect(question.contextualThrows.map((item) => item.actualDartId)).toEqual(['S20', 'S20']);
    expect(question.contextualThrows.every((item) => item.intendedDartId !== null)).toBe(true);
  });

  it('S20 を続けると 166 が残り、ノーテンなので learningCorrect にならない', () => {
    const result = gradeAnswer(question, parseRoute(['S20']));
    expect(result.leave).toBe(166);
    expect(isBogey(166)).toBe(true);
    expect(result.ruleValid).toBe(true);
    expect(result.learningCorrect).toBe(false);
    expect(result.failureCode).toBe('LEAVES_BOGEY');
  });

  it('S19 へずらすと 167 が残り、正解になる', () => {
    const result = gradeAnswer(question, parseRoute(['S19']));
    expect(result.leave).toBe(167);
    expect(isCheckoutable(167, 3)).toBe(true);
    expect(result.ruleValid).toBe(true);
    expect(result.learningCorrect).toBe(true);
  });

  it('推奨解答は S19 → 167', () => {
    expect(candidate.recommended.id).toBe('S19');
    expect(candidate.recommendedLeave).toBe(167);
    expect(question.expectedAnswer).toEqual(['S19']);
  });

  it('feedback が「20 を続けると 166」「19 へずらすと 167」を伝える', () => {
    const answer = parseRoute(['S20']);
    const feedback = buildFeedback(question, answer, gradeAnswer(question, answer));
    expect(feedback.recommendedDartIds).toEqual(['S19']);
    expect(feedback.recommendedLeave).toBe(167);
    expect(feedback.answerOutcomeJa).toContain('166');
    expect(feedback.recommendedOutcomeJa).toContain('167');
    expect(feedback.differenceJa).toContain('166');
    expect(feedback.differenceJa).toContain('19');
  });

  it('推奨以外にも成立する回答（S16 → 170）を正解として扱う', () => {
    const result = gradeAnswer(question, parseRoute(['S16']));
    expect(result.leave).toBe(170);
    expect(result.learningCorrect).toBe(true);
    // 二次評価（推奨度）は別軸として残る。
    expect(result.grade).not.toBeNull();
  });

  it('成立する回答が複数あることを feedback が示せる', () => {
    const answer = parseRoute(['S20']);
    const feedback = buildFeedback(question, answer, gradeAnswer(question, answer));
    expect(feedback.alternativeTexts.length).toBeGreaterThan(0);
    expect(feedback.alternativeTexts.join(' / ')).toContain('残り');
  });
});

describe('SETUP 1 投調整（302〜309）', () => {
  it.each(THIRD_DART_ADJUST_CASES.map((item) => [item.remaining, item.documentedThirdDart, item.documentedLeave] as const))(
    '%i は T20 が 2 本のあと S%i へ振り、%i を残す',
    (start, thirdDart, leave) => {
      const candidate = findAdjustment(start, ['T20', 'T20']);
      expect(candidate.currentRemaining).toBe(start - 120);
      expect(candidate.recommended.id).toBe(`S${thirdDart}`);
      expect(candidate.recommendedLeave).toBe(leave);
      expect(leaveVerdictOf(leave)).toBe('checkoutable');
    },
  );

  it('302 で 3 投目を 20 にすると 162 のノーテンになる', () => {
    const question = adjustmentQuestion(THIRD_DART_TRAP.remaining, ['T20', 'T20']);
    const result = gradeAnswer(question, parseRoute([`S${THIRD_DART_TRAP.badThirdDart}`]));
    expect(result.leave).toBe(THIRD_DART_TRAP.badLeave);
    expect(result.learningCorrect).toBe(false);
    expect(result.failureCode).toBe('LEAVES_BOGEY');
  });

  it('305 → S18 → 167 / 308 → S18 → 170', () => {
    expect(findAdjustment(305, ['T20', 'T20']).recommendedLeave).toBe(167);
    expect(findAdjustment(305, ['T20', 'T20']).recommended.id).toBe('S18');
    expect(findAdjustment(308, ['T20', 'T20']).recommendedLeave).toBe(170);
    expect(findAdjustment(308, ['T20', 'T20']).recommended.id).toBe('S18');
  });
});

describe('SETUP 1 投調整の候補 invariant', () => {
  it('全候補で推奨解答が「次のラウンドで上がれる残り」を作る', () => {
    const candidates = setupAdjustmentCandidates(FULL_RANGE);
    const violations: string[] = [];
    for (const candidate of candidates) {
      const label = `${candidate.startRemaining}/${candidate.contextualThrows
        .map((item) => item.actualDartId)
        .join(',')}`;
      const leave = candidate.currentRemaining - candidate.recommended.score;
      if (leave !== candidate.recommendedLeave) violations.push(`${label}: leave`);
      if (leaveVerdictOf(leave) !== 'checkoutable') violations.push(`${label}: verdict`);
      if (candidate.currentRemaining !== candidate.startRemaining - candidate.contextTotal) {
        violations.push(`${label}: arithmetic`);
      }
      const question = buildSetupAdjustmentQuestion(candidate, 0);
      const graded = gradeAnswer(question, [candidate.recommended]);
      if (!graded.ruleValid || !graded.learningCorrect) violations.push(`${label}: grader`);
    }
    expect(candidates.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('9 つの教育カテゴリすべてに候補がある', () => {
    const categories = new Set(
      setupAdjustmentCandidates(FULL_RANGE).map((candidate) => candidate.primaryCategory),
    );
    for (const category of [
      'setup-bogey-avoid',
      'setup-adjust-18-19-20',
      'setup-digits-0147',
      'setup-302-309',
      'setup-ton-trap',
      'setup-landing-95-105',
      'setup-sbull',
      'setup-same-number-worse',
      'setup-basics',
    ] as const) {
      expect(categories).toContain(category);
    }
  });

  it('とりあえず TON を取ると 269 は 169 のノーテンになる', () => {
    const candidate = findAdjustment(269, ['T20', 'S20']);
    expect(candidate.primaryCategory).toBe('setup-ton-trap');
    expect(candidate.currentRemaining).toBe(189);
    const question = buildSetupAdjustmentQuestion(candidate, 0);
    // 3 投目に S20 を入れると、このラウンドでちょうど 100 点になる。
    const result = gradeAnswer(question, parseRoute(['S20']));
    expect(result.leave).toBe(169);
    expect(result.learningCorrect).toBe(false);
  });

  it('S-BULL を調整に使ったあとの問題を出せる', () => {
    const sbull = setupAdjustmentCandidates(FULL_RANGE).filter((candidate) =>
      candidate.contextualThrows.some((item) => item.actualDartId === 'SB'),
    );
    expect(sbull.length).toBeGreaterThan(0);
    // より具体的なカテゴリ（302〜309 / TON トラップ）が優先されるものを除き、S-BULL 教材になる。
    expect(
      sbull.every((candidate) =>
        ['setup-sbull', 'setup-302-309', 'setup-ton-trap'].includes(candidate.primaryCategory),
      ),
    ).toBe(true);
    expect(sbull.some((candidate) => candidate.primaryCategory === 'setup-sbull')).toBe(true);
  });
});

/**
 * ラスト 1 投の「現在残りから逆算する」判断。
 *
 * 302 だから S18、という開始残り依存の暗記にしないため、
 * ここでは現在残りを主語にして固定する。
 */
describe('ラスト 1 投の 3 投目調整（現在残りからの逆算）', () => {
  /** その現在残りを作る出題候補（context は問わない）。 */
  function questionAt(current: number): TrainingQuestion {
    const candidate = setupAdjustmentCandidates(FULL_RANGE).find(
      (item) => item.currentRemaining === current,
    );
    if (!candidate) throw new Error(`現在残り ${current} の 1 投調整候補がありません`);
    return buildSetupAdjustmentQuestion(candidate, 0);
  }

  const SHIFT_CASES = [
    { current: 182, keepLeave: 162, shift: 'S18', shiftLeave: 164 },
    { current: 183, keepLeave: 163, shift: 'S19', shiftLeave: 164 },
    { current: 185, keepLeave: 165, shift: 'S18', shiftLeave: 167 },
    { current: 186, keepLeave: 166, shift: 'S19', shiftLeave: 167 },
    { current: 188, keepLeave: 168, shift: 'S18', shiftLeave: 170 },
    { current: 189, keepLeave: 169, shift: 'S19', shiftLeave: 170 },
  ] as const;

  it.each(SHIFT_CASES.map((c) => [c.current, c.keepLeave, c.shift, c.shiftLeave] as const))(
    '%i は 20 を続けると %i のノーテン、%s へずらすと %i',
    (current, keepLeave, shift, shiftLeave) => {
      const question = questionAt(current);

      const kept = gradeAnswer(question, parseRoute(['S20']));
      expect(kept.leave).toBe(keepLeave);
      expect(isBogey(keepLeave)).toBe(true);
      expect(kept.ruleValid).toBe(true);
      expect(kept.learningCorrect).toBe(false);
      expect(kept.failureCode).toBe('LEAVES_BOGEY');

      const shifted = gradeAnswer(question, parseRoute([shift]));
      expect(shifted.leave).toBe(shiftLeave);
      expect(isCheckoutable(shiftLeave, 3)).toBe(true);
      expect(shifted.ruleValid).toBe(true);
      expect(shifted.learningCorrect).toBe(true);

      // 推奨解答そのものが「ずらす側」であること。
      expect(recommendedAdjustment(current)?.id).toBe(shift);
      expect(question.expectedAnswer).toEqual([shift]);
    },
  );

  it.each([
    [184, 164],
    [187, 167],
  ])('%i は 20 のままで %i を作れるので、18 / 19 へずらさせない', (current, leave) => {
    const question = questionAt(current);
    const kept = gradeAnswer(question, parseRoute(['S20']));
    expect(kept.leave).toBe(leave);
    expect(kept.learningCorrect).toBe(true);
    expect(recommendedAdjustment(current)?.id).toBe('S20');
    expect(question.expectedAnswer).toEqual(['S20']);
  });

  it('302〜309 と現在残りの対応が一致する', () => {
    const expected = [
      [302, 182, 'S18'],
      [303, 183, 'S19'],
      [304, 184, 'S20'],
      [305, 185, 'S18'],
      [306, 186, 'S19'],
      [307, 187, 'S20'],
      [308, 188, 'S18'],
      [309, 189, 'S19'],
    ] as const;
    const violations: string[] = [];
    for (const [start, current, target] of expected) {
      const candidate = findAdjustment(start, ['T20', 'T20']);
      if (candidate.currentRemaining !== current) violations.push(`${start}: current`);
      if (candidate.recommended.id !== target) violations.push(`${start}: target`);
      if (recommendedAdjustment(current)?.id !== target) violations.push(`${start}: by-current`);
    }
    expect(violations).toEqual([]);
  });

  it('同じ判断を複数の context で反復できる', () => {
    // 「302 だから S18」ではなく「182 だから S18」を学べること。
    for (const { current, shift } of SHIFT_CASES) {
      const contexts = setupAdjustmentCandidates(FULL_RANGE).filter(
        (item) => item.currentRemaining === current,
      );
      expect(contexts.length).toBeGreaterThan(1);
      expect(new Set(contexts.map((item) => item.startRemaining)).size).toBeGreaterThan(1);
      expect(contexts.every((item) => item.recommended.id === shift)).toBe(true);
      // 現在残りを学習単位にするタグが、context をまたいで共通であること。
      const concept = `setup-last-dart|current=${current}|target=${shift}`;
      expect(contexts.every((item) => item.learningTags.includes(concept))).toBe(true);
    }
  });

  it('20 からずらす技術としてタグが付く', () => {
    for (const { current, shift } of SHIFT_CASES) {
      const candidate = setupAdjustmentCandidates(FULL_RANGE).find(
        (item) => item.currentRemaining === current,
      )!;
      expect(candidate.learningTags).toContain('last-dart-adjustment');
      expect(candidate.learningTags).toContain('avoid-bogey-on-last-dart');
      expect(candidate.learningTags).toContain(
        shift === 'S18' ? 'shift-20-to-18' : 'shift-20-to-19',
      );
    }
    // 184 / 187 は「ずらす」教材ではないのでタグを付けない。
    for (const current of [184, 187]) {
      const candidate = setupAdjustmentCandidates(FULL_RANGE).find(
        (item) => item.currentRemaining === current,
      )!;
      expect(candidate.learningTags).not.toContain('avoid-bogey-on-last-dart');
      expect(candidate.learningTags).not.toContain('shift-20-to-18');
      expect(candidate.learningTags).not.toContain('shift-20-to-19');
    }
  });

  it.each(SHIFT_CASES.map((c) => [c.current, c.keepLeave, c.shift, c.shiftLeave] as const))(
    '%i で S20 を選ぶと「%i が残るため %s へずらす」と示す',
    (current, keepLeave, shift, shiftLeave) => {
      const question = questionAt(current);
      const answer = parseRoute(['S20']);
      const feedback = buildFeedback(question, answer, gradeAnswer(question, answer));

      expect(feedback.answerOutcomeJa).toContain(String(keepLeave));
      expect(feedback.recommendedDartIds).toEqual([shift]);
      expect(feedback.recommendedOutcomeJa).toContain(String(shiftLeave));
      expect(feedback.differenceJa).toContain('20 を狙うと');
      expect(feedback.differenceJa).toContain(String(keepLeave));
      expect(feedback.differenceJa).toContain(shift.replace('S', ''));
      expect(feedback.differenceJa).toContain(String(shiftLeave));
    },
  );

  it('推奨以外でも、上がれる残りを作れば正解になる', () => {
    // 182 は S15 → 167 でも次のラウンドで上がれる。
    const question = questionAt(182);
    const result = gradeAnswer(question, parseRoute(['S15']));
    expect(result.leave).toBe(167);
    expect(result.learningCorrect).toBe(true);

    // ただし推奨として提示するのはシングルのずらしを優先する。
    const answer = parseRoute(['S20']);
    const feedback = buildFeedback(question, answer, gradeAnswer(question, answer));
    expect(feedback.alternativeTexts[0]).toBe('S15 → 残り 167');
  });
});

describe('SETUP 3 投フル', () => {
  const full = setupFullCandidates(FULL_RANGE);

  it('候補が存在し、推奨解答が良い残りを作る', () => {
    expect(full.length).toBeGreaterThan(0);
    const violations = full
      .filter((candidate) => leaveVerdictOf(candidate.recommendedLeave) !== 'checkoutable')
      .map((candidate) => candidate.startRemaining);
    expect(violations).toEqual([]);
  });

  it('合法に 3 投できても、ノーテンなら learningCorrect にならない', () => {
    const candidate = full.find((item) => item.startRemaining === 302);
    expect(candidate).toBeDefined();
    const question = buildSetupFullQuestion(candidate!, 0);
    const result = gradeAnswer(question, parseRoute(['T20', 'T20', 'S20']));
    expect(result.ruleValid).toBe(true);
    expect(result.learningCorrect).toBe(false);
    expect(result.leave).toBe(162);
  });

  it('170 超えを残しても learningCorrect にならない', () => {
    const candidate = full.find((item) => item.startRemaining === 350);
    expect(candidate).toBeDefined();
    const question = buildSetupFullQuestion(candidate!, 0);
    const result = gradeAnswer(question, parseRoute(['S1', 'S1', 'S1']));
    expect(result.ruleValid).toBe(true);
    expect(result.learningCorrect).toBe(false);
    expect(result.failureCode).toBe('LEAVE_ABOVE_CHECKOUT_RANGE');
    expect(result.leave).toBe(347);
  });

  it('全 173 候補へ S20 を 3 本入れても、正解になるのは一部だけ', () => {
    const s20 = requireDart('S20');
    let learningCorrect = 0;
    for (const candidate of full) {
      const question = buildSetupFullQuestion(candidate, 0);
      const result = gradeAnswer(question, [s20, s20, s20]);
      if (result.learningCorrect) learningCorrect += 1;
    }
    // v1 は「合法に 3 投できた」だけで全件正解になっていた。
    expect(learningCorrect).toBeLessThan(full.length);
    expect(learningCorrect).toBeGreaterThan(0);
  });
});

describe('1 投の結果一覧', () => {
  it('186 からの選択肢に、ノーテンと上がれる残りの両方がある', () => {
    const outcomes = adjustmentOutcomes(186);
    expect(outcomes.some((item) => item.verdict === 'bogey')).toBe(true);
    expect(outcomes.some((item) => item.verdict === 'checkoutable')).toBe(true);
    expect(outcomes.find((item) => item.dart.id === 'S20')?.leave).toBe(166);
    expect(outcomes.find((item) => item.dart.id === 'S19')?.leave).toBe(167);
  });

  it('推奨解答は残りが上がれるものだけを返す', () => {
    const dart = recommendedAdjustment(186);
    expect(dart?.id).toBe('S19');
    expect(leaveVerdictOf(186 - (dart?.score ?? 0))).toBe('checkoutable');
  });
});
