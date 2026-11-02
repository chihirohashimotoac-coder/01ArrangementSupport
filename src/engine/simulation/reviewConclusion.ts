/**
 * 振り返りの 1 投ごとの「結論 1 行」（監査フェーズ 2 / 2-9）。
 *
 * 以前は判定の札と長い説明文だけで、「推奨度 C なのに良い判断」のように、
 * 説明の途中に出る推奨度と判定が食い違って見えることがあった。いまは結論を 1 行で先に出し、
 * 詳しい説明（noteJa）はたたむ。結論は判定（verdict）と、判定が比べた代案（comparison）の
 * **数値（狙い通りの残り・シングル落ちの残り）** から作る。説明文は解析しない。
 * 日本語の組み立ては data/explanations.ts（renderReviewConclusionJa）。
 */
import { isCheckoutable } from '../../domain/checkoutRules';
import { renderReviewConclusionJa } from '../../data/explanations';
import { THROW_VERDICT_JA, type ThrowReview } from './review';
import { displayRouteText, displayTargetId } from './notation';

/** 次のビジットで上がれる残り（テンパイ）か。 */
const isTenpai = (leave: number | null): boolean =>
  leave !== null && leave >= 2 && leave <= 170 && isCheckoutable(leave, 3);

export function throwConclusionJa(review: ThrowReview): string {
  const label = THROW_VERDICT_JA[review.verdict];
  switch (review.verdict) {
    case 'GOOD_DECISION':
      return renderReviewConclusionJa({
        label,
        kind:
          review.reason?.code === 'CHECKOUT_PEER_OF_RECOMMENDED'
            ? 'good-peer'
            : review.recommendedDartId !== null &&
                review.record.intendedDartId === review.recommendedDartId
              ? 'good-recommended'
              : 'good-other',
      });
    case 'BETTER_OPTION_AVAILABLE':
    case 'ARRANGEMENT_MISTAKE':
    case 'SETUP_MISTAKE':
    case 'BOGEY_CREATED': {
      const comparison = review.comparison;
      if (comparison === null || comparison.dartIds.length === 0) {
        return renderReviewConclusionJa({
          label,
          kind: review.verdict === 'BOGEY_CREATED' ? 'bogey-without-alternative' : 'plain',
        });
      }
      return renderReviewConclusionJa({
        label,
        kind: 'alternative',
        alternativeText: displayRouteText(comparison.dartIds.join(' → ')),
        basis: comparison.basis,
        leaveOnHit: comparison.leaveOnHit,
        hitTenpai: isTenpai(comparison.leaveOnHit),
        missText: comparison.missDartId === null ? null : displayTargetId(comparison.missDartId),
        leaveOnSingleMiss: comparison.leaveOnSingleMiss,
        missTenpai: isTenpai(comparison.leaveOnSingleMiss),
      });
    }
    case 'SCORING_PHASE':
    case 'NOT_EVALUATED':
      return label;
  }
}
