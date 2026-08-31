/**
 * 学習履歴の保存と集計。
 *
 * 端末内（localStorage）のみ。初期版では Export / Import・クラウド同期は行わないが、
 * レコードを平坦な配列で持ち、集計は読み出し時に計算する形にしてあるため、
 * 後から JSON として出し入れしやすい構造にしている。
 */
import type { RouteGrade } from '../data/rankingRules';
import type { TrainingKind } from '../engine/training/questions';
import { readJson, removeKey, writeJson } from './localJson';

export const TRAINING_HISTORY_KEY = 'oas.training.v1';

/** 保存するレコードの上限（localStorage を圧迫しないため）。 */
export const MAX_RECORDS = 500;

export interface TrainingRecord {
  readonly id: string;
  /** 記録時刻（epoch ミリ秒）。 */
  readonly at: number;
  readonly kind: TrainingKind;
  readonly remaining: number;
  readonly dartsAvailable: number;
  /** 回答したセグメント表記。 */
  readonly answer: readonly string[];
  /** ルールとして成立したか。 */
  readonly valid: boolean;
  readonly grade: RouteGrade | null;
  /** 上がりに使ったダブル（SETUP では null）。 */
  readonly finishDouble: string | null;
  readonly elapsedMs: number;
}

export interface TrainingHistory {
  readonly version: 1;
  readonly records: readonly TrainingRecord[];
}

const EMPTY_HISTORY: TrainingHistory = { version: 1, records: [] };

export function loadHistory(): TrainingHistory {
  const stored = readJson<TrainingHistory>(TRAINING_HISTORY_KEY, EMPTY_HISTORY);
  if (typeof stored !== 'object' || stored === null || !Array.isArray(stored.records)) {
    return EMPTY_HISTORY;
  }
  return { version: 1, records: stored.records };
}

export function appendRecord(record: TrainingRecord): TrainingHistory {
  const history = loadHistory();
  const records = [...history.records, record].slice(-MAX_RECORDS);
  const next: TrainingHistory = { version: 1, records };
  writeJson(TRAINING_HISTORY_KEY, next);
  return next;
}

export function clearHistory(): void {
  removeKey(TRAINING_HISTORY_KEY);
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

export interface Breakdown {
  readonly key: string;
  readonly attempts: number;
  readonly correct: number;
  readonly accuracy: number;
  readonly averageMs: number;
}

export interface TrainingStats {
  readonly attempts: number;
  readonly correct: number;
  readonly accuracy: number;
  readonly averageMs: number;
  /** 現在の連続正解数。 */
  readonly currentStreak: number;
  readonly bestStreak: number;
  /** 非推奨（C ランク）を選んだ回数。 */
  readonly discouragedChoices: number;
  readonly byGrade: Readonly<Record<RouteGrade | 'invalid', number>>;
  /** 残り点ごとの成績。 */
  readonly byScore: readonly Breakdown[];
  /** スコア帯（20 点刻み）ごとの成績。 */
  readonly byScoreBand: readonly Breakdown[];
  /** 上がりダブルごとの成績。 */
  readonly byFinishDouble: readonly Breakdown[];
  /** 苦手スコア（正答率が低い順）。 */
  readonly weakScores: readonly number[];
  /** 直近で間違えた問題の残り点。 */
  readonly recentMistakes: readonly number[];
}

function summarize(records: readonly TrainingRecord[], key: string): Breakdown {
  const attempts = records.length;
  const correct = records.filter((record) => record.valid).length;
  const totalMs = records.reduce((sum, record) => sum + record.elapsedMs, 0);
  return {
    key,
    attempts,
    correct,
    accuracy: attempts === 0 ? 0 : correct / attempts,
    averageMs: attempts === 0 ? 0 : Math.round(totalMs / attempts),
  };
}

function groupBy(
  records: readonly TrainingRecord[],
  keyOf: (record: TrainingRecord) => string | null,
): Breakdown[] {
  const groups = new Map<string, TrainingRecord[]>();
  for (const record of records) {
    const key = keyOf(record);
    if (key === null) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else groups.set(key, [record]);
  }
  return [...groups.entries()]
    .map(([key, group]) => summarize(group, key))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

/** スコア帯（20 点刻み）のラベル。 */
export function scoreBandOf(remaining: number): string {
  const start = Math.floor(remaining / 20) * 20;
  return `${start === 0 ? 2 : start}〜${start + 19}`;
}

export function computeStats(history: TrainingHistory): TrainingStats {
  const records = history.records;
  const attempts = records.length;
  const correct = records.filter((record) => record.valid).length;
  const totalMs = records.reduce((sum, record) => sum + record.elapsedMs, 0);

  let currentStreak = 0;
  let bestStreak = 0;
  for (const record of records) {
    if (record.valid) {
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  const byGrade: Record<RouteGrade | 'invalid', number> = { S: 0, A: 0, B: 0, C: 0, invalid: 0 };
  for (const record of records) {
    if (!record.valid || record.grade === null) byGrade.invalid += 1;
    else byGrade[record.grade] += 1;
  }

  const byScore = groupBy(records, (record) => String(record.remaining));
  const weakScores = [...byScore]
    .filter((item) => item.attempts >= 1 && item.accuracy < 1)
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
    .map((item) => Number(item.key));

  const recentMistakes: number[] = [];
  for (let i = records.length - 1; i >= 0 && recentMistakes.length < 20; i -= 1) {
    const record = records[i];
    if (!record.valid || record.grade === 'C') recentMistakes.push(record.remaining);
  }

  return {
    attempts,
    correct,
    accuracy: attempts === 0 ? 0 : correct / attempts,
    averageMs: attempts === 0 ? 0 : Math.round(totalMs / attempts),
    currentStreak,
    bestStreak,
    discouragedChoices: records.filter((record) => record.valid && record.grade === 'C').length,
    byGrade,
    byScore,
    byScoreBand: groupBy(records, (record) => scoreBandOf(record.remaining)),
    byFinishDouble: groupBy(records, (record) => record.finishDouble),
    weakScores,
    recentMistakes: [...new Set(recentMistakes)],
  };
}

/** 重点的に再出題したい残り点（苦手 + 直近の間違い）。 */
export function reviewTargetsOf(stats: TrainingStats, limit = 12): number[] {
  return [...new Set([...stats.recentMistakes, ...stats.weakScores])].slice(0, limit);
}
