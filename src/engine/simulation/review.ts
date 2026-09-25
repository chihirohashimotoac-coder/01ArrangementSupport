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
 * ## シングル落ち回復と、次のビジットでダブルへ到達するまで（v1.4.3 / A-22）
 *
 * - SETUP 帯でまだ 2 本以上残っている場面は、候補一覧に無い狙いでも
 *   「狙い通り / 同ナンバーのシングル落ちのあとにテンパイを作れるか」
 *   （`setupRecovery.ts`、既存の `canReachTenpai` / `isSingleMissTenpaiSafe` を再利用）で
 *   言い切れるときだけ判定する。
 * - ビジット最後の 1 投は、残した数字が次のビジットで何を要求するか
 *   （`leaveProfile.ts`）を比べ、明確な上位互換がある狙いを GOOD にしない。
 *
 * どちらもレビュー層の分類方針で、エンジンの順位・重みは変えていない。
 *
 * ## 表現の強さ
 *
 * 学習用途のモードなので、悪い選択は悪いと分かる言い方にする。
 * 「成立する」と「良い選択」を区別し、何がどう悪いのか・次にどう考えるかを
 * 短く書く。罵倒や煽りは書かない。
 */
import {
  DARTS_PER_VISIT,
  MAX_CHECKOUT,
  MAX_SETUP_REMAINING,
  applyDart,
  isBogey,
} from '../../domain/checkoutRules';
import { requireDart } from '../../domain/dart';
import type { RouteGrade } from '../../data/rankingRules';
import { suggestFor, type Suggestion } from '../recovery/suggest';
import { rankCheckoutRoutes } from '../ranking/checkoutRanking';
import { displayRouteText, displayTargetId } from './notation';
import {
  analyzeLastDartSetup,
  recommendedLastDartTargets,
  type LastDartOption,
  type LastDartSetupAnalysis,
} from './lastDartSetup';
import {
  dominatesLeavePair,
  nextVisitLeaveProfileOf,
  type LeaveProfile,
} from './leaveProfile';
import { analyzeSetupRecovery, lastDartTenpaiExamples } from './setupRecovery';
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

/**
 * 判断の分類の**画面表記**。
 *
 * 判定キー（`ThrowVerdict`）・意味・件数の数え方はここでは変えない。
 * 英語のままだと意味を調べる負担が出るため、短い日本語にしている。
 * 「ボギー」「BUST」などの用語の意味は `THROW_VERDICT_HINT_JA` と画面の用語説明で補う。
 */
export const THROW_VERDICT_JA: Readonly<Record<ThrowVerdict, string>> = {
  GOOD_DECISION: '良い判断',
  BETTER_OPTION_AVAILABLE: 'もっと良い狙いあり',
  ARRANGEMENT_MISTAKE: '上がり方を見直す',
  SETUP_MISTAKE: '残し方を見直す',
  BOGEY_CREATED: 'ボギーを残した',
  SCORING_PHASE: '得点を伸ばす場面',
  NOT_EVALUATED: '判定対象外',
};

/** 判断の分類が何を指すかの短い補足（画面の「判断の内訳」で使う）。 */
export const THROW_VERDICT_HINT_JA: Readonly<Record<ThrowVerdict, string>> = {
  GOOD_DECISION: 'その場面で推奨できる狙い（推奨度 S・A、得意ダブル設定どおりの狙いなど）。',
  BETTER_OPTION_AVAILABLE: '成立はするが、もっと良い狙いがあった。',
  ARRANGEMENT_MISTAKE:
    'この 3 投で上がる形として不適切な狙い（狙い通りに入ると BUST する狙いを含む）。',
  SETUP_MISTAKE: '次のビジットへ残す形として不適切な狙い。',
  BOGEY_CREATED:
    'ビジット最後の 1 投で、狙い通りに入ってもボギー（次の 3 投で上がれない残り）になる狙い。',
  SCORING_PHASE: '残り 351 以上。1 ビジットでは上がりに絡まないので、狙いを採点していない。',
  NOT_EVALUATED: '候補一覧の外などで、良し悪しを断定していない。良い・悪いのどちらにも数えない。',
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
    const protectedDartId = preferenceDrivenFirstDartOf(suggestion, left, options);
    const lastDart = lastDartSetupReview(record, left, intendedLabel, grade, best, protectedDartId);
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
  /*
   * SETUP 帯（171〜350）でまだ 2 本以上残っている場面は、候補一覧に無くても
   * 「狙い通り / 同ナンバーのシングル落ち」のあとにテンパイを作れるかは計算できる
   * （`setupRecovery.ts`）。その事実から言い切れるときだけ判定し、
   * 言い切れないときは従来どおり断定しない。
   */
  if (context.kind === 'setup' && left > MAX_CHECKOUT && dartsLeft >= 2) {
    const recovery = setupRecoveryReview(record, left, dartsLeft, intendedLabel, intendedLeave, best);
    if (recovery !== null) return recovery;
  }

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
  protectedDartId: string | null,
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
  /*
   * 例に出す的は、Next Visit Leave Profile で別の的に上位互換を取られていないものだけ
   * （116 で「T18（狙い通り 62）も同じ条件を満たす」と勧めない）。
   */
  const alternatives = recommendedLastDartTargets(analysis, Number.POSITIVE_INFINITY, option.dartId)
    .filter((item) => dominatingLastDartOptionsOf(analysis, item).length === 0)
    .slice(0, 2);
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

  /*
   * 2-a. シングルを直接狙ってテンパイを作ったが、**同じナンバーのトリプル**が
   *      明確な上位互換になっている。
   *
   * S18 で 160 を残すのと、T18 を狙って S18 へ落ちて 160 を残すのは、
   * 外したときの残りが同じ。そのうえ T18 に入れば 124 まで進める。
   * 「シングル落ちでもテンパイを維持でき、かつトリプルに入っても
   * 3 本で上がれる」場合だけ、トリプルを狙う方が実戦的だと伝える。
   * 成立はしているので MISTAKE にはしない。
   */
  const tripleUpgrade = sameNumberTripleUpgradeOf(analysis, option, left);
  if (tripleUpgrade !== null) {
    const tripleLabel = displayTargetId(tripleUpgrade.dartId);
    return {
      ...base,
      verdict: 'BETTER_OPTION_AVAILABLE',
      noteJa:
        `テンパイは作れますが、${tripleLabel} を狙えば、シングルに落ちても同じ残り ` +
        `${option.leaveOnHit} を維持でき、${tripleLabel} に入れば残り ` +
        `${tripleUpgrade.leaveOnHit} まで進められます。` +
        `同じナンバーのトリプルを狙う方が実戦的です。`,
    };
  }

  /*
   * 2-c. 「次のビジットでダブルへ到達するまでに何が要るか」（Next Visit Leave
   *      Profile）で、別の的が**明確な上位互換**になっている（v1.4.3）。
   *
   * 狙い通り・同ナンバーのシングル落ちの両方で悪化せず、どちらかで改善する的が
   * あれば GOOD にしない。116 の S16 → 100（先に T20 が要る）に対して、
   * T20 → 56（S16 1 本で D20 が残る）/ S20 でも 96（2 本で上がれる）がこれにあたる。
   * 「残りが小さいほど良い」とはしない（`leaveProfile.ts`）。
   *
   * 得意ダブルの設定で NEXT VISIT の第 1 候補が変わった狙い（MY ROUTE）は、
   * この比較で下げない。
   */
  if (
    (option.singleMissTenpai || analysis.safeTargets.length === 0) &&
    option.dartId !== protectedDartId
  ) {
    const dominating = dominatingLastDartOptionsOf(analysis, option);
    if (dominating.length > 0) {
      return {
        ...base,
        verdict: 'BETTER_OPTION_AVAILABLE',
        noteJa: dominatedLeaveNoteJa(intendedLabel, option, dominating),
      };
    }
  }

  /* 2-b. 狙い通りならテンパイで、同ナンバーのシングルへ落ちてもテンパイ。 */
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

/**
 * 「同じナンバーのトリプルが明確な上位互換か」。
 *
 * シングル `Sn` を直接狙ってテンパイを作った場面で、`Tn` を狙っていたら
 * どうだったかを見る。`Tn` の同ナンバーシングル落ちは **`Sn` を狙ったときと
 * 同じ残り**になるので、`Tn` が次の 2 つを満たすとき、`Sn` を狙う理由が
 * 残らない（守りは同じで、当たれば前進する）。
 *
 *   1. トリプルに入っても次のラウンドに 3 本で上がれる（Bust もしない）
 *   2. シングルへ落ちてもテンパイを保てる（＝ `Sn` 狙いと同じ残り）
 *
 * 判定は SETUP 帯（171 以上）だけに限る。170 以下は「次のラウンドに残す形」を
 * 承認済みの NEXT VISIT セレクタが選ぶ場面で、そこでは残りが小さいほど良いとは
 * 限らない（残り 41 の `S1` → 40 は D20 で上がれる残りで、`T1` → 38 が
 * 上位互換とは言えない）。特定の残り点を優劣の根拠にしないためにも、
 * 「残りが小さいほど良い」が成り立つ SETUP 帯だけで使う。
 */
function sameNumberTripleUpgradeOf(
  analysis: LastDartSetupAnalysis,
  option: LastDartOption,
  left: number,
): LastDartOption | null {
  if (left <= MAX_CHECKOUT) return null;
  if (option.dart.kind !== 'single') return null;
  if (!option.hitTenpai) return null;

  const baseNumber = option.dart.baseNumber;
  if (baseNumber === null) return null;

  const triple = analysis.optionFor(`T${baseNumber}`);
  if (triple === null) return null;
  if (!triple.hitTenpai || !triple.singleMissTenpai) return null;
  // トリプルのシングル落ちが、この狙いとまったく同じ残りになることを確かめる。
  if (triple.leaveOnSingleMiss !== option.leaveOnHit) return null;

  return triple;
}

interface LeavePair {
  readonly hit: LeaveProfile;
  readonly miss: LeaveProfile;
}

function leavePairOf(option: LastDartOption): LeavePair | null {
  if (option.leaveOnSingleMiss === null) return null;
  return {
    hit: nextVisitLeaveProfileOf(option.leaveOnHit),
    miss: nextVisitLeaveProfileOf(option.leaveOnSingleMiss),
  };
}

/**
 * 残り 1 投で、`option` の明確な上位互換になっている的（良い順）。
 *
 * 比べるのはテンパイを作れる的のうち、落ち先を決められる（BULL 以外）
 * ダブル以外の的だけ。ダブルは SETUP の得点手段として勧めない。
 */
function dominatingLastDartOptionsOf(
  analysis: LastDartSetupAnalysis,
  option: LastDartOption,
): readonly LastDartOption[] {
  const own = leavePairOf(option);
  if (own === null) return [];
  const pairs = new Map<string, LeavePair>();
  for (const candidate of analysis.tenpaiTargets) {
    if (candidate.dartId === option.dartId || candidate.dart.kind === 'double') continue;
    const pair = leavePairOf(candidate);
    if (pair !== null && dominatesLeavePair(pair, own)) pairs.set(candidate.dartId, pair);
  }
  const kindOrder = (item: LastDartOption) => (item.dart.kind === 'triple' ? 0 : 1);
  return analysis.tenpaiTargets
    .filter((candidate) => pairs.has(candidate.dartId))
    .sort((a, b) => {
      const pa = pairs.get(a.dartId)!;
      const pb = pairs.get(b.dartId)!;
      return (
        pa.hit.rank - pb.hit.rank ||
        pa.miss.rank - pb.miss.rank ||
        kindOrder(a) - kindOrder(b) ||
        b.dart.score - a.dart.score ||
        a.dartId.localeCompare(b.dartId)
      );
    });
}

function routeLabelOf(dartIds: readonly string[]): string {
  return dartIds.map(displayTargetId).join(' → ');
}

/** 残り点が次のビジットで何を要求するかの短い言い方。 */
function leaveProfilePhraseJa(profile: LeaveProfile): string {
  const example = profile.exampleDartIds;
  switch (profile.kind) {
    case 'DIRECT_DOUBLE':
      return `1 投目から ${routeLabelOf(example ?? [])} を狙える`;
    case 'AIM_AREA':
      return '広いシングルのエリアからダブルを残せる';
    case 'SINGLE_TO_DOUBLE':
      return example === null
        ? 'シングル 1 本でダブルが残る'
        : `${routeLabelOf(example)} とシングル 1 本でダブルが残る`;
    case 'TWO_DART_OTHER':
      return example === null
        ? '2 本で上がれるが、先にトリプルや BULL を決める必要がある'
        : `${routeLabelOf(example)} と、先にトリプルなどを決めてからダブルへ進む`;
    case 'THREE_DART':
      return '上がりに 3 本を使う';
    case 'NO_CHECKOUT':
      return '3 本でも上がれない';
  }
}

function dominatedLeaveNoteJa(
  intendedLabel: string,
  option: LastDartOption,
  dominating: readonly LastDartOption[],
): string {
  const own = leavePairOf(option)!;
  const [first, ...rest] = dominating;
  const firstPair = leavePairOf(first)!;
  const firstMissLabel = displayTargetId(`S${first.dart.baseNumber}`);

  const ownMiss =
    option.leaveOnSingleMiss === option.leaveOnHit
      ? ''
      : `同じナンバーのシングルに落ちると残り ${option.leaveOnSingleMiss}（${leaveProfilePhraseJa(own.miss)}）です。`;
  const others = rest
    .slice(0, 1)
    .map(
      (item) =>
        `${displayTargetId(item.dartId)}（狙い通り ${item.leaveOnHit}・` +
        `${displayTargetId(`S${item.dart.baseNumber}`)} でも ${item.leaveOnSingleMiss}）も同じく上位互換です。`,
    )
    .join('');

  return (
    `成立はしますが、もっと実戦的な狙いがあります。${intendedLabel} は狙い通りなら残り ` +
    `${option.leaveOnHit}（${leaveProfilePhraseJa(own.hit)}）で、次のラウンドに 3 本で Checkout はできます。` +
    ownMiss +
    `${displayTargetId(first.dartId)} なら狙い通り ${first.leaveOnHit}` +
    `（${leaveProfilePhraseJa(firstPair.hit)}）、` +
    (first.leaveOnSingleMiss === first.leaveOnHit
      ? ''
      : `${firstMissLabel} に落ちても ${first.leaveOnSingleMiss}（${leaveProfilePhraseJa(firstPair.miss)}）`) +
    `で、次のビジットでダブルへ近づけます。` +
    others
  );
}

/**
 * 得意ダブルの設定で NEXT VISIT の第 1 候補が変わったときの、その 1 投目。
 * 設定が無い・設定しても第 1 候補が変わらないときは null。
 */
function preferenceDrivenFirstDartOf(
  suggestion: Suggestion,
  left: number,
  options: ReviewOptions,
): string | null {
  if ((options.preferredDoubles ?? []).length === 0) return null;
  const withPreference = suggestion.nextVisitProposals[0]?.route.darts[0]?.id ?? null;
  const withoutPreference =
    suggestFor(left, 1, suggestOptionsOf({ ...options, preferredDoubles: undefined }))
      .nextVisitProposals[0]?.route.darts[0]?.id ?? null;
  return withPreference !== withoutPreference ? withPreference : null;
}

/**
 * SETUP 帯（171〜350）でまだ 2 本以上残っている場面の、候補一覧に無い狙いの判定。
 *
 *   A. 狙い通りに入ったあと、残りのダーツでテンパイを作れるか
 *   B. 同ナンバーのシングルへ落ちたあとでも、残りのダーツでテンパイを作れるか
 *
 * - A を満たさず、A を満たす的が他にある → `SETUP_MISTAKE`
 * - A を満たし B を満たさず、A・B を両方満たす的が他にある → `BETTER_OPTION_AVAILABLE`
 * - それ以外 → null（従来どおり断定しない）
 *
 * 「同じトリプルを続けて狙うこと」は条件にしない。見るのは
 * シングルへ落ちてもテンパイを作る道が残るかだけ。
 */
function setupRecoveryReview(
  record: ThrowRecord,
  left: number,
  dartsLeft: number,
  intendedLabel: string,
  intendedLeave: number,
  best: RouteSummary | null,
): ThrowReview | null {
  const intended = requireDart(record.intendedDartId);
  const analysis = analyzeSetupRecovery(left, intended, dartsLeft);
  const facts = analysis.intended;
  const restDarts = dartsLeft - 1;
  const restText = restDarts === 1 ? '最後の 1 本' : `残り ${restDarts} 本`;
  const base = {
    record,
    grade: null,
    intendedLeave,
    recommendedRouteText: best?.routeText ?? null,
    recommendedDartId: best?.firstDartId ?? null,
  };

  if (!facts.hitCanReachTenpai) {
    if (analysis.hitAlternatives.length === 0) return null;
    const examples = (
      analysis.safeAlternatives.length > 0 ? analysis.safeAlternatives : analysis.hitAlternatives
    )
      .slice(0, 2)
      .map((item) => `${displayTargetId(item.dart.id)}（狙い通り ${item.leaveOnHit}）`)
      .join('や ');
    return {
      ...base,
      verdict: 'SETUP_MISTAKE',
      noteJa:
        `この選択は不適切です。${intendedLabel} は狙い通りに入っても残り ${intendedLeave} で、` +
        `${restText}では次のビジットに 3 本で Checkout できる数字（テンパイ）を作れません。` +
        `${examples}なら、狙い通りに入れば${restText}でテンパイを作れます。`,
    };
  }

  if (facts.singleMissCanReachTenpai || facts.leaveOnSingleMiss === null) return null;
  const [alternative, second] = analysis.safeAlternatives;
  if (alternative === undefined) return null;

  const missLabel = displayTargetId(`S${intended.baseNumber}`);
  const altLabel = displayTargetId(alternative.dart.id);
  const altMissLabel = displayTargetId(`S${alternative.dart.baseNumber}`);
  const examples =
    restDarts === 1 && alternative.leaveOnSingleMiss !== null
      ? lastDartTenpaiExamples(alternative.leaveOnSingleMiss)
          .map((item) => `${displayTargetId(item.dartId)} → ${item.leave}`)
          .join('、')
      : '';
  const altRecovery =
    alternative.dart.kind === 'single'
      ? `${altLabel} なら残り ${alternative.leaveOnHit} で、${restText}でテンパイを作れます。`
      : `${altLabel} なら ${altMissLabel} に落ちても残り ${alternative.leaveOnSingleMiss} で、` +
        `${restText}で${examples === '' ? '' : `${examples} など`}テンパイを作れます。`;
  const secondNote =
    second === undefined
      ? ''
      : `${displayTargetId(second.dart.id)} も同じ条件を満たします。`;

  return {
    ...base,
    verdict: 'BETTER_OPTION_AVAILABLE',
    noteJa:
      `成立はしますが、もっと良い狙いがあります。${intendedLabel} は狙い通りなら残り ${intendedLeave} で、` +
      `${restText}でテンパイを作れます。ただし ${missLabel} に落ちると残り ${facts.leaveOnSingleMiss} となり、` +
      `${restText}では次のビジットに 3 本で Checkout できる数字を作れません。` +
      altRecovery +
      secondNote,
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
