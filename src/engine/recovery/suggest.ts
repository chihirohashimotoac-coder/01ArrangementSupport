/**
 * 現在の残り・残り本数から「いま何を狙うべきか」を返す。
 *
 * CHECKOUT（2〜170）と SETUP（171〜350）で使うエンジンが変わるだけで、
 * どちらも「1 投ごとに追従して再計算する」という同じ考え方で動く。
 */
import { MAX_CHECKOUT, MAX_SETUP_REMAINING, isBogey } from '../../domain/checkoutRules';
import {
  rankCheckoutRoutes,
  type CheckoutRankingOptions,
  type RankedCheckoutRoute,
} from '../ranking/checkoutRanking';
import {
  canReachTenpai,
  rankSetupRoutes,
  tonTrapWarning,
  type RankedSetupRoute,
  type SetupOptions,
} from '../setup/enumerate';

export type SuggestionMode = 'checkout' | 'setup' | 'unavailable';

export interface Suggestion {
  readonly mode: SuggestionMode;
  readonly remaining: number;
  readonly dartsLeft: number;
  readonly checkoutRoutes: readonly RankedCheckoutRoute[];
  readonly setupRoutes: readonly RankedSetupRoute[];
  /**
   * CHECKOUT 中に、現在の残り本数では上がれなくなったときの「次ラウンドへの残し」。
   *
   * mode は 'checkout' のまま変えない。あくまで CHECKOUT 中の補助であり、
   * 計算そのものは通常の SETUP と同じ `rankSetupRoutes()` を再利用する。
   * CHECKOUT ルートが 1 件でもある場合は必ず null。
   */
  readonly nextVisitRoute: RankedSetupRoute | null;
  /** この残りが Bogey Number か。 */
  readonly isBogey: boolean;
  /** SETUP でテンパイを作れるか。CHECKOUT では常に null。 */
  readonly canReachTenpai: boolean | null;
  /** ちょうど 100 点を取ると Bogey になる場合の残り。 */
  readonly tonTrapLeave: number | null;
  /** 提案できない理由（表示用）。 */
  readonly unavailableReason: string | null;
}

export interface SuggestOptions extends CheckoutRankingOptions, SetupOptions {}

/** 現在の状況に対する提案を作る。 */
export function suggestFor(
  remaining: number,
  dartsLeft: number,
  options: SuggestOptions = {},
): Suggestion {
  const base = {
    remaining,
    dartsLeft,
    checkoutRoutes: [] as readonly RankedCheckoutRoute[],
    setupRoutes: [] as readonly RankedSetupRoute[],
    nextVisitRoute: null as RankedSetupRoute | null,
    isBogey: isBogey(remaining),
    canReachTenpai: null as boolean | null,
    tonTrapLeave: tonTrapWarning(remaining)?.leaveAfterTon ?? null,
  };

  if (dartsLeft <= 0) {
    return { ...base, mode: 'unavailable', unavailableReason: '残り本数がありません。' };
  }
  if (remaining > MAX_SETUP_REMAINING) {
    return {
      ...base,
      mode: 'unavailable',
      unavailableReason: `${MAX_SETUP_REMAINING} を超える残りは、このアプリの対象外です。`,
    };
  }
  if (remaining < 2) {
    return { ...base, mode: 'unavailable', unavailableReason: '残り 2 点未満は上がれません。' };
  }

  if (remaining <= MAX_CHECKOUT) {
    const routes = rankCheckoutRoutes(remaining, dartsLeft, options);
    if (routes.length === 0) {
      /*
       * 上がれないと伝えるだけで終わらせない。
       * 残っているダートで次ラウンドへ何を残すかは、通常の SETUP と同じ
       * エンジンで決める（NEXT VISIT 専用の残し点リストや重みは作らない）。
       */
      const nextVisit =
        rankSetupRoutes(remaining, dartsLeft, {
          mainTarget: options.mainTarget,
          maxRoutes: 1,
        })[0] ?? null;
      const cannot = isBogey(remaining)
        ? `${remaining} はノーテン（Bogey）です。この残りは 3 本でも上がれません。`
        : `残り ${dartsLeft} 本では ${remaining} を上がれません。`;
      return {
        ...base,
        mode: 'checkout',
        nextVisitRoute: nextVisit,
        // 残しを提示できるときは、答えの無い「作りましょう」で終わらせない。
        unavailableReason: nextVisit === null
          ? `${cannot}次ラウンドへ良い残りを作りましょう。`
          : cannot,
      };
    }
    return { ...base, mode: 'checkout', checkoutRoutes: routes, unavailableReason: null };
  }

  const setupRoutes = rankSetupRoutes(remaining, dartsLeft, options);
  const reachable = canReachTenpai(remaining, dartsLeft);
  return {
    ...base,
    mode: 'setup',
    setupRoutes,
    canReachTenpai: reachable,
    unavailableReason: reachable
      ? null
      : `残り ${dartsLeft} 本では、この ${remaining} からテンパイを作れません。次の3投で整えます。`,
  };
}
