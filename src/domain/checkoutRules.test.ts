import { describe, expect, it } from 'vitest';
import {
  DARTS_PER_VISIT,
  MAX_CHECKOUT,
  applyDart,
  isBogey,
  isCheckoutable,
  isLegalCheckoutRoute,
  minDartsToCheckout,
} from './checkoutRules';
import { parseRoute, requireDart } from './dart';
import { BOGEY_NUMBERS } from '../data/bogeyNumbers';
import { isBoardNumberSetValid } from './boardNumbers';

describe('盤面データ', () => {
  it('1〜20 をちょうど1回ずつ含む', () => {
    expect(isBoardNumberSetValid()).toBe(true);
  });
});

describe('isCheckoutable', () => {
  it('170 は 3 本で上がれる最大値', () => {
    expect(isCheckoutable(MAX_CHECKOUT, DARTS_PER_VISIT)).toBe(true);
    expect(isCheckoutable(MAX_CHECKOUT + 1, DARTS_PER_VISIT)).toBe(false);
  });

  it('1 残しは何本あっても上がれない', () => {
    for (const darts of [1, 2, 3]) expect(isCheckoutable(1, darts)).toBe(false);
  });

  it('2 は D1 の 1 本で上がれる', () => {
    expect(isCheckoutable(2, 1)).toBe(true);
  });

  it('1 本で上がれるのはダブルと BULL のちょうど 40 通り + 50', () => {
    const oneDart: number[] = [];
    for (let n = 0; n <= MAX_CHECKOUT; n += 1) if (isCheckoutable(n, 1)) oneDart.push(n);
    // D1..D20 = 偶数 2..40（20通り）と BULL = 50。
    expect(oneDart).toEqual([...Array.from({ length: 20 }, (_, i) => (i + 1) * 2), 50]);
  });

  it('110 は 2 本で上がれる最大値（T20 + BULL）', () => {
    expect(isCheckoutable(110, 2)).toBe(true);
    expect(isCheckoutable(111, 2)).toBe(false);
  });
});

describe('Bogey Number', () => {
  it('計算結果が data/bogeyNumbers.ts の定義と一致する', () => {
    const computed: number[] = [];
    for (let n = 2; n <= MAX_CHECKOUT; n += 1) if (isBogey(n)) computed.push(n);
    expect(computed).toEqual([...BOGEY_NUMBERS]);
  });

  it('添付資料 (2) の 160/161/164/167/170 は 3 本で上がれる', () => {
    for (const n of [160, 161, 164, 167, 170]) {
      expect(isCheckoutable(n, DARTS_PER_VISIT), `${n}`).toBe(true);
      expect(isBogey(n)).toBe(false);
    }
  });

  it('159〜170 の帯では下一桁 0/1/4/7 のときだけ上がれる', () => {
    for (let n = 159; n <= 170; n += 1) {
      const digit = n % 10;
      expect(isCheckoutable(n, DARTS_PER_VISIT), `${n}`).toBe([0, 1, 4, 7].includes(digit));
    }
  });
});

describe('minDartsToCheckout', () => {
  it.each([
    [40, 1],
    [50, 1],
    [100, 2],
    [110, 2],
    [111, 3],
    [170, 3],
  ])('残り %i は最短 %i 本', (remaining, expected) => {
    expect(minDartsToCheckout(remaining)).toBe(expected);
  });

  it('Bogey は null', () => {
    expect(minDartsToCheckout(169)).toBeNull();
  });
});

describe('applyDart / Bust 判定', () => {
  it('0 未満になると Bust', () => {
    const result = applyDart(30, requireDart('T20'));
    expect(result.outcome).toBe('bust');
    expect(result.bustReason).toBe('BELOW_ZERO');
  });

  it('1 残しは Bust', () => {
    const result = applyDart(21, requireDart('S20'));
    expect(result.outcome).toBe('bust');
    expect(result.bustReason).toBe('LEFT_ONE');
  });

  it('0 になってもダブルでなければ Bust', () => {
    const result = applyDart(20, requireDart('S20'));
    expect(result.outcome).toBe('bust');
    expect(result.bustReason).toBe('NOT_DOUBLE_FINISH');
  });

  it('トリプルで 0 にしても Bust', () => {
    expect(applyDart(60, requireDart('T20')).outcome).toBe('bust');
  });

  it('ダブルで 0 にするとチェックアウト', () => {
    const result = applyDart(40, requireDart('D20'));
    expect(result.outcome).toBe('checkout');
    expect(result.remainingAfter).toBe(0);
  });

  it('BULL は Double 25 として合法な上がり', () => {
    expect(applyDart(50, requireDart('BULL')).outcome).toBe('checkout');
  });

  it('アウターブルでは上がれない', () => {
    expect(applyDart(25, requireDart('SB')).outcome).toBe('bust');
  });

  it('Bust したときは残り点を進めない', () => {
    expect(applyDart(21, requireDart('S20')).remainingAfter).toBe(21);
  });
});

describe('isLegalCheckoutRoute', () => {
  it('合計・最終ダート・本数がそろえば合法', () => {
    expect(isLegalCheckoutRoute(103, parseRoute(['T19', 'S6', 'D20']), 3)).toBe(true);
  });

  it('本数超過は不成立', () => {
    expect(isLegalCheckoutRoute(103, parseRoute(['T19', 'S6', 'D20']), 2)).toBe(false);
  });

  it('最終ダートがシングルなら不成立', () => {
    expect(isLegalCheckoutRoute(60, parseRoute(['S20', 'S20', 'S20']), 3)).toBe(false);
  });

  it('途中で 1 残しになるルートは不成立', () => {
    expect(isLegalCheckoutRoute(41, parseRoute(['S20', 'S20', 'D20']), 3)).toBe(false);
  });
});
