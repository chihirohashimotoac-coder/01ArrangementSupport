import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  loadPreferences,
  savePreferences,
} from './preferences';
import {
  MAX_RECORDS,
  TRAINING_HISTORY_KEY,
  appendRecord,
  clearHistory,
  computeStats,
  loadHistory,
  reviewTargetsOf,
  scoreBandOf,
  type TrainingRecord,
} from './trainingHistory';

function record(overrides: Partial<TrainingRecord> = {}): TrainingRecord {
  return {
    id: Math.random().toString(36).slice(2),
    at: Date.now(),
    kind: 'checkout',
    remaining: 103,
    dartsAvailable: 3,
    answer: ['T19', 'S6', 'D20'],
    valid: true,
    grade: 'S',
    finishDouble: 'D20',
    elapsedMs: 4000,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('設定の保存', () => {
  it('未保存なら既定値を返す', () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('保存した得意ダブルを読み戻せる', () => {
    savePreferences({ ...DEFAULT_PREFERENCES, preferredDoubles: ['D20', 'BULL'] });
    expect(loadPreferences().preferredDoubles).toEqual(['D20', 'BULL']);
  });

  it('選択したテーマを読み戻せる', () => {
    savePreferences({ ...DEFAULT_PREFERENCES, theme: 'light' });
    expect(loadPreferences().theme).toBe('light');
  });

  it('旧形式の設定には既定の Dark テーマを補う', () => {
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ version: 1, preferredDoubles: ['D20'], setupMainTarget: 'T20' }),
    );
    expect(loadPreferences().theme).toBe('dark');
  });

  it('未知のテーマ値は Dark に戻す', () => {
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ ...DEFAULT_PREFERENCES, theme: 'system' }),
    );
    expect(loadPreferences().theme).toBe('dark');
  });

  it('存在しないセグメントは捨てる', () => {
    savePreferences({ ...DEFAULT_PREFERENCES, preferredDoubles: ['D20', 'D99', 'T20', 'SB'] });
    expect(loadPreferences().preferredDoubles).toEqual(['D20']);
  });

  it('重複は取り除く', () => {
    savePreferences({ ...DEFAULT_PREFERENCES, preferredDoubles: ['D16', 'D16', 'D20'] });
    expect(loadPreferences().preferredDoubles).toEqual(['D16', 'D20']);
  });

  it('壊れた JSON でも既定値へ戻る', () => {
    window.localStorage.setItem(PREFERENCES_KEY, '{壊れている');
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('学習履歴', () => {
  it('追記して読み戻せる', () => {
    appendRecord(record({ remaining: 122 }));
    expect(loadHistory().records).toHaveLength(1);
    expect(loadHistory().records[0].remaining).toBe(122);
  });

  it('上限を超えると古いものから捨てる', () => {
    for (let i = 0; i < MAX_RECORDS + 20; i += 1) appendRecord(record({ remaining: 100 + i }));
    const history = loadHistory();
    expect(history.records).toHaveLength(MAX_RECORDS);
    expect(history.records[history.records.length - 1].remaining).toBe(100 + MAX_RECORDS + 19);
  });

  it('消去できる', () => {
    appendRecord(record());
    clearHistory();
    expect(loadHistory().records).toHaveLength(0);
  });

  it('壊れた JSON でも空の履歴を返す', () => {
    window.localStorage.setItem(TRAINING_HISTORY_KEY, 'null');
    expect(loadHistory().records).toEqual([]);
  });
});

describe('集計', () => {
  it('正答率と平均回答時間を出す', () => {
    appendRecord(record({ valid: true, elapsedMs: 2000 }));
    appendRecord(record({ valid: false, grade: null, elapsedMs: 6000 }));
    const stats = computeStats(loadHistory());
    expect(stats.attempts).toBe(2);
    expect(stats.correct).toBe(1);
    expect(stats.accuracy).toBe(0.5);
    expect(stats.averageMs).toBe(4000);
  });

  it('連続正解を数える', () => {
    appendRecord(record({ valid: true }));
    appendRecord(record({ valid: true }));
    appendRecord(record({ valid: false, grade: null }));
    appendRecord(record({ valid: true }));
    const stats = computeStats(loadHistory());
    expect(stats.currentStreak).toBe(1);
    expect(stats.bestStreak).toBe(2);
  });

  it('ランク別・スコア別・上がりダブル別に集計する', () => {
    appendRecord(record({ remaining: 103, grade: 'S', finishDouble: 'D20' }));
    appendRecord(record({ remaining: 122, grade: 'C', finishDouble: 'BULL' }));
    const stats = computeStats(loadHistory());
    expect(stats.byGrade.S).toBe(1);
    expect(stats.byGrade.C).toBe(1);
    expect(stats.discouragedChoices).toBe(1);
    expect(stats.byScore.map((item) => item.key)).toEqual(['103', '122']);
    expect(stats.byFinishDouble.map((item) => item.key).sort()).toEqual(['BULL', 'D20']);
  });

  it('スコア帯でまとめる', () => {
    expect(scoreBandOf(103)).toBe('100〜119');
    expect(scoreBandOf(122)).toBe('120〜139');
    expect(scoreBandOf(2)).toBe('2〜19');
  });

  it('苦手スコアと直近の間違いを再出題対象にする', () => {
    appendRecord(record({ remaining: 161, valid: false, grade: null }));
    appendRecord(record({ remaining: 122, valid: true, grade: 'C' }));
    const stats = computeStats(loadHistory());
    expect(stats.weakScores).toContain(161);
    expect(stats.recentMistakes).toContain(122);
    expect(reviewTargetsOf(stats)).toEqual(expect.arrayContaining([122, 161]));
  });
});
