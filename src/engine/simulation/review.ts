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
 * 判定は `engine/recovery/suggest.ts` の `suggestFor()` と、最後の1本の共有分析を使う。
 * CHECKOUT / SETUP / NEXT VISIT の基準ランキングには一切手を入れない。
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
 * 基準ランキングは変更していない。最後の1本の実戦推奨は、この比較軸を共有する。
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
import { findDart, requireDart, type Dart } from '../../domain/dart';
import { DISCOURAGING_REASON_CODES, type RouteGrade } from '../../data/rankingRules';
import {
  BETTER_OPTION_LEAD_JA,
  appRouteSuggestionJa,
  renderCheckoutRelativeDisadvantageJa,
  renderCheckoutPeerJa,
  renderGradeBetterJa,
  renderLastDartDoubleTradeOffJa,
  renderNextVisitProposalPeerJa,
  reviewComparisonSuggestionJa,
  type LastDartTradeOffTarget,
  type ReviewComparisonTargetJa,
} from '../../data/explanations';
import {
  NEXT_VISIT_PROPOSAL_FACETS,
  type NextVisitProposalFacet,
} from '../../domain/reasonCodes';
import { suggestFor, type Suggestion } from '../recovery/suggest';
import { rankCheckoutRoutes, type RankedCheckoutRoute } from '../ranking/checkoutRanking';
import {
  buildNextVisitCandidates,
  nextVisitTierOf,
  type NextVisitProposal,
  type NextVisitProposalKind,
} from '../recovery/nextVisitSelection';
import { evaluateLeave } from '../setup/leaveQuality';
import { difficultyOf, targetKeyOf } from '../setup/sequences';
import { displayRouteText, displayTargetId } from './notation';
import {
  analyzeLastDartSetup,
  recommendedLastDartTargets,
  type LastDartOption,
} from './lastDartSetup';
import {
  nextVisitLeaveProfileOf,
  type LeaveProfile,
  type LeaveProfileKind,
} from './leaveProfile';
import {
  directDoubleIdOf,
  dominatingLastDartOptionsOf,
  lastDartDominanceOf,
  leavePairOf,
  sameNumberTripleUpgradeOf,
  type LastDartTradeOffScope,
} from './lastDartChoice';
export { isLastDartDoubleTradeOff } from './lastDartChoice';
import {
  analyzeSetupRecovery,
  lastDartTenpaiExamples,
  type SetupRecoveryFacts,
} from './setupRecovery';
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
  BETTER_OPTION_AVAILABLE: 'ルール上は成立するが、この基準では比較上の不利がある。個人の命中率は評価していない。',
  ARRANGEMENT_MISTAKE:
    '狙い通りなら BUST する、または必要な本数で上がれないなど、上がり方が成立しない狙い。',
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
  /**
   * 判定の決め手を構造化したもの（v1.4.3 の経路だけ）。
   * 集計・テストで日本語を解析しなくて済むよう、数値と的の ID で持つ。
   * `noteJa` はこの値から組み立てる。
   */
  readonly reason?: ThrowReviewReason;
  /**
   * 振り返りが**今回の判断と比べた代案**（v1.4.8）。否定的な判定のときだけ入る。
   *
   * 判定の根拠（上位互換の的・テンパイを作れる的・同じナンバーのトリプル・
   * エンジンの第 1 案）からそのまま作る。説明文（`noteJa`）を解析して取り出さない。
   * 1 投目が狙いと同じになることはない。アプリの第 1 案（`recommendedRouteText`）とは別物で、
   * 画面では両者を区別して見せる。
   */
  readonly comparison: ReviewComparison | null;
}

/**
 * 振り返りが比べた代案の根拠。
 *
 * - `APP_ROUTE`: エンジンの第 1 案（推奨度・Bust・候補に無い狙いとの比較）
 * - `LAST_DART_TENPAI`: 最後の 1 投で、テンパイ（シングル落ちでも）を作れる的（A-20）
 * - `LAST_DART_SAME_NUMBER_TRIPLE`: 同じナンバーのトリプル（A-21）
 * - `LAST_DART_LEAVE_PROFILE`: Next Visit Leave Profile の上位互換（A-22）
 * - `SETUP_RECOVERY`: SETUP・残り 2 本以上のシングル落ち回復（A-22）
 */
export type ReviewComparisonBasis =
  | 'APP_ROUTE'
  | 'LAST_DART_TENPAI'
  | 'LAST_DART_SAME_NUMBER_TRIPLE'
  | 'LAST_DART_LEAVE_PROFILE'
  | 'SETUP_RECOVERY';

export interface ReviewComparison {
  readonly basis: ReviewComparisonBasis;
  /** 代案の的（内部 ID）。1 投だけの比較なら 1 つ。先頭は狙いと違う。 */
  readonly dartIds: readonly string[];
  /** 代案を狙い通りに投げ切ったときの残り。上がるルートなら 0。 */
  readonly leaveOnHit: number;
  /** 1 投目の同ナンバーのシングル（内部 ID）。1 投だけの比較でないとき・BULL は null。 */
  readonly missDartId: string | null;
  readonly leaveOnSingleMiss: number | null;
}

/** 代わりに示す的と、その狙い通り / シングル落ちの残り。 */
export interface ReviewAlternative {
  readonly dartId: string;
  readonly leaveOnHit: number;
  /** 同ナンバーのシングル（内部 ID）。BULL エリアは null。 */
  readonly missDartId: string | null;
  readonly leaveOnSingleMiss: number | null;
}

/** 残し 1 つぶんの Next Visit Leave Profile 付きの見立て。 */
export interface ProfiledAlternative extends ReviewAlternative {
  readonly hitProfile: LeaveProfileKind;
  readonly missProfile: LeaveProfileKind;
}

export type ThrowReviewReason =
  /** SETUP・残り 2 本以上。狙い通りでも残りのダーツでテンパイを作れない。 */
  | {
      readonly code: 'SETUP_HIT_CANNOT_REACH_TENPAI';
      readonly leaveOnHit: number;
      readonly dartsAfter: number;
      readonly alternatives: readonly ReviewAlternative[];
    }
  /** SETUP・残り 2 本以上。同ナンバーのシングルへ落ちるとテンパイを作れない。 */
  | {
      readonly code: 'SETUP_SINGLE_MISS_LOSES_TENPAI';
      readonly leaveOnHit: number;
      readonly dartsAfter: number;
      readonly missDartId: string;
      readonly leaveOnSingleMiss: number;
      readonly alternatives: readonly ReviewAlternative[];
      /** 先頭の代案がシングルへ落ちたあと、残り 1 本で作れるテンパイの例。 */
      readonly recoveryExamples: readonly { readonly dartId: string; readonly leave: number }[];
    }
  /** ビジット最後の 1 投。Next Visit Leave Profile で明確な上位互換の的がある。 */
  | {
      readonly code: 'LAST_DART_LEAVE_DOMINATED';
      readonly intended: ProfiledAlternative;
      readonly dominating: readonly ProfiledAlternative[];
    }
  /**
   * ビジット最後の 1 投（v1.4.7 / A-26）。狙いはアプリが表示した NEXT VISIT の提案の
   * 1 投目で、シングル落ち後は有利な代案があるが、狙い通りのときに残る外側のダブルが違う
   * （交換条件）。シングル落ち後の差だけで「明確な上位互換」とは断定しない。
   */
  | {
      readonly code: 'LAST_DART_DOUBLE_TRADE_OFF';
      /** 狙いを 1 投目に持つ提案の種類。 */
      readonly proposalKind: NextVisitProposalKind;
      readonly intended: ProfiledAlternative;
      /** シングル落ち後は有利だが、狙い通りのときに残るダブルが違う代案（良い順）。 */
      readonly tradeOffs: readonly ProfiledAlternative[];
      /** 狙いの命中ダブルの得意ダブル順位（0 始まり）。設定に無ければ null。 */
      readonly intendedPreferenceRank: number | null;
    }
  /**
   * 狙いが、その場面のアプリのおすすめルートの 1 投目そのもの（v1.4.4）。
   * 推奨度が B / C でも、別のより良い 1 投目が示せないので否定的に判定しない。
   */
  | {
      readonly code: 'RECOMMENDED_FIRST_DART';
      /** 推奨度（エンジンが付けた値。事実として残す）。 */
      readonly grade: RouteGrade;
      /** おすすめルートの的（内部 ID）。先頭は狙いと同じ。 */
      readonly routeDartIds: readonly string[];
      readonly leaveOnHit: number;
      /** おすすめルートを投げ切ったときの残り。上がるルートなら 0。 */
      readonly routeLeave: number;
    }
  /**
   * CHECKOUT。狙いから始まる上がり方が、おすすめルートと戦術評価で同等以上（v1.4.5）。
   * 推奨度が B / C でも、おすすめより劣ると示せないので否定的に判定しない。
   */
  | {
      readonly code: 'CHECKOUT_PEER_OF_RECOMMENDED';
      /** 推奨度（エンジンが付けた値。事実として残す）。 */
      readonly grade: RouteGrade;
      /** 狙いから始まる、同等以上の上がり方（内部 ID）。先頭は狙いと同じ。 */
      readonly routeDartIds: readonly string[];
      /** おすすめルートの的（内部 ID）。 */
      readonly recommendedDartIds: readonly string[];
      readonly leaveOnHit: number;
      /** 基準ルート加点を除いた戦術スコア（`tacticalScore`）。 */
      readonly tacticalScore: number;
      readonly recommendedTacticalScore: number;
      /** おすすめルートと共通の注意点（非推奨の理由の表示名）。 */
      readonly sharedCautionLabels: readonly string[];
    }
  /**
   * NEXT VISIT。狙いが第 1 案以外の提案の 1 投目で、第 1 案がその提案の
   * 明確な上位互換になっていない（v1.4.6）。
   */
  | {
      readonly code: 'NEXT_VISIT_PROPOSAL_NOT_DOMINATED';
      /** 推奨度（エンジンが付けた値。事実として残す）。 */
      readonly grade: RouteGrade;
      /** その提案の種類（承認済みセレクタが付けたもの）。 */
      readonly proposalKind: NextVisitProposalKind;
      /** その提案の的（内部 ID）。先頭は狙いと同じ。 */
      readonly routeDartIds: readonly string[];
      readonly routeLeave: number;
      /** 第 1 案の的（内部 ID）。 */
      readonly primaryDartIds: readonly string[];
      readonly primaryLeave: number;
      readonly leaveOnHit: number;
      /** 第 1 案より良い観点（第 1 案と同等なら空）。 */
      readonly advantages: readonly ProposalFacet[];
      /** 第 1 案より劣る観点（一長一短のときだけ。良い観点が 1 つも無ければ否定判定のまま）。 */
      readonly disadvantages: readonly ProposalFacet[];
    }
  /** 合法な CHECKOUT 案の相対的な注意点。数値はルートと着弾規則から計算する。 */
  | {
      readonly code: 'CHECKOUT_RELATIVE_DISADVANTAGE';
      readonly routeDartIds: readonly string[];
      readonly alternativeDartIds: readonly string[];
      readonly tripleBustDartId: string | null;
      readonly alternativeTripleLeave: number | null;
      readonly innerSingleDartId: string | null;
      readonly innerSingleLeave: number | null;
      readonly cautionSummaries: readonly string[];
    };

/** NEXT VISIT の提案どうしを比べる観点（定義と意味は `domain/reasonCodes.ts`）。 */
export type ProposalFacet = NextVisitProposalFacet;

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
      comparison: null,
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
      comparison: appRouteComparisonOf(best, record.intendedDartId),
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
  /*
   * ビジット最後の 1 投で、最後の 1 投の比較（A-20〜A-22 / A-26）では判定しない狙い
   * （ダブル・BULL など）は、推奨度やボギーで判定する。その説明と「振り返りが比べた代案」に
   * エンジンの第 1 案を出すと、振り返り自身がその第 1 案を下げる場面がある
   * （残り 171 の S11。A-21 では T11 が上位）。その場面だけ、振り返り自身の代案に置き換える
   * （v1.4.8。判定は変えない）。
   */
  let lastDartFallback: ReviewComparison | null = null;
  if (context.kind === 'setup' && dartsLeft === 1) {
    const protectedDartId = preferenceDrivenFirstDartOf(suggestion, left, options);
    const tradeOff: LastDartTradeOffScope = {
      proposals: suggestion.nextVisitProposals,
      preferredDoubles: options.preferredDoubles ?? [],
    };
    const lastDart = lastDartSetupReview(
      record,
      left,
      intendedLabel,
      grade,
      best,
      protectedDartId,
      tradeOff,
    );
    if (lastDart !== null) return lastDart;
    lastDartFallback = lastDartFallbackComparisonOf(record, left, best, protectedDartId, tradeOff);
  }
  const comparison = lastDartFallback ?? appRouteComparisonOf(best, record.intendedDartId);
  /** 説明文の末尾に置く代案への言及（`lastDartFallback` のときは振り返り自身の代案）。 */
  const suggestionJa =
    lastDartFallback !== null
      ? reviewComparisonSuggestionJa(comparisonTargetJaOf(lastDartFallback))
      : best
        ? appRouteSuggestionJa(best.routeText, best.reasonJa)
        : '';

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
      comparison,
      grade,
      intendedLeave,
      recommendedRouteText: best?.routeText ?? null,
      recommendedDartId: best?.firstDartId ?? null,
      noteJa:
        `この選択で Bogey Number（残り ${intendedLeave}）を作っています。` +
        `狙い通りに入っても 3 本あって上がれないノーテンで、次のラウンドの Checkout 機会を失います。` +
        (lastDartFallback !== null
          ? suggestionJa
          : best
            ? `${best.routeText} なら上がり（または上がれる残り）を保てました。`
            : ''),
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
      comparison: null,
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
      comparison: null,
      grade,
      intendedLeave,
      recommendedRouteText: best?.routeText ?? null,
      recommendedDartId: best?.firstDartId ?? null,
      noteJa: `${context.label}として推奨できる狙いです（推奨度 ${grade}）。`,
    };
  }

  /*
   * 狙いがアプリのおすすめルートの 1 投目そのものなら、推奨度 B / C を理由に
   * 「もっと良い狙いあり」「見直す」とは言わない（v1.4.4）。
   *
   * 推奨度はその場面の最高スコアとの差で付く相対評価で、NEXT VISIT の提案では
   * **通常 SETUP ランキングの最高スコア**との差になる（`evaluateSetupRoute`）。
   * 一方、NEXT VISIT の第 1 候補は承認済みのセレクタが「残しの質」で選ぶので、
   * 第 1 候補そのものが B になりうる（129 / 残り 2 本の T20 → T15 など）。
   * そのとき B を「別のより良い 1 投目がある」と読むと、
   * 「T20 は劣る。おすすめは T20 → T15」という自己矛盾になる。
   *
   * 2 投目以降の選び方は、その投を投げるときに評価する（この投の判断に混ぜない）。
   */
  if ((grade === 'B' || grade === 'C') && best !== null && best.firstDartId === record.intendedDartId) {
    const reason: ThrowReviewReason = {
      code: 'RECOMMENDED_FIRST_DART',
      grade,
      routeDartIds: best.dartIds,
      leaveOnHit: intendedLeave,
      routeLeave: best.leave,
    };
    return {
      record,
      verdict: 'GOOD_DECISION',
      comparison: null,
      grade,
      intendedLeave,
      recommendedRouteText: best.routeText,
      recommendedDartId: best.firstDartId,
      noteJa: recommendedFirstDartNoteJa(intendedLabel, best.routeText, reason),
      reason,
    };
  }

  /*
   * CHECKOUT で、狙いから始まる上がり方が**おすすめルートと戦術評価で同等以上**なら、
   * 推奨度 B / C を理由に「もっと良い狙いあり」「見直す」とは言わない（v1.4.5）。
   *
   * CHECKOUT の推奨度は、基準ルート加点を除いた戦術スコアの最高値との差と、
   * 非推奨の理由の有無で付く相対評価で、基準ルートだけは定義上 S になる。
   * そのため、基準ルート（＝おすすめ）と戦術スコアも注意点も同じ上がり方が C になりうる
   * （残り 41 / 残り 2 本の S1 → D20 と、おすすめの S9 → D16。どちらも横ズレに弱い）。
   * そこで C を「不適切」と読むと、同じ欠点を持つルートを勧めながら狙いを否定することになる。
   *
   * 合法な上がり方があるだけでは GOOD にしない。次の両方を満たすときだけ。
   *   1. 戦術スコア（ダブルの質・シングル落ち・横ズレ・本数などの合計）がおすすめ以上
   *   2. おすすめに無い非推奨の理由を持たない
   * 満たさなければ従来どおり推奨度で判定する。
   */
  if ((grade === 'B' || grade === 'C') && best !== null) {
    const peer = context.peerOfRecommendedCheckout(record.intendedDartId);
    if (peer !== null) {
      const reason: ThrowReviewReason = {
        code: 'CHECKOUT_PEER_OF_RECOMMENDED',
        grade,
        routeDartIds: peer.route.darts.map((dart) => dart.id),
        recommendedDartIds: best.dartIds,
        leaveOnHit: intendedLeave,
        tacticalScore: peer.route.tacticalScore,
        recommendedTacticalScore: peer.recommended.tacticalScore,
        sharedCautionLabels: peer.sharedCautionLabels,
      };
      return {
        record,
        verdict: 'GOOD_DECISION',
        comparison: null,
        grade,
        intendedLeave,
        recommendedRouteText: best.routeText,
        recommendedDartId: best.firstDartId,
        noteJa: checkoutPeerNoteJa(intendedLabel, best.routeText, reason),
        reason,
      };
    }
  }

  /*
   * NEXT VISIT（上がれない場面）で、狙いが**第 1 案以外の提案**の 1 投目なら、
   * 第 1 案がその提案の明確な上位互換になっていない限り否定しない（v1.4.6）。
   *
   * 提案の推奨度は通常 SETUP ランキングの最高スコアとの差で付く（A-23 と同じ事情）。
   * 残り 122 / 残り 2 本の第 2 案 `T15 → T15` は、第 1 案 `T20 → T10` と同じ 32 を残し、
   * 的を切り替えずに投げられるのに、推奨度 B を理由に「明確に劣ります」と判定していた。
   *
   * 提案だから GOOD、にはしない。第 1 案が「残しの Tier・残しの質・難易度・
   * シングル落ち後・的の切り替え・得意ダブル」のすべてで同じか上で、どれかで上なら
   * 従来どおり推奨度で判定する（`nextVisitProposalPeerOf`）。
   * ビジット最後の 1 投（得意ダブルとの競合を含む）はこの比較の対象外。
   */
  if ((grade === 'B' || grade === 'C') && best !== null && dartsLeft >= 2) {
    const peer = context.nextVisitProposalPeerOf(record.intendedDartId);
    if (peer !== null) {
      const reason: ThrowReviewReason = {
        code: 'NEXT_VISIT_PROPOSAL_NOT_DOMINATED',
        grade,
        proposalKind: peer.proposal.kind,
        routeDartIds: peer.proposal.route.darts.map((dart) => dart.id),
        routeLeave: peer.proposal.route.leave,
        primaryDartIds: peer.primary.route.darts.map((dart) => dart.id),
        primaryLeave: peer.primary.route.leave,
        leaveOnHit: intendedLeave,
        advantages: peer.advantages,
        disadvantages: peer.disadvantages,
      };
      return {
        record,
        verdict: 'GOOD_DECISION',
        comparison: null,
        grade,
        intendedLeave,
        recommendedRouteText: best.routeText,
        recommendedDartId: best.firstDartId,
        noteJa: nextVisitProposalNoteJa(intendedLabel, reason),
        reason,
      };
    }
  }

  if (grade === 'B') {
    return {
      record,
      verdict: 'BETTER_OPTION_AVAILABLE',
      comparison,
      grade,
      intendedLeave,
      recommendedRouteText: best?.routeText ?? null,
      recommendedDartId: best?.firstDartId ?? null,
      noteJa: renderGradeBetterJa({
        intendedLabel,
        contextLabel: context.label,
        intendedLeave,
        suggestionJa,
      }),
    };
  }

  const mistake: ThrowVerdict = context.kind === 'checkout' ? 'ARRANGEMENT_MISTAKE' : 'SETUP_MISTAKE';
  if (grade === 'C') {
    const relative = context.kind === 'checkout'
      ? checkoutRelativeDisadvantageOf(suggestion.checkoutRoutes, record.intendedDartId, left)
      : null;
    return {
      record,
      verdict: 'BETTER_OPTION_AVAILABLE',
      comparison,
      grade,
      intendedLeave,
      recommendedRouteText: best?.routeText ?? null,
      recommendedDartId: best?.firstDartId ?? null,
      reason: relative ?? undefined,
      noteJa: relative === null
        ? `${intendedLabel} からの案は成立します（狙い通りだと残り ${intendedLeave}）。` +
          `この基準では推奨度 C です。${suggestionJa}`
        : renderCheckoutRelativeDisadvantageJa({
            reason: relative,
            routeText: relative.routeDartIds.map(displayTargetId).join(' → '),
            intendedLabel,
            intendedLeave,
            suggestionJa,
          }),
    };
  }

  // 候補のどれとも一致しない狙い。
  if (!context.hasCandidates) {
    return {
      record,
      verdict: 'NOT_EVALUATED',
      comparison: null,
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
      comparison: null,
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
    comparison: appRouteComparisonOf(best, record.intendedDartId),
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

/** 成立する下位候補について、比較できる着弾条件だけを取り出す。 */
function checkoutRelativeDisadvantageOf(
  routes: readonly RankedCheckoutRoute[],
  intendedDartId: string,
  left: number,
): Extract<ThrowReviewReason, { code: 'CHECKOUT_RELATIVE_DISADVANTAGE' }> | null {
  const own = routes.find((route) => route.darts[0]?.id === intendedDartId);
  const alternative = routes.find((route) => route.darts[0]?.id !== intendedDartId);
  if (own === undefined || alternative === undefined) return null;

  const first = own.darts[0];
  const otherFirst = alternative.darts[0];
  const ownTriple = first.kind === 'single' && first.baseNumber !== null
    ? findDart(`T${first.baseNumber}`) ?? null : null;
  const otherTriple = otherFirst.kind === 'single' && otherFirst.baseNumber !== null
    ? findDart(`T${otherFirst.baseNumber}`) ?? null : null;
  const ownTripleOutcome = ownTriple === null ? null : applyDart(left, ownTriple);
  const otherTripleOutcome = otherTriple === null ? null : applyDart(left, otherTriple);
  const tripleBustDartId = ownTripleOutcome?.outcome === 'bust' &&
    otherTripleOutcome?.outcome === 'continue' ? ownTriple!.id : null;

  const finish = own.darts[own.darts.length - 1];
  const otherFinish = alternative.darts[alternative.darts.length - 1];
  const beforeFinish = left - own.darts.slice(0, -1).reduce((sum, dart) => sum + dart.score, 0);
  const inner = finish.kind === 'double' && finish.baseNumber !== null
    ? findDart(`S${finish.baseNumber}`) ?? null : null;
  const innerOutcome = inner === null ? null : applyDart(beforeFinish, inner);
  const innerSingleDartId = innerOutcome?.outcome === 'continue' &&
    innerOutcome.remainingAfter % 2 === 1 && otherFinish.kind === 'double' &&
    otherFinish.baseNumber !== null && otherFinish.baseNumber % 2 === 0 ? inner!.id : null;

  return {
    code: 'CHECKOUT_RELATIVE_DISADVANTAGE',
    routeDartIds: own.darts.map((dart) => dart.id),
    alternativeDartIds: alternative.darts.map((dart) => dart.id),
    tripleBustDartId,
    alternativeTripleLeave: tripleBustDartId === null ? null : otherTripleOutcome!.remainingAfter,
    innerSingleDartId,
    innerSingleLeave: innerSingleDartId === null ? null : innerOutcome!.remainingAfter,
    cautionSummaries: own.reasons.filter((reason) => reason.polarity === 'negative')
      .map((reason) => reason.summary),
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
  tradeOff: LastDartTradeOffScope,
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
    .filter((item) => dominatingLastDartOptionsOf(analysis, item, tradeOff).length === 0)
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
      comparison: singleDartComparisonOf('LAST_DART_TENPAI', lastDartAlternativeOf(alternatives[0]), option.dartId),
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
      comparison: singleDartComparisonOf('LAST_DART_SAME_NUMBER_TRIPLE', lastDartAlternativeOf(tripleUpgrade), option.dartId),
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
   *
   * 2-d. アプリが表示した NEXT VISIT の提案の狙いで、代案との差が
   *      「狙い通りのときに残る外側のダブル」と「シングル落ち後の立て直し」の
   *      交換条件になっているだけなら、上位互換とは断定しない（v1.4.7 / A-26）。
   *      条件は `isLastDartDoubleTradeOff` を参照。
   */
  if (
    (option.singleMissTenpai || analysis.safeTargets.length === 0) &&
    option.dartId !== protectedDartId
  ) {
    const { dominating, tradeOffs } = lastDartDominanceOf(analysis, option, tradeOff);
    if (dominating.length === 0 && tradeOffs.length > 0) {
      const reason: ThrowReviewReason = {
        code: 'LAST_DART_DOUBLE_TRADE_OFF',
        proposalKind: proposalOfFirstDart(tradeOff.proposals, option.dartId)!.kind,
        intended: profiledAlternativeOf(option),
        tradeOffs: tradeOffs.map(profiledAlternativeOf),
        intendedPreferenceRank: preferenceRankOf(option.leaveOnHit, tradeOff.preferredDoubles),
      };
      return {
        ...base,
        verdict: 'GOOD_DECISION',
        comparison: null,
        noteJa: lastDartDoubleTradeOffNoteJa(intendedLabel, reason),
        reason,
      };
    }
    if (dominating.length > 0) {
      const reason: ThrowReviewReason = {
        code: 'LAST_DART_LEAVE_DOMINATED',
        intended: profiledAlternativeOf(option),
        dominating: dominating.map(profiledAlternativeOf),
      };
      return {
        ...base,
        verdict: 'BETTER_OPTION_AVAILABLE',
        comparison: singleDartComparisonOf('LAST_DART_LEAVE_PROFILE', lastDartAlternativeOf(dominating[0]), option.dartId),
        noteJa: dominatedLeaveNoteJa(intendedLabel, reason),
        reason,
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
      comparison: null,
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
      comparison: null,
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
    comparison: singleDartComparisonOf('LAST_DART_TENPAI', lastDartAlternativeOf(alternatives[0]), option.dartId),
    noteJa:
      `${BETTER_OPTION_LEAD_JA}${intendedLabel} はシングルに外れると${missNote}。` +
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
function proposalOfFirstDart(
  proposals: readonly NextVisitProposal[],
  dartId: string,
): NextVisitProposal | null {
  return proposals.find((proposal) => proposal.route.darts[0]?.id === dartId) ?? null;
}

function preferenceRankOf(leave: number, preferredDoubles: readonly string[]): number | null {
  const double = directDoubleIdOf(leave);
  if (double === null) return null;
  const rank = preferredDoubles.indexOf(double);
  return rank < 0 ? null : rank;
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

function profiledAlternativeOf(option: LastDartOption): ProfiledAlternative {
  const pair = leavePairOf(option)!;
  return {
    dartId: option.dartId,
    leaveOnHit: option.leaveOnHit,
    missDartId: option.dart.baseNumber === null ? null : `S${option.dart.baseNumber}`,
    leaveOnSingleMiss: option.leaveOnSingleMiss,
    hitProfile: pair.hit.kind,
    missProfile: pair.miss.kind,
  };
}

/** 説明文へ渡す、狙い・代案 1 つぶんの値（表記の変換だけをする）。 */
function tradeOffTargetOf(item: ProfiledAlternative): LastDartTradeOffTarget {
  const example = nextVisitLeaveProfileOf(item.leaveOnSingleMiss ?? item.leaveOnHit).exampleDartIds;
  return {
    label: displayTargetId(item.dartId),
    hitLeave: item.leaveOnHit,
    hitDoubleLabel: displayTargetId(`D${item.leaveOnHit / 2}`),
    missLabel: item.missDartId === null ? '' : displayTargetId(item.missDartId),
    missLeave: item.leaveOnSingleMiss ?? item.leaveOnHit,
    missExampleText: example === null ? null : routeLabelOf(example),
  };
}

/**
 * 構造化した理由（`LAST_DART_DOUBLE_TRADE_OFF`）から説明文を組み立てる。
 * 日本語は `data/explanations.ts` で解決し、ここでは表記の変換だけをする。
 */
function lastDartDoubleTradeOffNoteJa(
  intendedLabel: string,
  reason: Extract<ThrowReviewReason, { code: 'LAST_DART_DOUBLE_TRADE_OFF' }>,
): string {
  return renderLastDartDoubleTradeOffJa({
    proposalKind: reason.proposalKind,
    intended: { ...tradeOffTargetOf(reason.intended), label: intendedLabel },
    alternatives: reason.tradeOffs.map(tradeOffTargetOf),
    intendedPreferenceRank: reason.intendedPreferenceRank,
  });
}

/** 構造化した理由（`LAST_DART_LEAVE_DOMINATED`）から説明文を組み立てる。 */
function dominatedLeaveNoteJa(
  intendedLabel: string,
  reason: Extract<ThrowReviewReason, { code: 'LAST_DART_LEAVE_DOMINATED' }>,
): string {
  const phrase = (leave: number) => leaveProfilePhraseJa(nextVisitLeaveProfileOf(leave));
  const own = reason.intended;
  const [first, ...rest] = reason.dominating;

  const ownMiss =
    own.leaveOnSingleMiss === own.leaveOnHit || own.leaveOnSingleMiss === null
      ? ''
      : `同じナンバーのシングルに落ちると残り ${own.leaveOnSingleMiss}（${phrase(own.leaveOnSingleMiss)}）です。`;
  /*
   * シングル狙いの代案は、狙い通りとシングル落ちが同じ残りになる。
   * 落ちた場合の句を出さないときに、読点だけが残らないようにする。
   */
  const firstMiss =
    first.leaveOnSingleMiss === first.leaveOnHit ||
    first.leaveOnSingleMiss === null ||
    first.missDartId === null
      ? ''
      : `、${displayTargetId(first.missDartId)} に落ちても ${first.leaveOnSingleMiss}` +
        `（${phrase(first.leaveOnSingleMiss)}）`;
  const others = rest
    .slice(0, 1)
    .map((item) =>
      item.leaveOnSingleMiss === item.leaveOnHit || item.missDartId === null
        ? `${displayTargetId(item.dartId)}（狙い通り ${item.leaveOnHit}）も同じく上位互換です。`
        : `${displayTargetId(item.dartId)}（狙い通り ${item.leaveOnHit}・` +
          `${displayTargetId(item.missDartId)} でも ${item.leaveOnSingleMiss}）も同じく上位互換です。`,
    )
    .join('');

  return (
    `成立はしますが、もっと実戦的な狙いがあります。${intendedLabel} は狙い通りなら残り ` +
    `${own.leaveOnHit}（${phrase(own.leaveOnHit)}）で、次のラウンドに 3 本で Checkout はできます。` +
    ownMiss +
    `${displayTargetId(first.dartId)} なら狙い通り ${first.leaveOnHit}（${phrase(first.leaveOnHit)}）` +
    firstMiss +
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
  const base = {
    record,
    grade: null,
    intendedLeave,
    recommendedRouteText: best?.routeText ?? null,
    recommendedDartId: best?.firstDartId ?? null,
  };

  const toAlternative = (item: SetupRecoveryFacts): ReviewAlternative => ({
    dartId: item.dart.id,
    leaveOnHit: item.leaveOnHit ?? 0,
    missDartId: item.dart.baseNumber === null ? null : `S${item.dart.baseNumber}`,
    leaveOnSingleMiss: item.leaveOnSingleMiss,
  });

  if (!facts.hitCanReachTenpai) {
    if (analysis.hitAlternatives.length === 0) return null;
    const reason: ThrowReviewReason = {
      code: 'SETUP_HIT_CANNOT_REACH_TENPAI',
      leaveOnHit: intendedLeave,
      dartsAfter: restDarts,
      alternatives: (analysis.safeAlternatives.length > 0
        ? analysis.safeAlternatives
        : analysis.hitAlternatives
      )
        .slice(0, 2)
        .map(toAlternative),
    };
    return {
      ...base,
      verdict: 'SETUP_MISTAKE',
      comparison: singleDartComparisonOf('SETUP_RECOVERY', reason.alternatives[0], record.intendedDartId),
      noteJa: setupRecoveryNoteJa(intendedLabel, reason),
      reason,
    };
  }

  if (facts.singleMissCanReachTenpai || facts.leaveOnSingleMiss === null) return null;
  const [alternative] = analysis.safeAlternatives;
  if (alternative === undefined) return null;

  const reason: ThrowReviewReason = {
    code: 'SETUP_SINGLE_MISS_LOSES_TENPAI',
    leaveOnHit: intendedLeave,
    dartsAfter: restDarts,
    missDartId: `S${intended.baseNumber}`,
    leaveOnSingleMiss: facts.leaveOnSingleMiss,
    alternatives: analysis.safeAlternatives.slice(0, 2).map(toAlternative),
    recoveryExamples:
      restDarts === 1 && alternative.leaveOnSingleMiss !== null
        ? lastDartTenpaiExamples(alternative.leaveOnSingleMiss)
        : [],
  };
  return {
    ...base,
    verdict: 'BETTER_OPTION_AVAILABLE',
    comparison: singleDartComparisonOf('SETUP_RECOVERY', reason.alternatives[0], record.intendedDartId),
    noteJa: setupRecoveryNoteJa(intendedLabel, reason),
    reason,
  };
}

/** 構造化した理由（SETUP・残り 2 本以上）から説明文を組み立てる。 */
function setupRecoveryNoteJa(
  intendedLabel: string,
  reason: Extract<
    ThrowReviewReason,
    { code: 'SETUP_HIT_CANNOT_REACH_TENPAI' | 'SETUP_SINGLE_MISS_LOSES_TENPAI' }
  >,
): string {
  const restText = reason.dartsAfter === 1 ? '最後の 1 本' : `残り ${reason.dartsAfter} 本`;

  if (reason.code === 'SETUP_HIT_CANNOT_REACH_TENPAI') {
    const examples = reason.alternatives
      .map((item) => `${displayTargetId(item.dartId)}（狙い通り ${item.leaveOnHit}）`)
      .join('や ');
    return (
      `この選択は不適切です。${intendedLabel} は狙い通りに入っても残り ${reason.leaveOnHit} で、` +
      `${restText}では次のビジットに 3 本で Checkout できる数字（テンパイ）を作れません。` +
      `${examples}なら、狙い通りに入れば${restText}でテンパイを作れます。`
    );
  }

  const [alternative, second] = reason.alternatives;
  const altLabel = displayTargetId(alternative.dartId);
  const examples = reason.recoveryExamples
    .map((item) => `${displayTargetId(item.dartId)} → ${item.leave}`)
    .join('、');
  const altRecovery =
    alternative.missDartId === null || alternative.leaveOnSingleMiss === alternative.leaveOnHit
      ? `${altLabel} なら残り ${alternative.leaveOnHit} で、${restText}でテンパイを作れます。`
      : `${altLabel} なら ${displayTargetId(alternative.missDartId)} に落ちても残り ` +
        `${alternative.leaveOnSingleMiss} で、${restText}で${examples === '' ? '' : `${examples} など`}` +
        `テンパイを作れます。`;
  const secondNote =
    second === undefined ? '' : `${displayTargetId(second.dartId)} も同じ条件を満たします。`;

  return (
    `成立はしますが、もっと良い狙いがあります。${intendedLabel} は狙い通りなら残り ${reason.leaveOnHit} で、` +
    `${restText}でテンパイを作れます。ただし ${displayTargetId(reason.missDartId)} に落ちると残り ` +
    `${reason.leaveOnSingleMiss} となり、` +
    `${restText}では次のビジットに 3 本で Checkout できる数字を作れません。` +
    altRecovery +
    secondNote
  );
}

/** 構造化した理由（`RECOMMENDED_FIRST_DART`）から説明文を組み立てる。 */
function recommendedFirstDartNoteJa(
  intendedLabel: string,
  routeText: string,
  reason: Extract<ThrowReviewReason, { code: 'RECOMMENDED_FIRST_DART' }>,
): string {
  const rest = reason.routeDartIds.slice(1).map(displayTargetId);
  const lead =
    `${intendedLabel} は、この場面のおすすめ（${routeText}）の 1 投目です。` +
    `狙い通りなら残り ${reason.leaveOnHit} です。`;
  if (rest.length === 0) return lead;
  const goal = reason.routeLeave === 0 ? '上がれます' : `残り ${reason.routeLeave} を作れます`;
  return (
    lead +
    `続けて ${rest.join(' → ')} を狙えば${goal}` +
    `（次の投の狙いは、その投で評価します）。`
  );
}

/**
 * 構造化した理由（`CHECKOUT_PEER_OF_RECOMMENDED`）から説明文を組み立てる。
 * 日本語は `data/explanations.ts` で解決し、ここでは表記の変換だけをする。
 */
function checkoutPeerNoteJa(
  intendedLabel: string,
  recommendedText: string,
  reason: Extract<ThrowReviewReason, { code: 'CHECKOUT_PEER_OF_RECOMMENDED' }>,
): string {
  return renderCheckoutPeerJa({
    intendedLabel,
    routeText: routeLabelOf(reason.routeDartIds),
    recommendedText,
    grade: reason.grade,
    leaveOnHit: reason.leaveOnHit,
    restLabels: reason.routeDartIds.slice(1).map(displayTargetId),
    sharedCautionLabels: reason.sharedCautionLabels,
  });
}

/**
 * 構造化した理由（`NEXT_VISIT_PROPOSAL_NOT_DOMINATED`）から説明文を組み立てる。
 * 日本語は `data/explanations.ts` で解決し、ここでは表記の変換だけをする。
 */
function nextVisitProposalNoteJa(
  intendedLabel: string,
  reason: Extract<ThrowReviewReason, { code: 'NEXT_VISIT_PROPOSAL_NOT_DOMINATED' }>,
): string {
  return renderNextVisitProposalPeerJa({
    intendedLabel,
    proposalKind: reason.proposalKind,
    routeText: routeLabelOf(reason.routeDartIds),
    routeLeave: reason.routeLeave,
    primaryRouteText: routeLabelOf(reason.primaryDartIds),
    primaryLeave: reason.primaryLeave,
    grade: reason.grade,
    leaveOnHit: reason.leaveOnHit,
    restLabels: reason.routeDartIds.slice(1).map(displayTargetId),
    advantages: reason.advantages,
    disadvantages: reason.disadvantages,
  });
}

/** 説明文へ出すターゲットの書き方。 */
function describeLastDartOption(option: LastDartOption): string {
  const label = displayTargetId(option.dartId);
  if (option.leaveOnSingleMiss === null || !option.singleMissTenpai) {
    return `${label}（狙い通り ${option.leaveOnHit}）`;
  }
  return `${label}（狙い通り ${option.leaveOnHit}・シングルでも ${option.leaveOnSingleMiss}）`;
}

/**
 * ビジット最後の 1 投で、最後の 1 投の比較では判定しない狙い（ダブル・BULL など）の代案。
 *
 * エンジンの第 1 案の 1 投目を、同じ場面の最後の 1 投の比較（`lastDartSetupReview`）に
 * かけて「良い判断」にならないときだけ、振り返り自身が勧める的
 * （`recommendedLastDartTargets` の順で、同じ比較で「良い判断」になる最初の的）を返す。
 * それ以外は null（エンジンの第 1 案をそのまま代案にする）。判定には使わない。
 */
function lastDartFallbackComparisonOf(
  record: ThrowRecord,
  left: number,
  best: RouteSummary | null,
  protectedDartId: string | null,
  tradeOff: LastDartTradeOffScope,
): ReviewComparison | null {
  if (best === null || best.firstDartId === record.intendedDartId) return null;
  const judge = (dartId: string) =>
    lastDartSetupReview(
      { ...record, intendedDartId: dartId },
      left,
      displayTargetId(dartId),
      null,
      best,
      protectedDartId,
      tradeOff,
    );
  const asAppRoute = judge(best.firstDartId);
  if (asAppRoute === null || asAppRoute.verdict === 'GOOD_DECISION') return null;
  const analysis = analyzeLastDartSetup(left);
  for (const item of recommendedLastDartTargets(analysis, Number.POSITIVE_INFINITY, record.intendedDartId)) {
    if (judge(item.dartId)?.verdict === 'GOOD_DECISION') {
      return singleDartComparisonOf('LAST_DART_TENPAI', lastDartAlternativeOf(item), record.intendedDartId);
    }
  }
  return null;
}

/** 代案（1 投）を説明文用の値へ写す（表記の変換だけ）。 */
function comparisonTargetJaOf(comparison: ReviewComparison): ReviewComparisonTargetJa {
  return {
    label: displayTargetId(comparison.dartIds[0]),
    leaveOnHit: comparison.leaveOnHit,
    missLabel: comparison.missDartId === null ? null : displayTargetId(comparison.missDartId),
    leaveOnSingleMiss: comparison.leaveOnSingleMiss,
  };
}

/** エンジンの第 1 案を、比べた代案として渡す（1 投目が狙いと同じなら渡さない）。 */
function appRouteComparisonOf(best: RouteSummary | null, intendedDartId: string): ReviewComparison | null {
  if (best === null || best.firstDartId === intendedDartId) return null;
  return {
    basis: 'APP_ROUTE',
    dartIds: best.dartIds,
    leaveOnHit: best.leave,
    missDartId: null,
    leaveOnSingleMiss: null,
  };
}

/** 1 投だけの代案（的・狙い通りの残り・シングル落ちの残り）を、比べた代案として渡す。 */
function singleDartComparisonOf(
  basis: Exclude<ReviewComparisonBasis, 'APP_ROUTE'>,
  item: ReviewAlternative | undefined,
  intendedDartId: string,
): ReviewComparison | null {
  if (item === undefined || item.dartId === intendedDartId) return null;
  return {
    basis,
    dartIds: [item.dartId],
    leaveOnHit: item.leaveOnHit,
    missDartId: item.missDartId,
    leaveOnSingleMiss: item.leaveOnSingleMiss,
  };
}

/** 最後の 1 投の的を、比べた代案の形へ写す。 */
function lastDartAlternativeOf(option: LastDartOption | undefined): ReviewAlternative | undefined {
  if (option === undefined) return undefined;
  return {
    dartId: option.dartId,
    leaveOnHit: option.leaveOnHit,
    missDartId: option.dart.baseNumber === null ? null : `S${option.dart.baseNumber}`,
    leaveOnSingleMiss: option.leaveOnSingleMiss,
  };
}

interface RouteSummary {
  readonly routeText: string;
  readonly firstDartId: string;
  readonly reasonJa: string | null;
  /** ルートの的（内部 ID）。 */
  readonly dartIds: readonly string[];
  /** ルートを投げ切ったときの残り。上がるルートなら 0。 */
  readonly leave: number;
}

function bestRouteOf(suggestion: Suggestion): RouteSummary | null {
  const practical = suggestion.practicalLastDart;
  if (practical !== null) {
    return {
      routeText: displayTargetId(practical.dartId),
      firstDartId: practical.dartId,
      reasonJa: practical.leaveOnSingleMiss === null
        ? `残り ${practical.leaveOnHit} を作る`
        : `狙い通りなら残り ${practical.leaveOnHit}、同番号のシングルなら ${practical.leaveOnSingleMiss}`,
      dartIds: [practical.dartId],
      leave: practical.leaveOnHit,
    };
  }
  const checkout = suggestion.checkoutRoutes[0];
  if (checkout !== undefined) {
    return {
      routeText: displayRouteText(checkout.routeText),
      firstDartId: checkout.darts[0].id,
      reasonJa: checkout.reasons[0]?.summary ?? null,
      dartIds: checkout.darts.map((dart) => dart.id),
      leave: 0,
    };
  }
  const nextVisit = suggestion.nextVisitProposals[0]?.route;
  if (nextVisit !== undefined) {
    return {
      routeText: displayRouteText(nextVisit.routeText),
      firstDartId: nextVisit.darts[0].id,
      reasonJa: `残り ${nextVisit.leave} を作る`,
      dartIds: nextVisit.darts.map((dart) => dart.id),
      leave: nextVisit.leave,
    };
  }
  const setup = suggestion.setupRoutes[0];
  if (setup !== undefined) {
    return {
      routeText: displayRouteText(setup.routeText),
      firstDartId: setup.darts[0].id,
      reasonJa: `残り ${setup.leave} を作る`,
      dartIds: setup.darts.map((dart) => dart.id),
      leave: setup.leave,
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
  /**
   * 狙いから始まる上がり方のうち、おすすめルート（CHECKOUT の先頭）と
   * 戦術評価で同等以上のもの。CHECKOUT 以外・該当なしは null。
   */
  peerOfRecommendedCheckout(dartId: string): CheckoutPeer | null;
  /**
   * 狙いを 1 投目に持つ、第 1 案以外の NEXT VISIT 提案のうち、
   * 第 1 案に明確な上位互換を取られていないもの。NEXT VISIT 以外・該当なしは null。
   */
  nextVisitProposalPeerOf(dartId: string): NextVisitProposalPeer | null;
}

interface NextVisitProposalPeer {
  readonly proposal: NextVisitProposal;
  readonly primary: NextVisitProposal;
  readonly advantages: readonly ProposalFacet[];
  readonly disadvantages: readonly ProposalFacet[];
}

interface CheckoutPeer {
  readonly route: RankedCheckoutRoute;
  readonly recommended: RankedCheckoutRoute;
  readonly sharedCautionLabels: readonly string[];
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
      peerOfRecommendedCheckout: (dartId) => peerOfRecommendedCheckout(checkoutRoutes, dartId),
      nextVisitProposalPeerOf: () => null,
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
      peerOfRecommendedCheckout: () => null,
      nextVisitProposalPeerOf: (dartId) =>
        nextVisitProposalPeerOf(nextVisitProposals, dartId, remaining, dartsLeft, options),
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
      peerOfRecommendedCheckout: () => null,
      nextVisitProposalPeerOf: () => null,
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
    peerOfRecommendedCheckout: () => null,
    nextVisitProposalPeerOf: () => null,
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

function discouragingCodesOf(route: RankedCheckoutRoute): readonly string[] {
  return route.reasons
    .map((reason) => reason.code as string)
    .filter((code) => (DISCOURAGING_REASON_CODES as readonly string[]).includes(code));
}

/**
 * 狙い `dartId` から始まる上がり方のうち、おすすめルート（一覧の先頭）と比べて
 *
 *   1. 戦術スコア（`tacticalScore`。基準ルート加点を除く）が同じか上
 *   2. おすすめに無い非推奨の理由（`DISCOURAGING_REASON_CODES`）を持たない
 *
 * を満たすもの。複数あれば戦術スコアが高いもの、同点なら一覧の順で先のもの。
 * 狙いがおすすめの 1 投目そのもののときは使わない（`RECOMMENDED_FIRST_DART` が扱う）。
 */
function peerOfRecommendedCheckout(
  routes: readonly RankedCheckoutRoute[],
  dartId: string,
): CheckoutPeer | null {
  const recommended = routes[0];
  if (recommended === undefined || recommended.darts[0].id === dartId) return null;
  const allowed = new Set(discouragingCodesOf(recommended));
  let peer: RankedCheckoutRoute | null = null;
  for (const route of routes) {
    if (route.darts[0].id !== dartId) continue;
    if (route.tacticalScore < recommended.tacticalScore) continue;
    if (!discouragingCodesOf(route).every((code) => allowed.has(code))) continue;
    if (peer === null || route.tacticalScore > peer.tacticalScore) peer = route;
  }
  if (peer === null) return null;
  const sharedCautionLabels = peer.reasons
    .filter((reason) => allowed.has(reason.code))
    .map((reason) => reason.label);
  return { route: peer, recommended, sharedCautionLabels };
}

const TIER_RANKS = ['A', 'B', 'C', 'D', 'E'] as const;

/** Tier の順位（小さいほど良い）。上がれない残しは最下位。 */
function tierRankOf(leave: number): number {
  const tier = nextVisitTierOf(leave);
  return tier === null ? TIER_RANKS.length : TIER_RANKS.indexOf(tier);
}

/**
 * 1 投目が同じナンバーのシングルへ落ちたあと、残りのダーツで作れる最良の残しの Tier 順位。
 * シングル・BULL を狙う 1 投目は「同じナンバーのシングルへ落ちる」外れ方が無いので -1（最良）。
 */
function singleMissTierRankOf(left: number, first: Dart, dartsLeft: number): number {
  if (first.kind === 'single' || first.baseNumber === null) return -1;
  const miss = findDart(`S${first.baseNumber}`);
  if (miss === undefined) return -1;
  const after = left - miss.score;
  const rest = dartsLeft - 1;
  if (after < 2) return TIER_RANKS.length;
  if (rest === 0) return tierRankOf(after);
  const candidates = buildNextVisitCandidates(after, rest);
  if (candidates.length === 0) return TIER_RANKS.length;
  return Math.min(...candidates.map((candidate) => TIER_RANKS.indexOf(candidate.tier)));
}

/** 観点ごとの値。どれも**小さいほど良い**向きにそろえる。 */
function proposalFacetsOf(
  proposal: NextVisitProposal,
  left: number,
  dartsLeft: number,
  preferredDoubles: readonly string[],
): Readonly<Record<ProposalFacet, number>> {
  const { darts, leave } = proposal.route;
  let switches = 0;
  for (let i = 1; i < darts.length; i += 1) {
    if (targetKeyOf(darts[i]) !== targetKeyOf(darts[i - 1])) switches += 1;
  }
  const finish = leave % 2 === 0 && leave >= 2 && leave <= 40 ? `D${leave / 2}` : null;
  const preference = finish === null ? -1 : preferredDoubles.indexOf(finish);
  return {
    LEAVE_TIER: tierRankOf(leave),
    LEAVE_QUALITY: -evaluateLeave(leave).score,
    DIFFICULTY: darts.reduce((sum, dart) => sum + difficultyOf(dart), 0),
    SINGLE_MISS: singleMissTierRankOf(left, darts[0], dartsLeft),
    SAME_TARGET: switches,
    PREFERRED_DOUBLE: preference < 0 ? Number.MAX_SAFE_INTEGER : preference,
  };
}

const PROPOSAL_FACETS: readonly ProposalFacet[] = NEXT_VISIT_PROPOSAL_FACETS;

/**
 * 第 1 案（`primary`）と別の提案（`other`）を 6 観点で比べる。値は小さいほど良い。
 *
 * `dominated` は「第 1 案が明確な上位互換」= 別の提案が良い観点が 1 つも無く、
 * 劣る観点が 1 つ以上あること。すべて同じなら上位互換ではない。
 */
export function compareProposalFacets(
  primary: Readonly<Record<ProposalFacet, number>>,
  other: Readonly<Record<ProposalFacet, number>>,
): { readonly better: ProposalFacet[]; readonly worse: ProposalFacet[]; readonly dominated: boolean } {
  const better = PROPOSAL_FACETS.filter((facet) => other[facet] < primary[facet]);
  const worse = PROPOSAL_FACETS.filter((facet) => other[facet] > primary[facet]);
  return { better, worse, dominated: better.length === 0 && worse.length > 0 };
}

/**
 * 狙い `dartId` を 1 投目に持つ、第 1 案以外の NEXT VISIT 提案のうち、
 * 第 1 案に**明確な上位互換**を取られていないもの（v1.4.6）。
 *
 * 明確な上位互換 = 第 1 案が 6 観点（`ProposalFacet`）のすべてで同じか上で、
 * どれか 1 つで上。1 つでも第 1 案より良い観点があるか、すべて同じなら否定しない。
 * 提案の生成・順位（承認済みセレクタ）はここでは変えない。
 */
function nextVisitProposalPeerOf(
  proposals: readonly NextVisitProposal[],
  dartId: string,
  left: number,
  dartsLeft: number,
  options: ReviewOptions,
): NextVisitProposalPeer | null {
  const primary = proposals[0];
  if (primary === undefined || primary.route.darts[0]?.id === dartId) return null;
  const preferred = options.preferredDoubles ?? [];
  const own = proposalFacetsOf(primary, left, dartsLeft, preferred);
  for (const proposal of proposals.slice(1)) {
    if (proposal.route.darts[0]?.id !== dartId) continue;
    const { better, worse, dominated } = compareProposalFacets(
      own,
      proposalFacetsOf(proposal, left, dartsLeft, preferred),
    );
    if (!dominated) return { proposal, primary, advantages: better, disadvantages: worse };
  }
  return null;
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
