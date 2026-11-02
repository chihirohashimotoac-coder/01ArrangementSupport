/**
 * 振り返りの 1 投ごとの「結論 1 行」（監査フェーズ 2 / 2-9）。
 *
 * 以前は判定の札と長い説明文だけで、「推奨度 C なのに良い判断」のように、
 * 説明の途中に出る推奨度と判定が食い違って見えることがあった。いまは結論を 1 行で先に出し、
 * 詳しい説明（noteJa）はたたむ。結論は判定（verdict）と、判定が比べた代案（comparison）から作る。
 * 説明文を解析しない。
 */
import { THROW_VERDICT_JA, type ReviewComparisonBasis, type ThrowReview } from './review';
import { displayRouteText } from './notation';

const BASIS_PHRASE_JA: Readonly<Record<ReviewComparisonBasis, string>> = {
  APP_ROUTE: 'アプリの評価が高い狙いです',
  LAST_DART_TENPAI: 'シングルに落ちてもテンパイが残ります',
  LAST_DART_SAME_NUMBER_TRIPLE: '同じナンバーのトリプルの方が、入っても落ちても有利です',
  LAST_DART_LEAVE_PROFILE: '次のビジットで上がりやすい残りになります',
  SETUP_RECOVERY: 'シングルに落ちても立て直せます',
};

export function throwConclusionJa(review: ThrowReview): string {
  const label = THROW_VERDICT_JA[review.verdict];
  switch (review.verdict) {
    case 'GOOD_DECISION': {
      if (review.reason?.code === 'CHECKOUT_PEER_OF_RECOMMENDED') {
        return `${label}：おすすめと同等の上がり方です。`;
      }
      if (review.recommendedDartId !== null && review.record.intendedDartId === review.recommendedDartId) {
        return `${label}：おすすめどおりの狙いです。`;
      }
      return `${label}：この場面で推奨できる狙いです。`;
    }
    case 'BETTER_OPTION_AVAILABLE':
    case 'ARRANGEMENT_MISTAKE':
    case 'SETUP_MISTAKE':
    case 'BOGEY_CREATED': {
      const comparison = review.comparison;
      if (comparison === null || comparison.dartIds.length === 0) {
        return review.verdict === 'BOGEY_CREATED'
          ? `${label}：狙い通りでも、次のビジットで上がれない残りになります。`
          : `${label}。`;
      }
      const alternative = displayRouteText(comparison.dartIds.join(' → '));
      return `${label}：${alternative} なら、${BASIS_PHRASE_JA[comparison.basis]}。`;
    }
    case 'SCORING_PHASE':
    case 'NOT_EVALUATED':
      return label;
  }
}
