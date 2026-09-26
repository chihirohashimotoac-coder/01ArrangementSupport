import { describe, expect, it } from 'vitest';
import { CHECKOUT_CATEGORIES, RECOVERY_CATEGORIES, SETUP_CATEGORIES } from '../engine/training/model';
import { trainingCategoryLabel } from './trainingCategoryLabels';

describe('学習カテゴリの表示名', () => {
  it('現在の全カテゴリを日本語で表示し、保存キーを変えない', () => {
    const keys = [...CHECKOUT_CATEGORIES, ...RECOVERY_CATEGORIES, ...SETUP_CATEGORIES];
    expect(keys).toHaveLength(17);
    for (const key of keys) {
      const label = trainingCategoryLabel(key);
      expect(label).not.toBe('その他');
      expect(label).not.toBe(key);
      expect(label).toMatch(/[ぁ-んァ-ン一-龯]/);
    }
    expect(trainingCategoryLabel('checkout-100-119')).toBe('100〜119点の上がり');
  });

  it('未知の旧キーは履歴を壊さず「その他」と表示する', () => {
    expect(trainingCategoryLabel('legacy-unknown')).toBe('その他');
  });
});
