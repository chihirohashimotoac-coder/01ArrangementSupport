import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { VERSION_HISTORY } from './data/versionHistory';

type User = ReturnType<typeof userEvent.setup>;

async function openVersionHistory(user: User) {
  await user.click(screen.getByTestId('home-version-history'));
}

describe('バージョン履歴', () => {
  it('トップページに「バージョン履歴」ボタンがある', () => {
    render(<App />);
    const button = screen.getByTestId('home-version-history');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAccessibleName('バージョン履歴');

    // トップページの説明・カードより後ろ、フッターより前に置く。
    const modes = screen.getByTestId('home-training');
    const footer = document.querySelector('.app__footer');
    expect(footer).not.toBeNull();
    expect(modes.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('他の画面では「バージョン履歴」ボタンを出さない', async () => {
    const user = userEvent.setup();
    render(<App />);
    for (const id of ['nav-checkout', 'nav-setup', 'nav-training', 'nav-settings']) {
      await user.click(screen.getByTestId(id));
      expect(screen.queryByTestId('home-version-history')).not.toBeInTheDocument();
    }
    // バージョン履歴ページ自身にも出さない。
    await user.click(screen.getByTestId('app-title'));
    await openVersionHistory(user);
    expect(screen.queryByTestId('home-version-history')).not.toBeInTheDocument();
  });

  it('ボタンを押すと見出しと複数の履歴が並ぶ', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openVersionHistory(user);

    expect(screen.getByRole('heading', { name: 'バージョン履歴' })).toBeInTheDocument();
    const items = screen.getAllByTestId('version-history-item');
    expect(items.length).toBe(VERSION_HISTORY.length);
    expect(items.length).toBeGreaterThan(1);
  });

  it('最新の履歴に TRAINING v1.3 の主要変更がある', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openVersionHistory(user);

    const latest = screen.getAllByTestId('version-history-item')[0];
    expect(latest).toHaveTextContent('v1.3');
    expect(latest).toHaveTextContent('TRAINING');
    expect(latest).toHaveTextContent('現在');
    expect(latest.textContent ?? '').toMatch(/ノーテン/);
    expect(latest.textContent ?? '').toMatch(/1 投調整/);
  });

  it('「トップへ戻る」でトップページへ戻れる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openVersionHistory(user);

    await user.click(screen.getByTestId('version-history-back'));
    expect(screen.getByTestId('home-checkout')).toBeInTheDocument();
    expect(screen.queryByTestId('version-history-list')).not.toBeInTheDocument();
    // 戻ったときにスクロール位置を持ち越さない。
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it('バージョン履歴を開いても既存のナビゲーションは動く', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openVersionHistory(user);

    await user.click(screen.getByTestId('nav-training'));
    expect(screen.getByTestId('start-training')).toBeInTheDocument();
    expect(screen.queryByTestId('version-history-list')).not.toBeInTheDocument();
  });

  it('履歴データは新しい順で、現在版は 1 件だけ', () => {
    const dates = VERSION_HISTORY.map((entry) => entry.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(VERSION_HISTORY.filter((entry) => entry.current)).toHaveLength(1);
    expect(VERSION_HISTORY[0].current).toBe(true);
    // 名称・要約・変更点が欠けている項目を出さない。
    const broken = VERSION_HISTORY.filter(
      (entry) => !entry.label || !entry.summary || entry.changes.length === 0,
    );
    expect(broken).toEqual([]);
  });
});
