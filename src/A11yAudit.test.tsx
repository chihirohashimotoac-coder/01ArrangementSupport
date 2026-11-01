/**
 * 2026-11-01 監査 フェーズ 4（デザイン・アクセシビリティ）の回帰テスト。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('D-M5 読み上げ（常に置いておく live 領域）', () => {
  it('live 領域は最初から空で置いてあり、内容と同時には出現しない', () => {
    render(<App />);
    const region = screen.getByTestId('live-announcer');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('');
  });

  it('着弾を入れると、次の狙いを 1 文で読み上げる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-checkout'));
    await user.type(screen.getByTestId('score-input'), '103');
    await user.click(screen.getByTestId('recovery-toggle'));
    await user.click(screen.getByTestId('segment-s19-outer'));
    await waitFor(() =>
      expect(screen.getByTestId('live-announcer')).toHaveTextContent(/残り 84、2 本。次の狙いは/),
    );
  });

  it('BUST と CHECKOUT! を読み上げる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-checkout'));
    await user.type(screen.getByTestId('score-input'), '40');
    await user.click(screen.getByTestId('recovery-toggle'));
    await user.click(screen.getByTestId('segment-t20'));
    await waitFor(() => expect(screen.getByTestId('live-announcer')).toHaveTextContent(/^BUST/));

    await user.clear(screen.getByTestId('score-input'));
    await user.type(screen.getByTestId('score-input'), '40');
    await user.click(screen.getByTestId('recovery-toggle'));
    await user.click(screen.getByTestId('segment-d20'));
    await waitFor(() => expect(screen.getByTestId('live-announcer')).toHaveTextContent('CHECKOUT!'));
  });

  it('TRAINING の判定を読み上げる（結果の section には live 領域を付けない）', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('start-training'));
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('training-submit'));
    const verdict = screen.getByTestId('training-verdict').textContent ?? '';
    await waitFor(() => expect(screen.getByTestId('live-announcer')).toHaveTextContent(verdict));
    expect(screen.getByTestId('training-result')).not.toHaveAttribute('aria-live');
  });
});

describe('D-M3 狙う的の明るさ', () => {
  const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8');
  const luminance = (hex: string) => {
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const n = Number.parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const valuesOf = (name: string) => [...css.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, 'g'))].map((m) => m[1]);

  it('狙う的の塗り（2 種類）は、どのテーマでも赤・緑の区画と 3:1 以上の明るさの比がある', () => {
    const targets = [...valuesOf('highlight-fill'), ...valuesOf('focus-fill')];
    const others = [...valuesOf('segment-red'), ...valuesOf('segment-green')];
    expect(targets.length).toBeGreaterThanOrEqual(4);
    expect(others.length).toBeGreaterThanOrEqual(4);
    const violations = targets.flatMap((target) =>
      others.filter((other) => ratio(target, other) < 3).map((other) => `${target} / ${other}: ${ratio(target, other).toFixed(2)}`),
    );
    expect(violations).toEqual([]);
  });
});

describe('4-8 見出し・現在地・採点後の盤面', () => {
  it('CHECKOUT / TRAINING / SIMULATION に h1 があり、ナビの現在地に aria-current を付ける', async () => {
    const user = userEvent.setup();
    render(<App />);
    for (const [nav, heading] of [
      ['nav-checkout', /CHECKOUT/],
      ['nav-training', /TRAINING/],
      ['nav-simulation', /SIMULATION/],
    ] as const) {
      await user.click(screen.getByTestId(nav));
      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      expect(screen.getByTestId(nav)).toHaveAttribute('aria-current', 'page');
    }
    expect(screen.getByRole('heading', { level: 2, name: 'ゲームの設定' })).toBeInTheDocument();
    expect(screen.getByTestId('nav-checkout')).not.toHaveAttribute('aria-current');
  });

  it('TRAINING の採点後は、おすすめを番号札つきで、自分の回答を点線の枠で描き、盤面を薄くしない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('start-training'));
    await user.click(screen.getByTestId('segment-miss'));
    await user.click(screen.getByTestId('training-submit'));
    const board = screen.getByTestId('dartboard');
    expect(board).toHaveAttribute('data-dim', 'false');
    expect(board.querySelectorAll('.dartboard__badge').length).toBeGreaterThan(0);
    expect(screen.getByTestId('board-answers').querySelector('[data-dart="MISS"]')).not.toBeNull();
  });
});
