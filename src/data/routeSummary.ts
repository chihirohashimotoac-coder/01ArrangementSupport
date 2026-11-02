/**
 * ルートカードの要約（監査フェーズ 2 / 2-5、U-M3）。
 *
 * 以前は弱点を優先して 1 行だけ出しており、弱点が無いと「このアプリの基準ルートです。」だけになっていた。
 * いまは **1 行目に強み、2 行目に注意（あれば）** を出す。どの理由を選ぶかの優先順位をここで持つ。
 */
import type { ReasonPolarity } from '../domain/reasonCodes';

export interface SummaryReason {
  readonly code: string;
  readonly polarity: ReasonPolarity;
  readonly summary: string;
}

/**
 * 強みとして先に出す理由（上ほど優先）。「なぜこのルートか」が伝わるものを先にする。
 * STANDARD_ROUTE（基準ルートです）は中身が無いので、ほかに強みが無いときだけ使う。
 */
const STRENGTH_PRIORITY: readonly string[] = [
  // SETUP
  'SETUP_WHY_NOT_MAIN_TARGET',
  'LEAVES_PREMIUM_TENPAI',
  'SETUP_SINGLE_MISS_TENPAI_SAFE',
  'SETUP_LAST_DART_MISS_KEEPS_TENPAI',
  'SETUP_THIRD_DART_ADJUST',
  'LEAVES_TWO_DART_CHECKOUT',
  'LEAVE_GOOD_FINISH_DOUBLE',
  // CHECKOUT
  'PEER_OF_STANDARD',
  'SINGLE_MISS_SAFE',
  'SAFE_SINGLE_START',
  'FINISH_IN_ONE',
  'NEIGHBOR_SAFE',
  'USER_DOUBLE_PREFERENCE',
  'TARGET_CONTINUITY',
  'SETUP_TARGET_CONTINUITY',
  'GOOD_DOUBLE',
  'FEWER_DARTS',
];

/** 中身の無い強み（ほかに強みが無いときだけ使う）。 */
const WEAK_STRENGTHS: readonly string[] = ['STANDARD_ROUTE'];

/** 注意として先に出す理由（上ほど優先）。非推奨の理由を先にする。 */
const CAUTION_PRIORITY: readonly string[] = [
  'SINGLE_MISS_LOSES_CHECKOUT',
  'SINGLE_MISS_LEAVES_BOGEY',
  'SETUP_SINGLE_MISS_DEAD_END',
  'LEAVES_BOGEY',
  'LEAVE_ABOVE_CHECKOUT_RANGE',
  'NON_FINAL_DOUBLE',
  'SPENDS_EXTRA_DART',
  'SAFER_START_EXISTS',
  'UNNECESSARY_TRIPLE',
  'NEIGHBOR_RISK',
  'BELOW_TOP_ROUTE',
];

function rankBy(priority: readonly string[], code: string): number {
  const index = priority.indexOf(code);
  return index < 0 ? priority.length : index;
}

export interface SummaryLines {
  /** 1 行目（強み）。書き下ろし説明があればそれを使う。 */
  readonly strength: string | null;
  /** 2 行目（注意）。弱点が無ければ null。 */
  readonly caution: string | null;
}

export function routeSummaryLines(
  reasons: readonly SummaryReason[],
  curatedExplanation: string | null = null,
): SummaryLines {
  const positives = reasons.filter((reason) => reason.polarity === 'positive');
  const meaningful = positives.filter((reason) => !WEAK_STRENGTHS.includes(reason.code));
  const strengthReason = [...(meaningful.length > 0 ? meaningful : positives)].sort(
    (a, b) => rankBy(STRENGTH_PRIORITY, a.code) - rankBy(STRENGTH_PRIORITY, b.code),
  )[0];
  const cautionReason = reasons
    .filter((reason) => reason.polarity === 'negative')
    .sort((a, b) => rankBy(CAUTION_PRIORITY, a.code) - rankBy(CAUTION_PRIORITY, b.code))[0];
  return {
    strength: curatedExplanation ?? strengthReason?.summary ?? null,
    caution: cautionReason?.summary ?? null,
  };
}
