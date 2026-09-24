/**
 * 「盤面の狙い方」— 隣り合うシングルのエリアに入ったとき、どうなるか。
 *
 * CHECKOUT の説明を補う読み取り専用の教材で、次のものには一切関与しない。
 *   - 基準ルート・CHECKOUT の順位と重み（`rankCheckoutRoutes`）
 *   - SETUP / NEXT VISIT / RECOVERY の提案
 *   - TRAINING の出題・採点・履歴
 *
 * エリアはダートの列（ルート）ではないので、RankedCheckoutRoute とは別の型で表す。
 * 各着弾の結果はデータに保存せず、表示のたびに Double Out のルール
 * （`applyDart` / `isCheckoutable` / `minDartsToCheckout` / `isBogey`）から導く。
 *
 * 狙点の半径や命中確率は扱わない。ここで分かるのは「そこへ入ったら何が残るか」
 * という決定論的な事実だけで、「どこを狙うと何 % 上がれるか」ではない。
 */
import { neighborsOf } from '../../data/boardAdjacency';
import { aimAreaDefinitionOf, type AimAreaDefinition } from '../../data/aimAreas';
import { getStandardRoute } from '../../data/standardCheckoutRoutes';
import {
  MAX_CHECKOUT,
  applyDart,
  isBogey,
  isCheckoutable,
  type BustReason,
} from '../../domain/checkoutRules';
import { FINISHING_DARTS, requireDart, type Dart } from '../../domain/dart';
import { rankCheckoutRoutes } from '../ranking/checkoutRanking';

/** 着弾したリング。本教材では S / T / D の 3 つだけを見る。 */
export type AimRing = 'single' | 'triple' | 'double';

/** エリアの中での位置づけ。 */
export type AimLandingRole =
  /** エリアのナンバー。主従は付けない。 */
  | 'area'
  /** エリアのすぐ外側の隣。エリアが「全方向に安全」ではないことを示すために見る。 */
  | 'outside';

/** 1 投がそこへ入ったときの結果の分類。 */
export type AimLandingKind =
  /** Bust。得点は無効になり、ビジット開始時の残りへ戻る。 */
  | 'bust'
  /** その 1 投で上がる（最終ダートがダブル / BULL）。 */
  | 'checkout'
  /** 残り 1 本以上あり、次の 1 本（ダブル / BULL）で上がれる。 */
  | 'finish-next-dart'
  /** 残り 2 本あり、2 本なら上がれる（次の 1 本では上がれない）。 */
  | 'finish-in-two'
  /** このビジットでは上がれないが、次ラウンドに 3 本あれば上がれる残り。 */
  | 'next-visit'
  /** 3 本あっても上がれない残り（Bogey）。 */
  | 'bogey'
  /** 170 を超える残り。 */
  | 'above-range';

export interface AimLanding {
  readonly dart: Dart;
  readonly number: number;
  readonly ring: AimRing;
  readonly role: AimLandingRole;
  readonly kind: AimLandingKind;
  /** Bust の理由。Bust でなければ null。 */
  readonly bustReason: BustReason | null;
  /**
   * 着弾後の残り。Bust のときは null（得点は確定しないのでビジット開始時へ戻る）。
   * 上がったときは 0。
   */
  readonly leave: number | null;
  /** 残り点 − 得点の仮の差（Bust でも計算する。表示で「−18」「1」を示すため）。 */
  readonly difference: number;
  /** その 1 投のあとに残る本数。 */
  readonly dartsAfter: number;
  /** `finish-next-dart` のときの上がりのダート（D18 / BULL など）。それ以外は null。 */
  readonly finishDartId: string | null;
  /**
   * `finish-in-two` のときの例。アプリの CHECKOUT がその残りで第 1 候補に出すルート。
   * それ以外は null。
   */
  readonly exampleRouteIds: readonly string[] | null;
  /** 基準ルートの 1 投目と同じ的か。 */
  readonly isStandardFirstDart: boolean;
}

export interface AimAreaAnalysis {
  readonly left: number;
  readonly dartsLeft: number;
  readonly definition: AimAreaDefinition;
  /** このビジットで上がる教材として見せられるか（残り 2 本以上）。 */
  readonly canFinishThisVisit: boolean;
  /** 盤面の時計回りの順に並べたエリアのナンバー。 */
  readonly orderedNumbers: readonly number[];
  /** エリアのすぐ外側の 2 つのナンバー（反時計回り側・時計回り側）。 */
  readonly outsideNumbers: readonly [number, number];
  /** エリア（盤面の順）→ 外側の順。各ナンバーについて S / T / D の順。外側は S のみ。 */
  readonly landings: readonly AimLanding[];
  /** エリアのうち、入ると Bust する的。 */
  readonly bustDartIds: readonly string[];
  /** エリアのシングルすべてで、次の 1 本のダブル / BULL が残るか。 */
  readonly areaSinglesFinishNextDart: boolean;
}

const RING_PREFIX: Readonly<Record<AimRing, string>> = {
  single: 'S',
  triple: 'T',
  double: 'D',
};

const RINGS: readonly AimRing[] = ['single', 'triple', 'double'];

const FINISH_DART_BY_SCORE = new Map<number, Dart>(
  FINISHING_DARTS.map((dart) => [dart.score, dart]),
);

/** 盤面上で、`numbers` がこの順に時計回りで隣り合っているか。 */
export function isClockwiseRun(numbers: readonly number[]): boolean {
  for (let index = 0; index + 1 < numbers.length; index += 1) {
    const [, clockwise] = neighborsOf(numbers[index]);
    if (clockwise !== numbers[index + 1]) return false;
  }
  return true;
}

export type AimLandingOutcome = Pick<
  AimLanding,
  'kind' | 'bustReason' | 'leave' | 'difference' | 'dartsAfter' | 'finishDartId' | 'exampleRouteIds'
>;

/**
 * 残り `left` 点・残り `dartsLeft` 本で、1 投目が `dart` に入ったときの結果。
 * エリアに限らずどの残り点・的でも計算できる（全数検査のために公開している）。
 */
export function classifyLanding(left: number, dartsLeft: number, dart: Dart): AimLandingOutcome {
  const dartsAfter = Math.max(dartsLeft - 1, 0);
  const difference = left - dart.score;
  const empty = { finishDartId: null, exampleRouteIds: null } as const;
  const result = applyDart(left, dart);

  if (result.outcome === 'bust') {
    return { kind: 'bust', bustReason: result.bustReason, leave: null, difference, dartsAfter, ...empty };
  }
  if (result.outcome === 'checkout') {
    return { kind: 'checkout', bustReason: null, leave: 0, difference, dartsAfter, ...empty };
  }

  const leave = result.remainingAfter;
  const base = { bustReason: null, leave, difference, dartsAfter } as const;
  if (dartsAfter >= 1 && isCheckoutable(leave, 1)) {
    const finish = FINISH_DART_BY_SCORE.get(leave);
    return { ...base, kind: 'finish-next-dart', finishDartId: finish?.id ?? null, exampleRouteIds: null };
  }
  if (dartsAfter >= 2 && isCheckoutable(leave, dartsAfter)) {
    // 例は、その残りを CHECKOUT に入れたときの第 1 候補（アプリの表示と揃える）。
    const example = rankCheckoutRoutes(leave, dartsAfter)[0] ?? null;
    return {
      ...base,
      kind: 'finish-in-two',
      finishDartId: null,
      exampleRouteIds: example ? example.darts.map((item) => item.id) : null,
    };
  }
  if (leave > MAX_CHECKOUT) return { ...base, kind: 'above-range', ...empty };
  if (isBogey(leave)) return { ...base, kind: 'bogey', ...empty };
  return { ...base, kind: 'next-visit', ...empty };
}

/**
 * 残り `left` 点・残り `dartsLeft` 本のときの「盤面の狙い方」を計算する。
 * 教材の対象外の残り点なら null。
 *
 * 残り 1 本でも結果は返す（`canFinishThisVisit = false`）。その場合、
 * エリアへの 1 投でこのビジットを上がれることはないので、UI はチェックアウトの
 * 狙いとして見せてはいけない。
 */
export function analyzeAimArea(left: number, dartsLeft: number): AimAreaAnalysis | null {
  const definition = aimAreaDefinitionOf(left);
  if (definition === null || dartsLeft <= 0) return null;

  const standardFirst = getStandardRoute(left)?.darts[0]?.id ?? null;
  const orderedNumbers = definition.numbers;
  const [outsideCcw] = neighborsOf(orderedNumbers[0]);
  const [, outsideCw] = neighborsOf(orderedNumbers[orderedNumbers.length - 1]);

  const landingsOf = (number: number, role: AimLandingRole, rings: readonly AimRing[]) =>
    rings.map((ring): AimLanding => {
      const dart = requireDart(`${RING_PREFIX[ring]}${number}`);
      return {
        dart,
        number,
        ring,
        role,
        isStandardFirstDart: dart.id === standardFirst,
        ...classifyLanding(left, dartsLeft, dart),
      };
    });

  const landings: AimLanding[] = [
    ...orderedNumbers.flatMap((number) => landingsOf(number, 'area', RINGS)),
    ...[outsideCcw, outsideCw].flatMap((number) => landingsOf(number, 'outside', ['single'])),
  ];

  return {
    left,
    dartsLeft,
    definition,
    canFinishThisVisit: dartsLeft >= 2,
    orderedNumbers,
    outsideNumbers: [outsideCcw, outsideCw],
    landings,
    bustDartIds: landings
      .filter((landing) => landing.role !== 'outside' && landing.kind === 'bust')
      .map((landing) => landing.dart.id),
    areaSinglesFinishNextDart: landings
      .filter((landing) => landing.role === 'area' && landing.ring === 'single')
      .every((landing) => landing.kind === 'finish-next-dart'),
  };
}
