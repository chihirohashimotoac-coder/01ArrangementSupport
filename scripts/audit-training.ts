/**
 * TRAINING の大量品質監査。
 *
 * 通常の `npm run test` は高速な決定論的回帰に保ちたいので、
 * 10 万問規模の監査はこのスクリプトへ分離してある（本仕様 51 節）。
 * アプリの runtime bundle には含まれない（development / test tooling）。
 *
 *   npm run audit:training
 *   npm run audit:training -- --per-mode 30000   # 件数を減らして早く回す
 */
import { requireDart } from '../src/domain/dart';
import { isBogey, isCheckoutable, isLegalCheckoutRoute } from '../src/domain/checkoutRules';
import {
  DEFAULT_TRAINING_SETTINGS,
  type TrainingSettings,
} from '../src/engine/training/questions';
import {
  generateQuestions,
  generateQuestionsWithReport,
  modeQuota,
  setupCategoryQuota,
  setupFullCount,
} from '../src/engine/training/sampling';
import { gradeAnswer } from '../src/engine/training/grade';
import { recommendedAnswerOf } from '../src/engine/training/feedback';
import { contextKeyOf, type TrainingKind, type TrainingQuestion } from '../src/engine/training/model';

const PREMIUM_LEAVES = [160, 161, 164, 167, 170] as const;

interface Counter {
  [key: string]: number;
}

interface ModeAudit {
  mode: string;
  sessions: number;
  generated: number;
  unique: number;
  immediateIdentical: number;
  duplicateWithinPrior5: number;
  sameContextWithinPrior3: number;
  maxIdenticalRun: number;
  maxSameModeRun: number;
  difficulty: Counter;
  category: Counter;
  modeDistribution: Counter;
  format: Counter;
  invalidQuestions: number;
  graderMismatch: number;
  nan: number;
  undefinedState: number;
  relaxCount: number;
  quotaNormalizedCount: number;
  trivial: number;
  directOneDart: number;
  recoveryUnsolvable: number;
  setupAdjustment: number;
  setupFull: number;
  setupBogeyAvoidance: number;
  /** 出題順の制約（本仕様 28 節）の違反セッション数。 */
  hardTripleSessions: number;
  firstHardSessions: number;
  noFinalHardSessions: number;
  /** 出題構成の quota 違反セッション数。 */
  formatQuotaViolations: number;
  categoryQuotaViolations: number;
  trivialOverCapSessions: number;
  maxTrivialOverCap: number;
  directOverCapSessions: number;
  setupRecommendedLeave: Counter;
  /** 160 を推奨した問題の内訳（30% 超過時の原因分析に使う）。 */
  setupLeave160ByCategory: Counter;
  setupLeave160ByFormat: Counter;
}

function emptyAudit(mode: string): ModeAudit {
  return {
    mode,
    sessions: 0,
    generated: 0,
    unique: 0,
    immediateIdentical: 0,
    duplicateWithinPrior5: 0,
    sameContextWithinPrior3: 0,
    maxIdenticalRun: 0,
    maxSameModeRun: 0,
    difficulty: {},
    category: {},
    modeDistribution: {},
    format: {},
    invalidQuestions: 0,
    graderMismatch: 0,
    nan: 0,
    undefinedState: 0,
    relaxCount: 0,
    quotaNormalizedCount: 0,
    trivial: 0,
    directOneDart: 0,
    recoveryUnsolvable: 0,
    setupAdjustment: 0,
    setupFull: 0,
    setupBogeyAvoidance: 0,
    hardTripleSessions: 0,
    firstHardSessions: 0,
    noFinalHardSessions: 0,
    formatQuotaViolations: 0,
    categoryQuotaViolations: 0,
    trivialOverCapSessions: 0,
    maxTrivialOverCap: 0,
    directOverCapSessions: 0,
    setupRecommendedLeave: {},
    setupLeave160ByCategory: {},
    setupLeave160ByFormat: {},
  };
}

function bump(counter: Counter, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

/**
 * 1 問ごとの検証。
 *
 * grader は problemKey ごとに 1 度だけ通す。
 * 同じ問題を 10 万回採点しても新しい情報は出ないうえ、
 * ranking の再計算で監査が終わらなくなる。
 */
const verifiedProblems = new Map<string, { invalid: boolean; graderMismatch: boolean; unsolvable: boolean }>();

function verifyProblem(question: TrainingQuestion) {
  const cached = verifiedProblems.get(question.problemKey);
  if (cached) return cached;

  let invalid = false;
  let graderMismatch = false;
  let unsolvable = false;

  const contextTotal = question.contextualThrows.reduce(
    (sum, item) => sum + requireDart(item.actualDartId).score,
    0,
  );

  if (question.kind === 'setup' && question.format === 'setup-adjustment') {
    if (question.currentRemaining !== question.startRemaining - contextTotal) invalid = true;
    if (question.dartsAvailable !== 1) invalid = true;
  }
  if (question.kind === 'recovery') {
    const context = question.recovery;
    if (context === null || context.expectedRoute.length === 0) {
      unsolvable = true;
    } else {
      const expected = context.expectedRoute.map((id) => requireDart(id));
      const recalculated =
        context.visitStartRemaining - requireDart(context.actualDartId).score;
      if (
        question.currentRemaining !== recalculated ||
        question.dartsAvailable !== 2 ||
        !isLegalCheckoutRoute(question.currentRemaining, expected, question.dartsAvailable)
      ) {
        unsolvable = true;
      }
    }
  }
  if (question.kind !== 'setup' && !isCheckoutable(question.currentRemaining, question.dartsAvailable)) {
    unsolvable = true;
  }

  // 推奨解答が grader に受理されるか。
  const recommended = recommendedAnswerOf(question);
  if (recommended.length === 0) {
    graderMismatch = true;
  } else {
    const graded = gradeAnswer(question, recommended);
    if (!graded.ruleValid || !graded.learningCorrect) graderMismatch = true;
    if (question.kind === 'setup') {
      const leave = question.currentRemaining - recommended.reduce((s, d) => s + d.score, 0);
      if (!isCheckoutable(leave, 3) || isBogey(leave)) graderMismatch = true;
    }
  }

  const value = { invalid, graderMismatch, unsolvable };
  verifiedProblems.set(question.problemKey, value);
  return value;
}

/** trivial の上限（本仕様 47 節）。 */
function trivialCapOf(count: number): number {
  if (count === 10) return 2;
  if (count === 30) return 6;
  return Math.max(1, Math.round(count * 0.2));
}

function directCapOf(count: number): number {
  if (count === 10) return 1;
  if (count === 30) return 3;
  return Math.max(1, Math.round(count * 0.1));
}

/**
 * 出題順の制約を、slot 計画ではなく **実際に選ばれた question.difficulty** で数える。
 * quota の緩和が入っても結果として守られていることを確認するため。
 */
function orderingViolationsOf(
  questions: readonly TrainingQuestion[],
): { hardTriple: boolean; firstHard: boolean; noFinalHard: boolean } {
  const difficulties = questions.map((question) => question.difficulty);
  const count = difficulties.length;
  let run = 0;
  let longest = 0;
  for (const difficulty of difficulties) {
    run = difficulty === 'hard' ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const endpointsApply = count >= 10;
  return {
    hardTriple: longest > 2,
    firstHard: endpointsApply && difficulties[0] === 'hard',
    noFinalHard:
      endpointsApply &&
      difficulties[count - 1] !== 'hard' &&
      difficulties[count - 2] !== 'hard',
  };
}

/** SETUP の形式・カテゴリ quota を、そのセッションが満たしているか。 */
function setupQuotaViolationsOf(
  questions: readonly TrainingQuestion[],
): { format: boolean; category: boolean } {
  const setup = questions.filter((question) => question.kind === 'setup');
  if (setup.length === 0) return { format: false, category: false };

  const full = setup.filter((question) => question.format === 'setup-full').length;
  const wantedFull = setupFullCount(setup.length);
  const quota = setupCategoryQuota(setup.length);
  const counts: Counter = {};
  for (const question of setup) bump(counts, question.primaryCategory);

  return {
    format: full !== wantedFull,
    category: Object.entries(quota).some(([key, value]) => (counts[key] ?? 0) !== value),
  };
}

function auditSession(audit: ModeAudit, questions: readonly TrainingQuestion[]): void {
  audit.sessions += 1;
  audit.generated += questions.length;

  const ordering = orderingViolationsOf(questions);
  if (ordering.hardTriple) audit.hardTripleSessions += 1;
  if (ordering.firstHard) audit.firstHardSessions += 1;
  if (ordering.noFinalHard) audit.noFinalHardSessions += 1;

  const quota = setupQuotaViolationsOf(questions);
  if (quota.format) audit.formatQuotaViolations += 1;
  if (quota.category) audit.categoryQuotaViolations += 1;

  const trivialOver =
    questions.filter((question) => question.trivial).length - trivialCapOf(questions.length);
  if (trivialOver > 0) {
    audit.trivialOverCapSessions += 1;
    audit.maxTrivialOverCap = Math.max(audit.maxTrivialOverCap, trivialOver);
  }
  // 1 投上がりの上限は CHECKOUT の規定（本仕様 47 節）。
  // RECOVERY の「1 本で上がれる」は EASY 難易度 quota そのものなので数えない。
  if (
    questions.filter(
      (question) =>
        question.kind === 'checkout' && question.learningTags.includes('direct-finish'),
    ).length > directCapOf(questions.length)
  ) {
    audit.directOverCapSessions += 1;
  }

  let identicalRun = 0;
  let modeRun = 0;
  let previousKey: string | null = null;
  let previousMode: string | null = null;
  const keys: string[] = [];
  const contexts: string[] = [];

  for (const question of questions) {
    if (
      !Number.isFinite(question.currentRemaining) ||
      !Number.isFinite(question.startRemaining) ||
      !Number.isFinite(question.dartsAvailable)
    ) {
      audit.nan += 1;
    }
    if (
      question.problemKey === undefined ||
      question.primaryCategory === undefined ||
      question.difficulty === undefined ||
      question.expectedAnswer === undefined
    ) {
      audit.undefinedState += 1;
    }

    bump(audit.difficulty, question.difficulty);
    bump(audit.category, question.primaryCategory);
    bump(audit.modeDistribution, question.kind);
    bump(audit.format, question.format);
    if (question.trivial) audit.trivial += 1;
    if (question.learningTags.includes('direct-finish')) audit.directOneDart += 1;

    if (question.kind === 'setup') {
      if (question.format === 'setup-adjustment') audit.setupAdjustment += 1;
      else audit.setupFull += 1;
      if (question.learningTags.includes('bogey-avoidance')) audit.setupBogeyAvoidance += 1;
      const leave =
        question.currentRemaining -
        question.expectedAnswer.reduce((sum, id) => sum + requireDart(id).score, 0);
      bump(
        audit.setupRecommendedLeave,
        (PREMIUM_LEAVES as readonly number[]).includes(leave) ? String(leave) : 'other',
      );
      if (leave === 160) {
        bump(audit.setupLeave160ByCategory, question.primaryCategory);
        bump(audit.setupLeave160ByFormat, question.format);
      }
    }

    const verified = verifyProblem(question);
    if (verified.invalid) audit.invalidQuestions += 1;
    if (verified.graderMismatch) audit.graderMismatch += 1;
    if (verified.unsolvable && question.kind === 'recovery') audit.recoveryUnsolvable += 1;

    identicalRun = question.problemKey === previousKey ? identicalRun + 1 : 1;
    audit.maxIdenticalRun = Math.max(audit.maxIdenticalRun, identicalRun);
    if (question.problemKey === previousKey) audit.immediateIdentical += 1;
    previousKey = question.problemKey;

    modeRun = question.kind === previousMode ? modeRun + 1 : 1;
    audit.maxSameModeRun = Math.max(audit.maxSameModeRun, modeRun);
    previousMode = question.kind;

    if (keys.slice(-5).includes(question.problemKey)) audit.duplicateWithinPrior5 += 1;
    keys.push(question.problemKey);

    const contextKey = contextKeyOf(question);
    if (contexts.slice(-3).includes(contextKey)) audit.sameContextWithinPrior3 += 1;
    contexts.push(contextKey);
  }

  audit.unique = Math.max(audit.unique, new Set(keys).size);
}

function runMode(
  mode: TrainingKind | 'mixed',
  perMode: number,
  sessionSize: number,
  reviewTargets?: readonly number[],
): ModeAudit {
  const audit = emptyAudit(reviewTargets ? `${mode}+review` : mode);
  const settings: TrainingSettings = {
    ...DEFAULT_TRAINING_SETTINGS,
    mode,
    questionCount: sessionSize,
    reviewWeakFirst: reviewTargets !== undefined,
  };

  const sessions = Math.ceil(perMode / sessionSize);
  for (let seed = 1; seed <= sessions; seed += 1) {
    const { questions, report } = generateQuestionsWithReport({ settings, seed, reviewTargets });
    audit.relaxCount += report.relaxCount;
    audit.quotaNormalizedCount += report.quotaNormalizedCount;
    auditSession(audit, questions);
  }
  return audit;
}

/**
 * 出題順の制約を、10 問セッションで広く走査する。
 *
 * 独立監査は MIXED 10 問 / 10,000 seeds で HARD 3 連続 41 件・
 * 末尾 HARD 欠落 20 件を再現した。通常の session size（30 問）だけでは
 * 10 問固有の端点ルールを十分に踏まない。
 */
function auditOrderingSweep(seeds: number): {
  checked: number;
  hardTriple: number;
  firstHard: number;
  noFinalHard: number;
  examples: string[];
} {
  const result = { checked: 0, hardTriple: 0, firstHard: 0, noFinalHard: 0, examples: [] as string[] };
  for (const mode of ['checkout', 'setup', 'recovery', 'mixed'] as const) {
    for (let seed = 1; seed <= seeds; seed += 1) {
      const questions = generateQuestions({
        settings: {
          ...DEFAULT_TRAINING_SETTINGS,
          mode,
          questionCount: 10,
          reviewWeakFirst: false,
        },
        seed,
      });
      result.checked += 1;
      const ordering = orderingViolationsOf(questions);
      if (ordering.hardTriple) result.hardTriple += 1;
      if (ordering.firstHard) result.firstHard += 1;
      if (ordering.noFinalHard) result.noFinalHard += 1;
      if (
        (ordering.hardTriple || ordering.firstHard || ordering.noFinalHard) &&
        result.examples.length < 5
      ) {
        result.examples.push(`${mode}/seed=${seed}: ${questions.map((q) => q.difficulty[0]).join('')}`);
      }
    }
  }
  return result;
}

/**
 * 復習を有効にしたときの出題構成と、苦手問題の露出。
 *
 * 独立監査 F-002 は、復習枠が形式・カテゴリを無視して slot を置き換え、
 * SETUP の 80/20 と A〜I の quota を壊すことを示した。
 */
function auditReviewComposition(seeds: number): {
  cases: Array<{
    label: string;
    formatViolations: number;
    categoryViolations: number;
    baseline: number;
    reviewed: number;
    antiRepeatViolations: number;
  }>;
} {
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

  const specs = [
    { label: 'SETUP 10 / full weak', mode: 'setup' as const, count: 10, targets: [setupTarget(FULL)], keys: [FULL] },
    { label: 'SETUP 10 / adjust weak', mode: 'setup' as const, count: 10, targets: [setupTarget(ADJUST)], keys: [ADJUST] },
    { label: 'SETUP 30 / 複数 weak', mode: 'setup' as const, count: 30, targets: [setupTarget(FULL), setupTarget(ADJUST)], keys: [FULL, ADJUST] },
    { label: 'CHECKOUT 10 / legacy 122', mode: 'checkout' as const, count: 10, targets: [122], keys: ['checkout|v2|left=122|darts=3'] },
  ];

  const cases = specs.map((spec) => {
    let formatViolations = 0;
    let categoryViolations = 0;
    let baseline = 0;
    let reviewed = 0;
    let antiRepeatViolations = 0;

    for (let seed = 1; seed <= seeds; seed += 1) {
      const withReview = generateQuestions({
        settings: { ...DEFAULT_TRAINING_SETTINGS, mode: spec.mode, questionCount: spec.count, reviewWeakFirst: true },
        seed,
        reviewTargets: spec.targets,
      });
      const without = generateQuestions({
        settings: { ...DEFAULT_TRAINING_SETTINGS, mode: spec.mode, questionCount: spec.count, reviewWeakFirst: false },
        seed,
      });

      const quota = setupQuotaViolationsOf(withReview);
      if (quota.format) formatViolations += 1;
      if (quota.category) categoryViolations += 1;

      const keys: string[] = [];
      for (const question of withReview) {
        if (keys.slice(-5).includes(question.problemKey)) antiRepeatViolations += 1;
        keys.push(question.problemKey);
      }

      baseline += without.filter((question) => spec.keys.includes(question.problemKey)).length;
      reviewed += withReview.filter((question) => spec.keys.includes(question.problemKey)).length;
    }

    return { label: spec.label, formatViolations, categoryViolations, baseline, reviewed, antiRepeatViolations };
  });

  return { cases };
}

/**
 * 狭い出題範囲の SETUP スイープ（独立監査 F-006）。
 *
 * 171〜182 は 3 投フル候補 12 件がすべて同じカテゴリ・すべて HARD なので、
 * 「1 問目は HARD にしない」と 80/20 の形式 quota が正面から衝突する。
 * 候補不足ではないので、どちらも満たせなければ実装側の不具合として扱う。
 */
function auditNarrowRangeSweep(seeds: number): {
  cases: Array<{
    label: string;
    checked: number;
    generated: number;
    expectedGenerated: number;
    formatViolations: number;
    orderingViolations: number;
    prior5Sessions: number;
    prior5Events: number;
    prior3Sessions: number;
    prior3Events: number;
    immediateSessions: number;
    trivialOverCap: number;
    nonDeterministic: number;
    examples: string[];
  }>;
} {
  const ranges = [
    { label: 'SETUP 171-182', min: 171, max: 182 },
    { label: 'SETUP 302-309', min: 302, max: 309 },
  ];

  const cases = ranges.flatMap((range) =>
    [10, 30].flatMap((count) =>
      [false, true].map((reviewWeakFirst) => {
        const label = `${range.label} / ${count} 問 / review ${reviewWeakFirst ? 'on' : 'off'}`;
        const sessions = count === 30 ? Math.max(100, Math.round(seeds / 5)) : seeds;
        const settings: TrainingSettings = {
          ...DEFAULT_TRAINING_SETTINGS,
          mode: 'setup',
          questionCount: count,
          setupRange: { min: range.min, max: range.max },
          reviewWeakFirst,
        };
        const reviewTargets = reviewWeakFirst ? [range.min] : undefined;

        const result = {
          label,
          checked: sessions,
          generated: 0,
          expectedGenerated: sessions * count,
          formatViolations: 0,
          orderingViolations: 0,
          prior5Sessions: 0,
          prior5Events: 0,
          prior3Sessions: 0,
          prior3Events: 0,
          immediateSessions: 0,
          trivialOverCap: 0,
          nonDeterministic: 0,
          examples: [] as string[],
        };

        for (let seed = 0; seed < sessions; seed += 1) {
          const questions = generateQuestions({ settings, seed, reviewTargets });
          result.generated += questions.length;

          const full = questions.filter((question) => question.format === 'setup-full').length;
          const wantedFull = setupFullCount(questions.length);
          if (full !== wantedFull) {
            result.formatViolations += 1;
            if (result.examples.length < 5) {
              result.examples.push(`seed=${seed}: full ${full} / 期待 ${wantedFull}`);
            }
          }

          const ordering = orderingViolationsOf(questions);
          if (ordering.hardTriple || ordering.firstHard || ordering.noFinalHard) {
            result.orderingViolations += 1;
            if (result.examples.length < 5) {
              result.examples.push(`seed=${seed}: ${questions.map((q) => q.difficulty[0]).join('')}`);
            }
          }

          // 直近履歴。session 単位（1 件でも起きたか）と event 単位（何問で起きたか）の両方。
          let prior5 = 0;
          let prior3 = 0;
          let immediate = 0;
          questions.forEach((question, index) => {
            for (let back = 1; back <= 5 && index - back >= 0; back += 1) {
              if (questions[index - back].problemKey === question.problemKey) {
                prior5 += 1;
                break;
              }
            }
            for (let back = 1; back <= 3 && index - back >= 0; back += 1) {
              if (contextKeyOf(questions[index - back]) === contextKeyOf(question)) {
                prior3 += 1;
                break;
              }
            }
            if (index > 0 && questions[index - 1].problemKey === question.problemKey) immediate += 1;
          });
          if (prior5 > 0) {
            result.prior5Sessions += 1;
            if (result.examples.length < 5) {
              result.examples.push(`seed=${seed}: 直近 5 問の重複 ${prior5} 問`);
            }
          }
          if (prior3 > 0) {
            result.prior3Sessions += 1;
            if (result.examples.length < 5) {
              result.examples.push(`seed=${seed}: 直近 3 問の同じ状況 ${prior3} 問`);
            }
          }
          if (immediate > 0) result.immediateSessions += 1;
          result.prior5Events += prior5;
          result.prior3Events += prior3;

          if (questions.filter((question) => question.trivial).length > trivialCapOf(count)) {
            result.trivialOverCap += 1;
          }

          // 決定論であること（同じ seed から同じ並び）。
          if (seed % 100 === 0) {
            const again = generateQuestions({ settings, seed, reviewTargets });
            const same =
              again.length === questions.length &&
              again.every((question, index) => question.problemKey === questions[index].problemKey);
            if (!same) result.nonDeterministic += 1;
          }
        }

        return result;
      }),
    ),
  );

  return { cases };
}

/**
 * MIXED 30 問 + 復習の専用スイープ（独立監査 F-010）。
 *
 * 200 seeds の復習監査では、発生率 0.4% の構成崩れを安定して検出できなかった。
 * 復習枠の難易度は「配られる候補」で決まるため計画時点では予測でしかなく、
 * 予測が外れると末尾 2 問の HARD を作り直すことになり、
 * SETUP のカテゴリ quota が崩れる。専用に大量走査して厳密に assert する。
 */
function auditMixedReviewSweep(seeds: number): {
  checked: number;
  generated: number;
  expectedGenerated: number;
  categorySessions: number;
  categoryEvents: number;
  formatViolations: number;
  orderingViolations: number;
  modeQuotaViolations: number;
  sameKindRunViolations: number;
  prior5Sessions: number;
  prior5Events: number;
  prior3Sessions: number;
  prior3Events: number;
  immediateSessions: number;
  trivialOverCap: number;
  directOverCap: number;
  reviewPlaced: number;
  reviewZeroSessions: number;
  baselineExposure: number;
  reviewExposure: number;
  nonDeterministic: number;
  examples: string[];
} {
  const count = 30;
  const settings: TrainingSettings = {
    ...DEFAULT_TRAINING_SETTINGS,
    mode: 'mixed',
    questionCount: count,
    reviewWeakFirst: true,
  };
  const withoutReview: TrainingSettings = { ...settings, reviewWeakFirst: false };
  const reviewTargets = [122, 302];
  const reviewKeys = [
    'checkout|v2|left=122|darts=3',
    'setup|v2|full|start=302|darts=3',
    'setup|v2|adjust|start=302|ctx=T20,T20|current=182|darts=1',
  ];

  const result = {
    checked: seeds,
    generated: 0,
    expectedGenerated: seeds * count,
    categorySessions: 0,
    categoryEvents: 0,
    formatViolations: 0,
    orderingViolations: 0,
    modeQuotaViolations: 0,
    sameKindRunViolations: 0,
    prior5Sessions: 0,
    prior5Events: 0,
    prior3Sessions: 0,
    prior3Events: 0,
    immediateSessions: 0,
    trivialOverCap: 0,
    directOverCap: 0,
    reviewPlaced: 0,
    reviewZeroSessions: 0,
    baselineExposure: 0,
    reviewExposure: 0,
    nonDeterministic: 0,
    examples: [] as string[],
  };

  const quota = setupCategoryQuota(10);
  const kindQuota = modeQuota(count);

  for (let seed = 0; seed < seeds; seed += 1) {
    const { questions, report } = generateQuestionsWithReport({ settings, seed, reviewTargets });
    result.generated += questions.length;

    const kindCounts: Counter = {};
    for (const question of questions) bump(kindCounts, question.kind);
    if (Object.entries(kindQuota).some(([kind, wanted]) => (kindCounts[kind] ?? 0) !== wanted)) {
      result.modeQuotaViolations += 1;
    }
    let run = 0;
    let longestKindRun = 0;
    let previousKind = '';
    for (const question of questions) {
      run = question.kind === previousKind ? run + 1 : 1;
      previousKind = question.kind;
      longestKindRun = Math.max(longestKindRun, run);
    }
    if (longestKindRun > 2) result.sameKindRunViolations += 1;

    const setup = questions.filter((question) => question.kind === 'setup');
    if (setup.length > 0) {
      if (setup.filter((question) => question.format === 'setup-full').length !== setupFullCount(setup.length)) {
        result.formatViolations += 1;
      }
      const categoryCounts: Counter = {};
      for (const question of setup) bump(categoryCounts, question.primaryCategory);
      const events = Object.entries(quota).reduce(
        (sum, [category, wanted]) => sum + Math.abs((categoryCounts[category] ?? 0) - wanted),
        0,
      );
      if (events > 0) {
        result.categorySessions += 1;
        result.categoryEvents += events;
        if (result.examples.length < 5) {
          const diff = Object.entries(quota)
            .filter(([category, wanted]) => (categoryCounts[category] ?? 0) !== wanted)
            .map(([category, wanted]) => `${category} 期待${wanted}/実際${categoryCounts[category] ?? 0}`);
          result.examples.push(`seed=${seed}: ${diff.join(',')}`);
        }
      }
    }

    const ordering = orderingViolationsOf(questions);
    if (ordering.hardTriple || ordering.firstHard || ordering.noFinalHard) {
      result.orderingViolations += 1;
      if (result.examples.length < 5) {
        result.examples.push(`seed=${seed}: ${questions.map((q) => q.difficulty[0]).join('')}`);
      }
    }

    let prior5 = 0;
    let prior3 = 0;
    let immediate = 0;
    questions.forEach((question, index) => {
      for (let back = 1; back <= 5 && index - back >= 0; back += 1) {
        if (questions[index - back].problemKey === question.problemKey) {
          prior5 += 1;
          break;
        }
      }
      for (let back = 1; back <= 3 && index - back >= 0; back += 1) {
        if (contextKeyOf(questions[index - back]) === contextKeyOf(question)) {
          prior3 += 1;
          break;
        }
      }
      if (index > 0 && questions[index - 1].problemKey === question.problemKey) immediate += 1;
    });
    if (prior5 > 0) result.prior5Sessions += 1;
    if (prior3 > 0) result.prior3Sessions += 1;
    if (immediate > 0) result.immediateSessions += 1;
    result.prior5Events += prior5;
    result.prior3Events += prior3;

    if (questions.filter((question) => question.trivial).length > trivialCapOf(count)) {
      result.trivialOverCap += 1;
    }
    const direct = questions.filter(
      (question) => question.kind === 'checkout' && question.learningTags.includes('direct-finish'),
    ).length;
    if (direct > directCapOf(count)) result.directOverCap += 1;

    result.reviewPlaced += report.reviewPlaced;
    if (report.reviewPlaced === 0) result.reviewZeroSessions += 1;
    result.reviewExposure += questions.filter((question) => reviewKeys.includes(question.problemKey)).length;

    // 決定論であることと、復習なしとの露出差は抜き取りで確認する。
    if (seed % 50 === 0) {
      const again = generateQuestions({ settings, seed, reviewTargets });
      const same =
        again.length === questions.length &&
        again.every((question, index) => question.problemKey === questions[index].problemKey);
      if (!same) result.nonDeterministic += 1;
      const baseline = generateQuestions({ settings: withoutReview, seed });
      result.baselineExposure += baseline.filter((question) => reviewKeys.includes(question.problemKey)).length;
    }
  }

  return result;
}

function ratio(counter: Counter, key: string, total: number): number {
  return total === 0 ? 0 : (counter[key] ?? 0) / total;
}

function main(): void {
  const args = process.argv.slice(2);
  const perModeIndex = args.indexOf('--per-mode');
  const perMode = perModeIndex >= 0 ? Number(args[perModeIndex + 1]) : 100_000;
  const sessionSize = 30;

  const started = Date.now();
  const audits: ModeAudit[] = [
    runMode('checkout', perMode, sessionSize),
    runMode('setup', perMode, sessionSize),
    runMode('recovery', perMode, sessionSize),
    runMode('mixed', perMode, sessionSize),
    // 復習対象が 1 件しかない状況でも同じ問題を連打しないこと（本仕様 53 節）。
    runMode('checkout', Math.min(perMode, 10_000), 10, [122]),
  ];

  const failures: string[] = [];
  const warnings: string[] = [];

  for (const audit of audits) {
    console.log(`\n=== ${audit.mode} ===`);
    console.log(`Sessions                        : ${audit.sessions}`);
    console.log(`Generated                       : ${audit.generated}`);
    console.log(`Unique problems (max / session) : ${audit.unique}`);
    console.log(`Distinct problems verified      : ${verifiedProblems.size}`);
    console.log(`Immediate identical problem     : ${audit.immediateIdentical}`);
    console.log(`Duplicate within prior 5        : ${audit.duplicateWithinPrior5}`);
    console.log(`Same context within prior 3     : ${audit.sameContextWithinPrior3}`);
    console.log(`Max identical run               : ${audit.maxIdenticalRun}`);
    console.log(`Max same-mode run               : ${audit.maxSameModeRun}`);
    console.log(`Difficulty distribution         : ${JSON.stringify(audit.difficulty)}`);
    console.log(`Mode distribution               : ${JSON.stringify(audit.modeDistribution)}`);
    console.log(`Format distribution             : ${JSON.stringify(audit.format)}`);
    console.log(`Category distribution           : ${JSON.stringify(audit.category)}`);
    console.log(`HARD 3 連続セッション            : ${audit.hardTripleSessions}`);
    console.log(`1 問目が HARD のセッション        : ${audit.firstHardSessions}`);
    console.log(`末尾 2 問に HARD 無しセッション    : ${audit.noFinalHardSessions}`);
    console.log(`SETUP 形式 quota 違反            : ${audit.formatQuotaViolations}`);
    console.log(`SETUP カテゴリ quota 違反         : ${audit.categoryQuotaViolations}`);
    console.log(
      `trivial 上限超過セッション         : ${audit.trivialOverCapSessions}` +
        ` (最大 +${audit.maxTrivialOverCap} 問, ${((audit.trivialOverCapSessions / Math.max(audit.sessions, 1)) * 100).toFixed(3)}%)`,
    );
    console.log(`1 投上がり上限超過セッション        : ${audit.directOverCapSessions}`);
    console.log(`Invalid questions               : ${audit.invalidQuestions}`);
    console.log(`Grader mismatch                 : ${audit.graderMismatch}`);
    console.log(`NaN                             : ${audit.nan}`);
    console.log(`Undefined                       : ${audit.undefinedState}`);
    console.log(`Constraint relax count          : ${audit.relaxCount}`);
    console.log(`Quota normalized count          : ${audit.quotaNormalizedCount}`);
    console.log(
      `Trivial rate                    : ${((audit.trivial / audit.generated) * 100).toFixed(2)}%`,
    );
    console.log(`CHECKOUT direct 1-dart          : ${audit.directOneDart}`);

    if (audit.setupAdjustment + audit.setupFull > 0) {
      const setupTotal = audit.setupAdjustment + audit.setupFull;
      console.log(
        `SETUP adjustment / full         : ${audit.setupAdjustment} / ${audit.setupFull} (${(
          (audit.setupAdjustment / setupTotal) *
          100
        ).toFixed(1)}% / ${((audit.setupFull / setupTotal) * 100).toFixed(1)}%)`,
      );
      console.log(`SETUP bogey avoidance questions : ${audit.setupBogeyAvoidance}`);
      console.log(
        `SETUP recommended leave         : ${JSON.stringify(audit.setupRecommendedLeave)}`,
      );
      const share160 = ratio(audit.setupRecommendedLeave, '160', setupTotal);
      console.log(`SETUP recommended leave = 160   : ${(share160 * 100).toFixed(2)}%`);
      if (share160 > 0.3) {
        console.log(
          `  160 内訳 (category)           : ${JSON.stringify(audit.setupLeave160ByCategory)}`,
        );
        console.log(
          `  160 内訳 (format)             : ${JSON.stringify(audit.setupLeave160ByFormat)}`,
        );
        warnings.push(
          `${audit.mode}: 推奨 leave が 160 の割合 ${(share160 * 100).toFixed(2)}% > 30%。` +
            'カテゴリ配分と候補 pool を確認すること（hard failure ではない）。',
        );
      }
    }

    if (audit.mode.startsWith('recovery')) {
      console.log(`RECOVERY unsolvable             : ${audit.recoveryUnsolvable}`);
    }

    // --- 統計的な合格条件（本仕様 53 節） ---------------------------------
    if (audit.immediateIdentical !== 0) failures.push(`${audit.mode}: immediate identical !== 0`);
    if (audit.duplicateWithinPrior5 !== 0) {
      failures.push(`${audit.mode}: duplicate within prior 5 !== 0`);
    }
    if (audit.maxIdenticalRun > 1) failures.push(`${audit.mode}: max identical run > 1`);
    if (audit.nan !== 0) failures.push(`${audit.mode}: NaN !== 0`);
    if (audit.undefinedState !== 0) failures.push(`${audit.mode}: undefined !== 0`);
    if (audit.invalidQuestions !== 0) failures.push(`${audit.mode}: invalid questions !== 0`);
    if (audit.graderMismatch !== 0) failures.push(`${audit.mode}: grader mismatch !== 0`);
    if (audit.recoveryUnsolvable !== 0) failures.push(`${audit.mode}: RECOVERY unsolvable !== 0`);
    if (audit.mode === 'mixed' && audit.maxSameModeRun > 2) {
      failures.push(`${audit.mode}: max same-mode run > 2`);
    }
    // 出題順の制約（本仕様 28 節 / 独立監査 F-001）。
    if (audit.hardTripleSessions !== 0) {
      failures.push(`${audit.mode}: HARD 3 連続 = ${audit.hardTripleSessions}`);
    }
    if (audit.firstHardSessions !== 0) {
      failures.push(`${audit.mode}: 1 問目が HARD = ${audit.firstHardSessions}`);
    }
    if (audit.noFinalHardSessions !== 0) {
      failures.push(`${audit.mode}: 末尾 2 問に HARD 無し = ${audit.noFinalHardSessions}`);
    }
    // 出題構成の quota（本仕様 5・20 節 / 独立監査 F-002）。
    if (audit.formatQuotaViolations !== 0) {
      failures.push(`${audit.mode}: SETUP 形式 quota 違反 = ${audit.formatQuotaViolations}`);
    }
    if (audit.categoryQuotaViolations !== 0) {
      failures.push(`${audit.mode}: SETUP カテゴリ quota 違反 = ${audit.categoryQuotaViolations}`);
    }
    // trivial 上限（本仕様 47 節）は厳密に守る。1 件でも超過すれば失敗。
    if (audit.trivialOverCapSessions !== 0) {
      failures.push(
        `${audit.mode}: trivial 上限超過 = ${audit.trivialOverCapSessions} セッション` +
          ` (最大 +${audit.maxTrivialOverCap} 問)`,
      );
    }
    if (audit.directOverCapSessions !== 0) {
      failures.push(`${audit.mode}: 1 投上がり上限超過 = ${audit.directOverCapSessions}`);
    }
  }

  // --- 10 問セッションの出題順スイープ（本仕様 28 節 / 独立監査 F-001） --------
  const orderingSeeds = Math.max(500, Math.min(10_000, Math.round(perMode / 10)));
  const ordering = auditOrderingSweep(orderingSeeds);
  console.log(`\n=== 出題順スイープ（10 問 × ${orderingSeeds} seeds × 4 モード） ===`);
  console.log(`Sessions checked                : ${ordering.checked}`);
  console.log(`HARD 3 連続                      : ${ordering.hardTriple}`);
  console.log(`1 問目が HARD                    : ${ordering.firstHard}`);
  console.log(`末尾 2 問に HARD 無し             : ${ordering.noFinalHard}`);
  if (ordering.examples.length > 0) {
    console.log(`違反例                          : ${ordering.examples.join(' | ')}`);
  }
  if (ordering.hardTriple !== 0) failures.push(`ordering sweep: HARD 3 連続 = ${ordering.hardTriple}`);
  if (ordering.firstHard !== 0) failures.push(`ordering sweep: 1 問目が HARD = ${ordering.firstHard}`);
  if (ordering.noFinalHard !== 0) {
    failures.push(`ordering sweep: 末尾 2 問に HARD 無し = ${ordering.noFinalHard}`);
  }

  // --- 狭い出題範囲のスイープ（独立監査 F-006 / F-008） ----------------------
  const narrowSeeds = Math.max(1_000, Math.min(10_000, Math.round(perMode / 10)));
  const narrow = auditNarrowRangeSweep(narrowSeeds);
  console.log(`\n=== 狭い出題範囲スイープ（最大 ${narrowSeeds} seeds） ===`);
  for (const item of narrow.cases) {
    console.log(
      `${item.label.padEnd(38)}: ${String(item.checked).padStart(5)} セッション / ` +
        `出題 ${item.generated}（期待 ${item.expectedGenerated}） / ` +
        `形式 ${item.formatViolations} / 出題順 ${item.orderingViolations} / ` +
        `直近5 ${item.prior5Sessions}セッション ${item.prior5Events}問 / ` +
        `直近3 ${item.prior3Sessions}セッション ${item.prior3Events}問 / ` +
        `直前と同じ ${item.immediateSessions} / trivial超過 ${item.trivialOverCap}`,
    );
    if (item.examples.length > 0) {
      console.log(`  違反例                              : ${item.examples.join(' | ')}`);
    }
    if (item.generated !== item.expectedGenerated) {
      failures.push(
        `narrow(${item.label}): 出題数が足りない (${item.generated} / ${item.expectedGenerated})`,
      );
    }
    if (item.formatViolations !== 0) {
      failures.push(`narrow(${item.label}): SETUP 形式 quota 違反 = ${item.formatViolations}`);
    }
    if (item.orderingViolations !== 0) {
      failures.push(`narrow(${item.label}): 出題順違反 = ${item.orderingViolations}`);
    }
    if (item.prior5Sessions !== 0 || item.prior5Events !== 0) {
      failures.push(
        `narrow(${item.label}): 直近 5 問の同じ problemKey = ` +
          `${item.prior5Sessions} セッション / ${item.prior5Events} 問`,
      );
    }
    if (item.prior3Sessions !== 0 || item.prior3Events !== 0) {
      failures.push(
        `narrow(${item.label}): 直近 3 問の同じ状況 = ` +
          `${item.prior3Sessions} セッション / ${item.prior3Events} 問`,
      );
    }
    if (item.immediateSessions !== 0) {
      failures.push(`narrow(${item.label}): 直前と同じ問題 = ${item.immediateSessions}`);
    }
    if (item.trivialOverCap !== 0) {
      failures.push(`narrow(${item.label}): trivial 上限超過 = ${item.trivialOverCap}`);
    }
    if (item.nonDeterministic !== 0) {
      failures.push(`narrow(${item.label}): 同じ seed から別の並び = ${item.nonDeterministic}`);
    }
  }

  // --- MIXED 30 問 + 復習のスイープ（独立監査 F-010） -------------------------
  // 10,000 seeds でも 0 件であることは確認済み（約 8 分）。CI での実行時間に収めるため
  // 既定は 2,000 seeds にしてある。`--per-mode` を上げれば増える。
  const mixedReviewSeeds = Math.max(1_000, Math.min(10_000, Math.round(perMode / 50)));
  const mixedReview = auditMixedReviewSweep(mixedReviewSeeds);
  console.log(`\n=== MIXED 30 問 + 復習スイープ（${mixedReview.checked} seeds） ===`);
  console.log(`出題数                          : ${mixedReview.generated} / 期待 ${mixedReview.expectedGenerated}`);
  console.log(`SETUP カテゴリ quota 違反        : ${mixedReview.categorySessions} セッション / ${mixedReview.categoryEvents} 件`);
  console.log(`SETUP 形式 quota 違反            : ${mixedReview.formatViolations}`);
  console.log(`出題順違反                       : ${mixedReview.orderingViolations}`);
  console.log(`種別 quota 違反                  : ${mixedReview.modeQuotaViolations}`);
  console.log(`同一種別 3 連続                  : ${mixedReview.sameKindRunViolations}`);
  console.log(`直近 5 問の同じ problemKey       : ${mixedReview.prior5Sessions} セッション / ${mixedReview.prior5Events} 問`);
  console.log(`直近 3 問の同じ状況              : ${mixedReview.prior3Sessions} セッション / ${mixedReview.prior3Events} 問`);
  console.log(`直前と同じ問題                   : ${mixedReview.immediateSessions}`);
  console.log(`trivial 上限超過                 : ${mixedReview.trivialOverCap}`);
  console.log(`1 投上がり上限超過               : ${mixedReview.directOverCap}`);
  console.log(`復習枠                           : ${mixedReview.reviewPlaced} 問（復習 0 のセッション ${mixedReview.reviewZeroSessions}）`);
  console.log(`苦手問題の露出（抜き取り）        : ${mixedReview.baselineExposure} -> ${Math.round(mixedReview.reviewExposure / mixedReview.checked * Math.ceil(mixedReview.checked / 50))}（推計）`);
  console.log(`同じ seed から別の並び           : ${mixedReview.nonDeterministic}`);
  if (mixedReview.examples.length > 0) {
    console.log(`  違反例                        : ${mixedReview.examples.join(' | ')}`);
  }
  if (mixedReview.generated !== mixedReview.expectedGenerated) {
    failures.push(`mixed+review: 出題数が足りない (${mixedReview.generated} / ${mixedReview.expectedGenerated})`);
  }
  if (mixedReview.categorySessions !== 0 || mixedReview.categoryEvents !== 0) {
    failures.push(
      `mixed+review: SETUP カテゴリ quota 違反 = ` +
        `${mixedReview.categorySessions} セッション / ${mixedReview.categoryEvents} 件`,
    );
  }
  if (mixedReview.formatViolations !== 0) {
    failures.push(`mixed+review: SETUP 形式 quota 違反 = ${mixedReview.formatViolations}`);
  }
  if (mixedReview.orderingViolations !== 0) {
    failures.push(`mixed+review: 出題順違反 = ${mixedReview.orderingViolations}`);
  }
  if (mixedReview.modeQuotaViolations !== 0) {
    failures.push(`mixed+review: 種別 quota 違反 = ${mixedReview.modeQuotaViolations}`);
  }
  if (mixedReview.sameKindRunViolations !== 0) {
    failures.push(`mixed+review: 同一種別 3 連続 = ${mixedReview.sameKindRunViolations}`);
  }
  if (mixedReview.prior5Sessions !== 0 || mixedReview.prior5Events !== 0) {
    failures.push(
      `mixed+review: 直近 5 問の同じ problemKey = ` +
        `${mixedReview.prior5Sessions} セッション / ${mixedReview.prior5Events} 問`,
    );
  }
  if (mixedReview.prior3Sessions !== 0 || mixedReview.prior3Events !== 0) {
    failures.push(
      `mixed+review: 直近 3 問の同じ状況 = ` +
        `${mixedReview.prior3Sessions} セッション / ${mixedReview.prior3Events} 問`,
    );
  }
  if (mixedReview.immediateSessions !== 0) {
    failures.push(`mixed+review: 直前と同じ問題 = ${mixedReview.immediateSessions}`);
  }
  if (mixedReview.trivialOverCap !== 0) {
    failures.push(`mixed+review: trivial 上限超過 = ${mixedReview.trivialOverCap}`);
  }
  if (mixedReview.directOverCap !== 0) {
    failures.push(`mixed+review: 1 投上がり上限超過 = ${mixedReview.directOverCap}`);
  }
  if (mixedReview.reviewZeroSessions !== 0) {
    failures.push(`mixed+review: 復習枠が 0 のセッション = ${mixedReview.reviewZeroSessions}`);
  }
  if (mixedReview.reviewExposure <= mixedReview.baselineExposure) {
    failures.push(
      `mixed+review: 苦手問題の露出が増えていない (${mixedReview.baselineExposure} -> ${mixedReview.reviewExposure})`,
    );
  }
  if (mixedReview.nonDeterministic !== 0) {
    failures.push(`mixed+review: 同じ seed から別の並び = ${mixedReview.nonDeterministic}`);
  }

  // --- 復習を有効にしたときの構成と効果（独立監査 F-002） ---------------------
  const reviewSeeds = Math.max(50, Math.min(200, Math.round(perMode / 500)));
  const review = auditReviewComposition(reviewSeeds);
  console.log(`\n=== 復習の構成と効果（${reviewSeeds} seeds） ===`);
  for (const item of review.cases) {
    console.log(
      `${item.label.padEnd(26)}: format違反 ${item.formatViolations} / category違反 ${item.categoryViolations}` +
        ` / anti-repeat違反 ${item.antiRepeatViolations} / 露出 ${item.baseline} -> ${item.reviewed}`,
    );
    if (item.formatViolations !== 0) {
      failures.push(`review(${item.label}): SETUP 形式 quota 違反 = ${item.formatViolations}`);
    }
    if (item.categoryViolations !== 0) {
      failures.push(`review(${item.label}): SETUP カテゴリ quota 違反 = ${item.categoryViolations}`);
    }
    if (item.antiRepeatViolations !== 0) {
      failures.push(`review(${item.label}): 直近 5 問の重複 = ${item.antiRepeatViolations}`);
    }
    if (item.reviewed <= item.baseline) {
      failures.push(
        `review(${item.label}): 苦手問題の露出が増えていない (${item.baseline} -> ${item.reviewed})`,
      );
    }
  }

  console.log(`\nElapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (warnings.length > 0) {
    console.log('\nWARNINGS');
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  if (failures.length > 0) {
    console.error('\nFAILURES');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll statistical acceptance criteria passed.');
}

main();
