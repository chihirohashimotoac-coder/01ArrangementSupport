/**
 * 2026-11-01 監査フェーズ 2 / 2-1: 外れたときの説明文には、その残りのランキング 1 位を出す。
 *
 * 以前は説明専用の指標で選んでいたため、81 / 3 本 T19 → D12 の「S19 に落ちても 62」に
 * 非推奨のダブル→ダブル（D15 → D16）が出ていた。
 * 全件走査は違反を配列に集め、最後に 1 回だけ assert する（CLAUDE.md §5）。
 */
import { describe, expect, it } from 'vitest';
import { parseRoute } from '../../domain/dart';
import { MAX_CHECKOUT } from '../../domain/checkoutRules';
import { evaluateCheckoutRoute, rankCheckoutRoutes } from './checkoutRanking';

const reasonOf = (remaining: number, darts: number, ids: readonly string[], code: string) =>
  evaluateCheckoutRoute(remaining, darts, parseRoute([...ids]))!.reasons.find((reason) => reason.code === code);

describe('外れたときの説明文', () => {
  it.each([
    [['T19', 'D12'], 'S12 → D-BULL'],
    [['T15', 'D18'], 'S16 → D-BULL'],
    [['T17', 'D15'], 'S14 → D-BULL'],
  ] as const)('81 / 3 本の %j: シングルに落ちたあとはランキング 1 位の %s を示す', (ids, expected) => {
    const reason = reasonOf(81, 3, ids, 'SINGLE_MISS_SAFE')!;
    expect(reason.detail).toContain(expected);
    expect(reason.detail).not.toMatch(/D\d+ → D\d+/);
  });

  it('2〜170 × 2〜3 本の全ルート: 外れの説明に出るルートはランキング 1 位で、ダブル→ダブルでも C でもない', { timeout: 60_000 }, () => {
    const violations: string[] = [];
    const topOf = new Map<string, { text: string; discouraged: boolean }>();
    const top = (left: number, darts: number) => {
      const key = `${left}/${darts}`;
      if (!topOf.has(key)) {
        const route = rankCheckoutRoutes(left, darts)[0];
        topOf.set(key, {
          text: route?.routeText ?? '',
          // 1 位のルートが「外れると上がれない」などの弱点を持つのは、選びようのない残り（例: 2 / D1）では避けられない。
          // 説明に出してはいけないのは、非推奨の形（ダブル→ダブル）と推奨度 C のルート。
          discouraged:
            route === undefined ||
            route.grade === 'C' ||
            route.reasons.some((reason) => reason.code === 'NON_FINAL_DOUBLE'),
        });
      }
      return topOf.get(key)!;
    };
    for (let remaining = 2; remaining <= MAX_CHECKOUT; remaining += 1) {
      for (let darts = 2; darts <= 3; darts += 1) {
        for (const route of rankCheckoutRoutes(remaining, darts)) {
          const miss = route.reasons.find((reason) => reason.code === 'SINGLE_MISS_SAFE');
          const leave = miss ? /(\d+) が残ります/.exec(miss.summary)?.[1] : undefined;
          const shown = miss?.detail ? /で (.+) のチェックアウト/.exec(miss.detail)?.[1] : undefined;
          if (leave !== undefined && shown !== undefined) {
            const expected = top(Number(leave), darts - 1);
            if (shown !== expected.text || expected.discouraged) {
              violations.push(`${remaining}/${darts} ${route.key}: ${shown}（1 位 ${expected.text}）`);
            }
          }
          const neighbor = route.reasons.find((reason) => reason.code === 'NEIGHBOR_SAFE');
          for (const match of neighbor?.detail?.matchAll(/(\d+) 残りで ([^／]+)/g) ?? []) {
            const expected = top(Number(match[1]), darts - 1);
            if (match[2] !== expected.text || expected.discouraged) {
              violations.push(`${remaining}/${darts} ${route.key} 横: ${match[2]}（1 位 ${expected.text}）`);
            }
          }
        }
      }
    }
    expect(violations.slice(0, 10)).toEqual([]);
  });
});
