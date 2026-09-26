/**
 * ゲームの振り返りを「次の練習へ持ち込める形」にまとめる（**表示用の集計だけ**）。
 *
 * 1 投ごとの判定（`review.ts` の `reviewThrow`）はそのまま使い、ここでは
 * 判定を変えずに **並べ替えて代表を選ぶ** だけにする。
 *
 * - 改善ポイントは最大 1 件。優先順は
 *   `BOGEY_CREATED` ＞ `ARRANGEMENT_MISTAKE` / `SETUP_MISTAKE` ＞ `BETTER_OPTION_AVAILABLE`。
 *   同じ順位なら、早いビジット・早い投を先にする。
 * - 良かった判断も最大 1 件。ゲームの**最後に近い**良い判断を選ぶ
 *   （上がりに近い場面ほど、次のゲームでも同じ形が出やすいため。表示の方針であって、
 *   良い判断どうしの優劣を決めるものではない）。
 * - `SCORING_PHASE`（得点を伸ばす場面）と `NOT_EVALUATED`（判定対象外）は、
 *   良い・改善のどちらの件数にも入れない。
 * - 改善候補には、次の 2 つを**区別して**添える（v1.4.8）。
 *   1. 振り返りが今回の判断と比べた代案（`ThrowReview.comparison`。判定の根拠から作った構造化データ）
 *   2. その場面のアプリの第 1 案（CHECKOUT / NEXT VISIT が表示したルート。`recommendedRouteText`）
 *   第 1 案が今回の狙いと同じ 1 投目のときは、改善案ではないことを添える。
 *   最後の1本で基準例と実戦推奨が分かれるときは、実戦推奨を第1案にする。
 *   説明文（`noteJa`）を解析して代案を取り出すことはしない。
 */
import { DARTS_PER_VISIT } from '../../domain/checkoutRules';
import {
  describeReviewComparisonTargetJa,
  renderAppFirstProposalLineJa,
  renderReviewComparisonLineJa,
  type AppFirstProposalRelation,
} from '../../data/explanations';
import { MAX_ROUNDS } from './game';
import { displayTargetId } from './notation';
import {
  type GameReview,
  type GameSummary,
  type ReviewComparison,
  type RoundReview,
  type ThrowReview,
  type ThrowVerdict,
} from './review';

/**
 * 改善候補に添える「振り返りが比べた代案」と「アプリの第 1 案」（v1.4.8）。
 *
 * 2 つは別物として並べる。代案は判定の根拠そのもので、狙いと同じ 1 投目にはならない。
 * アプリの第 1 案は、その場面で CHECKOUT / NEXT VISIT が表示したルート（事実）で、
 * 今回の狙いと同じ 1 投目のこともある。
 */
export interface FocusSuggestions {
  /** 振り返りが比べた代案（構造化データ）。無ければ null。 */
  readonly comparison: ReviewComparison | null;
  /** アプリの第 1 案と、今回の狙い・代案との関係。第 1 案が無ければ null。 */
  readonly appFirstRelation: AppFirstProposalRelation | null;
  /** 画面に出す「振り返りが比べた代案」の行。 */
  readonly comparisonLineJa: string;
  /** 画面に出す「この場面のアプリの第 1 案」の行。代案と同じ・第 1 案が無ければ null。 */
  readonly appFirstLineJa: string | null;
}

/** 1 投と、それが属するビジット。 */
export interface ThrowFocus {
  readonly round: RoundReview;
  readonly review: ThrowReview;
  /** 改善候補のときだけ意味を持つ（良かった判断では null）。 */
  readonly suggestions: FocusSuggestions | null;
}

export interface ReviewHighlights {
  /** 良かった判断（最大 1 件）。無ければ null。 */
  readonly good: ThrowFocus | null;
  /** 最も直す価値のある判断（最大 1 件）。無ければ null。 */
  readonly improvement: ThrowFocus | null;
  /** 改善候補のすべて（優先順）。先頭は `improvement` と同じ。 */
  readonly improvements: readonly ThrowFocus[];
  /** 採点した狙いの数（良い判断 + 改善候補）。 */
  readonly evaluatedCount: number;
  readonly goodCount: number;
  readonly improvementCount: number;
  /** 得点を伸ばす場面（採点していない）。 */
  readonly scoringCount: number;
  /** 判定対象外（良し悪しを断定していない）。 */
  readonly notEvaluatedCount: number;
  /** 次のゲームで意識すること（1 文）。 */
  readonly nextFocusJa: string;
}

/** 改善候補の優先順位。小さいほど先に出す。改善候補でない分類は含めない。 */
export const IMPROVEMENT_PRIORITY: Readonly<Partial<Record<ThrowVerdict, number>>> = {
  BOGEY_CREATED: 0,
  ARRANGEMENT_MISTAKE: 1,
  SETUP_MISTAKE: 1,
  BETTER_OPTION_AVAILABLE: 2,
};

/**
 * 改善候補ごとの「次のゲームで意識すること」。
 *
 * 判定の分類を言い換えるだけにし、**分類の中身より細かい理由は書かない**。
 * `BETTER_OPTION_AVAILABLE` や `*_MISTAKE` は理由がさまざまで（シングル落ち・
 * 基準ルートとの差・隣接リスクなど）、1 つに決め打ちすると、その投とは関係のない
 * 規則を教えてしまう（例: 残り 5 の S3 は基準ルート S1 → D2 との比較で劣るのであって、
 * 外れたときの残りが理由ではない）。具体的な理由は、取り上げた投の説明文に任せる。
 * `BOGEY_CREATED` だけは分類そのものが理由なので、それを書く。
 */
const NEXT_FOCUS_JA: Readonly<Record<'BOGEY_CREATED' | 'ARRANGEMENT_MISTAKE' | 'SETUP_MISTAKE' | 'BETTER_OPTION_AVAILABLE', string>> = {
  BOGEY_CREATED:
    'ビジット最後の 1 投は、狙い通りに入ってもボギー（次の 3 投で上がれない残り）にならない的を選ぶ。',
  ARRANGEMENT_MISTAKE:
    '上がれる残りでは、狙う前に、この 3 投で上がる形をほかの候補と比べる（今回の理由は改善ポイントの説明を参照）。',
  SETUP_MISTAKE:
    'まだ上がれない残りでは、次のビジットへ残す形をほかの候補と比べてから選ぶ（今回の理由は改善ポイントの説明を参照）。',
  BETTER_OPTION_AVAILABLE:
    '成立する狙いでも、そこで決めずにほかの候補と比べてから選ぶ（今回の理由は改善ポイントの説明を参照）。',
};

export function buildReviewHighlights(review: GameReview): ReviewHighlights {
  const all = review.rounds.flatMap((round) =>
    round.throws.map((item) => ({ round, review: item })),
  );

  const improvements: ThrowFocus[] = all
    .filter((focus) => IMPROVEMENT_PRIORITY[focus.review.verdict] !== undefined)
    .map((focus) => ({ ...focus, suggestions: suggestionsOf(focus.review) }))
    .sort(
      (a, b) =>
        (IMPROVEMENT_PRIORITY[a.review.verdict] ?? 0) -
          (IMPROVEMENT_PRIORITY[b.review.verdict] ?? 0) ||
        a.review.record.dartIndex - b.review.record.dartIndex,
    );
  const goods: ThrowFocus[] = all
    .filter((focus) => focus.review.verdict === 'GOOD_DECISION')
    .map((focus) => ({ ...focus, suggestions: null }));

  const count = (verdict: ThrowVerdict) => review.verdictCounts[verdict];
  const improvement = improvements[0] ?? null;
  const good = goods[goods.length - 1] ?? null;
  const evaluatedCount = goods.length + improvements.length;

  return {
    good,
    improvement,
    improvements,
    evaluatedCount,
    goodCount: goods.length,
    improvementCount: improvements.length,
    scoringCount: count('SCORING_PHASE'),
    notEvaluatedCount: count('NOT_EVALUATED'),
    nextFocusJa: nextFocusOf(improvement, evaluatedCount),
  };
}

/**
 * 改善候補に添える 2 行を、構造化データから組み立てる（判定は変えない）。
 *
 * - 代案は `ThrowReview.comparison` をそのまま使う（エンジンの第 1 案なら、そのルート表記）。
 * - アプリの第 1 案は `recommendedRouteText`。今回の狙いと同じ 1 投目なら、その旨を添える。
 *   代案と同じ 1 投目なら、代案の行にまとめて 2 回は出さない。
 */
export function suggestionsOf(review: ThrowReview): FocusSuggestions {
  const comparison = review.comparison;
  const routeText = review.recommendedRouteText;
  const firstDartId = review.recommendedDartId;
  const appFirstRelation: AppFirstProposalRelation | null =
    routeText === null || firstDartId === null
      ? null
      : firstDartId === review.record.intendedDartId
        ? 'SAME_AS_INTENDED'
        : comparison !== null && comparison.dartIds[0] === firstDartId
          ? 'SAME_AS_COMPARISON'
          : 'DIFFERENT';
  const comparisonText =
    comparison === null
      ? null
      : comparison.basis === 'APP_ROUTE' && routeText !== null
        ? routeText
        : comparison.dartIds.length > 1
          ? comparison.dartIds.map(displayTargetId).join(' → ')
          : describeReviewComparisonTargetJa({
              label: displayTargetId(comparison.dartIds[0]),
              leaveOnHit: comparison.leaveOnHit,
              missLabel: comparison.missDartId === null ? null : displayTargetId(comparison.missDartId),
              leaveOnSingleMiss: comparison.leaveOnSingleMiss,
            });
  return {
    comparison,
    appFirstRelation,
    comparisonLineJa: renderReviewComparisonLineJa({
      text: comparisonText,
      sameAsAppFirst: appFirstRelation === 'SAME_AS_COMPARISON',
    }),
    appFirstLineJa:
      routeText === null || appFirstRelation === null
        ? null
        : renderAppFirstProposalLineJa({ routeText, relation: appFirstRelation }),
  };
}

function nextFocusOf(improvement: ThrowFocus | null, evaluatedCount: number): string {
  if (improvement !== null) {
    const verdict = improvement.review.verdict as keyof typeof NEXT_FOCUS_JA;
    return NEXT_FOCUS_JA[verdict];
  }
  if (evaluatedCount === 0) {
    return '今回は採点できた狙いがありませんでした。上がりまで続くゲームで、もう一度試してください。';
  }
  return '採点できた狙いに見直す点はありませんでした。同じ考え方で、同じ条件をもう一度試してください。';
}

/** その投を投げる直前に残っていた本数（その投を含む）。 */
export function dartsLeftBefore(review: ThrowReview): number {
  return DARTS_PER_VISIT - (review.record.dartNumber - 1);
}

/**
 * ゲームの結果の 1 行（開始点数は画面側で前に置く）。
 *
 * 上限ビジットで打ち切ったゲームを、上がったゲームと同じ言い方にしない。
 */
export function describeGameResultJa(summary: GameSummary): string {
  if (summary.checkedOut) return '上がりました（CHECKOUT）。';
  if (summary.abandoned) {
    return `${MAX_ROUNDS} ビジットに達したため終了しました（上がっていない・未完了）。`;
  }
  return 'まだ上がっていません。';
}
