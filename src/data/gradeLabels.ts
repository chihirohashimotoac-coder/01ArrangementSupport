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
