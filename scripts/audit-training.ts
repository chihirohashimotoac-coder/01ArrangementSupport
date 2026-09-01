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
import { generateQuestionsWithReport } from '../src/engine/training/sampling';
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

function auditSession(audit: ModeAudit, questions: readonly TrainingQuestion[]): void {
  audit.sessions += 1;
  audit.generated += questions.length;

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
