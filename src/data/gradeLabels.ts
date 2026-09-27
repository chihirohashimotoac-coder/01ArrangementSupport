import type { RouteGrade } from './rankingRules';

/**
 * 推奨度（S / A / B / C）の画面表記。
 *
 * 意味は `rankingRules.ts` の `GRADE_THRESHOLDS` のコメントと同じ。
 * CHECKOUT のルートカードと SIMULATION の用語説明で同じ言葉を使うため、ここに置く。
 */
export const ROUTE_GRADE_LABEL_JA: Readonly<Record<RouteGrade, string>> = {
  S: '基準推奨',
  A: '非常に良い代替',
  B: '十分実用的',
  C: '成立するが非推奨',
};
/** 最後の1本の OTHER ROUTES は通常のルート基準と実戦比較を混同させない。 */
export function otherRoutesGradeContext(mode: 'checkout' | 'setup', dartsLeft: number): string | null {
  return mode === 'setup' && dartsLeft === 1
    ? '基準評価は通常のSETUP順位です。最後の1本の実戦判断は、狙い通りとシングル落ちの残りを比べます。'
    : null;
}
