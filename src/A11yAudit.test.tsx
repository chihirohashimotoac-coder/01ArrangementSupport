/**
 * 2026-11-01 監査 フェーズ 4（デザイン・アクセシビリティ）の回帰テスト。
 */
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
