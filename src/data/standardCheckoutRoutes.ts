/**
 * STANDARD（基準ルート）データの統合アクセサ。
 *
 * 出典が 2 系統あるため、どの LEFT がどちらから来たかを必ず保持する。
 *   - 41〜170 : 添付 Excel の第1候補（source of truth。自動修正禁止）
 *   - 2〜40   : 明示ルールによる導出（v1 として人間承認済み）
 *
 * Excel のヘッダーには「PDC頻出ルート」とあるが、一次資料が確認できないため
 * アプリ内では「基準ルート / Standard Route」とだけ呼ぶ
 * （docs/CHECKOUT_DATA_POLICY.md の DATA CONFLICT #1）。
 */
import { parseRoute, type Dart } from '../domain/dart';
import { DERIVED_LOW_ROUTES } from './lowStandardRoutes';
import { TWO_DART_STANDARD_ROUTES } from './twoDartStandardRoutes';
import {
  EXCEL_STANDARD_ROWS,
  type AlternativeFinish,
} from './standardCheckoutRoutes.generated';

export type StandardRouteSource = 'excel-first-candidate' | 'derived-rule-v1' | 'derived-two-dart-v2';

/**
 * データの確認状態。
 *
 *  - `source-of-truth`      : 一次資料（添付 Excel）そのもの
 *  - `human-approved-v1`    : 導出データだが、人間が v1 の方針として承認済み
 *                             （docs/APPROVALS.md A-4）。暫定値であり、見直す前提。
 *  - `pending-human-review` : まだ承認されていない導出データ。今後追加する場合に使う。
 */
export type ReviewStatus =
  | 'source-of-truth'
  | 'human-approved-v1'
  | 'human-approved-v2'
  | 'pending-human-review';

export interface StandardAlternativeRoute {
  readonly finish: AlternativeFinish;
  readonly darts: readonly Dart[] | null;
  readonly sameAsStandard: boolean;
}

export interface StandardRouteEntry {
  readonly left: number;
  readonly darts: readonly Dart[];
  readonly source: StandardRouteSource;
  readonly reviewStatus: ReviewStatus;
  /** Excel の第2〜第5候補（D20 / D16 / D14 / D12 終わり）。2〜40 では空。 */
  readonly alternatives: readonly StandardAlternativeRoute[];
}

const entries: StandardRouteEntry[] = [];

for (const row of DERIVED_LOW_ROUTES) {
  entries.push({
    left: row.left,
    darts: parseRoute(row.darts),
    source: 'derived-rule-v1',
    // v1 の基準ルートとして承認済み（docs/APPROVALS.md A-4）。
    reviewStatus: 'human-approved-v1',
    alternatives: [],
  });
}

for (const row of EXCEL_STANDARD_ROWS) {
  entries.push({
    left: row.left,
    darts: parseRoute(row.standard),
    source: 'excel-first-candidate',
    reviewStatus: 'source-of-truth',
    alternatives: row.alternatives.map((alt) => ({
      finish: alt.finish,
      darts: alt.darts ? parseRoute(alt.darts) : null,
      sameAsStandard: alt.sameAsStandard,
    })),
  });
}

entries.sort((a, b) => a.left - b.left);

/** LEFT 昇順の全基準ルート。 */
export const STANDARD_ROUTES: readonly StandardRouteEntry[] = entries;

const BY_LEFT = new Map(entries.map((entry) => [entry.left, entry]));

/** 指定 LEFT の基準ルート。存在しない（Bogey など）場合は null。 */
export function getStandardRoute(left: number): StandardRouteEntry | null {
  return BY_LEFT.get(left) ?? null;
}

/** 基準ルートを持つ LEFT の一覧。 */
export const STANDARD_ROUTE_LEFTS: readonly number[] = entries.map((entry) => entry.left);

/*
 * 残り 2 本のときだけの基準ルート（51〜70。docs/APPROVALS.md A-27）。
 * 残り 3 本・次ラウンドの残しの評価（evaluateLeave）は getStandardRoute() のまま。
 */
const TWO_DART_BY_LEFT = new Map<number, StandardRouteEntry>(
  TWO_DART_STANDARD_ROUTES.map((row) => [
    row.left,
    {
      left: row.left,
      darts: parseRoute(row.darts),
      source: 'derived-two-dart-v2',
      reviewStatus: 'human-approved-v2',
      alternatives: [],
    },
  ]),
);

/** 残り 2 本・51〜70 で使う基準ルートの一覧。 */
export const TWO_DART_STANDARD_ENTRIES: readonly StandardRouteEntry[] = [...TWO_DART_BY_LEFT.values()];

/**
 * 残り本数を考えた基準ルート。残り 2 本の 51〜70 だけ導出規則（R3 / R4）を返し、
 * それ以外は getStandardRoute()（2〜40 の導出規則 / 41〜170 の Excel 第 1 候補）と同じ。
 */
export function getStandardRouteFor(left: number, dartsAvailable: number): StandardRouteEntry | null {
  if (dartsAvailable === 2) {
    const twoDart = TWO_DART_BY_LEFT.get(left);
    if (twoDart) return twoDart;
  }
  return getStandardRoute(left);
}
