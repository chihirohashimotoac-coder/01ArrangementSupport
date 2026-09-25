/**
 * SETUP（171〜350）でまだ 2 本以上残っている場面の、1 投の狙いの事実。
 * **SIMULATION のレビュー専用**。
 *
 * 計算は `engine/setup/tenpai.ts` の `canReachTenpai` / `isSingleMissTenpaiSafe` /
 * `singleMissDartOf` をそのまま使い、同じ計算を別に持たない。
 * SETUP ランキング（`rankSetupRoutes`）の順位・重みには触れない。
 *
 *   A. 狙い通りに入ったあと、残りのダーツで次のビジットのテンパイを作れるか
 *   B. 同じナンバーのシングルへ落ちたあとでも、残りのダーツでテンパイを作れるか
 *
 * 例: 243 / 残り 2 本
 *   T20 → 183（A: 最後の 1 本で S13 → 170 など）/ S20 → 223（B: 1 本では作れない）
 *   T19 → 186（A）/ S19 → 224（B: 最後の 1 本で T20 → 164 など）
 *
 * 大事なのは「同じトリプルを続けて狙うこと」ではなく、
 * **シングルへ落ちてもテンパイを作る道が残るか**である。
 */
import { applyDart, isCheckoutable, MAX_CHECKOUT } from '../../domain/checkoutRules';
import { THROWABLE_DARTS, type Dart } from '../../domain/dart';
import { canReachTenpai, isSingleMissTenpaiSafe, singleMissDartOf } from '../setup/tenpai';

export interface SetupRecoveryFacts {
  readonly dart: Dart;
  /** 狙い通り入ったときの残り。Bust / 上がりなら null。 */
  readonly leaveOnHit: number | null;
  /** A. 狙い通りなら、残りのダーツでテンパイを作れる。 */
  readonly hitCanReachTenpai: boolean;
  /** 同じナンバーのシングルへ落ちたときの残り。BULL エリアは null。 */
  readonly leaveOnSingleMiss: number | null;
  /** B. シングルへ落ちても、残りのダーツでテンパイを作れる。 */
  readonly singleMissCanReachTenpai: boolean;
}

/** 残り `left`・残り `dartsLeft` 本で、`dart` を狙ったときの A / B。 */
export function setupRecoveryFactsOf(left: number, dart: Dart, dartsLeft: number): SetupRecoveryFacts {
  const outcome = applyDart(left, dart);
  const leaveOnHit = outcome.outcome === 'continue' ? outcome.remainingAfter : null;
  const miss = singleMissDartOf(dart);
  return {
    dart,
    leaveOnHit,
    hitCanReachTenpai: leaveOnHit !== null && canReachTenpai(leaveOnHit, dartsLeft - 1),
    leaveOnSingleMiss: miss === null ? null : left - miss.score,
    singleMissCanReachTenpai: isSingleMissTenpaiSafe(left, dart, dartsLeft),
  };
}

/**
 * 代わりに示してよい的（得点用のトリプル → シングルの順、同じ種類は得点の高い順）。
 *
 * BULL エリアは落ち先を決められないので出さない。ダブルは SETUP の得点手段として
 * 選ぶ的ではない（A-18）ので出さない。
 */
function alternativeDarts(): readonly Dart[] {
  const kindOrder = (dart: Dart) => (dart.kind === 'triple' ? 0 : 1);
  return THROWABLE_DARTS.filter(
    (dart) => dart.baseNumber !== null && (dart.kind === 'triple' || dart.kind === 'single'),
  ).sort((a, b) => kindOrder(a) - kindOrder(b) || b.score - a.score);
}

export interface SetupRecoveryAnalysis {
  readonly intended: SetupRecoveryFacts;
  /** A を満たす代わりの的（狙いそのものは除く）。 */
  readonly hitAlternatives: readonly SetupRecoveryFacts[];
  /** A と B の両方を満たす代わりの的（狙いそのものは除く）。 */
  readonly safeAlternatives: readonly SetupRecoveryFacts[];
}

export function analyzeSetupRecovery(
  left: number,
  intended: Dart,
  dartsLeft: number,
): SetupRecoveryAnalysis {
  const others = alternativeDarts()
    .filter((dart) => dart.id !== intended.id)
    .map((dart) => setupRecoveryFactsOf(left, dart, dartsLeft));
  const hitAlternatives = others.filter((facts) => facts.hitCanReachTenpai);
  return {
    intended: setupRecoveryFactsOf(left, intended, dartsLeft),
    hitAlternatives,
    safeAlternatives: hitAlternatives.filter((facts) => facts.singleMissCanReachTenpai),
  };
}

/**
 * 残り `leave` から残り 1 本でテンパイ（3 本で上がれる 170 以下）を作れる的の例。
 * トリプルを得点の高い順に、最大 `limit` 件。説明文用。
 */
export function lastDartTenpaiExamples(
  leave: number,
  limit = 3,
): readonly { readonly dartId: string; readonly leave: number }[] {
  const examples: { dartId: string; leave: number }[] = [];
  for (const dart of alternativeDarts()) {
    const rest = leave - dart.score;
    if (rest > MAX_CHECKOUT || !isCheckoutable(rest, 3)) continue;
    examples.push({ dartId: dart.id, leave: rest });
    if (examples.length >= limit) break;
  }
  return examples;
}
