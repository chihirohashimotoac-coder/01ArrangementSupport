/**
 * 狙いどおりに入っているあいだは、ビジット開始時の計画を推奨として続ける
 * （戦術 v2 / 2026-11-01 オーナー承認 / docs/APPROVALS.md A-32）。
 *
 * 1 投ごとに「いまの残り・本数」だけで再計算すると、狙いどおりに入っているのに
 * 次の推奨が計画と変わることがある（例: 107 / 3 本 T19 → S10 → D20 で T19 に入ると、
 * 50 / 2 本の第 1 候補は S18 → D16）。投げている本人から見ると、計画どおりなのに
 * 狙いが変わるのは混乱のもとなので、計画の残りを推奨とし、再計算の第 1 候補は
 * 「別例」として並べる。外れたら（Dart ID が 1 つでも違ったら）従来どおり再計算に戻る。
 *
 * - 計画は「ビジット開始時の残り・本数に対する第 1 候補」で、状態として持たずに毎回導く。
 *   そのため Undo・Bust・別ビジット・残り点の書き換えのあとに古い計画が残らない。
 * - CHECKOUT / SETUP / NEXT VISIT の順位そのものは変えない。ここは表示の選び方だけ。
 * - SETUP の計画は、残りが 170 以下（NEXT VISIT）へ入っても続く。開始残りが 171 以上なら
 *   3 本以内で上がることはないので、計画の途中で CHECKOUT が成立して食い違うことはない。
 */
import { suggestFor, type SuggestOptions, type Suggestion } from './suggest';
import type { VisitState } from './visit';

/**
 * その提案で、盤面・NEXT に出す推奨の並び（Dart ID）。
 *
 * 画面（PracticePage）の既定の答えと同じ優先順にする:
 *   SETUP: 最後の 1 本の実戦推奨 → BEST
 *   CHECKOUT: 基準ルート（無ければ第 1 候補）→ 最後の 1 本の実戦推奨 → NEXT VISIT
 */
export function recommendedDartIdsOf(suggestion: Suggestion): readonly string[] | null {
  if (suggestion.mode === 'setup') {
    if (suggestion.practicalLastDart !== null) return [suggestion.practicalLastDart.dartId];
    return suggestion.setupRoutes[0]?.darts.map((dart) => dart.id) ?? null;
  }
  if (suggestion.mode !== 'checkout') return null;
  const standard =
    suggestion.checkoutRoutes.find((route) => route.isStandard) ?? suggestion.checkoutRoutes[0];
  if (standard !== undefined) return standard.darts.map((dart) => dart.id);
  if (suggestion.practicalLastDart !== null) return [suggestion.practicalLastDart.dartId];
  return suggestion.nextVisitRoute?.darts.map((dart) => dart.id) ?? null;
}

export interface VisitPlanFollow {
  /** ビジット開始時の第 1 候補（計画）全体。 */
  readonly planDartIds: readonly string[];
  /** 計画の残り。狙いどおりに入っているあいだの推奨。 */
  readonly remainingDartIds: readonly string[];
  /**
   * いまの残り・本数で再計算した推奨。計画の残りと同じなら null。
   * 違うときは「別例（推奨ではありません）」として表示する。
   */
  readonly alternativeDartIds: readonly string[] | null;
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * 計画どおりに進んでいれば、計画の残りと再計算の結果を返す。
 * まだ 1 投も投げていない・外した・ビジットが終わった場合は null（従来どおりの表示）。
 *
 * @param current いまの残り・本数に対する提案（画面がすでに持っているもの）。
 *   省略すると、ここで計算し直す。
 */
export function followVisitPlan(
  visit: VisitState | null,
  options: SuggestOptions = {},
  current?: Suggestion | null,
): VisitPlanFollow | null {
  if (visit === null || visit.status !== 'in-progress' || visit.dartsLeft <= 0) return null;
  const thrownCount = visit.thrown.length;
  if (thrownCount === 0) return null;

  const plan = recommendedDartIdsOf(
    suggestFor(visit.visitStartRemaining, visit.initialDartsLeft, options),
  );
  if (plan === null || thrownCount >= plan.length) return null;
  for (let index = 0; index < thrownCount; index += 1) {
    if (visit.thrown[index].dart.id !== plan[index]) return null;
  }

  const remainingDartIds = plan.slice(thrownCount);
  const recomputed = recommendedDartIdsOf(
    current ?? suggestFor(visit.remaining, visit.dartsLeft, options),
  );
  return {
    planDartIds: plan,
    remainingDartIds,
    alternativeDartIds:
      recomputed === null || sameIds(recomputed, remainingDartIds) ? null : recomputed,
  };
}
