/**
 * 2026-11-01 監査 フェーズ 3（画面の使い勝手）の回帰テスト。
 *
 *   U-H3 「戻る」で前の画面へ戻り、進行中の TRAINING / SIMULATION を一時保存して再開できる
 *   U-H1 「実際の着弾を入力」を開いたら盤面の先頭へ移る（App.test.tsx 側で確認）
 *   3-8  更新バナーは進行中なら確認を出す / ホームの入力欄から帯に合ったモードを開く /
 *        SIMULATION の計算ミスが続いたら答えを見られる
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { tabFromHash } from './navigation';
import { markUpdateAvailable, resetUpdateStore, setUpdateApplier } from './pwa/updateStore';
import {
  advanceRound,
  createGame,
  roundScoreOf,
  submitScore,
  throwAt,
} from './engine/simulation/game';
import {
  SIMULATION_SESSION_KEY,
  saveSimulationSession,
  TRAINING_SESSION_KEY,
  loadSimulationSession,
  loadTrainingSession,
  parseSimulationSession,
  parseTrainingSession,
} from './storage/sessionResume';

afterEach(() => {
  resetUpdateStore();
});

describe('U-H3 画面の切り替えを履歴に積む', () => {
  it('知らない hash はホームとして扱う', () => {
    expect(tabFromHash('')).toBe('home');
    expect(tabFromHash('#/')).toBe('home');
    expect(tabFromHash('#/training')).toBe('training');
    expect(tabFromHash('#/unknown')).toBe('home');
  });

  it('画面を移ると hash が変わり、「戻る」で前の画面へ戻る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-checkout'));
    expect(window.location.hash).toBe('#/checkout');
    await user.click(screen.getByTestId('nav-training'));
    expect(window.location.hash).toBe('#/training');

    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.getByTestId('nav-checkout')).toHaveAttribute('aria-pressed', 'true'),
    );
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByTestId('home-quick')).toBeInTheDocument());
  });

  it('URL の hash の画面から開く（再読み込みで同じ画面に戻る）', () => {
    window.history.replaceState(null, '', '#/simulation');
    render(<App />);
    expect(screen.getByTestId('nav-simulation')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('U-H3 進行中の TRAINING を一時保存して再開する', () => {
  it('採点済みの問題まで戻り、学習履歴へは二重に記録しない', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('start-training'));
    const prompt = screen.getByTestId('status-left').textContent;
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('training-submit'));
    expect(screen.getByTestId('stat-attempts')).toHaveTextContent('1');
    expect(loadTrainingSession()?.answered).toBe(true);
    first.unmount();

    render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    expect(screen.getByTestId('training-resume')).toHaveTextContent('1 問目');
    await user.click(screen.getByTestId('training-resume-apply'));

    expect(screen.getByTestId('status-left').textContent).toBe(prompt);
    expect(screen.getByTestId('answer-0')).toHaveTextContent('T20');
    expect(screen.getByTestId('training-result')).toBeInTheDocument();
    expect(screen.getByTestId('stat-attempts')).toHaveTextContent('1');
  });

  it('「破棄する」で保存を消す', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('start-training'));
    first.unmount();

    render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('training-resume-discard'));
    expect(screen.queryByTestId('training-resume')).toBeNull();
    expect(window.localStorage.getItem(TRAINING_SESSION_KEY)).toBeNull();
  });

  it('壊れた保存データ・知らない版は読まずに捨てる', () => {
    window.localStorage.setItem(TRAINING_SESSION_KEY, '{not json');
    expect(loadTrainingSession()).toBeNull();
    expect(parseTrainingSession({ version: 2 })).toBeNull();
    expect(parseTrainingSession(null)).toBeNull();
    expect(
      parseTrainingSession({
        version: 1,
        settings: { mode: 'checkout' },
        chunks: [],
        index: 0,
        answer: [],
        answered: false,
        remainingSeconds: null,
      }),
    ).toBeNull();
  });
});

describe('U-H3 進行中の SIMULATION を一時保存して再開する', () => {
  it('投げた 1 投まで戻って続けられる', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(screen.getByTestId('nav-simulation'));
    await user.click(screen.getByTestId('start-simulation'));
    await user.click(screen.getByTestId('segment-t20'));
    const lastThrow = screen.getByTestId('sim-last-throw').textContent;
    expect(loadSimulationSession()?.game.current?.throws).toHaveLength(1);
    first.unmount();

    render(<App />);
    await user.click(screen.getByTestId('nav-simulation'));
    expect(screen.getByTestId('sim-resume')).toHaveTextContent('ラウンド 1');
    await user.click(screen.getByTestId('sim-resume-apply'));
    expect(screen.getByTestId('sim-last-throw').textContent).toBe(lastThrow);
  });

  /*
   * Codex レビュー（PR #37）: 確定したラウンド（RoundRecord）は計算ミスを `entry` の中に持ち、
   * 進行中のラウンドとは形が違う。同じ検査を当てるとラウンド 2 以降の保存が捨てられていた。
   */
  it('ラウンドを確定したあとの保存も読める（計算ミスの記録を含む）', () => {
    let game = createGame(
      { startScore: 501, first9Ppr: 60, averagePpr: 55, missDirection: 'even', maxMiss: 'medium' },
      12345,
    );
    for (let i = 0; i < 3; i += 1) game = throwAt(game, 'segment-t20');
    game = submitScore(game, 999);
    game = submitScore(game, roundScoreOf(game.current!));
    game = advanceRound(game);
    game = throwAt(game, 'segment-t20');
    expect(game.rounds).toHaveLength(1);
    saveSimulationSession(game);

    const loaded = loadSimulationSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.game.rounds[0].entry?.wrongEntries).toEqual([999]);
    expect(loaded!.game.current?.round).toBe(2);
    expect(loaded!.game.current?.throws).toHaveLength(1);
  });

  it('BUST で確定したラウンド（entry が null）を含む保存も読める', () => {
    let game = createGame(
      { startScore: 61, first9Ppr: 167, averagePpr: 167, missDirection: 'even', maxMiss: 'medium' },
      1,
    );
    game = throwAt(game, 'segment-t20');
    expect(game.current?.bust).toBe(true);
    game = advanceRound(game);
    expect(game.rounds[0].entry).toBeNull();
    saveSimulationSession(game);
    expect(loadSimulationSession()?.game.rounds).toHaveLength(1);
  });

  it('壊れた保存データは読まずに捨てる', () => {
    window.localStorage.setItem(SIMULATION_SESSION_KEY, JSON.stringify({ version: 1, game: { seed: 'x' } }));
    expect(loadSimulationSession()).toBeNull();
    expect(window.localStorage.getItem(SIMULATION_SESSION_KEY)).toBeNull();
    expect(parseSimulationSession({ version: 9, game: {} })).toBeNull();
  });
});

describe('3-8 更新バナー', () => {
  it('TRAINING の出題中に「更新」を押したら確認を出し、確定したときだけ更新する', async () => {
    const applier = vi.fn();
    setUpdateApplier(applier);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('start-training'));
    act(() => markUpdateAvailable());

    await user.click(screen.getByTestId('update-banner-apply'));
    expect(screen.getByTestId('update-confirm')).toHaveTextContent('続きから再開');
    expect(applier).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('update-confirm-confirm'));
    expect(applier).toHaveBeenCalledTimes(1);
  });

  it('進行中でなければ、これまでどおりすぐ更新する', async () => {
    const applier = vi.fn();
    setUpdateApplier(applier);
    const user = userEvent.setup();
    render(<App />);
    act(() => markUpdateAvailable());
    await user.click(screen.getByTestId('update-banner-apply'));
    expect(screen.queryByTestId('update-confirm')).toBeNull();
    expect(applier).toHaveBeenCalledTimes(1);
  });
});

describe('3-8 ホームの残り点入力', () => {
  it('2〜170 は CHECKOUT、171〜350 は SETUP をその値で開く', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.type(screen.getByTestId('score-input'), '302{Enter}');
    expect(screen.getByTestId('nav-setup')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('score-input')).toHaveValue('302');
    first.unmount();
    window.history.replaceState(null, '', '/');

    render(<App />);
    await user.type(screen.getByTestId('score-input'), '103{Enter}');
    expect(screen.getByTestId('nav-checkout')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('standard-route')).toBeInTheDocument();
  });
});

describe('3-8 SIMULATION の計算ミス', () => {
  it('3 回間違えたら答えを見られる。ミスの記録は残る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-simulation'));
    await user.click(screen.getByTestId('start-simulation'));
    for (let i = 0; i < 3; i += 1) await user.click(screen.getByTestId('segment-t20'));

    for (let i = 0; i < 2; i += 1) {
      await user.type(screen.getByTestId('sim-score-input'), '999{Enter}');
    }
    expect(screen.queryByTestId('sim-entry-reveal')).toBeNull();
    await user.type(screen.getByTestId('sim-score-input'), '999{Enter}');
    await user.click(screen.getByTestId('sim-entry-reveal'));
    const answer = screen.getByTestId('sim-entry-answer').textContent ?? '';
    const actual = /正しい合計は (\d+) 点/.exec(answer)?.[1];
    expect(actual).toBeDefined();

    await user.type(screen.getByTestId('sim-score-input'), `${actual}{Enter}`);
    expect(screen.getByTestId('sim-next-round')).toBeInTheDocument();
    expect(loadSimulationSession()?.game.current?.entry?.wrongEntries).toEqual([999, 999, 999]);
  });
});
