/**
 * 監査フェーズ 2 / 2-5（U-M3）: カードの要約は「強み 1 行＋注意 1 行」。
 */
import { describe, expect, it } from 'vitest';
import { MAX_CHECKOUT } from '../domain/checkoutRules';
import { rankCheckoutRoutes } from '../engine/ranking/checkoutRanking';
import { routeSummaryLines } from './routeSummary';

const standardOf = (left: number) => rankCheckoutRoutes(left, 3).find((route) => route.isStandard)!;

describe('ルートカードの要約', () => {
  it.each([
    [121, 'T20 を狙って S20 に落ちても 101 が残ります。', '隣のナンバーへ横ズレすると上がりを失います。'],
    [81, 'T19 を狙って S19 に落ちても 62 が残ります。', null],
    [40, 'D20 を狙って S20 に落ちても 20 が残ります。', null],
    [32, 'D16 を狙って S16 に落ちても 16 が残ります。', null],
    [170, 'T20 を続けて狙えます。', 'T20 を狙って S20 に落ちると 150 となります。'],
  ] as const)('%i / 3 本の基準ルート: 1 行目に中身のある強み、2 行目に注意', (left, strength, caution) => {
    const lines = routeSummaryLines(standardOf(left).reasons);
    expect(lines.strength).toBe(strength);
    expect(lines.caution).toBe(caution);
  });

  it('書き下ろし説明があれば 1 行目はそれ、注意は 2 行目に残す', () => {
    const lines = routeSummaryLines(standardOf(121).reasons, '書き下ろし');
    expect(lines.strength).toBe('書き下ろし');
    expect(lines.caution).not.toBeNull();
  });

  it('2〜170 × 1〜3 本: 強みが「基準ルートです」だけになるのは、ほかに強みが無いときだけ', () => {
    const violations: string[] = [];
    for (let left = 2; left <= MAX_CHECKOUT; left += 1) {
      for (let darts = 1; darts <= 3; darts += 1) {
        for (const route of rankCheckoutRoutes(left, darts)) {
          const lines = routeSummaryLines(route.reasons);
          const others = route.reasons.filter(
            (reason) => reason.polarity === 'positive' && reason.code !== 'STANDARD_ROUTE',
          );
          if (lines.strength === 'このアプリの基準ルートです。' && others.length > 0) {
            violations.push(`${left}/${darts} ${route.key}`);
          }
          const negatives = route.reasons.filter((reason) => reason.polarity === 'negative');
          if ((negatives.length > 0) !== (lines.caution !== null)) violations.push(`${left}/${darts} ${route.key} 注意`);
        }
      }
    }
    expect(violations.slice(0, 10)).toEqual([]);
  });
});
