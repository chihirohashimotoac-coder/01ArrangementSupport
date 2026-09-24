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
   * 基本のエリア。盤面上で連続するナンバーを、盤面の時計回りの順で並べる。
   * どのシングルに入っても、次の 1 本でダブルが残る。
   */
  readonly coreNumbers: readonly number[];
  /**
   * 条件付きの拡張。基本エリアの隣に続くナンバーで、シングルならダブルが残るが、
   * 基本エリアとは条件が異なるもの（例: 39 の 17 は S17 → D11 の奇数ダブル、T17 は Bust）。
   * 画面では事実だけを示し、「勧める／勧めない」の戦術判断は付けない。
   */
  readonly extensionNumbers: readonly number[];
  /** 狙うリング。本教材ではシングル帯（内側・外側）だけを扱う。 */
  readonly targetRing: 'single';
  /** 教育用の補足であり、戦術ランキングではないことを型で明示する。 */
  readonly scope: 'educational';
}

export const AIM_AREAS: readonly AimAreaDefinition[] = [
  { left: 42, coreNumbers: [6, 10], extensionNumbers: [], targetRing: 'single', scope: 'educational' },
  { left: 46, coreNumbers: [6, 10], extensionNumbers: [], targetRing: 'single', scope: 'educational' },
  { left: 48, coreNumbers: [16, 8], extensionNumbers: [], targetRing: 'single', scope: 'educational' },
  { left: 39, coreNumbers: [3, 19, 7], extensionNumbers: [17], targetRing: 'single', scope: 'educational' },
  { left: 43, coreNumbers: [3, 19, 7], extensionNumbers: [], targetRing: 'single', scope: 'educational' },
];

const AIM_AREA_BY_LEFT = new Map<number, AimAreaDefinition>(
  AIM_AREAS.map((area) => [area.left, area]),
);

/** 残り点に対応するエリア定義。対象外なら null。 */
export function aimAreaDefinitionOf(left: number): AimAreaDefinition | null {
  return AIM_AREA_BY_LEFT.get(left) ?? null;
}
