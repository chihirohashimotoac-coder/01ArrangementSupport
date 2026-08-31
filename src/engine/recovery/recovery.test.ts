import { describe, expect, it } from 'vitest';
import { createVisit, isVisitFinished, recordMiss, recordThrow, undoThrow } from './visit';
import { suggestFor } from './suggest';
import { requireDart } from '../../domain/dart';

describe('ビジットの進行', () => {
  it('103 / 3 本から T19 → S6 → D20 で上がる', () => {
    let visit = createVisit(103);
    visit = recordThrow(visit, requireDart('T19'));
    expect(visit.remaining).toBe(46);
    expect(visit.dartsLeft).toBe(2);

    visit = recordThrow(visit, requireDart('S6'));
    expect(visit.remaining).toBe(40);
    expect(visit.dartsLeft).toBe(1);

    visit = recordThrow(visit, requireDart('D20'));
    expect(visit.remaining).toBe(0);
    expect(visit.status).toBe('checkout');
    expect(isVisitFinished(visit)).toBe(true);
  });

  it('資料どおり、103 で T19 を狙って S19 だと 84 / 2 本になる', () => {
    let visit = createVisit(103);
    visit = recordThrow(visit, requireDart('S19'));
    expect(visit.remaining).toBe(84);
    expect(visit.dartsLeft).toBe(2);

    const suggestion = suggestFor(visit.remaining, visit.dartsLeft);
    expect(suggestion.mode).toBe('checkout');
    expect(suggestion.checkoutRoutes.length).toBeGreaterThan(0);
    expect(suggestion.checkoutRoutes[0].darts.length).toBeLessThanOrEqual(2);
  });

  it('MISS を記録できる', () => {
    let visit = createVisit(60);
    visit = recordMiss(visit);
    expect(visit.remaining).toBe(60);
    expect(visit.dartsLeft).toBe(2);
    expect(visit.thrown[0].dart.id).toBe('MISS');
  });

  it('Bust するとビジット開始時の残りへ戻る', () => {
    let visit = createVisit(40);
    visit = recordThrow(visit, requireDart('T20'));
    expect(visit.status).toBe('bust');
    expect(visit.bustReason).toBe('BELOW_ZERO');
    expect(visit.remaining).toBe(40);
    expect(visit.dartsLeft).toBe(0);
  });

  it('1 残しの Bust も検出する', () => {
    let visit = createVisit(50);
    visit = recordThrow(visit, requireDart('S19'));
    expect(visit.remaining).toBe(31);
    visit = recordThrow(visit, requireDart('T10'));
    expect(visit.status).toBe('bust');
    expect(visit.bustReason).toBe('LEFT_ONE');
    expect(visit.remaining).toBe(50);
  });

  it('0 にしても最終ダートがダブルでなければ Bust', () => {
    let visit = createVisit(20);
    visit = recordThrow(visit, requireDart('S20'));
    expect(visit.status).toBe('bust');
    expect(visit.bustReason).toBe('NOT_DOUBLE_FINISH');
  });

  it('Undo で 1 投戻せる', () => {
    let visit = createVisit(103);
    visit = recordThrow(visit, requireDart('T19'));
    visit = recordThrow(visit, requireDart('S6'));
    expect(visit.remaining).toBe(40);

    visit = undoThrow(visit);
    expect(visit.remaining).toBe(46);
    expect(visit.dartsLeft).toBe(2);

    visit = undoThrow(visit);
    expect(visit.remaining).toBe(103);
    expect(visit.dartsLeft).toBe(3);

    // これ以上は戻らない。
    expect(undoThrow(visit)).toBe(visit);
  });

  it('Bust のあとも Undo で戻せる', () => {
    let visit = createVisit(40);
    visit = recordThrow(visit, requireDart('T20'));
    expect(visit.status).toBe('bust');
    visit = undoThrow(visit);
    expect(visit.status).toBe('in-progress');
    expect(visit.remaining).toBe(40);
    expect(visit.dartsLeft).toBe(3);
  });

  it('上がったあとは投げられない', () => {
    let visit = createVisit(40);
    visit = recordThrow(visit, requireDart('D20'));
    const after = recordThrow(visit, requireDart('S20'));
    expect(after).toBe(visit);
  });
});

describe('状況に応じた提案', () => {
  it('170 以下は CHECKOUT モード', () => {
    expect(suggestFor(103, 3).mode).toBe('checkout');
    expect(suggestFor(170, 3).mode).toBe('checkout');
  });

  it('171 以上は SETUP モード', () => {
    expect(suggestFor(171, 3).mode).toBe('setup');
    expect(suggestFor(350, 3).mode).toBe('setup');
  });

  it('350 を超えると対象外', () => {
    const suggestion = suggestFor(351, 3);
    expect(suggestion.mode).toBe('unavailable');
    expect(suggestion.unavailableReason).toContain('350');
  });

  it('Bogey では理由を示して候補なしにする', () => {
    const suggestion = suggestFor(169, 3);
    expect(suggestion.isBogey).toBe(true);
    expect(suggestion.checkoutRoutes).toEqual([]);
    expect(suggestion.unavailableReason).toContain('ノーテン');
  });

  it('残り本数で上がれない場合も理由を示す', () => {
    const suggestion = suggestFor(150, 1);
    expect(suggestion.checkoutRoutes).toEqual([]);
    expect(suggestion.unavailableReason).toContain('上がれません');
  });

  it('TON トラップの残りを知らせる', () => {
    expect(suggestFor(269, 3).tonTrapLeave).toBe(169);
    expect(suggestFor(270, 3).tonTrapLeave).toBeNull();
  });

  it('テンパイを作れない SETUP では、その旨を返す', () => {
    const suggestion = suggestFor(339, 3);
    expect(suggestion.mode).toBe('setup');
    expect(suggestion.canReachTenpai).toBe(false);
    expect(suggestion.unavailableReason).toContain('テンパイを作れません');
    expect(suggestion.setupRoutes.length).toBeGreaterThan(0);
  });

  it('305 で T20 を狙って S20 だった場合、285 / 2 本で再提案する', () => {
    let visit = createVisit(305);
    visit = recordThrow(visit, requireDart('S20'));
    expect(visit.remaining).toBe(285);
    expect(visit.dartsLeft).toBe(2);
    const suggestion = suggestFor(visit.remaining, visit.dartsLeft);
    expect(suggestion.mode).toBe('setup');
    expect(suggestion.setupRoutes.length).toBeGreaterThan(0);
  });
});
