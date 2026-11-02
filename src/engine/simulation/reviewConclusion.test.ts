/**
 * 監査フェーズ 2 / 2-9: 振り返りの 1 投ごとの結論 1 行。
 */
import { describe, expect, it } from 'vitest';
import type { ThrowRecord } from './game';
import { isCheckoutable } from '../../domain/checkoutRules';
import { reviewThrow } from './review';
import { throwConclusionJa } from './reviewConclusion';

function record(leftBefore: number, intendedDartId: string, dartNumber: number): ThrowRecord {
  return {
    round: 1,
    dartNumber,
    dartIndex: dartNumber,
    leftBefore,
    intendedSegmentId: `segment-${intendedDartId.toLowerCase()}`,
    intendedDartId,
    intendedPoint: { x: 0, y: 0 },
    actualPoint: { x: 0, y: 0 },
    actualDartId: intendedDartId,
    score: 0,
    leftAfter: leftBefore,
    bust: false,
    bustReason: null,
    checkout: false,
    drawsBefore: 0,
  };
}

describe('振り返りの結論 1 行', () => {
  it('121 / 3 本の T20（おすすめどおり）は「良い判断：おすすめどおりの狙いです。」', () => {
    expect(throwConclusionJa(reviewThrow(record(121, 'T20', 1)))).toBe('良い判断：おすすめどおりの狙いです。');
  });

  it('41 / 2 本の S1（おすすめと同等の上がり方）は、推奨度に触れずに良い判断と書く', () => {
    const review = reviewThrow(record(41, 'S1', 2));
    expect(review.verdict).toBe('GOOD_DECISION');
    expect(throwConclusionJa(review)).toBe('良い判断：おすすめと同等の上がり方です。');
  });

  it('否定的な判定は、代案とその理由を 1 行で示す（122 / 3 本の T20）', () => {
    const review = reviewThrow(record(122, 'T20', 1));
    expect(review.verdict).not.toBe('GOOD_DECISION');
    const line = throwConclusionJa(review);
    expect(line).toMatch(/^.+：.+ なら、.+。$/);
    expect(line).not.toContain('推奨度');
  });

  it('2〜170 × 1〜3 投目 × 主な的: 結論は 1 行で、「推奨度」を含まない', () => {
    const violations: string[] = [];
    for (let left = 2; left <= 170; left += 7) {
      for (let dartNumber = 1; dartNumber <= 3; dartNumber += 1) {
        for (const target of ['T20', 'T19', 'S20', 'D16', 'BULL', 'SB']) {
          const line = throwConclusionJa(reviewThrow(record(left, target, dartNumber)));
          if (line.includes('\n') || line.includes('推奨度') || line.length === 0) {
            violations.push(`${left}/${dartNumber} ${target}: ${line}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  /*
   * Codex レビュー（PR #39）: 最後の 1 投で「テンパイを作れる的」を代案にしたとき、シングル落ちでも
   * テンパイが残るとは限らない（200 の T20 は入れば 140 だが、S20 に落ちると 180 でノーテン）。
   */
  it.each([
    [200, 140],
    [191, 131],
    [220, 160],
    [230, 170],
  ])('%i の最後の 1 投 S20: 代案 T20 は「入れば残り %i でテンパイ」と書き、シングル落ちでも残るとは書かない', (left, hit) => {
    const line = throwConclusionJa(reviewThrow(record(left, 'S20', 3)));
    expect(line).toContain(`入れば残り ${hit} でテンパイです。`);
    expect(line).not.toContain('落ちても');
  });

  it('171〜350 の最後の 1 投: 「落ちても残り X でテンパイ」と書くのは、X が本当にテンパイのときだけ', () => {
    const violations: string[] = [];
    for (let left = 171; left <= 350; left += 1) {
      for (const target of ['S20', 'S19', 'T20', 'T19', 'S18', 'D20', 'BULL']) {
        const line = throwConclusionJa(reviewThrow(record(left, target, 3)));
        const match = /落ちても残り (\d+) でテンパイ/.exec(line);
        if (match === null) continue;
        const leave = Number(match[1]);
        if (!(leave >= 2 && leave <= 170 && isCheckoutable(leave, 3))) violations.push(`${left} ${target}: ${line}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
