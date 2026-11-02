/**
 * 実戦入力（PracticePage の「実際の着弾を入力」）で、画面下に固定した帯
 * （いまの残り・本数・次の狙い・「1投戻す」）が盤面に重ならないための寸法と計算。
 *
 * 帯の高さは状態で変わる（幅 375px 以上の実測で、開いた直後は約 5rem、1 投入れて
 * 「NEXT」が出ると約 8rem、「NEXT VISIT（次ラウンドへの残し）」の候補が 1 つで約 12rem、
 * 2 つで約 16rem、3 つで約 20rem）。開いたときの高さで位置を合わせると、入力の途中で
 * 帯が伸びて盤面の下端にかぶる。そこで、伸びたときの高さ（ENTRY_BAR_RESERVE_REM）を
 * あらかじめ確保して位置と盤面の大きさを決める。
 *
 * 2026-11-02 オーナー決定（「開いたときの位置合わせ＋盤面の大きさの上限、固定は残す」）。
 * 確保は候補 2 つまでを覆う 16rem（オーナー決定）。候補 3 つの場面は、縦の短い画面では
 * 帯が盤面の下端に少しかぶる（確保を増やすと小さい画面で盤面が小さくなりすぎるため）。
 */

/** 帯のために確保する高さ（rem）。PracticePage.css の盤面の上限でも同じ値を使う。 */
export const ENTRY_BAR_RESERVE_REM = 16;

/** 盤面の上端と画面の上端のあいだに残す余白（px）。 */
export const BOARD_TOP_MARGIN_PX = 8;

export interface EntryLayout {
  /** 実戦入力のまとまり・盤面の上端と下端（いずれも画面上の座標、px）。 */
  sectionTop: number;
  boardTop: number;
  boardBottom: number;
  /** 盤面と帯のあいだの隙間（px）。 */
  gap: number;
  /** 帯のいまの高さ（px）。 */
  barHeight: number;
  /** 帯のために確保する高さ（px）。 */
  reserve: number;
  /** 画面の高さ（px）。 */
  viewportHeight: number;
}

/**
 * 実戦入力を開いたとき、まとまりの先頭を画面の上端へ合わせた位置から、
 * さらに下へずらす量（px）。0 なら先頭を上端へ合わせるだけでよい。
 *
 * 盤面の下に、帯の確保ぶん（いまの高さがそれより大きければ、いまの高さ）が
 * 画面内に収まるようにずらす。ただし盤面の上端が画面の上へ出るほどはずらさない
 * （盤面の上側が見えなくなるくらいなら、帯が下端にかぶる方を選ぶ）。
 */
export function entryScrollOffset(layout: EntryLayout): number {
  const { sectionTop, boardTop, boardBottom, gap, barHeight, reserve, viewportHeight } = layout;
  const barBottom = boardBottom - sectionTop + gap + Math.max(barHeight, reserve);
  const overflow = barBottom - viewportHeight;
  if (overflow <= 0) return 0;
  return Math.max(0, Math.min(overflow, boardTop - sectionTop - BOARD_TOP_MARGIN_PX));
}
