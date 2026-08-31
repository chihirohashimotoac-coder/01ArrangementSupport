/**
 * ユーザー設定（MY ROUTE の得意ダブルなど）の永続化。
 *
 * 端末内保存のみ。ログイン・クラウド同期は行わない。
 * 将来サーバー同期を足せるよう、スキーマにバージョンを持たせている。
 */
import { DOUBLE_DARTS, INNER_BULL_DART, findDart } from '../domain/dart';
import { DEFAULT_SETUP_MAIN_TARGET } from '../data/rankingRules';
import { readJson, writeJson } from './localJson';

export const PREFERENCES_KEY = 'oas.preferences.v1';

export interface Preferences {
  readonly version: 1;
  /** MY ROUTE の得意ダブル（順位順）。BULL も指定できる。 */
  readonly preferredDoubles: readonly string[];
  /** SETUP で続けて狙う主目標。 */
  readonly setupMainTarget: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  preferredDoubles: ['D16', 'D20', 'D8', 'D10', 'D18'],
  setupMainTarget: DEFAULT_SETUP_MAIN_TARGET,
};

/** MY ROUTE の得意ダブルとして選べるセグメント。 */
export const SELECTABLE_FINISH_TARGETS: readonly string[] = [
  ...DOUBLE_DARTS.map((dart) => dart.id),
  INNER_BULL_DART.id,
];

function sanitize(input: Preferences): Preferences {
  const seen = new Set<string>();
  const preferredDoubles = input.preferredDoubles.filter((id) => {
    if (seen.has(id)) return false;
    if (!SELECTABLE_FINISH_TARGETS.includes(id)) return false;
    seen.add(id);
    return true;
  });
  const mainTarget = findDart(input.setupMainTarget)
    ? input.setupMainTarget
    : DEFAULT_SETUP_MAIN_TARGET;
  return { version: 1, preferredDoubles, setupMainTarget: mainTarget };
}

export function loadPreferences(): Preferences {
  const stored = readJson<Preferences>(PREFERENCES_KEY, DEFAULT_PREFERENCES);
  if (typeof stored !== 'object' || stored === null || !Array.isArray(stored.preferredDoubles)) {
    return DEFAULT_PREFERENCES;
  }
  return sanitize({ ...DEFAULT_PREFERENCES, ...stored });
}

export function savePreferences(preferences: Preferences): boolean {
  return writeJson(PREFERENCES_KEY, sanitize(preferences));
}
