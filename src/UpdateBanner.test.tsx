/**
 * 新しいバージョンのお知らせ（更新バナー）。
 *
 * 守りたいことは 4 つ。
 *   1. 更新が待機していないあいだは、何も出さない
 *   2. 待機したら「新しいバージョンがあります。」と更新ボタンを出す
 *   3. 更新ボタンを押すまでリロードしない（押したときだけ適用を呼ぶ）
 *   4. TRAINING / SIMULATION の最中でも出るが、進行を壊さない
 *
 * Service Worker そのものは jsdom に無いので、`updateStore` を直接動かす。
 * 画面側は `virtual:pwa-register` を import しない作りにしてある。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import {
  dismissUpdate,
  getUpdateState,
  markUpdateAvailable,
  resetUpdateStore,
  setUpdateApplier,
} from './pwa/updateStore';

type User = ReturnType<typeof userEvent.setup>;

afterEach(() => {
  resetUpdateStore();
});

/** 新しいビルドが待機した、という通知を再現する。 */
function needRefresh() {
  act(() => {
    markUpdateAvailable();
  });
}

describe('更新バナー', () => {
  it('更新が待機していないあいだは出さない', () => {
    render(<App />);
    expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument();
  });

  it('待機を検出すると、文言と更新ボタンを出す', () => {
    render(<App />);
    needRefresh();

    const banner = screen.getByTestId('update-banner');
    expect(banner).toHaveTextContent('新しいバージョンがあります。');
    expect(screen.getByTestId('update-banner-apply')).toHaveAccessibleName('更新');
    expect(screen.getByTestId('update-banner-dismiss')).toHaveAccessibleName('閉じる');
    // 読み上げへ伝わるようにしておく（割り込まない polite）。
    expect(banner).toHaveAttribute('role', 'status');
  });

  it('いちばん上に出す（ヘッダーより前）', () => {
    render(<App />);
    needRefresh();

    const banner = screen.getByTestId('update-banner');
    const header = document.querySelector('.app__header');
    expect(header).not.toBeNull();
    expect(banner.compareDocumentPosition(header!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('更新ボタンを押したときだけ適用する', async () => {
    const user: User = userEvent.setup();
    const apply = vi.fn();
    setUpdateApplier(apply);

    render(<App />);
    needRefresh();
    // 出ているだけでは何も起こさない。
    expect(apply).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('update-banner-apply'));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('閉じるとお知らせは消え、更新は適用しない', async () => {
    const user: User = userEvent.setup();
    const apply = vi.fn();
    setUpdateApplier(apply);

    render(<App />);
    needRefresh();
    await user.click(screen.getByTestId('update-banner-dismiss'));

    expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    // 更新自体は待機したまま（閉じただけ）。
    expect(getUpdateState()).toBe('dismissed');
  });

  it('閉じたあと、さらに新しいビルドが待機すれば再び知らせる', () => {
    render(<App />);
    needRefresh();
    act(() => {
      dismissUpdate();
    });
    expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument();

    needRefresh();
    expect(screen.getByTestId('update-banner')).toBeInTheDocument();
  });

  it('適用の手段が無い場合でも、押して落ちない', async () => {
    const user: User = userEvent.setup();
    render(<App />);
    needRefresh();

    await user.click(screen.getByTestId('update-banner-apply'));
    // 登録に失敗している状況。お知らせは残り、例外にはしない。
    expect(screen.getByTestId('update-banner')).toBeInTheDocument();
  });

  it.each([
    ['training', 'nav-training'],
    ['simulation', 'nav-simulation'],
  ])('%s の最中でも出るが、画面はそのまま動く', async (_mode, navId) => {
    const user: User = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId(navId));
    needRefresh();

    expect(screen.getByTestId('update-banner')).toBeInTheDocument();
    // モードの画面は置き換わらない。
    expect(screen.getByTestId(navId)).toHaveAttribute('aria-pressed', 'true');
  });

  it('CHECKOUT の入力中に出ても、答えは消えない', async () => {
    const user: User = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId('nav-checkout'));
    await user.type(screen.getByTestId('score-input'), '103');
    expect(screen.getByTestId('standard-route')).toBeInTheDocument();

    needRefresh();

    expect(screen.getByTestId('update-banner')).toBeInTheDocument();
    expect(screen.getByTestId('standard-route')).toBeInTheDocument();
    expect(screen.getByTestId('score-input')).toHaveValue('103');
  });
});

describe('更新バナーの状態', () => {
  it('待機の通知を重ねても状態は 1 つ', () => {
    markUpdateAvailable();
    markUpdateAvailable();
    expect(getUpdateState()).toBe('available');
  });

  it('待機していないのに閉じても、状態は変わらない', () => {
    expect(getUpdateState()).toBe('idle');
    dismissUpdate();
    expect(getUpdateState()).toBe('idle');
  });
});
