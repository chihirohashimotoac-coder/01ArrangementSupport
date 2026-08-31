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
import {
  EXCEL_STANDARD_ROWS,
  type AlternativeFinish,
} from './standardCheckoutRoutes.generated';

export type StandardRouteSource = 'excel-first-candidate' | 'derived-rule-v1';

/**
 * データの確認状態。
 *
 *  - `source-of-truth`      : 一次資料（添付 Excel）そのもの
 *  - `human-approved-v1`    : 導出データだが、人間が v1 の方針として承認済み
 *                             （docs/APPROVALS.md A-4）。暫定値であり、見直す前提。
 *  - `pending-human-review` : まだ承認されていない導出データ。今後追加する場合に使う。
 */
export type ReviewStatus = 'source-of-truth' | 'human-approved-v1' | 'pending-human-review';

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
