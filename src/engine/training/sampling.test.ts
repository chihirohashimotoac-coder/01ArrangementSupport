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

/** 出題順の制約（HARD 3 連続・1 問目 HARD・末尾 2 問の HARD）の違反。 */
function orderingProblemsOf(questions: readonly TrainingQuestion[]): string[] {
  const difficulties = questions.map((question) => question.difficulty);
  const problems: string[] = [];
  let run = 0;
  let longest = 0;
  for (const difficulty of difficulties) {
    run = difficulty === 'hard' ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  if (longest > 2) problems.push('HARD 3 連続');
  if (difficulties.length >= 10) {
    if (difficulties[0] === 'hard') problems.push('1 問目が HARD');
    if (
      difficulties[difficulties.length - 1] !== 'hard' &&
      difficulties[difficulties.length - 2] !== 'hard'
    ) {
      problems.push('末尾 2 問に HARD 無し');
    }
  }
  return problems;
}

/** 直近 n 問に同じ状況（現在残り × 使える本数）が出ていないか。 */
function sameContextWithin(questions: readonly TrainingQuestion[], window: number): number {
  let count = 0;
  for (let i = 0; i < questions.length; i += 1) {
    for (let k = 1; k <= window && i - k >= 0; k += 1) {
      if (contextKeyOf(questions[i - k]) === contextKeyOf(questions[i])) {
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

  it('狭い出題範囲でも 3 投フルの比率を保つ', () => {
    // Codex レビュー指摘の回帰テスト。
    // 171〜182 は 3 投フル候補 12 件がすべて同じカテゴリにあり、
    // そのカテゴリの枠が 1 つしかないため 9 / 1 になっていた。
    for (const seed of [1, 2, 3]) {
      const { report } = generateQuestionsWithReport({
        settings: settingsOf({
          mode: 'setup',
          questionCount: 10,
          setupRange: { min: 171, max: 182 },
          reviewWeakFirst: false,
        }),
        seed,
      });
      expect(report.formatDistribution['setup-full']).toBe(2);
      expect(report.formatDistribution['setup-adjustment']).toBe(8);
      // 枠を譲ったことは report に残る。
      expect(report.quotaNormalizedCount).toBeGreaterThan(0);
    }
  });

  it('狭い出題範囲の seed 33 は adjustment 8 / full 2 になる（独立監査 F-006 回帰）', () => {
    // 出題順の制約と形式 quota が同時に効く並びで、3 投フルの枠が
    // 「同じカテゴリの 1 投調整」へ差し替えられていた（9 / 1）。
    // 171〜182 では 3 投フル候補 12 件がすべて HARD なので、
    // その枠が 1 問目へ来ると「1 問目は HARD にしない」と衝突する。
    const questions = generateQuestions({
      settings: settingsOf({
        mode: 'setup',
        questionCount: 10,
        setupRange: { min: 171, max: 182 },
        reviewWeakFirst: false,
      }),
      seed: 33,
    });

    expect(questions.filter((question) => question.format === 'setup-full')).toHaveLength(2);
    expect(questions.filter((question) => question.format === 'setup-adjustment')).toHaveLength(8);
    // 形式を保ったまま出題順の制約も満たす。
    expect(orderingProblemsOf(questions)).toEqual([]);
  });

  it('狭い出題範囲の seed 33 は同じ問題・同じ状況を近くで繰り返さない（独立監査 F-008 回帰）', () => {
    // 171〜182 では setup-bogey-avoid と setup-same-number-worse の 1 投調整が
    // それぞれ 1 件しかない。カテゴリ quota を満たすためにその 1 件を出し直し、
    // 1 問目と 5 問目が同じ問題（current=160）になっていた。
    // 1 投調整の候補は範囲全体で 120 件あるので、候補不足ではない。
    const questions = generateQuestions({
      settings: settingsOf({
        mode: 'setup',
        questionCount: 10,
        setupRange: { min: 171, max: 182 },
        reviewWeakFirst: false,
      }),
      seed: 33,
    });

    expect(questions).toHaveLength(10);
    expect(questions.filter((question) => question.format === 'setup-adjustment')).toHaveLength(8);
    expect(questions.filter((question) => question.format === 'setup-full')).toHaveLength(2);
    expect(duplicateWithin(questions, 5)).toBe(0);
    expect(sameContextWithin(questions, 3)).toBe(0);
    expect(orderingProblemsOf(questions)).toEqual([]);
    expect(questions.filter((question) => question.trivial).length).toBeLessThanOrEqual(2);
  });

  it.each([
    { label: '171〜182 / 10 問 / review off', min: 171, max: 182, questionCount: 10, reviewWeakFirst: false },
    { label: '171〜182 / 10 問 / review on', min: 171, max: 182, questionCount: 10, reviewWeakFirst: true },
    { label: '302〜309 / 10 問 / review off', min: 302, max: 309, questionCount: 10, reviewWeakFirst: false },
    { label: '302〜309 / 10 問 / review on', min: 302, max: 309, questionCount: 10, reviewWeakFirst: true },
  ])(
    '狭い出題範囲は 1,000 seeds すべてで形式・出題順・anti-repeat を同時に守る（$label）',
    ({ min, max, questionCount, reviewWeakFirst }) => {
      const violations: string[] = [];

      for (let seed = 0; seed < 1000; seed += 1) {
        const questions = generateQuestions({
          settings: settingsOf({
            mode: 'setup',
            questionCount,
            setupRange: { min, max },
            reviewWeakFirst,
          }),
          seed,
          reviewTargets: reviewWeakFirst ? [min] : undefined,
        });

        const full = questions.filter((question) => question.format === 'setup-full').length;
        const adjustment = questions.filter(
          (question) => question.format === 'setup-adjustment',
        ).length;
        const wantedFull = setupFullCount(questionCount);
        if (questions.length !== questionCount) {
          violations.push(`seed=${seed}: 出題数 ${questions.length}`);
        }
        if (full !== wantedFull || adjustment !== questionCount - wantedFull) {
          violations.push(`seed=${seed}: adjustment ${adjustment} / full ${full}`);
        }
        const ordering = orderingProblemsOf(questions);
        if (ordering.length > 0) violations.push(`seed=${seed}: ${ordering.join(',')}`);
        const prior5 = duplicateWithin(questions, 5);
        if (prior5 > 0) violations.push(`seed=${seed}: 直近 5 問の重複 ${prior5}`);
        const prior3 = sameContextWithin(questions, 3);
        if (prior3 > 0) violations.push(`seed=${seed}: 直近 3 問の同じ状況 ${prior3}`);
        const trivial = questions.filter((question) => question.trivial).length;
        if (trivial > (questionCount === 10 ? 2 : 6)) {
          violations.push(`seed=${seed}: trivial ${trivial}`);
        }
      }

      expect(violations.slice(0, 5)).toEqual([]);
    },
  );

  it.each([
    { label: '171〜182 / 30 問', min: 171, max: 182 },
    { label: '302〜309 / 30 問', min: 302, max: 309 },
  ])('狭い出題範囲の 30 問も anti-repeat を守る（$label）', ({ min, max }) => {
    const violations: string[] = [];

    for (let seed = 0; seed < 200; seed += 1) {
      const questions = generateQuestions({
        settings: settingsOf({
          mode: 'setup',
          questionCount: 30,
          setupRange: { min, max },
          reviewWeakFirst: false,
        }),
        seed,
      });
      if (questions.length !== 30) violations.push(`seed=${seed}: 出題数 ${questions.length}`);
      if (questions.filter((question) => question.format === 'setup-full').length !== 6) {
        violations.push(`seed=${seed}: full 枠が 6 でない`);
      }
      const prior5 = duplicateWithin(questions, 5);
      if (prior5 > 0) violations.push(`seed=${seed}: 直近 5 問の重複 ${prior5}`);
      const prior3 = sameContextWithin(questions, 3);
      if (prior3 > 0) violations.push(`seed=${seed}: 直近 3 問の同じ状況 ${prior3}`);
      const ordering = orderingProblemsOf(questions);
      if (ordering.length > 0) violations.push(`seed=${seed}: ${ordering.join(',')}`);
    }

    expect(violations.slice(0, 5)).toEqual([]);
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

  it('間違えた問題そのものを、同じカテゴリの別問題より先に出す', () => {
    // Codex レビュー指摘の回帰テスト。
    // 完全一致（problemKey）と、カテゴリ・タグだけ一致する候補を同じ bucket へ
    // 入れていたため、復習枠が「関連しているだけの問題」で埋まっていた。
    // CHECKOUT の slot は形式・カテゴリの制約を持たないので、
    // 互換な復習枠が必ず存在し、完全一致が毎回選ばれること自体を固定できる。
    const target = {
      kind: 'checkout' as const,
      problemKey: 'checkout|v2|left=122|darts=3',
      startRemaining: 122,
      primaryCategory: 'checkout-120-149' as const,
      learningTags: ['two-dart-checkout'],
      weight: 100,
    };
    for (const seed of [1, 2, 3, 7, 42]) {
      const questions = generateQuestions({
        settings: settingsOf({ mode: 'checkout', questionCount: 10, reviewWeakFirst: true }),
        seed,
        reviewTargets: [target],
      });
      // 同じカテゴリ・同じタグの「関連しているだけの問題」ではなく、その問題そのものが出る。
      expect(questions.some((q) => q.problemKey === target.problemKey)).toBe(true);
      // 復習枠でも同じ問題を連打しない。
      expect(duplicateWithin(questions, 5)).toBe(0);
    }
  });

  it('復習枠は SETUP の形式・カテゴリ quota を崩さない（F-002 回帰）', () => {
    // 独立監査 F-002 の回帰テスト。
    // 復習 ring を種別だけで絞っていたため、weak item が任意の slot を置き換え、
    // 8/2 の Hybrid と A〜I の quota が壊れていた（FULL 62/80・ADJ 45/80 で違反）。
    const setupTarget = (problemKey: string) => ({
      kind: 'setup' as const,
      problemKey,
      startRemaining: 302,
      primaryCategory: 'setup-302-309' as const,
      learningTags: ['bogey-avoidance', 'digits-0147'],
      weight: 100,
    });
    const FULL = 'setup|v2|full|start=302|darts=3';
    const ADJUST = 'setup|v2|adjust|start=302|ctx=T20,T20|current=182|darts=1';

    const cases: ReadonlyArray<{
      label: string;
      targets: ReadonlyArray<ReturnType<typeof setupTarget>>;
      keys: readonly string[];
    }> = [
      { label: 'full のみ', targets: [setupTarget(FULL)], keys: [FULL] },
      { label: 'adjustment のみ', targets: [setupTarget(ADJUST)], keys: [ADJUST] },
      { label: '複数 weak', targets: [setupTarget(FULL), setupTarget(ADJUST)], keys: [FULL, ADJUST] },
    ];

    for (const { label, targets, keys } of cases) {
      for (const count of [10, 30] as const) {
        const wantFull = count === 10 ? 2 : 6;
        let baseline = 0;
        let reviewed = 0;
        for (let seed = 1; seed <= 40; seed += 1) {
          const withReview = generateQuestionsWithReport({
            settings: settingsOf({ mode: 'setup', questionCount: count, reviewWeakFirst: true }),
            seed,
            reviewTargets: [...targets],
          });
          const without = generateQuestions({
            settings: settingsOf({ mode: 'setup', questionCount: count, reviewWeakFirst: false }),
            seed,
          });

          // 形式 quota（80 / 20）を維持する。
          expect(withReview.report.formatDistribution['setup-full'], `${label}/${count}/${seed}`).toBe(
            wantFull,
          );
          expect(withReview.report.formatDistribution['setup-adjustment']).toBe(count - wantFull);
          // カテゴリ quota を維持する。
          expect(countBy(withReview.questions.map((q) => q.primaryCategory))).toEqual(
            setupCategoryQuota(count),
          );
          // anti-repeat を壊さない。
          expect(duplicateWithin(withReview.questions, 5)).toBe(0);

          baseline += without.filter((q) => keys.includes(q.problemKey)).length;
          reviewed += withReview.questions.filter((q) => keys.includes(q.problemKey)).length;
        }
        // そのうえで苦手問題の露出は実際に増える。
        expect(reviewed, `${label}/${count} の露出`).toBeGreaterThan(baseline);
      }
    }
  });

  const F010_SEEDS = [619, 869, 1111, 1312, 1656, 1666, 1755, 1923, 2273, 2692, 2761, 2888];

  it.each(F010_SEEDS)(
    'MIXED 30 問 + 復習の seed %i は出題構成をすべて満たす（独立監査 F-010 回帰）',
    (seed) => {
      // 復習枠の難易度は「配られる候補」で決まるため、計画時点では予測でしかない。
      // 末尾 2 問の HARD をその予測に頼ると、予測が外れたときに最後の 1 問で
      // HARD を作り直すことになり、SETUP のカテゴリ quota が崩れていた。
      const { questions, report } = generateQuestionsWithReport({
        settings: settingsOf({ mode: 'mixed', questionCount: 30, reviewWeakFirst: true }),
        seed,
        reviewTargets: [122, 302],
      });

      expect(questions).toHaveLength(30);

      // 種別 quota と同一種別の連続。
      const kinds = countBy(questions.map((question) => question.kind));
      expect(kinds).toEqual({ checkout: 10, setup: 10, recovery: 10 });
      expect(maxRunOf(questions.map((question) => question.kind))).toBeLessThanOrEqual(2);

      // SETUP の形式とカテゴリ。
      const setup = questions.filter((question) => question.kind === 'setup');
      expect(setup.filter((question) => question.format === 'setup-full')).toHaveLength(
        setupFullCount(setup.length),
      );
      const categories = countBy(setup.map((question) => question.primaryCategory ?? '-'));
      for (const [category, wanted] of Object.entries(setupCategoryQuota(setup.length))) {
        expect(categories[category] ?? 0, `${category}`).toBe(wanted);
      }

      // 出題順と anti-repeat と上限。
      expect(orderingProblemsOf(questions)).toEqual([]);
      expect(duplicateWithin(questions, 5)).toBe(0);
      expect(sameContextWithin(questions, 3)).toBe(0);
      expect(report.trivialCount).toBeLessThanOrEqual(6);
      expect(report.directOneDartCount).toBeLessThanOrEqual(3);

      // 復習枠は使われている。
      expect(report.reviewPlaced).toBeGreaterThan(0);
    },
  );

  it('MIXED 30 問 + 復習は 60 seeds すべてで出題構成を守る（F-010 走査）', () => {
    const violations: string[] = [];

    // 10,000 seeds の走査は `npm run audit:training` 側（本仕様 51 節）。
    for (let seed = 0; seed < 60; seed += 1) {
      const { questions, report } = generateQuestionsWithReport({
        settings: settingsOf({ mode: 'mixed', questionCount: 30, reviewWeakFirst: true }),
        seed,
        reviewTargets: [122, 302],
      });

      if (questions.length !== 30) violations.push(`seed=${seed}: 出題数 ${questions.length}`);
      const kinds = countBy(questions.map((question) => question.kind));
      if (kinds.checkout !== 10 || kinds.setup !== 10 || kinds.recovery !== 10) {
        violations.push(`seed=${seed}: 種別 ${JSON.stringify(kinds)}`);
      }
      if (maxRunOf(questions.map((question) => question.kind)) > 2) {
        violations.push(`seed=${seed}: 同一種別が 3 連続`);
      }

      const setup = questions.filter((question) => question.kind === 'setup');
      if (setup.filter((question) => question.format === 'setup-full').length !== setupFullCount(setup.length)) {
        violations.push(`seed=${seed}: SETUP 形式 quota`);
      }
      const categories = countBy(setup.map((question) => question.primaryCategory ?? '-'));
      for (const [category, wanted] of Object.entries(setupCategoryQuota(setup.length))) {
        if ((categories[category] ?? 0) !== wanted) {
          violations.push(`seed=${seed}: ${category} 期待 ${wanted} / 実際 ${categories[category] ?? 0}`);
        }
      }

      const ordering = orderingProblemsOf(questions);
      if (ordering.length > 0) violations.push(`seed=${seed}: ${ordering.join(',')}`);
      const prior5 = duplicateWithin(questions, 5);
      if (prior5 > 0) violations.push(`seed=${seed}: 直近 5 問の重複 ${prior5}`);
      const prior3 = sameContextWithin(questions, 3);
      if (prior3 > 0) violations.push(`seed=${seed}: 直近 3 問の同じ状況 ${prior3}`);
      if (report.trivialCount > 6) violations.push(`seed=${seed}: trivial ${report.trivialCount}`);
      if (report.directOneDartCount > 3) violations.push(`seed=${seed}: 1 投上がり ${report.directOneDartCount}`);
      if (report.reviewPlaced === 0) violations.push(`seed=${seed}: 復習枠が 0`);
    }

    expect(violations.slice(0, 5)).toEqual([]);
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
  /** 実際に選ばれた question.difficulty で違反を数える（slot 計画ではなく結果を見る）。 */
  function orderingViolationsOf(questions: readonly TrainingQuestion[], count: number) {
    const d = questions.map((q) => q.difficulty);
    let hardRun = 0;
    let longestHardRun = 0;
    for (const item of d) {
      hardRun = item === 'hard' ? hardRun + 1 : 0;
      longestHardRun = Math.max(longestHardRun, hardRun);
    }
    return {
      longestHardRun,
      firstHard: d[0] === 'hard',
      noFinalHard: count >= 10 && d[d.length - 1] !== 'hard' && d[d.length - 2] !== 'hard',
    };
  }

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

  it.each([1, 703])(
    'MIXED seed %i は HARD 3 連続も、末尾 2 問の HARD 欠落も起こさない（F-001 回帰）',
    (seed) => {
      // 独立監査 F-001 の再現 seed。
      // 修正前: seed 1 は 5〜7 問目が HARD 3 連続、seed 703 は末尾 2 問が MEDIUM / MEDIUM。
      const questions = generateQuestions({
        settings: settingsOf({ mode: 'mixed', questionCount: 10, reviewWeakFirst: false }),
        seed,
      });
      const result = orderingViolationsOf(questions, 10);
      expect(result.longestHardRun).toBeLessThanOrEqual(2);
      expect(result.firstHard).toBe(false);
      expect(result.noFinalHard).toBe(false);
    },
  );

  it('HARD が 3 連続しない', () => {
    for (const mode of ['checkout', 'setup', 'recovery', 'mixed'] as const) {
      for (const seed of [1, 5, 9, 77, 2026]) {
        const questions = generateQuestions({
          settings: settingsOf({ mode, questionCount: 30, reviewWeakFirst: false }),
          seed,
        });
        expect(orderingViolationsOf(questions, 30).longestHardRun).toBeLessThanOrEqual(2);
      }
    }
  });

  it('全モードで出題順の制約が破れない（seed 走査）', () => {
    // 監査は MIXED 10 問 / 10,000 seeds で 41 件の HARD 3 連続と
    // 20 件の末尾 HARD 欠落を再現した。ここでは通常 suite を速く保つため
    // seed 数を抑え、10 万問規模の走査は npm run audit:training が担う。
    const violations: string[] = [];
    for (const mode of ['checkout', 'setup', 'recovery', 'mixed'] as const) {
      for (const count of [10, 30] as const) {
        for (let seed = 1; seed <= 150; seed += 1) {
          const questions = generateQuestions({
            settings: settingsOf({ mode, questionCount: count, reviewWeakFirst: false }),
            seed,
          });
          const result = orderingViolationsOf(questions, count);
          if (result.longestHardRun > 2) violations.push(`${mode}/${count}/${seed}: hard run`);
          if (result.firstHard) violations.push(`${mode}/${count}/${seed}: first hard`);
          if (result.noFinalHard) violations.push(`${mode}/${count}/${seed}: no final hard`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('復習を有効にしても出題順の制約が破れない', () => {
    const violations: string[] = [];
    for (let seed = 1; seed <= 100; seed += 1) {
      const questions = generateQuestions({
        settings: settingsOf({ mode: 'mixed', questionCount: 10, reviewWeakFirst: true }),
        seed,
        reviewTargets: [122, 302],
      });
      const result = orderingViolationsOf(questions, 10);
      if (result.longestHardRun > 2) violations.push(`${seed}: hard run`);
      if (result.firstHard) violations.push(`${seed}: first hard`);
      if (result.noFinalHard) violations.push(`${seed}: no final hard`);
    }
    expect(violations).toEqual([]);
  });

  it('trivial と 1 投上がりの上限を厳密に守る', () => {
    for (const mode of ['checkout', 'setup', 'recovery', 'mixed'] as const) {
      for (const [count, trivialCap, directCap] of [
        [10, 2, 1],
        [30, 6, 3],
      ] as const) {
        for (let seed = 1; seed <= 200; seed += 1) {
          const { report } = generateQuestionsWithReport({
            settings: settingsOf({ mode, questionCount: count, reviewWeakFirst: false }),
            seed,
          });
          expect(report.trivialCount, `${mode}/${count}/${seed}`).toBeLessThanOrEqual(trivialCap);
          expect(report.directOneDartCount).toBeLessThanOrEqual(directCap);
        }
      }
    }
  });

  it('MIXED 30 問 seed 3307 は trivial 上限 6 を超えない（独立監査 追加指摘の回帰）', () => {
    // 希望難易度が出題順の制約（1 問目 HARD 禁止 / HARD 3 連続禁止）で使えないとき、
    // すでに quota を使い切った EASY を選び直していたため trivial が 7 件になっていた。
    // EASY は RECOVERY と SETUP 基礎確認では定義上 trivial なので、上限を押し出す。
    const { questions, report } = generateQuestionsWithReport({
      settings: settingsOf({ mode: 'mixed', questionCount: 30, reviewWeakFirst: false }),
      seed: 3307,
    });
    expect(report.trivialCount).toBeLessThanOrEqual(6);
    expect(questions.filter((q) => q.trivial)).toHaveLength(report.trivialCount);
    // 上限を守るために他の quota を崩していないこと。
    expect(report.modeDistribution).toEqual({ checkout: 10, setup: 10, recovery: 10 });
    expect(
      countBy(questions.filter((q) => q.kind === 'setup').map((q) => q.primaryCategory)),
    ).toEqual(setupCategoryQuota(10));
    expect(report.formatDistribution['setup-full']).toBe(2);
    expect(report.formatDistribution['setup-adjustment']).toBe(8);
    expect(duplicateWithin(questions, 5)).toBe(0);
  });

  it('難易度 quota を、出題順の制約で希望が使えないときも超えない', () => {
    // trivial 上限の根本原因だった「quota を使い切った難易度の選び直し」を直接固定する。
    for (const mode of ['checkout', 'recovery'] as const) {
      for (const count of [10, 30] as const) {
        for (let seed = 1; seed <= 200; seed += 1) {
          const { report } = generateQuestionsWithReport({
            settings: settingsOf({ mode, questionCount: count, reviewWeakFirst: false }),
            seed,
          });
          expect(report.difficultyDistribution, `${mode}/${count}/${seed}`).toEqual(
            difficultyQuota(mode, count),
          );
        }
      }
    }
    // MIXED では種別ごとに難易度 quota を満たす。
    for (let seed = 1; seed <= 200; seed += 1) {
      const questions = generateQuestions({
        settings: settingsOf({ mode: 'mixed', questionCount: 30, reviewWeakFirst: false }),
        seed,
      });
      for (const mode of ['checkout', 'recovery'] as const) {
        const ofKind = questions.filter((q) => q.kind === mode);
        expect(countBy(ofKind.map((q) => q.difficulty)), `mixed/${mode}/${seed}`).toEqual(
          difficultyQuota(mode, ofKind.length),
        );
      }
    }
  });
});
