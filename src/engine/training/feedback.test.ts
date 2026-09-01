import { describe, expect, it } from 'vitest';
import { parseRoute } from '../../domain/dart';
import { DARTS_PER_VISIT } from '../../domain/checkoutRules';
import {
  buildRecoveryQuestion,
  buildSetupAdjustmentQuestion,
  buildSetupFullQuestion,
  createRecoveryQuestionCandidate,
} from './questions';
import { setupAdjustmentCandidates, setupFullCandidates } from './setupQuestions';
import { gradeAnswer, type FailureCode } from './grade';
import { buildFeedback, recommendedAnswerOf } from './feedback';
import { checkoutProblemKey, type TrainingQuestion } from './model';
import { requireDart } from '../../domain/dart';

function checkoutQuestion(left: number, darts = DARTS_PER_VISIT): TrainingQuestion {
  return {
    id: 'q',
    problemKey: checkoutProblemKey(left, darts),
    kind: 'checkout',
    format: 'checkout-route',
    difficulty: 'medium',
    primaryCategory: 'checkout-100-119',
    learningTags: [],
    startRemaining: left,
    currentRemaining: left,
    dartsAvailable: darts,
    contextualThrows: [],
    promptJa: '',
    recovery: null,
    expectedAnswer: [],
    trivial: false,
  };
}

function adjustment(start: number, actualIds: readonly string[]): TrainingQuestion {
  const candidate = setupAdjustmentCandidates({ min: 171, max: 350 }).find(
    (item) =>
      item.startRemaining === start &&
      item.contextualThrows.map((t) => t.actualDartId).join(',') === actualIds.join(','),
  );
  if (!candidate) throw new Error('候補が見つかりません');
  return buildSetupAdjustmentQuestion(candidate, 0);
}

describe('不成立の回答にも必ず推奨解答を返す', () => {
  const cases: ReadonlyArray<{
    label: string;
    question: TrainingQuestion;
    answer: readonly string[];
    expected: FailureCode;
  }> = [
    { label: 'EMPTY', question: checkoutQuestion(103), answer: [], expected: 'EMPTY' },
    {
      label: 'TOO_MANY_DARTS',
      question: checkoutQuestion(103, 2),
      answer: ['T19', 'S6', 'D20'],
      expected: 'TOO_MANY_DARTS',
    },
    {
      label: 'BUST',
      question: checkoutQuestion(40),
      answer: ['T20', 'D20'],
      expected: 'BUST',
    },
    {
      label: 'NOT_DOUBLE_FINISH',
      question: checkoutQuestion(60),
      answer: ['S20', 'S20', 'S20'],
      expected: 'NOT_DOUBLE_FINISH',
    },
    {
      label: 'TOTAL_MISMATCH',
      question: checkoutQuestion(103),
      answer: ['T20', 'D20'],
      expected: 'TOTAL_MISMATCH',
    },
    {
      label: 'NOT_FINISHED',
      question: adjustment(302, ['T20', 'T20']),
      answer: [],
      expected: 'EMPTY',
    },
    {
      label: 'LEAVES_BOGEY',
      question: adjustment(226, ['S20', 'S20']),
      answer: ['S20'],
      expected: 'LEAVES_BOGEY',
    },
  ];

  it.each(cases.map((item) => [item.label, item] as const))(
    '%s でも推奨解答が空にならない',
    (_label, item) => {
      const answer = parseRoute(item.answer);
      const result = gradeAnswer(item.question, answer);
      expect(result.failureCode).toBe(item.expected);
      const feedback = buildFeedback(item.question, answer, result);
      expect(feedback.recommendedDartIds.length).toBeGreaterThan(0);
      expect(feedback.recommendedText.length).toBeGreaterThan(0);
      expect(feedback.differenceJa.length).toBeGreaterThan(0);
    },
  );

  it('3 投フルで本数が足りないときも推奨解答を返す', () => {
    const candidate = setupFullCandidates({ min: 171, max: 350 }).find(
      (item) => item.startRemaining === 302,
    );
    const question = buildSetupFullQuestion(candidate!, 0);
    const answer = parseRoute(['T20', 'T20']);
    const result = gradeAnswer(question, answer);
    expect(result.failureCode).toBe('NOT_FINISHED');
    const feedback = buildFeedback(question, answer, result);
    expect(feedback.recommendedDartIds).toEqual(['T20', 'T20', 'S18']);
  });

  it('170 超えを残したときも推奨解答を返す', () => {
    const candidate = setupFullCandidates({ min: 171, max: 350 }).find(
      (item) => item.startRemaining === 350,
    );
    const question = buildSetupFullQuestion(candidate!, 0);
    const answer = parseRoute(['S1', 'S1', 'S1']);
    const result = gradeAnswer(question, answer);
    expect(result.failureCode).toBe('LEAVE_ABOVE_CHECKOUT_RANGE');
    const feedback = buildFeedback(question, answer, result);
    expect(feedback.recommendedDartIds.length).toBe(3);
    expect(feedback.differenceJa).toContain('347');
  });
});

describe('CHECKOUT の推奨解答', () => {
  it('103 の推奨解答は T19 → S6 → D20', () => {
    const question = checkoutQuestion(103);
    expect(recommendedAnswerOf(question).map((dart) => dart.id)).toEqual(['T19', 'S6', 'D20']);
  });

  it('不成立の回答でも 103 の推奨解答と理由を返す', () => {
    const question = checkoutQuestion(103);
    const answer = parseRoute(['T20', 'D20']);
    const feedback = buildFeedback(question, answer, gradeAnswer(question, answer));
    expect(feedback.recommendedText).toBe('T19 → S6 → D20');
    expect(feedback.differenceJa).toContain('T19 → S6 → D20');
  });
});

describe('RECOVERY の推奨解答', () => {
  it('不成立の回答でも、現在の残り・本数で成立するルートを返す', () => {
    const candidate = createRecoveryQuestionCandidate(
      122,
      requireDart('T18'),
      requireDart('S18'),
    );
    const question = buildRecoveryQuestion(candidate!, 0);
    const answer = parseRoute(['S20']);
    const result = gradeAnswer(question, answer);
    expect(result.ruleValid).toBe(false);

    const feedback = buildFeedback(question, answer, result);
    const recommended = parseRoute(feedback.recommendedDartIds);
    const replay = gradeAnswer(question, recommended);
    expect(replay.ruleValid).toBe(true);
    expect(replay.learningCorrect).toBe(true);
  });

  it('全 RECOVERY 候補で、推奨解答が grader に受理される', () => {
    const violations: string[] = [];
    for (const [index, candidate] of [
      createRecoveryQuestionCandidate(122, requireDart('T18'), requireDart('S18')),
      createRecoveryQuestionCandidate(103, requireDart('T19'), requireDart('S19')),
      createRecoveryQuestionCandidate(100, requireDart('T20'), requireDart('S20')),
    ].entries()) {
      if (candidate === null) {
        violations.push(`${index}: candidate`);
        continue;
      }
      const question = buildRecoveryQuestion(candidate, index);
      const recommended = recommendedAnswerOf(question);
      const graded = gradeAnswer(question, recommended);
      if (!graded.ruleValid || !graded.learningCorrect) violations.push(`${index}: grader`);
    }
    expect(violations).toEqual([]);
  });
});
