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
 *
 * ## ビジット最後の 1 投だけは、別の軸を足す
 *
 * 残り 1 投で「次のラウンドへ残す形」を作る場面は、ランキングの推奨度だけでは
 * 足りない。推奨度は**狙い通り入ったときの残り点の質**で決まるので、
 * 残り 178 では T19（シングル落ちで 159 の Bogey）と T20 / T18
 * （シングル落ちでもテンパイ）が同じ推奨度 B に並ぶ。
 *
 * そこで残り 1 投の SETUP 側だけ、`lastDartSetup.ts` の
 * 「次のラウンドに 3 本で上がれる数字を作れるか」を主軸にする。
 * **エンジンは変更していない**（レビューの分類方針だけをこの層で足している）。
 * 160・170 のような特定の残り点を特別扱いはせず、条件を満たすターゲットは
 * どれも GOOD DECISION として扱う。
 *
 * ## 表現の強さ
 *
 * 学習用途のモードなので、悪い選択は悪いと分かる言い方にする。
 * 「成立する」と「良い選択」を区別し、何がどう悪いのか・次にどう考えるかを
 * 短く書く。罵倒や煽りは書かない。
 */
import { DARTS_PER_VISIT, MAX_SETUP_REMAINING, applyDart, isBogey } from '../../domain/checkoutRules';
import { requireDart } from '../../domain/dart';
import type { RouteGrade } from '../../data/rankingRules';
import { suggestFor, type Suggestion } from '../recovery/suggest';
import { rankCheckoutRoutes } from '../ranking/checkoutRanking';
import { displayRouteText, displayTargetId } from './notation';
import {
  analyzeLastDartSetup,
  recommendedLastDartTargets,
  type LastDartOption,
} from './lastDartSetup';
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
   * ビジット最後の 1 投で「次のラウンドへ残す形」を作る場面は、
   * 推奨度ではなく「次のラウンドに 3 本で上がれる数字を作れるか」を主軸にする。
   * 判定できない場面（テンパイを作れない残り点・BULL 狙い・ダブル狙い）は
   * null が返り、従来どおり推奨度で判定する。
   */
  if (context.kind === 'setup' && dartsLeft === 1) {
    const lastDart = lastDartSetupReview(record, left, intendedLabel, grade, best);
    if (lastDart !== null) return lastDart;
  }

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
        `この選択で Bogey Number（残り ${intendedLeave}）を作っています。` +
        `狙い通りに入っても 3 本あって上がれないノーテンで、次のラウンドの Checkout 機会を失います。` +
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
        `成立はしますが、良い選択ではありません。${intendedLabel} は${context.label}として明確に劣ります` +
        `（狙い通りだと残り ${intendedLeave}）。` +
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
        `この選択は不適切です。${intendedLabel} は成立はしますが、${context.label}としては非推奨で` +
        `（狙い通りだと残り ${intendedLeave}）、この 1 投を活かせていません。` +
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
      `この選択は不適切です。${intendedLabel} からは、この ${dartsLeft} 本で上がる組み立てがありません` +
      `（狙い通りだと残り ${intendedLeave}）。上がれる場面を自分から捨てています。` +
      (best ? `おすすめは ${best.routeText}（${best.reasonJa ?? '推奨度 S'}）。` : ''),
  };
}

/**
 * ビジット最後の 1 投で「次のラウンドへ残す形」を作る場面の判定。
 *
 * 判定できるときだけ `ThrowReview` を返し、判定しない場面は null を返して
 * 従来どおり推奨度で判定させる。null を返すのは次の場合。
 *
 * - この 1 投ではどの的でもテンパイを作れない残り点（そもそも比べる軸が無い）
 * - BULL 狙い（外した 1 投の落ち先を「同ナンバーのシングル」と決められない）
 * - ダブル狙い（SETUP の得点手段として選ぶ的ではないので、この観点で
 *   良い判断へ引き上げない。悪い場合は従来の判定がそのまま拾う）
 */
function lastDartSetupReview(
  record: ThrowRecord,
  left: number,
  intendedLabel: string,
  grade: RouteGrade | null,
  best: RouteSummary | null,
): ThrowReview | null {
  const analysis = analyzeLastDartSetup(left);
  if (!analysis.hasTenpaiTargets) return null;

  const option = analysis.optionFor(record.intendedDartId);
  if (option === null) return null;
  if (option.leaveOnSingleMiss === null) return null;
  if (option.dart.kind === 'double') return null;

  const base = {
    record,
    grade,
    intendedLeave: option.leaveOnHit,
    recommendedRouteText: best?.routeText ?? null,
    recommendedDartId: best?.firstDartId ?? null,
  };
  const alternatives = recommendedLastDartTargets(analysis, 2, option.dartId);
  const alternativesText = alternatives.map(describeLastDartOption).join('または ');

  /* 1. 狙い通りでもテンパイにならない — 残り 1 投で作れるはずの機会を捨てている。 */
  if (!option.hitTenpai) {
    const lead = option.createsBogey
      ? `この選択で Bogey Number（残り ${option.leaveOnHit}）を作っています。` +
        `${intendedLabel} が狙い通りに入っても、3 本あって上がれないノーテンです。`
      : `この狙いではテンパイを作れません。${intendedLabel} は狙い通りに入っても` +
        `残り ${option.leaveOnHit} で、次のラウンドに 3 本では上がりきれません。`;
    /*
     * シングル落ちまで守れる的が 1 つも無い残り点（191〜230 など）では、
     * 「シングルに外れても」を基準として出さない。無い条件を勧めないため。
     */
    const advice =
      analysis.safeTargets.length > 0
        ? '残り 1 投では、シングルに外れても次のラウンドに 3 本で Checkout できる数字を' +
          '残せるターゲットを優先してください。'
        : 'まず、次のラウンドに 3 本で Checkout できる残りを作れるターゲットを選んでください。';
    return {
      ...base,
      verdict: option.createsBogey ? 'BOGEY_CREATED' : 'SETUP_MISTAKE',
      noteJa: lead + advice + (alternativesText === '' ? '' : `例: ${alternativesText}。`),
    };
  }

  /* 2. 狙い通りならテンパイで、同ナンバーのシングルへ落ちてもテンパイ。 */
  if (option.singleMissTenpai) {
    const teach =
      option.dart.kind !== 'triple' && analysis.safeTripleTargets.length > 0
        ? `同じ条件を満たすトリプルなら、得点も伸ばせます。例: ${alternativesText}。`
        : alternativesText === ''
          ? ''
          : `他に ${alternativesText}も同じ条件を満たします。`;
    /*
     * シングル狙いは「外しても着弾が同じナンバーのシングル」なので、
     * 狙い通りの残りとシングル落ちの残りが一致する。同じ数字を 2 回書かない。
     */
    const leaveNote =
      option.leaveOnHit === option.leaveOnSingleMiss
        ? `狙い通りなら残り ${option.leaveOnHit} で、次のラウンドに 3 本で Checkout できます。`
        : `狙い通りなら残り ${option.leaveOnHit}、同じナンバーのシングルに落ちても` +
          `残り ${option.leaveOnSingleMiss} で、どちらも次のラウンドに 3 本で Checkout できます。`;
    return {
      ...base,
      verdict: 'GOOD_DECISION',
      noteJa: leaveNote + teach,
    };
  }

  /* 3. 狙い通りならテンパイだが、シングルへ落ちるとテンパイを外す。 */
  if (analysis.safeTargets.length === 0) {
    /*
     * この残り点では、シングル落ちまで守れるターゲットが存在しない。
     * 無い選択肢を理由に減点しない。
     */
    return {
      ...base,
      verdict: 'GOOD_DECISION',
      noteJa:
        `狙い通りなら残り ${option.leaveOnHit} で、次のラウンドに 3 本で Checkout できます。` +
        `この残り点には、シングルに外れてもテンパイを保てるターゲットがありません。`,
    };
  }

  const missNote = isBogey(option.leaveOnSingleMiss)
    ? `残り ${option.leaveOnSingleMiss}（Bogey Number）となり、次のラウンドで Checkout できません`
    : `残り ${option.leaveOnSingleMiss} となり、次のラウンドで Checkout できません`;
  return {
    ...base,
    verdict: 'BETTER_OPTION_AVAILABLE',
    noteJa:
      `成立はしますが、良い選択ではありません。${intendedLabel} はシングルに外れると${missNote}。` +
      `${alternativesText}なら、シングルに外れてもテンパイを作れます。`,
  };
}

/** 説明文へ出すターゲットの書き方。 */
function describeLastDartOption(option: LastDartOption): string {
  const label = displayTargetId(option.dartId);
  if (option.leaveOnSingleMiss === null || !option.singleMissTenpai) {
    return `${label}（狙い通り ${option.leaveOnHit}）`;
  }
  return `${label}（狙い通り ${option.leaveOnHit}・シングルでも ${option.leaveOnSingleMiss}）`;
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
    `この選択は不適切です。${intendedNameJa} は狙い通り入ると ${reason}。` +
    `このビジットの得点が無効になり、残り点は変わりません。` +
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
