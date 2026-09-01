import { describe, expect, it } from 'vitest';
import { DEFAULT_TRAINING_SETTINGS, type TrainingSettings } from './questions';
import {
  difficultyQuota,
  generateQuestions,
  generateQuestionsWithReport,
  modeQuota,
  recentTailOf,
  setupCategoryQuota,
  setupFullCount,
} from './sampling';
import { contextKeyOf, type TrainingQuestion } from './model';
import { setupAdjustmentCandidates } from './setupQuestions';

function settingsOf(overrides: Partial<TrainingSettings>): TrainingSettings {
  return { ...DEFAULT_TRAINING_SETTINGS, ...overrides };
}

function countBy<T extends string>(values: readonly T[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

/** 直近 n 問に同じ problemKey が出ていないか。 */
function duplicateWithin(questions: readonly TrainingQuestion[], window: number): number {
  let count = 0;
  for (let i = 0; i < questions.length; i += 1) {
    for (let k = 1; k <= window && i - k >= 0; k += 1) {
      if (questions[i].problemKey === questions[i - k].problemKey) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

function maxRunOf(values: readonly string[]): number {
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const value of values) {
    run = value === previous ? run + 1 : 1;
    previous = value;
    best = Math.max(best, run);
  }
  return best;
}

describe('quota', () => {
  it('SETUP のカテゴリ quota は 10 問 / 30 問で仕様どおり', () => {
    expect(setupCategoryQuota(10)).toEqual({
      'setup-bogey-avoid': 2,
      'setup-adjust-18-19-20': 1,
      'setup-digits-0147': 1,
      'setup-302-309': 1,
      'setup-ton-trap': 1,
      'setup-landing-95-105': 1,
      'setup-sbull': 1,
      'setup-same-number-worse': 1,
      'setup-basics': 1,
    });
    const thirty = setupCategoryQuota(30);
    expect(Object.values(thirty).reduce((a, b) => a + b, 0)).toBe(30);
    expect(thirty['setup-bogey-avoid']).toBe(6);
  });

  it('任意の問題数でも合計が一致する', () => {
    for (const count of [1, 7, 13, 25, 50, 99]) {
      const quota = setupCategoryQuota(count);
      expect(Object.values(quota).reduce((a, b) => a + b, 0)).toBe(count);
      expect(Object.values(difficultyQuota('checkout', count)).reduce((a, b) => a + b, 0)).toBe(
        count,
      );
      expect(Object.values(modeQuota(count)).reduce((a, b) => a + b, 0)).toBe(count);
    }
  });

  it('SETUP の 3 投フル比率は 10 問 2 件 / 30 問 6 件', () => {
    expect(setupFullCount(10)).toBe(2);
    expect(setupFullCount(30)).toBe(6);
  });

  it('MIXED の種別 quota は 4/3/3 と 10/10/10', () => {
    expect(modeQuota(10)).toEqual({ checkout: 4, setup: 3, recovery: 3 });
    expect(modeQuota(30)).toEqual({ checkout: 10, setup: 10, recovery: 10 });
  });
});

describe('SETUP セッションの構成', () => {
  it('10 問は adjustment 8 / full 2 になる', () => {
    const { questions, report } = generateQuestionsWithReport({
      settings: settingsOf({ mode: 'setup', questionCount: 10, reviewWeakFirst: false }),
      seed: 2026,
    });
    expect(questions).toHaveLength(10);
    expect(report.formatDistribution['setup-adjustment']).toBe(8);
    expect(report.formatDistribution['setup-full']).toBe(2);
  });

  it('30 問は adjustment 24 / full 6 になる', () => {
    const { report } = generateQuestionsWithReport({
      settings: settingsOf({ mode: 'setup', questionCount: 30, reviewWeakFirst: false }),
      seed: 7,
    });
    expect(report.formatDistribution['setup-adjustment']).toBe(24);
    expect(report.formatDistribution['setup-full']).toBe(6);
  });

  it('10 問で 9 カテゴリすべてが出る', () => {
    const questions = generateQuestions({
      settings: settingsOf({ mode: 'setup', questionCount: 10, reviewWeakFirst: false }),
      seed: 31,
    });
    expect(new Set(questions.map((q) => q.primaryCategory)).size).toBe(9);
  });

  it('trivial（判断が要らない問題）は上限を超えない', () => {
    for (const [count, cap] of [
      [10, 2],
      [30, 6],
    ] as const) {
      for (const seed of [1, 7, 20260901]) {
        const questions = generateQuestions({
          settings: settingsOf({ mode: 'setup', questionCount: count, reviewWeakFirst: false }),
          seed,
        });
        expect(questions.filter((q) => q.trivial).length).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('継続の的でも上がれて、かつノーテン判断が要らない問題だけを trivial とする', () => {
    // 302 は継続（S20）で 162 のノーテンになるので trivial ではない。
    // 304 は継続（S20）で 164 になるが、166 などノーテンを選べるので判断が要る。
    const candidates = setupAdjustmentCandidates({ min: 171, max: 350 });
    const trivial = candidates.filter((candidate) => candidate.trivial);
    expect(trivial.length).toBeGreaterThan(0);
    expect(trivial.every((candidate) => candidate.primaryCategory === 'setup-basics')).toBe(true);
    expect(
      trivial.every((candidate) =>
        candidate.outcomes.every(
          (outcome) => outcome.verdict === 'checkoutable' || outcome.verdict === 'bust',
        ),
      ),
    ).toBe(true);
  });

  it('30 問のカテゴリ配分が quota と一致する', () => {
    const questions = generateQuestions({
      settings: settingsOf({ mode: 'setup', questionCount: 30, reviewWeakFirst: false }),
      seed: 41,
    });
    expect(countBy(questions.map((q) => q.primaryCategory))).toEqual(setupCategoryQuota(30));
  });
});

describe('CHECKOUT / RECOVERY の難易度配分', () => {
  it('CHECKOUT 10 問は EASY 2 / MEDIUM 4 / HARD 4', () => {
    const { report } = generateQuestionsWithReport({
      settings: settingsOf({ mode: 'checkout', questionCount: 10, reviewWeakFirst: false }),
      seed: 3,
    });
    expect(report.difficultyDistribution).toEqual({ easy: 2, medium: 4, hard: 4 });
    expect(report.directOneDartCount).toBeLessThanOrEqual(1);
    expect(report.trivialCount).toBeLessThanOrEqual(2);
  });

  it('RECOVERY 10 問は EASY 2 / MEDIUM 5 / HARD 3', () => {
    const { report } = generateQuestionsWithReport({
      settings: settingsOf({ mode: 'recovery', questionCount: 10, reviewWeakFirst: false }),
      seed: 3,
    });
    expect(report.difficultyDistribution).toEqual({ easy: 2, medium: 5, hard: 3 });
  });

  it('RECOVERY で S19 / S20 の実投が 70% を超えない', () => {
    const questions = generateQuestions({
      settings: settingsOf({ mode: 'recovery', questionCount: 30, reviewWeakFirst: false }),
      seed: 12,
    });
    const biased = questions.filter((question) =>
      ['S19', 'S20'].includes(question.recovery?.actualDartId ?? ''),
    ).length;
    expect(biased / questions.length).toBeLessThanOrEqual(0.7);
  });

  it('CHECKOUT 30 問で 100 点以上の帯もひととおり出る', () => {
    const questions = generateQuestions({
      settings: settingsOf({ mode: 'checkout', questionCount: 30, reviewWeakFirst: false }),
      seed: 55,
    });
    const categories = new Set(questions.map((q) => q.primaryCategory));
    expect(categories).toContain('checkout-100-119');
    expect(categories).toContain('checkout-120-149');
    expect(categories).toContain('checkout-150-170');
  });
});

describe('MIXED', () => {
  it('10 問は CHECKOUT 4 / SETUP 3 / RECOVERY 3', () => {
    const { report } = generateQuestionsWithReport({
      settings: settingsOf({ mode: 'mixed', questionCount: 10, reviewWeakFirst: false }),
      seed: 9,
    });
    expect(report.modeDistribution).toEqual({ checkout: 4, setup: 3, recovery: 3 });
  });

  it('30 問は 10 / 10 / 10', () => {
    const { report } = generateQuestionsWithReport({
      settings: settingsOf({ mode: 'mixed', questionCount: 30, reviewWeakFirst: false }),
      seed: 10,
    });
    expect(report.modeDistribution).toEqual({ checkout: 10, setup: 10, recovery: 10 });
  });

  it('同じ種別が 3 連続しない', () => {
    for (const seed of [1, 2, 3, 4, 5, 100, 2026]) {
      const questions = generateQuestions({
        settings: settingsOf({ mode: 'mixed', questionCount: 30, reviewWeakFirst: false }),
        seed,
      });
      expect(maxRunOf(questions.map((q) => q.kind))).toBeLessThanOrEqual(2);
    }
  });
});

describe('anti-repeat', () => {
  it('同じ問題が直近 5 問以内に再出題されない', () => {
    for (const mode of ['checkout', 'setup', 'recovery', 'mixed'] as const) {
      const questions = generateQuestions({
        settings: settingsOf({ mode, questionCount: 30, reviewWeakFirst: false }),
        seed: 777,
      });
      expect(duplicateWithin(questions, 5)).toBe(0);
    }
  });

  it('同じ状況（開始残り・現在残り）が直近 3 問以内に出ない', () => {
    const questions = generateQuestions({
      settings: settingsOf({ mode: 'setup', questionCount: 30, reviewWeakFirst: false }),
      seed: 61,
    });
    let violations = 0;
    for (let i = 0; i < questions.length; i += 1) {
      for (let k = 1; k <= 3 && i - k >= 0; k += 1) {
        if (contextKeyOf(questions[i]) === contextKeyOf(questions[i - k])) violations += 1;
      }
    }
    expect(violations).toBe(0);
  });

  it('復習対象が 1 件しかなくても、同じ問題を連打しない', () => {
    const questions = generateQuestions({
      settings: settingsOf({ mode: 'checkout', questionCount: 10, reviewWeakFirst: true }),
      seed: 4,
      reviewTargets: [122],
    });
    expect(questions).toHaveLength(10);
    expect(maxRunOf(questions.map((q) => q.problemKey))).toBe(1);
    expect(duplicateWithin(questions, 2)).toBe(0);
  });

  it('候補が 1 件しかない極端な設定でも無限ループしない', () => {
    const questions = generateQuestions({
      settings: settingsOf({
        mode: 'checkout',
        checkoutRange: { min: 170, max: 170 },
        questionCount: 5,
        reviewWeakFirst: false,
      }),
      seed: 1,
    });
    expect(questions).toHaveLength(5);
    expect(new Set(questions.map((q) => q.problemKey)).size).toBe(1);
  });
});

describe('reviewWeakFirst', () => {
  it('復習対象を含む出題になる', () => {
    const { questions, report } = generateQuestionsWithReport({
      settings: settingsOf({ mode: 'checkout', questionCount: 10, reviewWeakFirst: true }),
      seed: 21,
      reviewTargets: [
        {
          kind: 'checkout',
          problemKey: 'checkout|v2|left=122|darts=3',
          startRemaining: 122,
          primaryCategory: null,
          learningTags: [],
          weight: 100,
        },
      ],
    });
    expect(report.reviewPlaced).toBeGreaterThan(0);
    expect(questions.some((q) => q.startRemaining === 122)).toBe(true);
  });

  it('reviewWeakFirst を切ると復習枠を使わない', () => {
    const { report } = generateQuestionsWithReport({
      settings: settingsOf({ mode: 'checkout', questionCount: 10, reviewWeakFirst: false }),
      seed: 21,
      reviewTargets: [122],
    });
    expect(report.reviewPlaced).toBe(0);
  });
});

describe('決定性と無限モード', () => {
  it('同じ seed からは同じ並びになる', () => {
    for (const mode of ['checkout', 'setup', 'recovery', 'mixed'] as const) {
      const options = {
        settings: settingsOf({ mode, questionCount: 30, reviewWeakFirst: false }),
        seed: 12345,
      };
      expect(generateQuestions(options).map((q) => q.problemKey)).toEqual(
        generateQuestions(options).map((q) => q.problemKey),
      );
    }
  });

  it('chunk 境界で直前 5 問の anti-repeat を維持する', () => {
    const first = generateQuestions({
      settings: settingsOf({ mode: 'checkout', questionCount: null, reviewWeakFirst: false }),
      seed: 1,
      count: 10,
    });
    const second = generateQuestions({
      settings: settingsOf({ mode: 'checkout', questionCount: null, reviewWeakFirst: false }),
      seed: 2,
      count: 10,
      recentHistory: recentTailOf(first, 5),
    });
    expect(duplicateWithin([...first, ...second], 5)).toBe(0);
  });
});

describe('出題順の制約', () => {
  it('1 問目は HARD にせず、最後の 2 問のどちらかは HARD にする', () => {
    for (const seed of [1, 2, 3, 11, 42]) {
      const questions = generateQuestions({
        settings: settingsOf({ mode: 'checkout', questionCount: 10, reviewWeakFirst: false }),
        seed,
      });
      expect(questions[0].difficulty).not.toBe('hard');
      expect(
        questions[questions.length - 1].difficulty === 'hard' ||
          questions[questions.length - 2].difficulty === 'hard',
      ).toBe(true);
    }
  });

  it('HARD が 3 連続しない', () => {
    for (const mode of ['checkout', 'setup', 'recovery', 'mixed'] as const) {
      for (const seed of [1, 5, 9, 77, 2026]) {
        const questions = generateQuestions({
          settings: settingsOf({ mode, questionCount: 30, reviewWeakFirst: false }),
          seed,
        });
        // HARD だけを見る（EASY / MEDIUM の連続は制約しない）。
        let run = 0;
        let longest = 0;
        for (const question of questions) {
          run = question.difficulty === 'hard' ? run + 1 : 0;
          longest = Math.max(longest, run);
        }
        expect(longest).toBeLessThanOrEqual(2);
      }
    }
  });
});
