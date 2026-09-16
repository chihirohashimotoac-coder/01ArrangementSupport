import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PPR } from '../engine/simulation/accuracy';
import { MAX_START_SCORE, MIN_START_SCORE } from '../engine/simulation/game';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  loadPreferences,
  savePreferences,
} from './preferences';
import {
  DEFAULT_SIMULATION_PREFERENCES,
  SIMULATION_SETTINGS_KEY,
  loadSimulationPreferences,
  saveSimulationPreferences,
} from './simulationSettings';

describe('SIMULATION 設定の保存', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('保存していなければ既定値を返す', () => {
    expect(loadSimulationPreferences()).toEqual(DEFAULT_SIMULATION_PREFERENCES);
  });

  it('保存した設定を次回も読み出せる', () => {
    saveSimulationPreferences({
      version: 1,
      startScore: 701,
      first9Ppr: 88,
      averagePpr: 72,
      missDirection: 'vertical',
      maxMiss: 'large',
    });
    expect(loadSimulationPreferences()).toEqual({
      version: 1,
      startScore: 701,
      first9Ppr: 88,
      averagePpr: 72,
      missDirection: 'vertical',
      maxMiss: 'large',
    });
  });

  it('範囲外の値は安全な範囲へ丸める', () => {
    window.localStorage.setItem(
      SIMULATION_SETTINGS_KEY,
      JSON.stringify({
        version: 1,
        startScore: 999999,
        first9Ppr: 400,
        averagePpr: -50,
        missDirection: 'diagonal',
        maxMiss: 'huge',
      }),
    );
    const loaded = loadSimulationPreferences();
    expect(loaded.startScore).toBe(MAX_START_SCORE);
    expect(loaded.first9Ppr).toBe(MAX_PPR);
    expect(loaded.averagePpr).toBe(0);
    expect(loaded.missDirection).toBe(DEFAULT_SIMULATION_PREFERENCES.missDirection);
    expect(loaded.maxMiss).toBe(DEFAULT_SIMULATION_PREFERENCES.maxMiss);
  });

  it('壊れた JSON でも既定値で動く', () => {
    window.localStorage.setItem(SIMULATION_SETTINGS_KEY, '{ not json');
    expect(loadSimulationPreferences()).toEqual(DEFAULT_SIMULATION_PREFERENCES);
  });

  it('開始点数の下限を下回る値も丸める', () => {
    saveSimulationPreferences({ ...DEFAULT_SIMULATION_PREFERENCES, startScore: 0 });
    expect(loadSimulationPreferences().startScore).toBe(MIN_START_SCORE);
  });
});

describe('既存の設定との独立性', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('SIMULATION の保存は既存 preferences を壊さない', () => {
    savePreferences({
      ...DEFAULT_PREFERENCES,
      preferredDoubles: ['D16', 'D20'],
      theme: 'light',
    });
    saveSimulationPreferences({
      ...DEFAULT_SIMULATION_PREFERENCES,
      startScore: 301,
      averagePpr: 90,
    });

    const existing = loadPreferences();
    expect(existing.preferredDoubles).toEqual(['D16', 'D20']);
    expect(existing.theme).toBe('light');
    // 既存キーの中身に SIMULATION の項目が混ざっていないこと。
    const raw = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? '{}');
    expect(Object.keys(raw).sort()).toEqual(
      ['preferredDoubles', 'setupMainTarget', 'theme', 'version'].sort(),
    );
  });

  it('既存 preferences しか無い端末でも SIMULATION は既定値で動く', () => {
    savePreferences({ ...DEFAULT_PREFERENCES, preferredDoubles: ['D8'] });
    expect(loadSimulationPreferences()).toEqual(DEFAULT_SIMULATION_PREFERENCES);
  });

  it('別々のキーへ保存している', () => {
    saveSimulationPreferences(DEFAULT_SIMULATION_PREFERENCES);
    expect(SIMULATION_SETTINGS_KEY).not.toBe(PREFERENCES_KEY);
    expect(window.localStorage.getItem(PREFERENCES_KEY)).toBeNull();
  });
});
