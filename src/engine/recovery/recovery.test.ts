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

/*
 * 動画「アレンジディスカッション#1」12:10–17:43 の 121 を、実着弾ごとに辿る。
 * 出典: https://www.youtube.com/watch?v=687FgfVnINs
 * 記録: docs/VIDEO_ARRANGEMENT_DISCUSSION_01.md
 *
 * 動画の中心理論は「実着弾のたびに次手を計算し直す」こと。
 * それは visit.ts と suggestFor() の組み合わせで既に実装済みなので、
 * ここでは分岐ごとの答えを Golden として固定するだけにする。
 * 61 / 2 本の主表示（STANDARD T15 → D8）は変更しない。
 */
describe('動画ケース: 121 を実着弾ごとに辿る', () => {
  /** 121 から 1 投だけ実着弾させた状態。 */
  function after(dartId: string) {
    const visit = recordThrow(createVisit(121), requireDart(dartId));
    return { visit, suggestion: suggestFor(visit.remaining, visit.dartsLeft) };
  }

  it('T20 が入ると 61 / 2 本になり、STANDARD は T15 → D8 のまま', () => {
    const { visit, suggestion } = after('T20');
    expect(visit.remaining).toBe(61);
    expect(visit.dartsLeft).toBe(2);
    expect(suggestion.mode).toBe('checkout');
    expect(suggestion.checkoutRoutes[0].routeText).toBe('T15 → D8');
    // 動画の T11 → D14 も同じ一覧に出る（選べば実戦入力が追従する）。
    expect(suggestion.checkoutRoutes.some((route) => route.key === 'T11-D14')).toBe(true);
  });

  it('S20 だと 101 / 2 本になり、T17 → BULL へ計算し直す', () => {
    const { visit, suggestion } = after('S20');
    expect(visit.remaining).toBe(101);
    expect(visit.dartsLeft).toBe(2);
    expect(suggestion.checkoutRoutes[0].routeText).toBe('T17 → BULL');
  });

  it('V-84-1: S20 → S17 の 84 / 1 本では、上がれないので次ラウンドへの残しへ移る', () => {
    let visit = createVisit(121);
    visit = recordThrow(visit, requireDart('S20'));
    visit = recordThrow(visit, requireDart('S17'));
    expect(visit.remaining).toBe(84);
    expect(visit.dartsLeft).toBe(1);

    const suggestion = suggestFor(84, 1);
    expect(suggestion.mode).toBe('checkout');
    expect(suggestion.checkoutRoutes).toEqual([]);
    expect(suggestion.nextVisitRoute?.routeText).toBe('T20');
    expect(suggestion.nextVisitRoute?.leave).toBe(24);
  });

  it('V-84-2: 得意ダブルを D18 にすると、84 / 1 本の残しは T16 → 36 へ変わる', () => {
    // 動画 14:31–15:11。D12 派は T20 → 24、D18 派は T16 → 36。
    const withD18 = suggestFor(84, 1, { fallbackPreferredDoubles: ['D18'] });
    expect(withD18.nextVisitRoute?.routeText).toBe('T16');
    expect(withD18.nextVisitRoute?.leave).toBe(36);

    const withD12 = suggestFor(84, 1, { fallbackPreferredDoubles: ['D12'] });
    expect(withD12.nextVisitRoute?.routeText).toBe('T20');
    expect(withD12.nextVisitRoute?.leave).toBe(24);
  });

  it('V-71-1 / V-58-1: BULL が入ると 71 / 2 本で T13 → D16、S13 なら 58 / 1 本で S18 → 40 残し', () => {
    let visit = createVisit(121);
    visit = recordThrow(visit, requireDart('BULL'));
    expect(visit.remaining).toBe(71);
    expect(suggestFor(71, 2).checkoutRoutes[0].routeText).toBe('T13 → D16');

    visit = recordThrow(visit, requireDart('S13'));
    expect(visit.remaining).toBe(58);
    expect(visit.dartsLeft).toBe(1);

    const suggestion = suggestFor(58, 1);
    expect(suggestion.checkoutRoutes).toEqual([]);
    expect(suggestion.nextVisitRoute?.routeText).toBe('S18');
    expect(suggestion.nextVisitRoute?.leave).toBe(40);
  });

  it('V-118-1: BULL を狙って S3 だと 118 / 2 本で、次ラウンドへの残しへ移る', () => {
    const { visit, suggestion } = after('S3');
    expect(visit.remaining).toBe(118);
    expect(visit.dartsLeft).toBe(2);
    expect(suggestion.checkoutRoutes).toEqual([]);
    expect(suggestion.nextVisitRoute?.routeText).toBe('T20 → S18');
    expect(suggestion.nextVisitRoute?.leave).toBe(40);
    expect(suggestion.unavailableReason).toContain('上がれません');
  });

  it('V-96-1: S-BULL だと 96 / 2 本で T20 → D18 になる', () => {
    const { visit, suggestion } = after('SB');
    expect(visit.remaining).toBe(96);
    expect(suggestion.checkoutRoutes[0].routeText).toBe('T20 → D18');
  });
});
