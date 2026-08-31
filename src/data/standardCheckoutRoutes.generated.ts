/* eslint-disable */
/**
 * 自動生成ファイル — 直接編集しないこと。
 *
 * 生成元 : data/source/checkout_table_added_routes_final.xlsx（シート「チェックアウト表」）
 * 生成器 : scripts/import-checkout-excel.mjs
 * 再生成 : npm run import:checkout
 *
 * 第1候補をこのアプリの「基準ルート（Standard Route）」として扱う。
 * 出典の一次資料が確認できていないため、「PDC公式ルート」とは呼ばない
 * （docs/CHECKOUT_DATA_POLICY.md を参照）。
 *
 * 収録範囲: LEFT 41〜170 の 123 件。
 * 41〜170 のうち表に存在しない LEFT: 159, 162, 163, 165, 166, 168, 169
 *   （いずれも 3 本でチェックアウトできない Bogey Number）
 */

/** 第2〜第5候補が終わるべきダブル。 */
export type AlternativeFinish = 'D20' | 'D16' | 'D14' | 'D12';

export interface StandardAlternative {
  readonly finish: AlternativeFinish;
  /** 3 本以内で成立しない場合は null（Excel の「—」）。 */
  readonly darts: readonly string[] | null;
  /** Excel で「第1候補と同一」と記載されていた行。 */
  readonly sameAsStandard: boolean;
}

export interface StandardCheckoutRow {
  readonly left: number;
  /** 第1候補 = 基準ルート。 */
  readonly standard: readonly string[];
  readonly alternatives: readonly StandardAlternative[];
}

export const EXCEL_STANDARD_ROWS: readonly StandardCheckoutRow[] = [
  {
    left: 41,
    standard: ['S9', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['S1', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S9', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['S13', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S17', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 42,
    standard: ['S10', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['S2', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S10', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['S14', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S18', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 43,
    standard: ['S3', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['S3', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['S11', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S15', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S19', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 44,
    standard: ['S4', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['S4', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['S12', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S16', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 45,
    standard: ['S13', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['S5', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S13', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['S17', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T7', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 46,
    standard: ['S6', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['S6', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['S14', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S18', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'S2', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 47,
    standard: ['S7', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['S7', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['S15', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S19', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'S3', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 48,
    standard: ['S16', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['S8', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S16', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['S20', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T8', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 49,
    standard: ['S17', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['S9', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S17', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T7', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['SB', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 50,
    standard: ['S18', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['S10', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S18', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['S20', 'S2', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'S6', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 51,
    standard: ['S19', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['S11', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S19', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['S20', 'S3', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T9', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 52,
    standard: ['S20', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['S12', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S20', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T8', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'S8', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 53,
    standard: ['S13', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['S13', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T7', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['SB', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'S9', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 54,
    standard: ['S14', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['S14', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['S20', 'S2', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S20', 'S6', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T10', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 55,
    standard: ['S15', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['S15', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['S20', 'S3', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T9', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'S11', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 56,
    standard: ['S16', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['S16', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T8', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S20', 'S8', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'S12', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 57,
    standard: ['S17', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['S17', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['SB', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S20', 'S9', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T11', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 58,
    standard: ['S18', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['S18', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['S20', 'S6', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T10', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'S14', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 59,
    standard: ['S19', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['S19', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T9', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S20', 'S11', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'S15', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 60,
    standard: ['S20', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['S20', 'S8', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S20', 'S12', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T12', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 61,
    standard: ['T15', 'D8'],
    alternatives: [
      { finish: 'D20', darts: ['T7', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S20', 'S9', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T11', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'S17', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 62,
    standard: ['T10', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'S2', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T10', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['S20', 'S14', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'S18', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 63,
    standard: ['T13', 'D12'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'S3', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S20', 'S11', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S20', 'S15', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T13', 'D12'], sameAsStandard: true },
    ],
  },
  {
    left: 64,
    standard: ['T16', 'D8'],
    alternatives: [
      { finish: 'D20', darts: ['T8', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S20', 'S12', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T12', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['S20', 'S20', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 65,
    standard: ['T19', 'D4'],
    alternatives: [
      { finish: 'D20', darts: ['SB', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T11', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S20', 'S17', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T13', 'S2', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 66,
    standard: ['T14', 'D12'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'S6', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S20', 'S14', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S20', 'S18', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T14', 'D12'], sameAsStandard: true },
    ],
  },
  {
    left: 67,
    standard: ['T17', 'D8'],
    alternatives: [
      { finish: 'D20', darts: ['T9', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S20', 'S15', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T13', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T14', 'S1', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 68,
    standard: ['T20', 'D4'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'S8', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T12', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['S20', 'S20', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T14', 'S2', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 69,
    standard: ['T19', 'D6'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'S9', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S20', 'S17', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T13', 'S2', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T15', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 70,
    standard: ['T18', 'D8'],
    alternatives: [
      { finish: 'D20', darts: ['T10', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S20', 'S18', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T14', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T15', 'S1', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 71,
    standard: ['T13', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'S11', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T13', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T14', 'S1', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T15', 'S2', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 72,
    standard: ['T16', 'D12'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'S12', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['S20', 'S20', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T14', 'S2', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T16', 'D12'], sameAsStandard: true },
    ],
  },
  {
    left: 73,
    standard: ['T19', 'D8'],
    alternatives: [
      { finish: 'D20', darts: ['T11', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T13', 'S2', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T15', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T16', 'S1', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 74,
    standard: ['T14', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'S14', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T14', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T15', 'S1', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['BULL', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 75,
    standard: ['T17', 'D12'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'S15', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T14', 'S1', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T15', 'S2', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T17', 'D12'], sameAsStandard: true },
    ],
  },
  {
    left: 76,
    standard: ['T20', 'D8'],
    alternatives: [
      { finish: 'D20', darts: ['T12', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T14', 'S2', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T16', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T17', 'S1', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 77,
    standard: ['T19', 'D10'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'S17', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T15', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T16', 'S1', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T17', 'S2', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 78,
    standard: ['T18', 'D12'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'S18', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T15', 'S1', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['BULL', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T18', 'D12'], sameAsStandard: true },
    ],
  },
  {
    left: 79,
    standard: ['T19', 'D11'],
    alternatives: [
      { finish: 'D20', darts: ['T13', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T15', 'S2', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T17', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T18', 'S1', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 80,
    standard: ['T20', 'D10'],
    alternatives: [
      { finish: 'D20', darts: ['S20', 'S20', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T16', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T17', 'S1', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T18', 'S2', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 81,
    standard: ['T19', 'D12'],
    alternatives: [
      { finish: 'D20', darts: ['T13', 'S2', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T16', 'S1', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T17', 'S2', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T19', 'D12'], sameAsStandard: true },
    ],
  },
  {
    left: 82,
    standard: ['BULL', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T14', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['BULL', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T18', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T19', 'S1', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 83,
    standard: ['T17', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T14', 'S1', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T17', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T18', 'S1', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T19', 'S2', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 84,
    standard: ['T20', 'D12'],
    alternatives: [
      { finish: 'D20', darts: ['T14', 'S2', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T17', 'S1', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T18', 'S2', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'D12'], sameAsStandard: true },
    ],
  },
  {
    left: 85,
    standard: ['T15', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T15', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T17', 'S2', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T19', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S1', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 86,
    standard: ['T18', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T15', 'S1', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T18', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T19', 'S1', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S2', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 87,
    standard: ['T17', 'D18'],
    alternatives: [
      { finish: 'D20', darts: ['T15', 'S2', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T18', 'S1', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T19', 'S2', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S3', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 88,
    standard: ['T20', 'D14'],
    alternatives: [
      { finish: 'D20', darts: ['T16', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T18', 'S2', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'D14'], sameAsStandard: true },
      { finish: 'D12', darts: ['T20', 'S4', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 89,
    standard: ['T19', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T16', 'S1', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T19', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T20', 'S1', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S5', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 90,
    standard: ['T20', 'D15'],
    alternatives: [
      { finish: 'D20', darts: ['BULL', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T19', 'S1', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S2', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S6', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 91,
    standard: ['T17', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T17', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T19', 'S2', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S3', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S7', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 92,
    standard: ['T20', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T17', 'S1', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T20', 'S4', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S8', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 93,
    standard: ['T19', 'D18'],
    alternatives: [
      { finish: 'D20', darts: ['T17', 'S2', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S1', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S5', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S9', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 94,
    standard: ['T18', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T18', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T20', 'S2', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S6', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S10', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 95,
    standard: ['T19', 'D19'],
    alternatives: [
      { finish: 'D20', darts: ['T18', 'S1', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S3', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S7', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S11', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 96,
    standard: ['T20', 'D18'],
    alternatives: [
      { finish: 'D20', darts: ['T18', 'S2', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S4', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S8', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S12', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 97,
    standard: ['T19', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T19', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T20', 'S5', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S9', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S13', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 98,
    standard: ['T20', 'D19'],
    alternatives: [
      { finish: 'D20', darts: ['T19', 'S1', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S6', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S10', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S14', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 99,
    standard: ['T19', 'S10', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T19', 'S2', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S7', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S11', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S15', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 100,
    standard: ['T20', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T20', 'S8', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S12', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S16', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 101,
    standard: ['T20', 'S9', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S1', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S9', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T20', 'S13', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S17', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 102,
    standard: ['T16', 'S14', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S2', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S10', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S14', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S18', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 103,
    standard: ['T19', 'S6', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S3', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S11', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S15', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S19', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 104,
    standard: ['T16', 'S16', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S4', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S12', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S16', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'S20', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 105,
    standard: ['T20', 'S13', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S5', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S13', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T20', 'S17', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T17', 'T10', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 106,
    standard: ['T20', 'S6', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S6', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T20', 'S14', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S18', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T19', 'SB', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 107,
    standard: ['T19', 'S10', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S7', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S15', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'S19', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T17', 'D16', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 108,
    standard: ['T20', 'S16', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S8', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S16', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T20', 'S20', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'D12', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 109,
    standard: ['T20', 'S17', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S9', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S17', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T17', 'T10', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'SB', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 110,
    standard: ['T20', 'S10', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S10', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T20', 'S18', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T18', 'D14', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T18', 'D16', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 111,
    standard: ['T19', 'S14', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S11', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S19', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T17', 'D16', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T19', 'T10', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 112,
    standard: ['T20', 'S20', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S12', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'S20', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: ['T18', 'T10', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'D14', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 113,
    standard: ['T19', 'S16', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S13', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T17', 'T10', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'SB', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T19', 'D16', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 114,
    standard: ['T20', 'S14', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S14', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T19', 'SB', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T18', 'D16', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'T10', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 115,
    standard: ['T20', 'S15', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S15', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T17', 'D16', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T19', 'T10', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T17', 'D20', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 116,
    standard: ['T20', 'S16', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S16', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T18', 'T10', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'D14', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'D16', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 117,
    standard: ['T20', 'S17', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S17', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T20', 'SB', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T19', 'D16', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'T11', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 118,
    standard: ['T20', 'S18', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S18', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T18', 'D16', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'T10', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T18', 'D20', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 119,
    standard: ['T19', 'S12', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S19', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T19', 'T10', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T17', 'D20', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T15', 'BULL', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 120,
    standard: ['T20', 'S20', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'S20', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T20', 'D14', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'D16', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'T12', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 121,
    standard: ['T20', 'S11', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: ['T17', 'T10', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T19', 'D16', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'T11', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T19', 'D20', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 122,
    standard: ['T18', 'S18', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: ['T19', 'SB', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'T10', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T18', 'D20', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T16', 'BULL', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 123,
    standard: ['T19', 'S16', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: ['T17', 'D16', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T17', 'D20', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T15', 'BULL', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'T13', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 124,
    standard: ['T20', 'S14', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: ['T18', 'T10', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'D16', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'T12', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'D20', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 125,
    standard: ['SB', 'T20', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'SB', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'T11', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T19', 'D20', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T17', 'BULL', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 126,
    standard: ['T19', 'S19', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: ['T18', 'D16', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T18', 'D20', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T16', 'BULL', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'T14', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 127,
    standard: ['T20', 'S17', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: ['T19', 'T10', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T15', 'BULL', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'T13', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 128,
    standard: ['S18', 'T20', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: ['T16', 'D20', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'T12', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'D20', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T18', 'BULL', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 129,
    standard: ['S19', 'T20', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: ['T19', 'D16', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T19', 'D20', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T17', 'BULL', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'T15', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 130,
    standard: ['T20', 'S20', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'T10', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T16', 'BULL', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'T14', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 131,
    standard: ['T20', 'T13', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T17', 'D20', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'T13', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: ['T19', 'BULL', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 132,
    standard: ['SB', 'T19', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'D16', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'D20', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T18', 'BULL', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'T16', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 133,
    standard: ['T20', 'T19', 'D8'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'T11', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T17', 'BULL', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'T15', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 134,
    standard: ['T20', 'T14', 'D16'],
    alternatives: [
      { finish: 'D20', darts: ['T18', 'D20', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'T14', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'BULL', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 135,
    standard: ['SB', 'T20', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: ['T15', 'BULL', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: ['T19', 'BULL', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'T17', 'D12'], sameAsStandard: false },
    ],
  },
  {
    left: 136,
    standard: ['T20', 'T20', 'D8'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'T12', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T18', 'BULL', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'T16', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 137,
    standard: ['T20', 'T19', 'D10'],
    alternatives: [
      { finish: 'D20', darts: ['T19', 'D20', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'T15', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 138,
    standard: ['T20', 'T18', 'D12'],
    alternatives: [
      { finish: 'D20', darts: ['T16', 'BULL', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'BULL', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'T18', 'D12'], sameAsStandard: true },
    ],
  },
  {
    left: 139,
    standard: ['T19', 'T14', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'T13', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T19', 'BULL', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'T17', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 140,
    standard: ['T20', 'T20', 'D10'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'D20', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'T16', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 141,
    standard: ['T20', 'T19', 'D12'],
    alternatives: [
      { finish: 'D20', darts: ['T17', 'BULL', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'T19', 'D12'], sameAsStandard: true },
    ],
  },
  {
    left: 142,
    standard: ['T20', 'T14', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'T14', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: ['T20', 'BULL', 'D16'], sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'T18', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 143,
    standard: ['T20', 'T17', 'D16'],
    alternatives: [
      { finish: 'D20', darts: null, sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'T17', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 144,
    standard: ['T20', 'T20', 'D12'],
    alternatives: [
      { finish: 'D20', darts: ['T18', 'BULL', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: ['T20', 'T20', 'D12'], sameAsStandard: true },
    ],
  },
  {
    left: 145,
    standard: ['T20', 'T15', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'T15', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'T19', 'D14'], sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 146,
    standard: ['T20', 'T18', 'D16'],
    alternatives: [
      { finish: 'D20', darts: null, sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'T18', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 147,
    standard: ['T20', 'T17', 'D18'],
    alternatives: [
      { finish: 'D20', darts: ['T19', 'BULL', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 148,
    standard: ['T20', 'T20', 'D14'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'T16', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: ['T20', 'T20', 'D14'], sameAsStandard: true },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 149,
    standard: ['T20', 'T19', 'D16'],
    alternatives: [
      { finish: 'D20', darts: null, sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'T19', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 150,
    standard: ['T20', 'T18', 'D18'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'BULL', 'D20'], sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 151,
    standard: ['T20', 'T17', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'T17', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 152,
    standard: ['T20', 'T20', 'D16'],
    alternatives: [
      { finish: 'D20', darts: null, sameAsStandard: false },
      { finish: 'D16', darts: ['T20', 'T20', 'D16'], sameAsStandard: true },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 153,
    standard: ['T20', 'T19', 'D18'],
    alternatives: [
      { finish: 'D20', darts: null, sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 154,
    standard: ['T20', 'T18', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'T18', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 155,
    standard: ['T20', 'T19', 'D19'],
    alternatives: [
      { finish: 'D20', darts: null, sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 156,
    standard: ['T20', 'T20', 'D18'],
    alternatives: [
      { finish: 'D20', darts: null, sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 157,
    standard: ['T20', 'T19', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'T19', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 158,
    standard: ['T20', 'T20', 'D19'],
    alternatives: [
      { finish: 'D20', darts: null, sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 160,
    standard: ['T20', 'T20', 'D20'],
    alternatives: [
      { finish: 'D20', darts: ['T20', 'T20', 'D20'], sameAsStandard: true },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 161,
    standard: ['T20', 'T17', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: null, sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 164,
    standard: ['T20', 'T18', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: null, sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 167,
    standard: ['T20', 'T19', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: null, sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
  {
    left: 170,
    standard: ['T20', 'T20', 'BULL'],
    alternatives: [
      { finish: 'D20', darts: null, sameAsStandard: false },
      { finish: 'D16', darts: null, sameAsStandard: false },
      { finish: 'D14', darts: null, sameAsStandard: false },
      { finish: 'D12', darts: null, sameAsStandard: false },
    ],
  },
];
