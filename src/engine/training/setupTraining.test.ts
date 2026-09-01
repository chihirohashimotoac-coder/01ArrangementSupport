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
