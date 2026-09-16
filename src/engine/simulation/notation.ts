/**
 * SIMULATION の画面表記。
 *
 * ターゲットは **略記だけ**で表す（「トリプル20」のような読み下しはしない）。
 *
 * | 的 | 表記 |
 * | --- | --- |
 * | シングル 20 | `S20` |
 * | ダブル 20 | `D20` |
 * | トリプル 20 | `T20` |
 * | アウターブル（25 点） | `SB` |
 * | インナーブル（50 点） | `DB` |
 * | 盤外 | `MISS` |
 *
 * `Dart.id` はほぼそのまま使えるが、インナーブルだけは内部 ID が `BULL` なので
 * `DB` へ読み替える。内部 ID は既存モード・データファイル・テストフィクスチャと
 * 共有しているため**変更しない**（ここは表示だけの写像）。
 */

/** 1 投の内部 ID を、SIMULATION の画面表記へ直す。 */
export function displayTargetId(dartId: string): string {
  return dartId === 'BULL' ? 'DB' : dartId;
}

/** ルート表示（`formatRoute` の "T20 → T20 → BULL"）を画面表記へ直す。 */
export function displayRouteText(routeText: string): string {
  return routeText
    .split(ROUTE_SEPARATOR)
    .map((token) => displayTargetId(token.trim()))
    .join(ROUTE_SEPARATOR);
}

const ROUTE_SEPARATOR = ' → ';
