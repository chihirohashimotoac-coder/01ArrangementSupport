/**
 * SIMULATION の画面表記。
 *
 * ターゲットは **略記だけ**で表す（「トリプル20」のような読み下しはしない）。
 * アプリ全体の表記（`displayDartId`）と同じ: S20 / D20 / T20 / S-BULL（25 点）/ D-BULL（50 点）/ MISS。
 * 以前は SIMULATION だけインナーブルを「DB」、アウターブルを「SB」と書いていた（監査フェーズ 2 / 2-3 で統一）。
 */
import { displayDartId } from '../../domain/dart';

/** 1 投の内部 ID を、画面表記へ直す。 */
export function displayTargetId(dartId: string): string {
  return displayDartId(dartId);
}

/** ルート表示を画面表記へ直す（内部 ID の並びでも、表記済みの並びでもよい）。 */
export function displayRouteText(routeText: string): string {
  return routeText
    .split(ROUTE_SEPARATOR)
    .map((token) => displayTargetId(token.trim()))
    .join(ROUTE_SEPARATOR);
}

const ROUTE_SEPARATOR = ' → ';
