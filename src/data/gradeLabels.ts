import type { RouteGrade } from './rankingRules';

/**
 * 推奨度（S / A / B / C）の画面表記。
 *
 * 意味は `rankingRules.ts` の `GRADE_THRESHOLDS` のコメントと同じ。
 * CHECKOUT のルートカードと SIMULATION の用語説明で同じ言葉を使うため、ここに置く。
 */
export const ROUTE_GRADE_LABEL_JA: Readonly<Record<RouteGrade, string>> = {
  /*
   * 以前は「基準推奨」。OTHER ROUTES の別ルートにも付くため、基準ルートが複数あるように見えていた
   * （例: 121 の T11 → T16 → D20）。監査フェーズ 2 / 2-4 で、基準ルート以外の S は「基準と同等」にした。
   */
  S: '基準と同等',
  A: '非常に良い代替',
  B: '十分実用的',
  C: '成立するが非推奨',
};
/** 基準ルート自身の S の表記（監査フェーズ 2 / 2-4）。 */
export const STANDARD_ROUTE_GRADE_LABEL_JA = '基準ルート';

/**
 * ルート 1 本の推奨度の表記。基準ルート自身の S だけ「基準ルート」、それ以外の S は「基準と同等」。
 */
export function routeGradeLabelJa(
  grade: RouteGrade,
  isStandard: boolean,
  isSetupBest = false,
): string {
  if (grade !== 'S') return ROUTE_GRADE_LABEL_JA[grade];
  if (isStandard) return STANDARD_ROUTE_GRADE_LABEL_JA;
  // SETUP には基準ルートが無い。BEST 自身は「基準と同等」ではなく最上位の候補。
  if (isSetupBest) return '最上位の候補';
  return ROUTE_GRADE_LABEL_JA.S;
}

/** S / A / B / C の意味を一覧で説明するときの S の表記（基準ルート自身と、それ以外の S の両方）。 */
export const GRADE_S_OVERVIEW_JA = '基準ルート、または基準と同等';

/** 最後の1本の OTHER ROUTES は通常のルート基準と実戦比較を混同させない。 */
export function otherRoutesGradeContext(mode: 'checkout' | 'setup', dartsLeft: number): string | null {
  return mode === 'setup' && dartsLeft === 1
    ? '基準評価は通常のSETUP順位です。最後の1本の実戦判断は、狙い通りとシングル落ちの残りを比べます。'
    : null;
}
