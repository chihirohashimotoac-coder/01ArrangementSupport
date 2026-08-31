import { describe, expect, it } from 'vitest';
import { isLegalCheckoutRoute } from '../../domain/checkoutRules';
import { gradeAnswer } from './grade';
import {
  DEFAULT_TRAINING_SETTINGS,
  generateQuestions,
  recoveryQuestionCandidates,
  type TrainingQuestion,
} from './questions';

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
    if (!Number.isFinite(question.remaining) || !Number.isFinite(question.dartsAvailable)) {
      summary.nan += 1;
    }
    if (question.kind !== 'recovery') continue;

    summary.recovery += 1;
    const context = question.recovery;
    if (context === null || context.expectedRoute.length === 0) {
      summary.undefinedState += 1;
      continue;
    }

    const recalculated = context.visitStartRemaining - context.actualDart.score;
    if (
      question.remaining !== recalculated ||
      question.dartsAvailable !== 2 ||
      !isLegalCheckoutRoute(
        question.remaining,
        context.expectedRoute,
        question.dartsAvailable,
      )
    ) {
      summary.unsolvable += 1;
      continue;
    }

    const graded = gradeAnswer(question, context.expectedRoute);
    if (
      !graded.valid ||
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
    '各 10,000 問で解なし・NaN・undefined・grader 不一致を生成しない',
    () => {
      const recovery = generateQuestions({
        settings: {
          ...DEFAULT_TRAINING_SETTINGS,
          mode: 'recovery',
          questionCount: 10_000,
          reviewWeakFirst: false,
        },
        seed: 1,
      });
      const mixed = generateQuestions({
        settings: {
          ...DEFAULT_TRAINING_SETTINGS,
          mode: 'mixed',
          questionCount: 10_000,
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
      expect(summaries.recovery.generated).toBe(10_000);
      expect(summaries.recovery.recovery).toBe(10_000);
      expect(summaries.mixed.generated).toBe(10_000);
      expect(summaries.mixed.recovery).toBeGreaterThan(0);
      expect(violations).toEqual([]);
    },
    60_000,
  );
});
