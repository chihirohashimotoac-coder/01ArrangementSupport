/**
 * 添付資料「01アレンジの整理」に記載されたケースを、機械検証できる形にしたもの。
 *
 * ============================================================
 *  これは「資料に何が書かれていたか」の記録であり、正解の定義ではない。
 *  engine の計算結果と食い違った場合、資料もこのファイルも書き換えず、
 *  docs/DATA_CONFLICTS.md へ記録する（本プロンプト 36 節）。
 * ============================================================
 */

/** 資料 (3)「340点台と180後の残り」。 */
export interface After180Case {
  readonly score: number;
  readonly leave: number;
  /** 資料上の「テンパイ」欄（○ / ×）。 */
  readonly documentedTenpai: boolean;
}

export const AFTER_180_CASES: readonly After180Case[] = [
  { score: 340, leave: 160, documentedTenpai: true },
  { score: 341, leave: 161, documentedTenpai: true },
  { score: 342, leave: 162, documentedTenpai: false },
  { score: 343, leave: 163, documentedTenpai: false },
  { score: 344, leave: 164, documentedTenpai: true },
  { score: 345, leave: 165, documentedTenpai: false },
  { score: 346, leave: 166, documentedTenpai: false },
  { score: 347, leave: 167, documentedTenpai: true },
  { score: 348, leave: 168, documentedTenpai: false },
  { score: 349, leave: 169, documentedTenpai: false },
];

/** 資料 (4)「『とりあえずTON』だと失敗する数字」。 */
export interface TonTrapCase {
  readonly remaining: number;
  /** ちょうど 100 点を取ったあとの残り（資料の記載値）。 */
  readonly documentedLeaveAfterTon: number;
}

export const TON_TRAP_CASES: readonly TonTrapCase[] = [
  { remaining: 269, documentedLeaveAfterTon: 169 },
  { remaining: 268, documentedLeaveAfterTon: 168 },
  { remaining: 266, documentedLeaveAfterTon: 166 },
  { remaining: 265, documentedLeaveAfterTon: 165 },
  { remaining: 263, documentedLeaveAfterTon: 163 },
  { remaining: 262, documentedLeaveAfterTon: 162 },
  { remaining: 259, documentedLeaveAfterTon: 159 },
];

/** 資料 (4)「着地点の例（170残しへ乗せる）」。 */
export interface LandingExample {
  readonly remaining: number;
  /** 資料に書かれたルート（セグメント表記へ変換したもの）。 */
  readonly darts: readonly string[];
  /** 資料に書かれた取得点。 */
  readonly documentedScore: number;
  /** 資料に書かれた残り。 */
  readonly documentedLeave: number;
  /** 資料上の式（表示・照合用）。 */
  readonly formula: string;
};

export const LANDING_EXAMPLES: readonly LandingExample[] = [
  // 19 × 5 = 95 は「19 を 5 個ぶん」= T19 + S19 + S19（3 本）。
  { remaining: 265, darts: ['T19', 'S19', 'S19'], documentedScore: 95, documentedLeave: 170, formula: '265 = 19×5 = 95' },
  // 19 × 4 + 20 = 96 は T19 + S19 + S20。
  { remaining: 266, darts: ['T19', 'S19', 'S20'], documentedScore: 96, documentedLeave: 170, formula: '266 = 19×4+20 = 96' },
  // 19 + 20 × 4 = 99 は S19 + T20 + S20。
  { remaining: 269, darts: ['S19', 'T20', 'S20'], documentedScore: 99, documentedLeave: 170, formula: '269 = 19+20×4 = 99' },
];

/**
 * 資料 (5)「302〜309の調整例」。
 * いずれも「T20 が 2 本入った後」の 3 投目をどこへ振るか、という形。
 */
export interface ThirdDartAdjustCase {
  readonly remaining: number;
  /** 資料が示す 3 投目のシングル。 */
  readonly documentedThirdDart: number;
  /** 資料が示す最終的な残り。 */
  readonly documentedLeave: number;
}

export const THIRD_DART_ADJUST_CASES: readonly ThirdDartAdjustCase[] = [
  { remaining: 302, documentedThirdDart: 18, documentedLeave: 164 },
  { remaining: 303, documentedThirdDart: 19, documentedLeave: 164 },
  { remaining: 304, documentedThirdDart: 20, documentedLeave: 164 },
  { remaining: 305, documentedThirdDart: 18, documentedLeave: 167 },
  { remaining: 306, documentedThirdDart: 19, documentedLeave: 167 },
  { remaining: 307, documentedThirdDart: 20, documentedLeave: 167 },
  { remaining: 308, documentedThirdDart: 18, documentedLeave: 170 },
  { remaining: 309, documentedThirdDart: 19, documentedLeave: 170 },
];

/**
 * 資料 (5) の警告。
 * 302 で 3 投目を 20 にすると 162 が残り、ノーテンになる。
 */
export const THIRD_DART_TRAP = { remaining: 302, badThirdDart: 20, badLeave: 162 } as const;

/** 資料 (6) 「S-BULL（25点）を使って整える例」。 */
export interface SBullCase {
  readonly remaining: number;
  readonly darts: readonly string[];
  readonly documentedScore: number;
  readonly documentedLeave: number;
}

/** 資料 (6) A: 231〜235。 */
export const SBULL_CASES_A: readonly SBullCase[] = [
  { remaining: 231, darts: ['S20', 'S19', 'SB'], documentedScore: 64, documentedLeave: 167 },
  { remaining: 232, darts: ['S20', 'S20', 'SB'], documentedScore: 65, documentedLeave: 167 },
  { remaining: 233, darts: ['S19', 'S19', 'SB'], documentedScore: 63, documentedLeave: 170 },
  { remaining: 234, darts: ['S20', 'S19', 'SB'], documentedScore: 64, documentedLeave: 170 },
  { remaining: 235, darts: ['S20', 'S20', 'SB'], documentedScore: 65, documentedLeave: 170 },
];

/** 資料 (6) B: 271〜275。 */
export const SBULL_CASES_B: readonly SBullCase[] = [
  { remaining: 271, darts: ['T19', 'S19', 'SB'], documentedScore: 101, documentedLeave: 170 },
  { remaining: 272, darts: ['T19', 'S20', 'SB'], documentedScore: 102, documentedLeave: 170 },
  { remaining: 273, darts: ['T20', 'S18', 'SB'], documentedScore: 103, documentedLeave: 170 },
  { remaining: 274, darts: ['T20', 'S19', 'SB'], documentedScore: 104, documentedLeave: 170 },
  { remaining: 275, darts: ['T20', 'S20', 'SB'], documentedScore: 105, documentedLeave: 170 },
];
