/**
 * SIMULATION のゲーム後レビュー。
 *
 * ## 着弾ミスと判断ミスを混同しない
 *
 * 評価するのは **INTENDED TARGET（狙い）だけ**で、実際にどこへ刺さったかは
 * 評価に使わない。T20 を狙って S5 へ飛んだのは腕の問題であって、
 * アレンジの判断ミスではない。
 *
 * ## 既存エンジンの再利用
 *
 * 判定は `engine/recovery/suggest.ts` の `suggestFor()` を通すだけで、
 * CHECKOUT / SETUP / NEXT VISIT のランキングには一切手を入れない。
 * 「正解が一意ではない」局面を不正解にしないため、推奨度 S・A（＝非常に良い代替）は
 * どちらも GOOD DECISION として扱う。
 */
import { DARTS_PER_VISIT, MAX_SETUP_REMAINING, applyDart, isBogey } from '../../domain/checkoutRules';
import { requireDart } from '../../domain/dart';
import type { RouteGrade } from '../../data/rankingRules';
import { suggestFor, type Suggestion } from '../recovery/suggest';
import { rankCheckoutRoutes } from '../ranking/checkoutRanking';
import { displayRouteText, displayTargetId } from './notation';
import {
  allThrows,
  roundScoreOf,
  type RoundRecord,
  type ScoreEntry,
  type SimulationGame,
  type ThrowRecord,
} from './game';

/** 1 投の判断に対する分類。 */
export type ThrowVerdict =
  /** その場面で推奨できる狙い。 */
  | 'GOOD_DECISION'
  /** 成立はするが、もっと良い狙いがあった。 */
  | 'BETTER_OPTION_AVAILABLE'
  /** CHECKOUT（2〜170）での判断ミス。 */
  | 'ARRANGEMENT_MISTAKE'
  /** 残りを整える場面（171〜350・上がれない 170 以下）での判断ミス。 */
  | 'SETUP_MISTAKE'
  /** 狙い通り入ると Bogey Number を作ってしまう。 */
  | 'BOGEY_CREATED'
  /** 351 以上。アレンジ判断の対象外（得点を伸ばす場面）。 */
  | 'SCORING_PHASE'
  /** 判定できなかった（データ不整合など）。 */
  | 'NOT_EVALUATED';

export const THROW_VERDICT_JA: Readonly<Record<ThrowVerdict, string>> = {
  GOOD_DECISION: 'GOOD DECISION',
  BETTER_OPTION_AVAILABLE: 'BETTER OPTION AVAILABLE',
  ARRANGEMENT_MISTAKE: 'ARRANGEMENT MISTAKE',
  SETUP_MISTAKE: 'SETUP MISTAKE',
  BOGEY_CREATED: 'BOGEY CREATED',
  SCORING_PHASE: 'SCORING',
  NOT_EVALUATED: '—',
};

export const THROW_VERDICTS: readonly ThrowVerdict[] = [
  'GOOD_DECISION',
  'BETTER_OPTION_AVAILABLE',
  'ARRANGEMENT_MISTAKE',
  'SETUP_MISTAKE',
  'BOGEY_CREATED',
  'SCORING_PHASE',
  'NOT_EVALUATED',
];

export interface ThrowReview {
  readonly record: ThrowRecord;
  readonly verdict: ThrowVerdict;
  /** 狙いに対応するルートの推奨度。該当が無ければ null。 */
  readonly grade: RouteGrade | null;
  /** 狙い通り入ったときの残り。Bust する狙いなら null。 */
  readonly intendedLeave: number | null;
  /** その場面のおすすめルート（**画面表記**へ直したもの）。 */
  readonly recommendedRouteText: string | null;
  /** おすすめルートの 1 投目。**内部 ID**（照合用。表示は `displayTargetId`）。 */
  readonly recommendedDartId: string | null;
  /** なぜそう判断したかの説明。 */
  readonly noteJa: string;
}

export interface RoundReview {
  readonly round: number;
  readonly leftBefore: number;
  readonly scored: number;
  readonly leftAfter: number;
  readonly bust: boolean;
  readonly checkout: boolean;
  /** 暗算入力の結果。入力を求めないラウンド（BUST）は null。 */
  readonly entry: ScoreEntry | null;
  readonly throws: readonly ThrowReview[];
}

export interface GameSummary {
  readonly startScore: number;
  readonly totalDarts: number;
  /** 3 ダーツ平均。BUST したラウンドの得点は 0 として数える。 */
  readonly ppr: number;
  /** 最初の 9 投の 3 ダーツ平均。9 投未満で上がった場合は投げた本数で割る。 */
  readonly first9Ppr: number;
  /** 暗算を間違えた**回数**（1 ラウンドで複数回あればそのぶん数える）。 */
  readonly calculationMissCount: number;
  readonly bustCount: number;
  /** 上がったラウンドで使った本数。上がっていなければ null。 */
  readonly checkoutDarts: number | null;
  /** 上がったラウンド開始時の残り（＝決めたフィニッシュ）。 */
  readonly checkoutScore: number | null;
  readonly checkedOut: boolean;
  /** 上限ラウンドで打ち切った。 */
  readonly abandoned: boolean;
}

export interface GameReview {
  readonly summary: GameSummary;
  readonly rounds: readonly RoundReview[];
  readonly verdictCounts: Readonly<Record<ThrowVerdict, number>>;
}

export interface ReviewOptions {
  /** MY ROUTE の得意ダブル（順位順）。ユーザー設定をそのまま渡す。 */
  readonly preferredDoubles?: readonly string[];
  /** SETUP で続けて狙う主目標。ユーザー設定をそのまま渡す。 */
  readonly mainTarget?: string;
}

/**
 * SETUP ランキングへ渡す候補数。
 *
 * 既定は 40 件だが、それは**画面に並べる件数**であって「その場面の候補の全部」では
 * ない。40 件で切ると、41 番目以降にある推奨度 S / A / B の 1 投目まで
 * 「候補に無い」と誤判定してしまう（171 の T16 → S20 → T20 は推奨度 A）。
 * レビューでは表示件数で切らず、エンジンが評価した候補をすべて受け取る。
 * エンジン側にも内部上限があるので、大きな値を渡してもそれ以上は返らない。
 */
const SETUP_REVIEW_MAX_ROUTES = 1000;

/**
 * ユーザー設定を、既存エンジンが読むオプションへ写す。
 *
 * **PracticePage とまったく同じ渡し方**にする。得意ダブルは
 * `fallbackPreferredDoubles`（NEXT VISIT だけが読む名前）で渡し、
 * `preferredDoubles` は渡さない。そうしないと STANDARD / OTHER ROUTES の
 * 順位が得意ダブルで動いてしまい、アプリが実際に表示した推奨と
 * レビューの判定がずれる。
 */
function suggestOptionsOf(options: ReviewOptions) {
  return {
    mainTarget: options.mainTarget,
    fallbackPreferredDoubles: options.preferredDoubles,
    maxRoutes: SETUP_REVIEW_MAX_ROUTES,
  };
}

/** ゲーム全体のレビューを作る。 */
export function buildGameReview(
  game: SimulationGame,
  options: ReviewOptions = {},
): GameReview {
  const rounds = game.rounds.map((round) => reviewRound(round, options));
  const verdictCounts = countVerdicts(rounds);
  return { summary: summarize(game), rounds, verdictCounts };
}

function countVerdicts(rounds: readonly RoundReview[]): Record<ThrowVerdict, number> {
  const counts = Object.fromEntries(
    THROW_VERDICTS.map((verdict) => [verdict, 0]),
  ) as Record<ThrowVerdict, number>;
  for (const round of rounds) {
    for (const item of round.throws) counts[item.verdict] += 1;
  }
  return counts;
}

function reviewRound(round: RoundRecord, options: ReviewOptions): RoundReview {
  return {
    round: round.round,
    leftBefore: round.leftBefore,
    scored: roundScoreOf(round),
    leftAfter: round.leftAfter,
    bust: round.bust,
    checkout: round.checkout,
    entry: round.entry,
    throws: round.throws.map((record) => reviewThrow(record, options)),
  };
}

/** 1 投の狙いを評価する。 */
export function reviewThrow(record: ThrowRecord, options: ReviewOptions = {}): ThrowReview {
  const dartsLeft = DARTS_PER_VISIT - (record.dartNumber - 1);
  const intended = requireDart(record.intendedDartId);
  /** 説明文に出す表記。判定は内部 ID（`record.intendedDartId`）で行う。 */
  const intendedLabel = displayTargetId(record.intendedDartId);
  const left = record.leftBefore;

  if (left > MAX_SETUP_REMAINING) {
    return {
      record,
      verdict: 'SCORING_PHASE',
      grade: null,
      intendedLeave: left - intended.score,
      recommendedRouteText: null,
      recommendedDartId: null,
      noteJa: `残り ${left} は 1 ビジットでは上がりに絡まないため、アレンジの評価対象外です（得点を伸ばす場面）。`,
    };
  }

  const outcome = applyDart(left, intended);
  const suggestion = suggestFor(left, dartsLeft, suggestOptionsOf(options));

  if (outcome.outcome === 'bust') {
    const best = bestRouteOf(suggestion);
    return {
      record,
      verdict: 'ARRANGEMENT_MISTAKE',
      grade: null,
      intendedLeave: null,
      recommendedRouteText: best?.routeText ?? null,
      recommendedDartId: best?.firstDartId ?? null,
      noteJa: bustNoteJa(left, intendedLabel, intended.score, best?.routeText ?? null),
    };
  }

  const intendedLeave = outcome.remainingAfter;
  const context = contextOf(suggestion, left, dartsLeft, options);
  const best = bestRouteOf(suggestion);
  const grade = context.gradeOfFirstDart(record.intendedDartId);

  /*
   * Bogey を作る狙いは、成立していても先に指摘する。
   *
   * ただし **ビジット最後の 1 投のときだけ**。途中の投で一時的に 159 のような
   * 残りを通っても、同じビジットの残りのダーツで作り直せるので判断ミスではない
   * （例: 219 から T20 を狙うと一度 159 を通るが、これは正しい狙い）。
   */
  if (
    dartsLeft === 1 &&
    outcome.outcome !== 'checkout' &&
    isBogey(intendedLeave) &&
    context.hasBogeyFreeAlternative
  ) {
    return {
      record,
      verdict: 'BOGEY_CREATED',
      grade,
      intendedLeave,
      recommendedRouteText: best?.routeText ?? null,
      recommendedDartId: best?.firstDartId ?? null,
      noteJa:
        `${intendedLabel} が狙い通り入ると残り ${intendedLeave} で、3 本あっても上がれないノーテンになります。` +
        (best ? `${best.routeText} なら上がり（または上がれる残り）を保てました。` : ''),
    };
  }

  /*
   * MY ROUTE（得意ダブル）に沿った狙いを不正解にしない。
   *
   * アプリは CHECKOUT で STANDARD と MY ROUTE を並べて出しているので、
   * ユーザーが MY ROUTE に従って投げたのなら、それは推奨どおりの判断。
   * 計算の仕方は PracticePage の MY ROUTE とまったく同じにする。
   */
  if (context.kind === 'checkout' && context.myRouteFirstDartId === record.intendedDartId) {
    return {
      record,
      verdict: 'GOOD_DECISION',
      grade,
      intendedLeave,
      recommendedRouteText: best?.routeText ?? null,
      recommendedDartId: best?.firstDartId ?? null,
      noteJa: '得意ダブルの設定（MY ROUTE）に沿った狙いです。',
    };
  }

  if (grade === 'S' || grade === 'A') {
    return {
      record,
      verdict: 'GOOD_DECISION',
      grade,
      intendedLeave,
      recommendedRouteText: best?.routeText ?? null,
      recommendedDartId: best?.firstDartId ?? null,
      noteJa: `${context.label}として推奨できる狙いです（推奨度 ${grade}）。`,
    };
  }

  if (grade === 'B') {
    return {
      record,
      verdict: 'BETTER_OPTION_AVAILABLE',
      grade,
      intendedLeave,
      recommendedRouteText: best?.routeText ?? null,
      recommendedDartId: best?.firstDartId ?? null,
      noteJa:
        `${intendedLabel} でも成立しますが、${context.label}としてはより良い狙いがありました。` +
        (best ? `おすすめは ${best.routeText}（${best.reasonJa ?? '推奨度 S'}）。` : ''),
    };
  }

  const mistake: ThrowVerdict = context.kind === 'checkout' ? 'ARRANGEMENT_MISTAKE' : 'SETUP_MISTAKE';
  if (grade === 'C') {
    return {
      record,
      verdict: mistake,
      grade,
      intendedLeave,
      recommendedRouteText: best?.routeText ?? null,
      recommendedDartId: best?.firstDartId ?? null,
      noteJa:
        `${intendedLabel} は成立はしますが、${context.label}としては非推奨です。` +
        (best ? `おすすめは ${best.routeText}（${best.reasonJa ?? '推奨度 S'}）。` : ''),
    };
  }

  // 候補のどれとも一致しない狙い。
  if (!context.hasCandidates) {
    return {
      record,
      verdict: 'NOT_EVALUATED',
      grade: null,
      intendedLeave,
      recommendedRouteText: null,
      recommendedDartId: null,
      noteJa: suggestion.unavailableReason ?? 'この場面は判定の対象外です。',
    };
  }

  /*
   * 候補一覧に無いことを「ミス」と読み替えてよいのは、その一覧が
   * **その場面の全候補を尽くしている**ときだけ。
   *
   * CHECKOUT（2〜170 で上がれる場面）のランキングは全ルートの列挙なので、
   * 一覧に無い＝その 1 投目から上がる組み立てが存在しない、と言い切れる。
   *
   * 一方 SETUP / NEXT VISIT の候補は、承認済みの戦術のふるい（得点用トリプル
   * 始動など）と件数の上限を通ったあとの一覧で、盤面の全 62 通りを評価した
   * ものではない。ここで「一覧に無いから SETUP MISTAKE」と言うと、
   * エンジンが評価していない狙いまで不正解にしてしまう。
   * 断定はせず、アプリならどう組み立てたかだけを示す。
   */
  if (!context.isExhaustive) {
    return {
      record,
      verdict: 'NOT_EVALUATED',
      grade: null,
      intendedLeave,
      recommendedRouteText: best?.routeText ?? null,
      recommendedDartId: best?.firstDartId ?? null,
      noteJa:
        `${intendedLabel} は${context.label}の候補一覧に無いため、良し悪しは断定していません` +
        `（狙い通りだと残り ${intendedLeave}）。` +
        (best ? `アプリのおすすめは ${best.routeText} でした。` : ''),
    };
  }

  return {
    record,
    verdict: mistake,
    grade: null,
    intendedLeave,
    recommendedRouteText: best?.routeText ?? null,
    recommendedDartId: best?.firstDartId ?? null,
    noteJa:
      `${intendedLabel} からは、この ${dartsLeft} 本で上がる組み立てがありません` +
      `（狙い通りだと残り ${intendedLeave}）。` +
      (best ? `おすすめは ${best.routeText}（${best.reasonJa ?? '推奨度 S'}）。` : ''),
  };
}

interface RouteSummary {
  readonly routeText: string;
  readonly firstDartId: string;
  readonly reasonJa: string | null;
}

function bestRouteOf(suggestion: Suggestion): RouteSummary | null {
  const checkout = suggestion.checkoutRoutes[0];
  if (checkout !== undefined) {
    return {
      routeText: displayRouteText(checkout.routeText),
      firstDartId: checkout.darts[0].id,
      reasonJa: checkout.reasons[0]?.summary ?? null,
    };
  }
  const nextVisit = suggestion.nextVisitProposals[0]?.route;
  if (nextVisit !== undefined) {
    return {
      routeText: displayRouteText(nextVisit.routeText),
      firstDartId: nextVisit.darts[0].id,
      reasonJa: `残り ${nextVisit.leave} を作る`,
    };
  }
  const setup = suggestion.setupRoutes[0];
  if (setup !== undefined) {
    return {
      routeText: displayRouteText(setup.routeText),
      firstDartId: setup.darts[0].id,
      reasonJa: `残り ${setup.leave} を作る`,
    };
  }
  return null;
}

interface VerdictContext {
  readonly kind: 'checkout' | 'setup';
  readonly label: string;
  readonly hasCandidates: boolean;
  /**
   * 候補一覧がその場面の**全候補を尽くしている**か。
   *
   * CHECKOUT のランキングは全ルートの列挙なので true。
   * SETUP / NEXT VISIT は戦術のふるいと件数上限を通った一覧なので false。
   * 「一覧に無い＝ミス」と読み替えてよいのは true のときだけ。
   */
  readonly isExhaustive: boolean;
  /** 狙いを 1 投目に持つルートのうち、最も良い推奨度。 */
  gradeOfFirstDart(dartId: string): RouteGrade | null;
  /** Bogey を作らない選択肢が他にあるか。 */
  readonly hasBogeyFreeAlternative: boolean;
  /** MY ROUTE の 1 投目（CHECKOUT で得意ダブルを設定しているときだけ）。 */
  readonly myRouteFirstDartId: string | null;
}

function contextOf(
  suggestion: Suggestion,
  remaining: number,
  dartsLeft: number,
  options: ReviewOptions,
): VerdictContext {
  const { checkoutRoutes, setupRoutes, nextVisitProposals } = suggestion;

  if (checkoutRoutes.length > 0) {
    return {
      kind: 'checkout',
      label: 'この 3 投で上がる形',
      hasCandidates: true,
      isExhaustive: true,
      gradeOfFirstDart: (dartId) => bestGrade(checkoutRoutes, dartId),
      hasBogeyFreeAlternative: true,
      myRouteFirstDartId: myRouteFirstDartOf(remaining, dartsLeft, options),
    };
  }

  if (nextVisitProposals.length > 0) {
    const routes = nextVisitProposals.map((proposal) => proposal.route);
    return {
      kind: 'setup',
      label: '次のラウンドへ残す形',
      hasCandidates: true,
      isExhaustive: false,
      gradeOfFirstDart: (dartId) => bestGrade(routes, dartId),
      hasBogeyFreeAlternative: routes.some((route) => !isBogey(route.leave)),
      myRouteFirstDartId: null,
    };
  }

  if (setupRoutes.length > 0) {
    return {
      kind: 'setup',
      label: '次の 3 投へ向けて整える形',
      hasCandidates: true,
      isExhaustive: false,
      gradeOfFirstDart: (dartId) => bestGrade(setupRoutes, dartId),
      hasBogeyFreeAlternative: setupRoutes.some((route) => !isBogey(route.leave)),
      myRouteFirstDartId: null,
    };
  }

  return {
    kind: suggestion.mode === 'setup' ? 'setup' : 'checkout',
    label: 'この場面',
    hasCandidates: false,
    isExhaustive: false,
    gradeOfFirstDart: () => null,
    hasBogeyFreeAlternative: false,
    myRouteFirstDartId: null,
  };
}

/**
 * MY ROUTE の 1 投目。PracticePage の MY ROUTE とまったく同じ計算をする
 * （得意ダブルを優先し、基準ルート加点を外して並べ替える）。
 */
function myRouteFirstDartOf(
  remaining: number,
  dartsLeft: number,
  options: ReviewOptions,
): string | null {
  const preferred = options.preferredDoubles ?? [];
  if (preferred.length === 0) return null;
  const ranked = rankCheckoutRoutes(remaining, dartsLeft, {
    preferredDoubles: preferred,
    applyStandardBonus: false,
  });
  return ranked[0]?.darts[0]?.id ?? null;
}

const GRADE_ORDER: Readonly<Record<RouteGrade, number>> = { S: 3, A: 2, B: 1, C: 0 };

function bestGrade(
  routes: ReadonlyArray<{ readonly darts: ReadonlyArray<{ readonly id: string }>; readonly grade: RouteGrade }>,
  dartId: string,
): RouteGrade | null {
  let best: RouteGrade | null = null;
  for (const route of routes) {
    if (route.darts[0]?.id !== dartId) continue;
    if (best === null || GRADE_ORDER[route.grade] > GRADE_ORDER[best]) best = route.grade;
  }
  return best;
}

function bustNoteJa(
  left: number,
  intendedNameJa: string,
  score: number,
  recommended: string | null,
): string {
  const leave = left - score;
  const reason =
    leave < 0
      ? `残り ${left} を超えるため Bust です`
      : leave === 1
        ? '残り 1 になり Bust です'
        : 'ダブルで上がっていないため Bust です';
  return (
    `${intendedNameJa} が狙い通り入ると ${reason}。` +
    (recommended ? `おすすめは ${recommended}。` : '')
  );
}

function summarize(game: SimulationGame): GameSummary {
  const rounds = game.rounds;
  const throws = allThrows(game);
  const totalDarts = throws.length;
  const scoredTotal = rounds.reduce((sum, round) => sum + round.scored, 0);

  const countedByDartIndex = new Map<number, number>();
  for (const round of rounds) {
    for (const record of round.throws) {
      countedByDartIndex.set(record.dartIndex, round.bust ? 0 : record.score);
    }
  }
  const first9Count = Math.min(9, totalDarts);
  let first9Total = 0;
  for (let index = 1; index <= first9Count; index += 1) {
    first9Total += countedByDartIndex.get(index) ?? 0;
  }

  const last = rounds[rounds.length - 1];
  const checkedOut = last?.checkout === true;

  return {
    startScore: game.settings.startScore,
    totalDarts,
    ppr: totalDarts > 0 ? (scoredTotal / totalDarts) * 3 : 0,
    first9Ppr: first9Count > 0 ? (first9Total / first9Count) * 3 : 0,
    // 間違えた入力の**回数**で数える（1 ラウンドで複数回あればそのぶん）。
    calculationMissCount: rounds.reduce(
      (sum, round) => sum + (round.entry?.wrongEntries.length ?? 0),
      0,
    ),
    bustCount: rounds.filter((round) => round.bust).length,
    checkoutDarts: checkedOut ? last.throws.length : null,
    checkoutScore: checkedOut ? last.leftBefore : null,
    checkedOut,
    abandoned: game.abandoned,
  };
}
