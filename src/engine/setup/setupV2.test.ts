/**
 * 戦術 v2（2026-11-01 オーナー承認 / docs/APPROVALS.md A-29）の SETUP 回帰テスト。
 *
 *   - ビジット最後の 1 投が縦ズレしてもテンパイが残るルートを加点する（+40）
 *   - 同点のときは主目標（既定 T20）から始まるルートを先にする
 *
 * 期待値は `npm run audit:tactics-v2` の差分表（docs/reports/tactics-v2-diff.md §2-2、案 A）。
 * 全件走査は違反を配列に集め、最後に 1 回だけ assert する（CLAUDE.md §5）。
 */
import { describe, expect, it } from 'vitest';
import { findDart } from '../../domain/dart';
import { rankSetupRoutes } from './enumerate';
import { lastDartMissKeepsTenpai } from './tenpai';

const topOf = (remaining: number, darts: number) => rankSetupRoutes(remaining, darts, { maxRoutes: 1 })[0];

describe('A-29: 最後の 1 投の縦ズレ', () => {
  it.each([
    [192, 1, 'BULL'],
    [195, 1, 'BULL'],
    [200, 1, 'D20'],
    [302, 3, 'T18-T20-S18'],
    [303, 3, 'T19-T19-S19'],
    [306, 3, 'T19-T20-S19'],
    [309, 3, 'T19-T19-BULL'],
    [312, 3, 'T20-T20-BULL'],
    [320, 3, 'T20-T20-D20'],
    [330, 3, 'T20-T20-BULL'],
    [304, 3, 'T20-T20-S20'],
    [307, 3, 'T20-T20-S20'],
  ] as const)('%i / %i 本の第 1 候補は %s', (remaining, darts, key) => {
    expect(topOf(remaining, darts).key).toBe(key);
  });

  it('192 / 1 本の D-BULL は、S-BULL へ外れても 167 が残ることを理由に示す', () => {
    const top = topOf(192, 1);
    expect(top.reasons.map((reason) => reason.code)).toContain('SETUP_LAST_DART_MISS_KEEPS_TENPAI');
  });

  it('縦ズレの判定: T は同じナンバーの S、D は S と盤外、S は T と D、D-BULL は S-BULL', () => {
    const dart = (id: string) => findDart(id)!;
    // 182 から S18 を狙い、T18（54）→ 128 / D18（36）→ 146 のどちらもテンパイ。
    expect(lastDartMissKeepsTenpai(182, dart('S18'))).toBe(true);
    // 192 から D16 を狙い、盤外（0）なら 192 が残りテンパイではない。
    expect(lastDartMissKeepsTenpai(192, dart('D16'))).toBe(false);
    // 192 から D-BULL を狙い、S-BULL（25）なら 167 が残る。
    expect(lastDartMissKeepsTenpai(192, dart('BULL'))).toBe(true);
    // S-BULL は縦ズレの対象にしない。
    expect(lastDartMissKeepsTenpai(200, dart('SB'))).toBe(false);
  });
});

describe('A-29: 同点は主目標から始める', () => {
  it('171〜350 × 1〜3 本で、第 1 候補と同点の主目標始動ルートがあれば、第 1 候補は主目標から始まる', () => {
    const violations: string[] = [];
    for (let remaining = 171; remaining <= 350; remaining += 1) {
      for (let darts = 2; darts <= 3; darts += 1) {
        const routes = rankSetupRoutes(remaining, darts);
        const [top] = routes;
        const tiedMain = routes.find(
          (route) => route.score === top.score && route.darts[0].id === 'T20',
        );
        if (tiedMain !== undefined && top.darts[0].id !== 'T20') {
          violations.push(`${remaining}/${darts} ${top.key} (${tiedMain.key})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
