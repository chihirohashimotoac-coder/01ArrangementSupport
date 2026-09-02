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
    format: 'checkout-route',
    problemKey: 'checkout|v2|left=103|darts=3',
    difficulty: 'medium',
    primaryCategory: 'checkout-100-119',
    learningTags: [],
    startRemaining: 103,
    currentRemaining: 103,
    contextualThrows: [],
    dartsAvailable: 3,
    answer: ['T19', 'S6', 'D20'],
    ruleValid: true,
    learningCorrect: true,
    grade: 'S',
    failureCode: null,
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
    appendRecord(record({ startRemaining: 122, currentRemaining: 122 }));
    expect(loadHistory().records).toHaveLength(1);
    expect(loadHistory().records[0].startRemaining).toBe(122);
  });

  it('上限を超えると古いものから捨てる', () => {
    for (let i = 0; i < MAX_RECORDS + 20; i += 1) {
      appendRecord(record({ startRemaining: 100 + i, currentRemaining: 100 + i }));
    }
    const history = loadHistory();
    expect(history.records).toHaveLength(MAX_RECORDS);
    expect(history.records[history.records.length - 1].startRemaining).toBe(100 + MAX_RECORDS + 19);
  });

  it('消去できる', () => {
    appendRecord(record());
    clearHistory();
    expect(loadHistory().records).toHaveLength(0);
  });

  it('壊れた JSON でも空の履歴を返す', () => {
    window.localStorage.setItem(TRAINING_HISTORY_KEY, 'null');
    expect(loadHistory().records).toEqual([]);
    window.localStorage.setItem(TRAINING_HISTORY_KEY, '{壊れている');
    expect(loadHistory().records).toEqual([]);
  });

  it('壊れたレコードが混ざっても crash しない', () => {
    window.localStorage.setItem(
      TRAINING_HISTORY_KEY,
      JSON.stringify({
        version: 99,
        records: [
          null,
          {},
          [],
          'text',
          { kind: 'unknown', remaining: 100, dartsAvailable: 3, valid: true, answer: [] },
          { kind: 'checkout', remaining: 103, dartsAvailable: 3, valid: true, answer: ['T19'], grade: 'Z' },
          { kind: 'checkout', remaining: 103, dartsAvailable: 3, valid: true, answer: ['T19'] },
        ],
      }),
    );
    const history = loadHistory();
    expect(history.version).toBe(2);
    expect(history.records).toHaveLength(2);
    expect(history.migrationSkippedCount).toBe(5);
    expect(history.records[0].grade).toBeNull();
    expect(history.records[0].elapsedMs).toBe(0);
  });
});

describe('V1 履歴の移行', () => {
  function storeV1(records: readonly unknown[]): void {
    window.localStorage.setItem(TRAINING_HISTORY_KEY, JSON.stringify({ version: 1, records }));
  }

  it('V1 の CHECKOUT / RECOVERY は valid をそのまま learningCorrect にする', () => {
    storeV1([
      { id: 'a', at: 1, kind: 'checkout', remaining: 103, dartsAvailable: 3, answer: ['T19', 'S6', 'D20'], valid: true, grade: 'S', finishDouble: 'D20', elapsedMs: 3000 },
      { id: 'b', at: 2, kind: 'recovery', remaining: 104, dartsAvailable: 2, answer: ['T18', 'BULL'], valid: true, grade: 'A', finishDouble: 'BULL', elapsedMs: 2000 },
      { id: 'c', at: 3, kind: 'checkout', remaining: 40, dartsAvailable: 3, answer: ['S20'], valid: false, grade: null, finishDouble: null, elapsedMs: 1000 },
    ]);
    const records = loadHistory().records;
    expect(records.map((item) => item.learningCorrect)).toEqual([true, true, false]);
    expect(records.every((item) => item.problemKey.includes('v1'))).toBe(true);
  });

  it('V1 の SETUP は残りを再計算し、上がれる残りだけを正解にする', () => {
    storeV1([
      // 302 → T20 T20 S18 → 164（上がれる）
      { id: 'a', at: 1, kind: 'setup', remaining: 302, dartsAvailable: 3, answer: ['T20', 'T20', 'S18'], valid: true, grade: 'S', finishDouble: null, elapsedMs: 4000 },
      // 302 → T20 T20 S20 → 162（ノーテン）
      { id: 'b', at: 2, kind: 'setup', remaining: 302, dartsAvailable: 3, answer: ['T20', 'T20', 'S20'], valid: true, grade: 'C', finishDouble: null, elapsedMs: 4000 },
      // 350 → S1 S1 S1 → 347（170 超え）
      { id: 'c', at: 3, kind: 'setup', remaining: 350, dartsAvailable: 3, answer: ['S1', 'S1', 'S1'], valid: true, grade: 'C', finishDouble: null, elapsedMs: 4000 },
    ]);
    const records = loadHistory().records;
    expect(records.map((item) => item.learningCorrect)).toEqual([true, false, false]);
    expect(computeStats(loadHistory()).accuracy).toBeCloseTo(1 / 3);
  });

  it('再評価できない SETUP 記録は正答率へ混ぜず、件数だけ残す', () => {
    storeV1([
      { id: 'a', at: 1, kind: 'setup', remaining: 302, dartsAvailable: 3, answer: ['T20', 'T20', 'S18'], valid: true, grade: 'S', finishDouble: null, elapsedMs: 4000 },
      // 盤面に存在しない表記 → 残りを再計算できない
      { id: 'b', at: 2, kind: 'setup', remaining: 302, dartsAvailable: 3, answer: ['T21', 'X9'], valid: true, grade: 'S', finishDouble: null, elapsedMs: 4000 },
      // 回答が空 → 残りを再計算できない
      { id: 'c', at: 3, kind: 'setup', remaining: 302, dartsAvailable: 3, answer: [], valid: true, grade: 'S', finishDouble: null, elapsedMs: 4000 },
    ]);
    const history = loadHistory();
    expect(history.records).toHaveLength(1);
    expect(history.migrationSkippedCount).toBe(2);
    // ユーザーが間違えていないのに正答率が下がってはいけない。
    expect(computeStats(history).accuracy).toBe(1);
  });

  it('V1 と V2 が混ざっていても読める', () => {
    window.localStorage.setItem(
      TRAINING_HISTORY_KEY,
      JSON.stringify({
        version: 1,
        records: [
          { id: 'a', at: 1, kind: 'checkout', remaining: 103, dartsAvailable: 3, answer: ['T19', 'S6', 'D20'], valid: true, grade: 'S', finishDouble: 'D20', elapsedMs: 3000 },
          record({ id: 'b', problemKey: 'setup|v2|adjust|start=226|ctx=S20,S20|current=186|darts=1', kind: 'setup', format: 'setup-adjustment', learningCorrect: false, ruleValid: true, startRemaining: 226, currentRemaining: 186, dartsAvailable: 1, answer: ['S20'], failureCode: 'LEAVES_BOGEY' }),
        ],
      }),
    );
    const history = loadHistory();
    expect(history.records).toHaveLength(2);
    expect(history.records[1].problemKey).toContain('adjust');
    expect(history.records[1].learningCorrect).toBe(false);
    expect(computeStats(history).accuracy).toBe(0.5);
  });

  it('復習対象が SETUP の文脈を保つ', () => {
    appendRecord(
      record({
        kind: 'setup',
        format: 'setup-adjustment',
        problemKey: 'setup|v2|adjust|start=226|ctx=S20,S20|current=186|darts=1',
        primaryCategory: 'setup-digits-0147',
        learningTags: ['bogey-avoidance'],
        startRemaining: 226,
        currentRemaining: 186,
        dartsAvailable: 1,
        answer: ['S20'],
        ruleValid: true,
        learningCorrect: false,
        grade: 'C',
        failureCode: 'LEAVES_BOGEY',
      }),
    );
    const targets = reviewTargetsOf(computeStats(loadHistory()));
    const setupTarget = targets.find((target) => target.problemKey?.includes('adjust'));
    expect(setupTarget).toBeDefined();
    expect(setupTarget!.kind).toBe('setup');
    expect(setupTarget!.startRemaining).toBe(226);
    expect(setupTarget!.primaryCategory).toBe('setup-digits-0147');
    expect(setupTarget!.weight).toBeGreaterThan(0);
  });
});

describe('集計', () => {
  it('正答率と平均回答時間を出す', () => {
    appendRecord(record({ learningCorrect: true, elapsedMs: 2000 }));
    appendRecord(record({ learningCorrect: false, ruleValid: false, grade: null, elapsedMs: 6000 }));
    const stats = computeStats(loadHistory());
    expect(stats.attempts).toBe(2);
    expect(stats.correct).toBe(1);
    expect(stats.accuracy).toBe(0.5);
    expect(stats.averageMs).toBe(4000);
  });

  it('SETUP のノーテンは正答率へ入れず、ruleValidRate には残る', () => {
    appendRecord(
      record({
        kind: 'setup',
        format: 'setup-adjustment',
        ruleValid: true,
        learningCorrect: false,
        grade: 'C',
        failureCode: 'LEAVES_BOGEY',
        finishDouble: null,
      }),
    );
    const stats = computeStats(loadHistory());
    expect(stats.accuracy).toBe(0);
    expect(stats.ruleValidRate).toBe(1);
  });

  it('連続正解を数える', () => {
    appendRecord(record({ learningCorrect: true }));
    appendRecord(record({ learningCorrect: true }));
    appendRecord(record({ learningCorrect: false, ruleValid: false, grade: null }));
    appendRecord(record({ learningCorrect: true }));
    const stats = computeStats(loadHistory());
    expect(stats.currentStreak).toBe(1);
    expect(stats.bestStreak).toBe(2);
  });

  it('ランク別・スコア別・上がりダブル別・カテゴリ別に集計する', () => {
    appendRecord(
      record({ startRemaining: 103, currentRemaining: 103, grade: 'S', finishDouble: 'D20', primaryCategory: 'checkout-100-119' }),
    );
    appendRecord(
      record({ startRemaining: 122, currentRemaining: 122, grade: 'C', finishDouble: 'BULL', primaryCategory: 'checkout-120-149' }),
    );
    const stats = computeStats(loadHistory());
    expect(stats.byGrade.S).toBe(1);
    expect(stats.byGrade.C).toBe(1);
    expect(stats.discouragedChoices).toBe(1);
    expect(stats.byScore.map((item) => item.key)).toEqual(['103', '122']);
    expect(stats.byFinishDouble.map((item) => item.key).sort()).toEqual(['BULL', 'D20']);
    expect(stats.byCategory.map((item) => item.key)).toEqual([
      'checkout-100-119',
      'checkout-120-149',
    ]);
  });

  it('スコア帯でまとめる', () => {
    expect(scoreBandOf(103)).toBe('100〜119');
    expect(scoreBandOf(122)).toBe('120〜139');
    expect(scoreBandOf(2)).toBe('2〜19');
  });

  it('苦手スコアと直近の間違いを再出題対象にする', () => {
    appendRecord(
      record({ startRemaining: 161, currentRemaining: 161, ruleValid: false, learningCorrect: false, grade: null }),
    );
    appendRecord(record({ startRemaining: 122, currentRemaining: 122, grade: 'C' }));
    const stats = computeStats(loadHistory());
    expect(stats.weakScores).toContain(161);
    expect(stats.recentMistakes).toContain(122);
    expect(reviewTargetsOf(stats).map((target) => target.startRemaining)).toEqual(
      expect.arrayContaining([122, 161]),
    );
  });
});
