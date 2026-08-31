/**
 * Bogey Number（ノーテン）の定義データ。
 *
 * ここに書いた一覧は「人間が合意した定義」であり、
 * domain/checkoutRules.ts の動的計画法による計算結果と一致することを
 * ユニットテストで常に検証する（片方だけが壊れることを防ぐ）。
 *
 * 変更には Human Approval が必要（docs/ARRANGE_RULES.md）。
 */

/** 2〜170 のうち、3 本あってもチェックアウトできない残り点。 */
export const BOGEY_NUMBERS: readonly number[] = [159, 162, 163, 165, 166, 168, 169];

/**
 * 「180 を出した直後の残り」がテンパイになる 340 点台。
 * 添付資料 (3) の表に対応する。
 */
export const TENPAI_AFTER_180_IN_340S: readonly number[] = [340, 341, 344, 347];

/**
 * 添付資料 (2) の「覚えるべき数字」。
 * 159〜170 の帯では、下一桁が 0 / 1 / 4 / 7 のときだけ 3 本で上がれる。
 *
 * これは 159〜170 という限られた帯でだけ成り立つ経験則であり、
 * すべての残り点に一般化できるルールではない（docs/SETUP_THEORY.md 参照）。
 */
export const MEMORABLE_LAST_DIGITS: readonly number[] = [0, 1, 4, 7];

/** 経験則が成り立つ帯。 */
export const LAST_DIGIT_RULE_BAND = { min: 159, max: 170 } as const;

/** 159〜170 の帯で 3 本チェックアウト可能な残り点（添付資料 (2)）。 */
export const CHECKOUTABLE_IN_BAND: readonly number[] = [160, 161, 164, 167, 170];
