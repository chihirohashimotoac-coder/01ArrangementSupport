import { describe, expect, it } from 'vitest';
import { isLegalCheckoutRoute } from '../../domain/checkoutRules';
import { parseRoute } from '../../domain/dart';
import { gradeAnswer } from './grade';
import { DEFAULT_TRAINING_SETTINGS, recoveryQuestionCandidates } from './questions';
import { generateQuestions } from './sampling';
import type { TrainingQuestion } from './model';

interface AuditSummary {
  generated: number;
  recovery: number;
  unsolvable: number;
  graderMismatch: number;
  undefinedState: number;
  nan: number;
}

function audit(questions: readonly TrainingQuestion[]): AuditSummary {
  const summary: AuditSummary = {
    generated: questions.length,
    recovery: 0,
    unsolvable: 0,
    graderMismatch: 0,
    undefinedState: 0,
    nan: 0,
  };

  for (const question of questions) {
    if (!Number.isFinite(question.currentRemaining) || !Number.isFinite(question.dartsAvailable)) {
      summary.nan += 1;
    }
    if (question.kind !== 'recovery') continue;

    summary.recovery += 1;
    const context = question.recovery;
    if (context === null || context.expectedRoute.length === 0) {
      summary.undefinedState += 1;
      continue;
    }

    const expected = parseRoute(context.expectedRoute);
    const recalculated =
      context.visitStartRemaining - parseRoute([context.actualDartId])[0].score;
    if (
      question.currentRemaining !== recalculated ||
      question.dartsAvailable !== 2 ||
      !isLegalCheckoutRoute(question.currentRemaining, expected, question.dartsAvailable)
    ) {
      summary.unsolvable += 1;
      continue;
    }

    const graded = gradeAnswer(question, expected);
    if (
      !graded.ruleValid ||
      !graded.learningCorrect ||
      graded.grade === null ||
      graded.checkoutEvaluation === null ||
      graded.bestCheckout === null
    ) {
      summary.graderMismatch += 1;
    }
  }

  return summary;
}

describe('RECOVERY / MIXED 大量決定性監査', () => {
  it(
    '各 2,000 問で解なし・NaN・undefined・grader 不一致を生成しない',
    () => {
      // 10 万問規模の監査は `npm run audit:training` に分離してある（本仕様 51 節）。
      // 通常 suite は高速な決定論的回帰として、規模を抑えて同じ invariant を確認する。
      const recovery = generateQuestions({
        settings: {
          ...DEFAULT_TRAINING_SETTINGS,
          mode: 'recovery',
          questionCount: 2_000,
          reviewWeakFirst: false,
        },
        seed: 1,
      });
      const mixed = generateQuestions({
        settings: {
          ...DEFAULT_TRAINING_SETTINGS,
          mode: 'mixed',
          questionCount: 2_000,
          reviewWeakFirst: false,
        },
        seed: 20260901,
      });

      const candidatePool = recoveryQuestionCandidates({ min: 2, max: 170 }).length;
      const summaries = { recovery: audit(recovery), mixed: audit(mixed) };
      const violations = Object.entries(summaries).flatMap(([mode, summary]) =>
        (['unsolvable', 'graderMismatch', 'undefinedState', 'nan'] as const)
          .filter((key) => summary[key] !== 0)
          .map((key) => `${mode}: ${key}=${summary[key]}`),
      );

      console.info(
        `TRAINING_SOLVABILITY_AUDIT ${JSON.stringify({ candidatePool, ...summaries })}`,
      );
      expect(candidatePool).toBeGreaterThan(0);
      expect(summaries.recovery.generated).toBe(2_000);
      expect(summaries.recovery.recovery).toBe(2_000);
      expect(summaries.mixed.generated).toBe(2_000);
      expect(summaries.mixed.recovery).toBeGreaterThan(0);
      expect(violations).toEqual([]);
    },
    60_000,
  );
});
