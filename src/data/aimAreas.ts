/**
 * 「盤面の狙い方」（隣り合うシングルのエリア）の教材定義。
 *
 * ============================================================
 *  これは戦術ランキングのデータではない。
 *  基準ルート・評価の重み・TRAINING の採点には一切使わない、
 *  読み取り専用の説明用データである。
 * ============================================================
 *
 * ここに持つのは「どの残り点で、盤面のどのナンバーを一まとまりとして見せるか」
 * だけ。着弾ごとの残り点・上がりのダブル・Bust かどうかは保存せず、
 * 表示のたびに `engine/aimArea` が `applyDart()` などのルール計算から導く。
 *
 * 対象は次の 5 点に限る（2〜170 の全数探索で見つかる他の候補は自動公開しない）。
 * 追加するときは人間がレビューし、別の小さな変更として増やすこと。
 *
 * 「プロが使う」「確率的に最良」といった主張はしない。
 * ナンバーの並びは盤面の物理配置（BOARD_NUMBERS）と一致することをテストで確認する。
 */

export interface AimAreaDefinition {
  /** 対象の残り点。 */
  readonly left: number;
  /**
   * エリアのナンバー。盤面上で連続するナンバーを、盤面の時計回りの順で並べる。
   * どのシングルに入っても、次の 1 本でダブルが残る（テストで確認する）。
   *
   * エリア内のナンバーに主従・優先順位は付けない。どのナンバーについても、
   * 着弾したときの事実（残り点・上がりのダブル・Bust）だけを同じ形で示す。
   * 「どこを主に狙うか」は戦術判断であり、承認記録（docs/APPROVALS.md）なしに
   * ここへ持ち込まない。
   */
  readonly numbers: readonly number[];
  /** 狙うリング。本教材ではシングル帯（内側・外側）だけを扱う。 */
  readonly targetRing: 'single';
  /** 教育用の補足であり、戦術ランキングではないことを型で明示する。 */
  readonly scope: 'educational';
}

export const AIM_AREAS: readonly AimAreaDefinition[] = [
  { left: 42, numbers: [6, 10], targetRing: 'single', scope: 'educational' },
  { left: 46, numbers: [6, 10], targetRing: 'single', scope: 'educational' },
  { left: 48, numbers: [16, 8], targetRing: 'single', scope: 'educational' },
  { left: 39, numbers: [17, 3, 19, 7], targetRing: 'single', scope: 'educational' },
  { left: 43, numbers: [3, 19, 7], targetRing: 'single', scope: 'educational' },
];

const AIM_AREA_BY_LEFT = new Map<number, AimAreaDefinition>(
  AIM_AREAS.map((area) => [area.left, area]),
);

/** 残り点に対応するエリア定義。対象外なら null。 */
export function aimAreaDefinitionOf(left: number): AimAreaDefinition | null {
  return AIM_AREA_BY_LEFT.get(left) ?? null;
}
