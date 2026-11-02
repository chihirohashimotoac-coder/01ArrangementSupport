/**
 * 監査フェーズ 2 / 2-2（U-M9）: SETUP の BEST が主目標（T20）から始まらない理由を、
 * エンジンの計算結果から比較の形で出す（docs/APPROVALS.md A-34）。
 * 全件走査は違反を配列に集め、最後に 1 回だけ assert する（CLAUDE.md §5）。
 */
import { describe, expect, it } from 'vitest';
import { canReachTenpai } from './tenpai';
import { rankSetupRoutes } from './enumerate';

const whyOf = (remaining: number, darts: number) =>
  rankSetupRoutes(remaining, darts)[0].reasons.find((reason) => reason.code === 'SETUP_WHY_NOT_MAIN_TARGET');

describe('BEST が T20 から始まらない理由', () => {
  it('302 / 3 本: T20 → S20 ではテンパイを作れず、T18 → S18 ならチャンスが残る', () => {
    const why = whyOf(302, 3)!;
    expect(why.summary).toBe(
      'T20 を狙って S20 に入ると、残り 282・あと 2 本ではテンパイを作れません。' +
        'T18 を狙って S18 に入っても、残り 284・あと 2 本でまだテンパイを作るチャンスが残ります。',
    );
    expect(why.detail).toContain('1 投目は T18 から狙います');
  });

  it('279 / 3 本: どちらもシングル落ちに耐えるときは、狙いどおり入ったときの残しで比べる', () => {
    const why = whyOf(279, 3)!;
    expect(why.summary).toContain('T20 も T13 も、シングルに入ってもテンパイを作れます');
    expect(why.detail).toContain('T20 → T20 → S20）は 139 残し');
    expect(why.detail).toContain('T13 から入ると 160 残し');
  });

  it('BEST が T20 始動なら付けない（304 / 3 本）', () => {
    expect(whyOf(304, 3)).toBeUndefined();
  });

  it('171〜350 × 2〜3 本: T20 から始まらない BEST には必ず先頭に付き、書いてある判定がエンジンの計算と一致する', () => {
    const violations: string[] = [];
    let count = 0;
    for (let remaining = 171; remaining <= 350; remaining += 1) {
      for (let darts = 2; darts <= 3; darts += 1) {
        const best = rankSetupRoutes(remaining, darts)[0];
        const why = best.reasons.find((reason) => reason.code === 'SETUP_WHY_NOT_MAIN_TARGET');
        if (best.darts[0].id === 'T20') {
          if (why !== undefined) violations.push(`${remaining}/${darts}: T20 始動なのに付いている`);
          continue;
        }
        count += 1;
        if (why === undefined || best.reasons[0] !== why) {
          violations.push(`${remaining}/${darts} ${best.key}: 先頭に無い`);
          continue;
        }
        const mainKeeps = canReachTenpai(remaining - 20, darts - 1);
        const saysMainLoses = why.summary.includes('ではテンパイを作れません');
        const saysBothKeep = why.summary.includes('シングルに入ってもテンパイを作れます');
        if (saysMainLoses === mainKeeps || (saysBothKeep && !mainKeeps)) {
          violations.push(`${remaining}/${darts} ${best.key}: 判定が計算と違う（${why.summary}）`);
        }
      }
    }
    expect(count).toBeGreaterThan(30);
    expect(violations).toEqual([]);
  });
});
