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
 * - 代案は、その投を投げる直前の残りと残り本数で求めた既存の
 *   `recommendedRouteText` だけを使う。無ければ作らない。
 *   ただし、その 1 投目を**同じ場面で振り返りにかけても「良い判断」になる**ときだけ出す。
 *   ビジット最後の 1 投は、振り返りがエンジンの第 1 候補とは別の軸（シングル落ちでも
 *   テンパイを保てるか）で評価するため、第 1 候補がそのまま代案にならないことがある
 *   （例: 残り 178 の最後の 1 投。第 1 候補は S18 だが、振り返りは T18 を勧める）。
 *   食い違う代案を並べず、説明文の中の例に任せる。
 */
import { DARTS_PER_VISIT } from '../../domain/checkoutRules';
import { MAX_ROUNDS } from './game';
import {
  reviewThrow,
  type GameReview,
  type GameSummary,
  type ReviewOptions,
  type RoundReview,
  type ThrowReview,
  type ThrowVerdict,
} from './review';

/**
 * 代案の出し方。
 *
 * - `route`: アプリのおすすめ（`text`）をそのまま出す。
 * - `in-note`: 第 1 候補が振り返りの評価と食い違うので出さない（説明文の例を見てもらう）。
 * - `none`: 代案が無い。作らない。
 */
export type Alternative =
  | { readonly kind: 'route'; readonly text: string }
  | { readonly kind: 'in-note' }
  | { readonly kind: 'none' };

/** 1 投と、それが属するビジット。 */
export interface ThrowFocus {
  readonly round: RoundReview;
  readonly review: ThrowReview;
  /** 改善候補のときだけ意味を持つ。 */
  readonly alternative: Alternative;
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

export function buildReviewHighlights(
  review: GameReview,
  options: ReviewOptions = {},
): ReviewHighlights {
  const all = review.rounds.flatMap((round) =>
    round.throws.map((item) => ({ round, review: item })),
  );

  const improvements: ThrowFocus[] = all
    .filter((focus) => IMPROVEMENT_PRIORITY[focus.review.verdict] !== undefined)
    .map((focus) => ({ ...focus, alternative: alternativeOf(focus.review, options) }))
    .sort(
      (a, b) =>
        (IMPROVEMENT_PRIORITY[a.review.verdict] ?? 0) -
          (IMPROVEMENT_PRIORITY[b.review.verdict] ?? 0) ||
        a.review.record.dartIndex - b.review.record.dartIndex,
    );
  const goods: ThrowFocus[] = all
    .filter((focus) => focus.review.verdict === 'GOOD_DECISION')
    .map((focus) => ({ ...focus, alternative: { kind: 'none' } }));

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
 * 代案を出してよいか。
 *
 * 判定は変えない。アプリのおすすめの 1 投目を、同じ場面（残り・何投目）で
 * `reviewThrow` にかけて「良い判断」になるときだけ代案として出す。
 */
function alternativeOf(item: ThrowReview, options: ReviewOptions): Alternative {
  const text = item.recommendedRouteText;
  const firstDartId = item.recommendedDartId;
  if (text === null || firstDartId === null) return { kind: 'none' };
  if (firstDartId === item.record.intendedDartId) return { kind: 'in-note' };
  const asAlternative = reviewThrow({ ...item.record, intendedDartId: firstDartId }, options);
  return asAlternative.verdict === 'GOOD_DECISION' ? { kind: 'route', text } : { kind: 'in-note' };
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
