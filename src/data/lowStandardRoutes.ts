/**
 * LEFT 2〜40 の基準ルート（レビュー対象データ）。
 *
 * ============================================================
 *  REVIEW REQUIRED
 *  添付 Excel は 41〜170 しか収録していないため、この帯だけは
 *  「明示的なルール」で機械生成している。アルゴリズムが暗黙の好みを
 *  持たないよう、採用ルールは下記の 2 つだけに限定している。
 *  人間のレビューが済むまで reviewStatus は 'pending-human-review'。
 * ============================================================
 *
 * 採用ルール（docs/CHECKOUT_DATA_POLICY.md と同一内容）:
 *
 *   R1. LEFT が偶数（2〜40）
 *       → 1 本で上がる。D(LEFT / 2)。
 *
 *   R2. LEFT が奇数（3〜39）
 *       → シングル 1 本で「立て直しやすいダブル」を作ってから上がる。
 *         立て直しやすさは 32 → 16 → 8 → 4 → 2 の順（2 分割が続く順）とし、
 *         「シングルで到達できる（差が 1〜20）」最大のものを選ぶ。
 *
 * このルールは、41〜170 の Excel 第1候補が D16 / D20 を多用する傾向とは
 * 独立に定義している。両者の整合性は人間が確認すること。
 */

/** R2 が候補にする「立て直しやすい残り」。左から優先。 */
export const PREFERRED_EVEN_LEAVES: readonly number[] = [32, 16, 8, 4, 2];

export interface DerivedLowRoute {
  readonly left: number;
  readonly darts: readonly string[];
  /** 適用したルール。 */
  readonly rule: 'R1_DIRECT_DOUBLE' | 'R2_SINGLE_THEN_DOUBLE';
}

function deriveRoute(left: number): DerivedLowRoute {
  if (left % 2 === 0) {
    return { left, darts: [`D${left / 2}`], rule: 'R1_DIRECT_DOUBLE' };
  }
  for (const leave of PREFERRED_EVEN_LEAVES) {
    const single = left - leave;
    if (single >= 1 && single <= 20) {
      return { left, darts: [`S${single}`, `D${leave / 2}`], rule: 'R2_SINGLE_THEN_DOUBLE' };
    }
  }
  // 3〜39 の奇数はすべて R2 で解決できるため、ここへは到達しない。
  throw new Error(`LEFT ${left} の基準ルートを導出できません`);
}

/** LEFT 2〜40 の導出結果。 */
export const DERIVED_LOW_ROUTES: readonly DerivedLowRoute[] = Array.from(
  { length: 39 },
  (_, i) => deriveRoute(i + 2),
);
