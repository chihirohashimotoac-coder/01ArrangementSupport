/**
 * 「次のビジットでダブルへ到達するまでに、何を要求される残りか」の分類
 * （Next Visit Leave Profile）。**SIMULATION のレビュー専用**。
 *
 * ## なぜ要るのか
 *
 * ビジット最後の 1 投の評価（`lastDartSetup.ts`）は「次のラウンドに 3 本で
 * 上がれるか」だけを見ていたので、残り 116 から
 *
 *   - S16 → 100（次のビジットは T20 を決めてから D20）
 *   - T20 → 56 （次のビジットは S16 1 本で D20 が残る。S20 へ落ちても 96）
 *
 * がどちらも「テンパイ」で同列の GOOD DECISION になっていた。
 *
 * ここでは残り点を、**次のビジットの 1 投目に要求される的の種類**で分ける。
 * 「残りが小さいほど良い」とはしない（100 より 68 が小さいからといって、
 * T20 → D4 の 68 を上に見ない。どちらも先にトリプルが要る）。
 *
 * | 段階 | 分類 | 意味 | 例 |
 * | --- | --- | --- | --- |
 * | 0 | `DIRECT_DOUBLE` | 1 投目から外側のダブルを狙える | 40 → D20 / 32 → D16 |
 * | 1 | `AIM_AREA` | 承認済みの「盤面の狙い方」のエリア（複数のシングルからダブルが残る） | 39 / 42 / 43 / 46 / 48 |
 * | 1 | `SINGLE_TO_DOUBLE` | 通常のシングル 1 本で外側のダブルが残る | 56 → S16 → D20 |
 * | 2 | `TWO_DART_OTHER` | 2 本で上がれるが、先にトリプル / BULL / ダブルが要る | 96 → T20 → D18 |
 * | 3 | `THREE_DART` | 上がりに 3 本を使う | 118 |
 * | 4 | `NO_CHECKOUT` | 3 本でも上がれない（Bogey・170 超） | 159 |
 *
 * - BULL（50）は上がりの的として数えない。50 は S10 → D20 などで
 *   `SINGLE_TO_DOUBLE` になり、外側ダブル 1 本の残りと同じ最上位には置かない
 *   （BULL を SETUP の得点手段にしない既存方針と向きを揃える）。
 * - `AIM_AREA` は `data/aimAreas.ts` の承認済みの 5 点だけを使う。定義は変えない。
 * - どのダブルで上がるか（得意ダブル・MY ROUTE）はここでは区別しない。
 *   外側のダブルはどれも同じ扱いにし、得意ダブルの設定と衝突させない。
 *
 * 使い方は「別の的が明確な上位互換か」の比較だけ（`review.ts`）。
 * 全ターゲットへ点数を付けて順位づけする用途には使わない。
 */
import { aimAreaDefinitionOf } from '../../data/aimAreas';
import { getStandardRoute } from '../../data/standardCheckoutRoutes';
import { MAX_CHECKOUT, MIN_CHECKOUT, isCheckoutable } from '../../domain/checkoutRules';
import type { Dart } from '../../domain/dart';

export type LeaveProfileKind =
  | 'DIRECT_DOUBLE'
  | 'AIM_AREA'
  | 'SINGLE_TO_DOUBLE'
  | 'TWO_DART_OTHER'
  | 'THREE_DART'
  | 'NO_CHECKOUT';

/**
 * 比較に使う段階。小さいほど「次のビジットでダブルへ到達しやすい」。
 *
 * `AIM_AREA` は `SINGLE_TO_DOUBLE` と**同じ段階**に置く。どちらも「シングル 1 本で
 * 外側のダブルが残る」残りで、エリアの広さは説明に添える事実にとどめる。
 * 広さで段階を分けると、48（S16 / S8 のエリア）と 52（S12 → D20）のような
 * 近い残りの差で、承認済みの NEXT VISIT が選ぶ残し（半分にし続けられる回数など、
 * A-10）まで上書きしてしまうため。
 */
export const LEAVE_PROFILE_RANK: Readonly<Record<LeaveProfileKind, number>> = {
  DIRECT_DOUBLE: 0,
  AIM_AREA: 1,
  SINGLE_TO_DOUBLE: 1,
  TWO_DART_OTHER: 2,
  THREE_DART: 3,
  NO_CHECKOUT: 4,
};

export interface LeaveProfile {
  readonly leave: number;
  readonly kind: LeaveProfileKind;
  /** `LEAVE_PROFILE_RANK` の段階。小さいほど良い。 */
  readonly rank: number;
  /**
   * 説明用の上がりの例（内部 ID の並び）。`DIRECT_DOUBLE` / `SINGLE_TO_DOUBLE` /
   * `TWO_DART_OTHER` のときだけ。それ以外は null。
   */
  readonly exampleDartIds: readonly string[] | null;
}

/** 外側のダブル（D1〜D20）で直接上がれる残りか。BULL（50）は含めない。 */
function isOuterDoubleLeave(leave: number): boolean {
  return leave >= MIN_CHECKOUT && leave <= 40 && leave % 2 === 0;
}

/** 通常のシングル（S1〜S20）1 本で外側のダブルが残るときの、その 2 本。 */
function singleToDoubleOf(leave: number): readonly string[] | null {
  const standard = getStandardRoute(leave);
  if (standard !== null && standard.darts.length === 2) {
    const [first, finish] = standard.darts;
    if (first.kind === 'single' && first.baseNumber !== null && isOuterDoubleLeave(finish.score)) {
      return [first.id, finish.id];
    }
  }
  // 基準ルートがこの形でなければ、残るダブルが大きい（＝外側で広い）順に探す。
  for (let single = 1; single <= 20; single += 1) {
    const rest = leave - single;
    if (isOuterDoubleLeave(rest)) return [`S${single}`, `D${rest / 2}`];
  }
  return null;
}

const cache = new Map<number, LeaveProfile>();

function profileOf(leave: number, kind: LeaveProfileKind, exampleDartIds: readonly string[] | null): LeaveProfile {
  return { leave, kind, rank: LEAVE_PROFILE_RANK[kind], exampleDartIds };
}

/** 残り点の Next Visit Leave Profile。 */
export function nextVisitLeaveProfileOf(leave: number): LeaveProfile {
  const cached = cache.get(leave);
  if (cached) return cached;

  let profile: LeaveProfile;
  if (leave < MIN_CHECKOUT || leave > MAX_CHECKOUT || !isCheckoutable(leave, 3)) {
    profile = profileOf(leave, 'NO_CHECKOUT', null);
  } else if (isOuterDoubleLeave(leave)) {
    profile = profileOf(leave, 'DIRECT_DOUBLE', [`D${leave / 2}`]);
  } else if (aimAreaDefinitionOf(leave) !== null) {
    profile = profileOf(leave, 'AIM_AREA', singleToDoubleOf(leave));
  } else if (singleToDoubleOf(leave) !== null) {
    profile = profileOf(leave, 'SINGLE_TO_DOUBLE', singleToDoubleOf(leave));
  } else if (isCheckoutable(leave, 2)) {
    const standard = getStandardRoute(leave);
    const example =
      standard !== null && standard.darts.length === 2
        ? standard.darts.map((dart: Dart) => dart.id)
        : null;
    profile = profileOf(leave, 'TWO_DART_OTHER', example);
  } else {
    profile = profileOf(leave, 'THREE_DART', null);
  }

  cache.set(leave, profile);
  return profile;
}

/**
 * `a` の組（狙い通り・シングル落ち）が `b` の組の**明確な上位互換**か。
 *
 * 両方で悪化せず、少なくとも一方で改善しているときだけ true。
 * 一方で良く一方で悪い組は「好みの差」として上位互換にしない。
 */
export function dominatesLeavePair(
  a: { readonly hit: LeaveProfile; readonly miss: LeaveProfile },
  b: { readonly hit: LeaveProfile; readonly miss: LeaveProfile },
): boolean {
  if (a.hit.rank > b.hit.rank || a.miss.rank > b.miss.rank) return false;
  return a.hit.rank < b.hit.rank || a.miss.rank < b.miss.rank;
}
