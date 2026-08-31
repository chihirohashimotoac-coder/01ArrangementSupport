/**
 * 「次ラウンドに残す点数」の質を評価する。
 *
 * SETUP の良し悪しはここで決まる。単純な数値順（170 > 167 > …）にはせず、
 * 「3 本で上がれるか」「2 本でも上がれるか」「上がりに BULL が要るか」など
 * 計算できる事実と、data 側の人間定義（重要教材の残りなど）を合成する。
 */
import { formatRoute } from '../../domain/dart';
import {
  DARTS_PER_VISIT,
  MAX_CHECKOUT,
  MAX_SETUP_REMAINING,
  isBogey,
  isCheckoutable,
  minDartsToCheckout,
} from '../../domain/checkoutRules';
import type { SetupReasonCode } from '../../domain/reasonCodes';
import {
  DOUBLE_QUALITY,
  GOOD_DOUBLE_TIERS,
  PREMIUM_TENPAI_LEAVES,
  SETUP_REASON_WEIGHTS,
} from '../../data/rankingRules';
import {
  LAST_DIGIT_RULE_BAND,
  MEMORABLE_LAST_DIGITS,
} from '../../data/bogeyNumbers';
import { getStandardRoute } from '../../data/standardCheckoutRoutes';

export interface LeaveEvaluation {
  readonly leave: number;
  readonly codes: readonly SetupReasonCode[];
  readonly score: number;
  /** 3 本でチェックアウトできるか（テンパイか）。 */
  readonly checkoutable: boolean;
  readonly isBogey: boolean;
  readonly minDarts: 1 | 2 | 3 | null;
  /** その残りの基準ルート（表示・説明用）。 */
  readonly standardRouteText: string | null;
}

const cache = new Map<number, LeaveEvaluation>();

/** 159〜170 の帯で、下一桁が 0 / 1 / 4 / 7 か。 */
export function hasMemorableLastDigit(leave: number): boolean {
  if (leave < LAST_DIGIT_RULE_BAND.min || leave > LAST_DIGIT_RULE_BAND.max) return false;
  return MEMORABLE_LAST_DIGITS.includes(leave % 10);
}

/** 残り点そのものの質を評価する。 */
export function evaluateLeave(leave: number): LeaveEvaluation {
  const cached = cache.get(leave);
  if (cached) return cached;

  const codes: SetupReasonCode[] = [];
  const checkoutable = isCheckoutable(leave, DARTS_PER_VISIT);
  const bogey = isBogey(leave);
  const standard = getStandardRoute(leave);

  if (leave > MAX_CHECKOUT) {
    codes.push('LEAVE_ABOVE_CHECKOUT_RANGE');
  } else if (bogey) {
    codes.push('LEAVES_BOGEY');
  } else if (checkoutable) {
    codes.push('LEAVES_CHECKOUTABLE');
    if (isCheckoutable(leave, 2)) codes.push('LEAVES_TWO_DART_CHECKOUT');
    if (PREMIUM_TENPAI_LEAVES.includes(leave)) codes.push('LEAVES_PREMIUM_TENPAI');
    if (hasMemorableLastDigit(leave)) codes.push('LEAVE_LAST_DIGIT_0147');
    if (standard) {
      if (standard.darts.some((dart) => dart.baseNumber === null)) {
        codes.push('LEAVE_REQUIRES_BULL');
      }
      const finish = standard.darts[standard.darts.length - 1];
      const quality = DOUBLE_QUALITY[finish.id];
      if (quality && GOOD_DOUBLE_TIERS.includes(quality.tier)) {
        codes.push('LEAVE_GOOD_FINISH_DOUBLE');
      }
    }
  }

  const score = codes.reduce((sum, code) => sum + SETUP_REASON_WEIGHTS[code], 0);
  const evaluation: LeaveEvaluation = {
    leave,
    codes,
    score,
    checkoutable,
    isBogey: bogey,
    minDarts: minDartsToCheckout(leave),
    standardRouteText: standard ? formatRoute(standard.darts) : null,
  };
  cache.set(leave, evaluation);
  return evaluation;
}

/**
 * 残り点の「見出し」分類。UI のバッジ表示に使う。
 */
export type LeaveTier = 'premium' | 'good' | 'playable' | 'bogey' | 'out-of-range';

export function leaveTierOf(leave: number): LeaveTier {
  if (leave > MAX_CHECKOUT) return 'out-of-range';
  if (isBogey(leave)) return 'bogey';
  if (PREMIUM_TENPAI_LEAVES.includes(leave)) return 'premium';
  if (isCheckoutable(leave, 2)) return 'good';
  return 'playable';
}

/** 171〜350 の各残り点で、ちょうど 100 点（TON）を取ると Bogey になるか。 */
export function isTonTrap(remaining: number): boolean {
  if (remaining < 171 || remaining > MAX_SETUP_REMAINING) return false;
  return isBogey(remaining - 100);
}

/** テスト用にキャッシュを空にする。 */
export function clearLeaveQualityCache(): void {
  cache.clear();
}
