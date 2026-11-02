/**
 * 1-7 L-M3: TRAINING で、基準ルートと同等の別解を S（基準と同等）にする（docs/APPROVALS.md A-31）。
 *
 * 対象は当初 B / C の別解（263 件 / 41 状態）。2026-11-02 のオーナー決定で推奨度 A の別解も含め、
 * 691 件 / 86 状態になった（docs/DATA_CONFLICTS.md #10）。
 */
import { describe, expect, it } from 'vitest';
import { parseRoute } from '../../domain/dart';
import { MAX_CHECKOUT } from '../../domain/checkoutRules';
import { peerOfStandard, rankCheckoutRoutes } from '../ranking/checkoutRanking';
import { gradeAnswer } from './grade';
import { buildFeedback } from './feedback';
import { checkoutProblemKey, type TrainingQuestion } from './model';

function checkoutQuestion(left: number, darts: number): TrainingQuestion {
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
    visitDartsAvailable: darts,
    contextualThrows: [],
    promptJa: '',
    recovery: null,
    expectedAnswer: [],
    trivial: false,
  };
}

describe('基準と同等の別解', () => {
  it.each([
    [41, 2, ['S1', 'D20']],
    [21, 2, ['S1', 'D10']],
    [25, 3, ['S3', 'D11']],
    [50, 2, ['S10', 'D20']],
  ] as const)('%i / %i 本の %j は TRAINING では S（PEER_OF_STANDARD）、Practice の推奨度は変えない', (left, darts, ids) => {
    const answer = parseRoute([...ids]);
    const result = gradeAnswer(checkoutQuestion(left, darts), answer);
    expect(result.grade).toBe('S');
    const codes = result.checkoutEvaluation!.reasons.map((reason) => reason.code);
    expect(codes[0]).toBe('PEER_OF_STANDARD');
    expect(codes).not.toContain('BELOW_TOP_ROUTE');
    expect(buildFeedback(checkoutQuestion(left, darts), answer, result).verdictJa).toBe(
      '正解（推奨度 S・基準と同等の別解）',
    );

    const practice = rankCheckoutRoutes(left, darts).find((route) => route.key === ids.join('-'))!;
    expect(['A', 'B', 'C']).toContain(practice.grade);
  });

  it('基準ルートそのものには付けない（41 / 2 本 S9 → D16）', () => {
    const result = gradeAnswer(checkoutQuestion(41, 2), parseRoute(['S9', 'D16']));
    expect(result.grade).toBe('S');
    expect(result.checkoutEvaluation!.reasons.some((reason) => reason.code === 'PEER_OF_STANDARD')).toBe(false);
  });

  it('戦術スコアが基準ルートより低い答えは上げない（41 / 2 本の全ルート）', () => {
    const ranked = rankCheckoutRoutes(41, 2);
    const violations = ranked
      .filter((route) => !route.isStandard && route.grade !== 'S')
      .filter((route) => route.tacticalScore < ranked.find((item) => item.isStandard)!.tacticalScore)
      .filter((route) => peerOfStandard(41, 2, route, ranked) !== null)
      .map((route) => route.key);
    expect(violations).toEqual([]);
  });

  it('2〜170 × 1〜3 本: 上がる別解は定義どおりで、件数は 691 件 / 86 状態（A / B / C）', () => {
    const violations: string[] = [];
    let count = 0;
    const states = new Set<string>();
    for (let left = 2; left <= MAX_CHECKOUT; left += 1) {
      for (let darts = 1; darts <= 3; darts += 1) {
        const ranked = rankCheckoutRoutes(left, darts);
        const standard = ranked.find((route) => route.isStandard);
        for (const route of ranked) {
          const peer = peerOfStandard(left, darts, route, ranked);
          if (peer === null) continue;
          count += 1;
          states.add(`${left}/${darts}`);
          if (
            standard === undefined ||
            ranked[0].key !== standard.key ||
            route.tacticalScore < standard.tacticalScore ||
            peer.grade !== 'S'
          ) {
            violations.push(`${left}/${darts} ${route.key}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
    expect({ count, states: states.size }).toEqual({ count: 691, states: 86 });
  });
});
