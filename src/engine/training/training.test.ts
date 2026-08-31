import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRAINING_SETTINGS,
  buildRecoveryQuestion,
  canBuildRecoveryQuestion,
  canGenerateQuestions,
  checkoutCandidates,
  createRecoveryQuestionCandidate,
  generateQuestions,
  recoveryCandidates,
  recoveryQuestionCandidates,
  setupCandidates,
} from './questions';
import { gradeAnswer, isDiscouraged, leftBogey } from './grade';
import { createRandom } from './random';
import { isFinishingDart, parseRoute, requireDart, routeTotal } from '../../domain/dart';
import {
  DARTS_PER_VISIT,
  applyDart,
  isBogey,
  isCheckoutable,
  isLegalCheckoutRoute,
} from '../../domain/checkoutRules';
import { BOGEY_NUMBERS } from '../../data/bogeyNumbers';

describe('擬似乱数', () => {
  it('同じ seed からは同じ列が出る', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('nextInt は範囲内に収まる', () => {
    const random = createRandom(7);
    for (let i = 0; i < 500; i += 1) {
      const value = random.nextInt(3, 9);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(9);
    }
  });
});

describe('出題対象', () => {
  it('CHECKOUT の出題対象に Bogey は含まれない', () => {
    const candidates = checkoutCandidates({ min: 2, max: 170 });
    for (const bogey of BOGEY_NUMBERS) expect(candidates).not.toContain(bogey);
    expect(candidates).toContain(103);
    expect(candidates).toContain(2);
    expect(candidates).toContain(170);
  });

  it('SETUP の出題対象はテンパイを作れる残りだけ', () => {
    const candidates = setupCandidates({ min: 171, max: 350 });
    for (const unreachable of [339, 342, 343, 345, 346, 348, 349]) {
      expect(candidates).not.toContain(unreachable);
    }
    expect(candidates).toContain(302);
  });

  it('範囲指定が効く', () => {
    const candidates = checkoutCandidates({ min: 100, max: 110 });
    expect(Math.min(...candidates)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...candidates)).toBeLessThanOrEqual(110);
  });

  it('min / max が逆でも扱える', () => {
    expect(checkoutCandidates({ min: 110, max: 100 })).toEqual(
      checkoutCandidates({ min: 100, max: 110 }),
    );
  });
});

describe('RECOVERY の出題可否（PR #1 レビュー指摘の回帰テスト）', () => {
  it('1 投目がシングルの残り点では RECOVERY を作れない', () => {
    // 3 の基準ルートは S1 + D1 なので、外す先が同じ的になり問題にならない。
    expect(canBuildRecoveryQuestion(3)).toBe(false);
  });

  it('外した後の残りが 2 未満になる残り点では作れない', () => {
    // 2 の基準ルートは D1。S1 へ外すと 1 残りで Bust になる。
    expect(canBuildRecoveryQuestion(2)).toBe(false);
  });

  it('1 投目がトリプルなら作れる', () => {
    expect(canBuildRecoveryQuestion(103)).toBe(true);
    expect(canBuildRecoveryQuestion(122)).toBe(true);
  });

  it('161 → T20 狙い → S20 で 141 / 2 本になる問題は作れない', () => {
    expect(isCheckoutable(141, 2)).toBe(false);
    expect(canBuildRecoveryQuestion(161)).toBe(false);
    expect(recoveryCandidates({ min: 161, max: 161 })).toEqual([]);
  });

  it('2〜3 の範囲では RECOVERY の出題対象が 0 件になる', () => {
    expect(recoveryCandidates({ min: 2, max: 3 })).toEqual([]);
    expect(canGenerateQuestions({
      ...DEFAULT_TRAINING_SETTINGS,
      mode: 'recovery',
      checkoutRange: { min: 2, max: 3 },
    })).toBe(false);
  });

  it('出題できない範囲では、空回りせずに空の出題列を返す', () => {
    const questions = generateQuestions({
      settings: {
        ...DEFAULT_TRAINING_SETTINGS,
        mode: 'recovery',
        checkoutRange: { min: 2, max: 3 },
        questionCount: 10,
      },
      seed: 1,
    });
    expect(questions).toEqual([]);
  });

  it('十分な範囲があれば、要求した問題数を満たす', () => {
    const questions = generateQuestions({
      settings: { ...DEFAULT_TRAINING_SETTINGS, mode: 'recovery', questionCount: 20 },
      seed: 4,
    });
    expect(questions).toHaveLength(20);
    for (const question of questions) {
      expect(question.kind).toBe('recovery');
      expect(question.remaining).toBeGreaterThanOrEqual(2);
    }
  });

  it('他のモードは出題できる設定として扱われる', () => {
    expect(canGenerateQuestions(DEFAULT_TRAINING_SETTINGS)).toBe(true);
    expect(canGenerateQuestions({ ...DEFAULT_TRAINING_SETTINGS, mode: 'setup' })).toBe(true);
  });

  it('MIXED は空の RECOVERY pool を選ばず、要求数を決定的に満たす', () => {
    const settings = {
      ...DEFAULT_TRAINING_SETTINGS,
      mode: 'mixed' as const,
      checkoutRange: { min: 2, max: 3 },
      questionCount: 100,
    };
    const questions = generateQuestions({ settings, seed: 23 });
    expect(questions).toHaveLength(100);
    expect(questions.some((question) => question.kind === 'recovery')).toBe(false);
    expect(generateQuestions({ settings, seed: 23 })).toEqual(questions);
  });
});

describe('RECOVERY 候補の合法性 invariant', () => {
  it('全候補で表示状態・合法 route・grader が一致する', () => {
    const candidates = recoveryQuestionCandidates({ min: 2, max: 170 });
    const violations: string[] = [];

    for (const [index, candidate] of candidates.entries()) {
      const label = `${candidate.visitStartRemaining}/${candidate.actualDart.id}`;
      const recalculated = candidate.visitStartRemaining - candidate.actualDart.score;
      const question = buildRecoveryQuestion(candidate, index);

      if (candidate.remaining !== recalculated) violations.push(`${label}: remaining`);
      if (candidate.dartsAvailable !== DARTS_PER_VISIT - 1) violations.push(`${label}: darts`);
      if (question.remaining !== recalculated) violations.push(`${label}: question remaining`);
      if (question.dartsAvailable !== candidate.dartsAvailable) {
        violations.push(`${label}: question darts`);
      }
      if (question.recovery === null) violations.push(`${label}: context`);
      if (!question.promptJa.includes(`${candidate.visitStartRemaining}`)) {
        violations.push(`${label}: prompt initial`);
      }
      if (!question.promptJa.includes(candidate.intendedDart.id)) {
        violations.push(`${label}: prompt intended`);
      }
      if (!question.promptJa.includes(candidate.actualDart.id)) {
        violations.push(`${label}: prompt actual`);
      }
      if (!question.promptJa.includes(`${candidate.remaining}`)) {
        violations.push(`${label}: prompt remaining`);
      }

      const route = candidate.expectedRoute;
      if (route.length === 0 || route.length > candidate.dartsAvailable) {
        violations.push(`${label}: route length`);
      }
      if (routeTotal(route) !== candidate.remaining) violations.push(`${label}: route total`);
      if (!isFinishingDart(route[route.length - 1])) violations.push(`${label}: finish`);
      if (!isLegalCheckoutRoute(candidate.remaining, route, candidate.dartsAvailable)) {
        violations.push(`${label}: illegal route`);
      }

      let left = candidate.remaining;
      for (const [dartIndex, dart] of route.entries()) {
        const result = applyDart(left, dart);
        if (result.outcome === 'bust') violations.push(`${label}: bust at ${dartIndex}`);
        if (result.outcome === 'checkout' && dartIndex !== route.length - 1) {
          violations.push(`${label}: early checkout`);
        }
        if (result.outcome === 'continue') left = result.remainingAfter;
      }

      const graded = gradeAnswer(question, route);
      if (!graded.valid) violations.push(`${label}: grader ${graded.invalidReason}`);
      if (graded.grade === null) violations.push(`${label}: grade`);
      if (graded.checkoutEvaluation === null) violations.push(`${label}: reason`);
      if (graded.bestCheckout === null) violations.push(`${label}: better route`);
    }

    expect(candidates.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});

describe('RECOVERY 実投境界', () => {
  const intended = requireDart('T19');

  it.each([
    ['MISS', 100],
    ['S20', 80],
    ['D20', 60],
    ['T20', 40],
    ['SB', 75],
    ['BULL', 50],
  ])('%s の実投後に合法な回答があれば候補になる', (actualId, expectedRemaining) => {
    const candidate = createRecoveryQuestionCandidate(
      100,
      intended,
      requireDart(actualId),
    );
    expect(candidate?.remaining).toBe(expectedRemaining);
    expect(
      candidate === null
        ? false
        : isLegalCheckoutRoute(
            candidate.remaining,
            candidate.expectedRoute,
            candidate.dartsAvailable,
          ),
    ).toBe(true);
  });

  it('BULL finish を必要とする 104 / 2 本を生成・採点できる', () => {
    const candidate = createRecoveryQuestionCandidate(
      122,
      requireDart('T18'),
      requireDart('S18'),
    );
    expect(candidate?.remaining).toBe(104);
    expect(candidate?.expectedRoute.map((dart) => dart.id)).toEqual(['T18', 'BULL']);
    expect(gradeAnswer(buildRecoveryQuestion(candidate!, 0), candidate!.expectedRoute).valid).toBe(
      true,
    );
  });

  it('D1 finish の 2 / 2 本を生成・採点できる', () => {
    const candidate = createRecoveryQuestionCandidate(
      4,
      requireDart('D2'),
      requireDart('S2'),
    );
    expect(candidate?.remaining).toBe(2);
    expect(candidate?.expectedRoute.map((dart) => dart.id)).toEqual(['D1']);
    expect(gradeAnswer(buildRecoveryQuestion(candidate!, 0), candidate!.expectedRoute).valid).toBe(
      true,
    );
  });

  it.each([
    [40, 'T20', 'BELOW_ZERO'],
    [21, 'S20', 'LEFT_ONE'],
    [20, 'S20', 'single zero'],
    [60, 'T20', 'triple zero'],
    [40, 'D20', 'checkout'],
  ])('%i から %s の %s 状態は次の狙いを問わない', (remaining, actualId) => {
    expect(
      createRecoveryQuestionCandidate(remaining, intended, requireDart(actualId)),
    ).toBeNull();
  });
});

describe('出題生成', () => {
  it('指定した問題数を生成する', () => {
    const questions = generateQuestions({
      settings: { ...DEFAULT_TRAINING_SETTINGS, questionCount: 30 },
      seed: 1,
    });
    expect(questions).toHaveLength(30);
  });

  it('同じ seed からは同じ出題になる', () => {
    const options = { settings: DEFAULT_TRAINING_SETTINGS, seed: 99 };
    expect(generateQuestions(options).map((q) => q.id)).toEqual(
      generateQuestions(options).map((q) => q.id),
    );
  });

  it('MIXED では 3 種類が混ざりうる', () => {
    const questions = generateQuestions({
      settings: { ...DEFAULT_TRAINING_SETTINGS, mode: 'mixed', questionCount: 60 },
      seed: 5,
    });
    expect(new Set(questions.map((q) => q.kind)).size).toBeGreaterThan(1);
  });

  it('RECOVERY は「狙い」と「実際」を持ち、残り本数が 2 になる', () => {
    const questions = generateQuestions({
      settings: { ...DEFAULT_TRAINING_SETTINGS, mode: 'recovery', questionCount: 20 },
      seed: 3,
    });
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(question.recovery).not.toBeNull();
      expect(question.dartsAvailable).toBe(2);
      expect(question.remaining).toBe(
        question.recovery!.visitStartRemaining - question.recovery!.actualDart.score,
      );
    }
  });

  it('SETUP の出題は必ずテンパイを作れる', () => {
    const questions = generateQuestions({
      settings: { ...DEFAULT_TRAINING_SETTINGS, mode: 'setup', questionCount: 25 },
      seed: 11,
    });
    for (const question of questions) {
      expect(question.remaining).toBeGreaterThanOrEqual(171);
      expect(question.kind).toBe('setup');
    }
  });

  it('苦手スコアを指定すると、そのスコアが出題に混ざる', () => {
    const questions = generateQuestions({
      settings: { ...DEFAULT_TRAINING_SETTINGS, questionCount: 40 },
      seed: 8,
      reviewTargets: [122],
    });
    expect(questions.some((q) => q.remaining === 122)).toBe(true);
  });
});

const checkoutQuestion = {
  id: 'q',
  kind: 'checkout' as const,
  remaining: 103,
  dartsAvailable: DARTS_PER_VISIT,
  promptJa: '',
  recovery: null,
};

describe('CHECKOUT の採点', () => {
  it('基準ルートは S ランク', () => {
    const result = gradeAnswer(checkoutQuestion, parseRoute(['T19', 'S6', 'D20']));
    expect(result.valid).toBe(true);
    expect(result.grade).toBe('S');
    expect(result.finishDouble).toBe('D20');
  });

  it('順番が違えば別ルートとして扱う', () => {
    const forward = gradeAnswer(checkoutQuestion, parseRoute(['T19', 'S6', 'D20']));
    const reversed = gradeAnswer(checkoutQuestion, parseRoute(['S6', 'T19', 'D20']));
    expect(forward.valid).toBe(true);
    expect(reversed.valid).toBe(true);
    expect(reversed.answerText).not.toBe(forward.answerText);
    expect(reversed.checkoutEvaluation!.key).not.toBe(forward.checkoutEvaluation!.key);
  });

  it('成立するが非推奨のルートは C ランクで、理由が付く', () => {
    const result = gradeAnswer(
      { ...checkoutQuestion, remaining: 46 },
      parseRoute(['D11', 'D12']),
    );
    expect(result.valid).toBe(true);
    expect(isDiscouraged(result)).toBe(true);
    expect(result.checkoutEvaluation!.reasons.map((r) => r.code)).toContain('NON_FINAL_DOUBLE');
    const negatives = result.checkoutEvaluation!.reasons.filter((r) => r.polarity === 'negative');
    expect(negatives.length).toBeGreaterThan(0);
  });

  it('122 の T20 始動は「成立するが非推奨」として C になり、理由が示される', () => {
    const result = gradeAnswer(
      { ...checkoutQuestion, remaining: 122 },
      parseRoute(['T20', 'T14', 'D10']),
    );
    expect(result.valid).toBe(true);
    expect(result.grade).toBe('C');
    const codes = result.checkoutEvaluation!.reasons.map((r) => r.code);
    expect(codes).toContain('SINGLE_MISS_LOSES_CHECKOUT');
    expect(codes).toContain('SAFER_START_EXISTS');
  });

  it('合計が合わなければ不成立', () => {
    const result = gradeAnswer(checkoutQuestion, parseRoute(['T20', 'D20']));
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe('TOTAL_MISMATCH');
  });

  it('最終ダートがシングルなら不成立', () => {
    const result = gradeAnswer(
      { ...checkoutQuestion, remaining: 60 },
      parseRoute(['S20', 'S20', 'S20']),
    );
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe('NOT_DOUBLE_FINISH');
  });

  it('Bust するルートは不成立', () => {
    const result = gradeAnswer(
      { ...checkoutQuestion, remaining: 40 },
      parseRoute(['T20', 'D20']),
    );
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe('BUST');
  });

  it('本数超過は不成立', () => {
    const result = gradeAnswer(
      { ...checkoutQuestion, remaining: 103, dartsAvailable: 2 },
      parseRoute(['T19', 'S6', 'D20']),
    );
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe('TOO_MANY_DARTS');
  });

  it('未回答は不成立', () => {
    expect(gradeAnswer(checkoutQuestion, []).invalidReason).toBe('EMPTY');
  });

  it('最上位ルートを併せて返す', () => {
    const result = gradeAnswer(checkoutQuestion, parseRoute(['T20', 'S11', 'D16']));
    expect(result.bestCheckout?.routeText).toBe('T19 → S6 → D20');
  });
});

const setupQuestion = {
  id: 'q',
  kind: 'setup' as const,
  remaining: 302,
  dartsAvailable: DARTS_PER_VISIT,
  promptJa: '',
  recovery: null,
};

describe('SETUP の採点', () => {
  it('資料どおり T20 → T20 → S18 は最上位ランク', () => {
    const result = gradeAnswer(setupQuestion, parseRoute(['T20', 'T20', 'S18']));
    expect(result.valid).toBe(true);
    expect(result.grade).toBe('S');
    expect(result.setupEvaluation!.leave).toBe(164);
    expect(leftBogey(result)).toBe(false);
  });

  it('S20 に振るとノーテンを残し、C ランクになる', () => {
    const result = gradeAnswer(setupQuestion, parseRoute(['T20', 'T20', 'S20']));
    expect(result.valid).toBe(true);
    expect(result.grade).toBe('C');
    expect(result.setupEvaluation!.leave).toBe(162);
    expect(isBogey(162)).toBe(true);
    expect(leftBogey(result)).toBe(true);
  });

  it('3 本すべてを選ばないと採点しない', () => {
    const result = gradeAnswer(setupQuestion, parseRoute(['T20', 'T20']));
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe('NOT_FINISHED');
  });

  it('最上位の SETUP ルートを併せて返す', () => {
    const result = gradeAnswer(setupQuestion, parseRoute(['T20', 'T20', 'S20']));
    expect(result.bestSetup?.routeText).toBe('T20 → T20 → S18');
  });
});

describe('RECOVERY の採点', () => {
  it('122 で T18 → S18 のあと、104 を 2 本で上がるルートが正解になる', () => {
    const question = {
      id: 'r',
      kind: 'recovery' as const,
      remaining: 104,
      dartsAvailable: 2,
      promptJa: '',
      recovery: null,
    };
    const result = gradeAnswer(question, parseRoute(['T18', 'BULL']));
    expect(result.valid).toBe(true);
    expect(result.grade).not.toBeNull();
  });
});
