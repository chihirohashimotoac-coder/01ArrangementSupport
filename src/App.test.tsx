import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

async function openCheckout(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('nav-checkout'));
}

describe('アプリの骨格', () => {
  it('トップに 3 つのモードが並ぶ', () => {
    render(<App />);
    expect(screen.getByTestId('home-checkout')).toBeInTheDocument();
    expect(screen.getByTestId('home-setup')).toBeInTheDocument();
    expect(screen.getByTestId('home-training')).toBeInTheDocument();
  });

  it('ナビゲーションでモードを切り替えられる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    await user.click(screen.getByTestId('nav-training'));
    expect(screen.getByTestId('start-training')).toBeInTheDocument();
  });
});

describe('CHECKOUT 画面', () => {
  it('103 の基準ルートと理由を表示する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    expect(screen.getByTestId('status-left')).toHaveTextContent('103');
    expect(screen.getByTestId('status-darts')).toHaveTextContent('3');

    const standard = screen.getByTestId('standard-route');
    expect(within(standard).getByText('T19')).toBeInTheDocument();
    expect(within(standard).getByText('S6')).toBeInTheDocument();
    expect(within(standard).getByText('D20')).toBeInTheDocument();
    expect(within(standard).getByText('STANDARD')).toBeInTheDocument();
    // 書き下ろしの説明が要約として出る。
    expect(screen.getByTestId('standard-route-headline').textContent).toContain('46');
  });

  it('盤面をタップすると残りと本数が追従する（リカバリー）', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    // T19 を狙って S19 に落ちた、という入力。
    await user.click(screen.getByTestId('segment-s19-outer'));
    expect(screen.getByTestId('status-left')).toHaveTextContent('84');
    expect(screen.getByTestId('status-darts')).toHaveTextContent('2');
    expect(screen.getByTestId('thrown-0')).toHaveTextContent('S19');
  });

  it('Undo で 1 投戻せる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    await user.click(screen.getByTestId('segment-s19-outer'));
    expect(screen.getByTestId('status-left')).toHaveTextContent('84');
    await user.click(screen.getByTestId('undo-button'));
    expect(screen.getByTestId('status-left')).toHaveTextContent('103');
    expect(screen.getByTestId('status-darts')).toHaveTextContent('3');
  });

  it('Bust するとビジット開始時の残りへ戻ることが分かる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    // 103 → T19 → 46 → T20 で 46 - 60 < 0 となり Bust。
    await user.click(screen.getByTestId('segment-t19'));
    expect(screen.getByTestId('status-left')).toHaveTextContent('46');
    await user.click(screen.getByTestId('segment-t20'));

    expect(screen.getByTestId('status-flag')).toHaveTextContent('BUST');
    expect(screen.getByTestId('status-left')).toHaveTextContent('103');
    expect(screen.getByTestId('status-note').textContent).toContain('103');
    expect(screen.getByTestId('board-disabled-reason')).toBeInTheDocument();
  });

  it('チェックアウトすると CHECKOUT! と表示する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    await user.click(screen.getByTestId('segment-t19'));
    await user.click(screen.getByTestId('segment-s6-outer'));
    await user.click(screen.getByTestId('segment-d20'));
    expect(screen.getByTestId('status-flag')).toHaveTextContent('CHECKOUT!');
    expect(screen.getByTestId('status-left')).toHaveTextContent('0');
  });

  it('理由は「開く」まで隠れている（progressive disclosure）', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    // OTHER ROUTES の最初のカードは畳まれている。
    const toggles = screen.getAllByRole('button', { name: /WHY THIS ROUTE/ });
    expect(toggles.length).toBeGreaterThan(0);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
  });

  it('「すべて表示」で候補を増やせる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    const before = screen.getAllByTestId(/^route-/).length;
    await user.click(screen.getByTestId('show-all-routes'));
    expect(screen.getAllByTestId(/^route-/).length).toBeGreaterThan(before);
  });

  it('Bogey を入力すると理由を示して候補を出さない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    const input = screen.getByTestId('score-input');
    await user.clear(input);
    await user.type(input, '169');
    await user.click(screen.getByTestId('score-input-apply'));

    expect(screen.getByTestId('no-routes').textContent).toContain('ノーテン');
  });

  it('122 では T18 始動が基準として出る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    const input = screen.getByTestId('score-input');
    await user.clear(input);
    await user.type(input, '122');
    await user.click(screen.getByTestId('score-input-apply'));

    const standard = screen.getByTestId('standard-route');
    expect(within(standard).getByText('T18')).toBeInTheDocument();
    expect(screen.getByTestId('standard-route-headline').textContent).toContain('104');
  });
});

describe('SETUP 画面', () => {
  it('305 で T20 → T20 → S18 を最上位に出し、残り 167 を示す', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-setup'));

    expect(screen.getByTestId('status-left')).toHaveTextContent('305');
    const best = screen.getByTestId('standard-route');
    // T20 → T20 → S18 なので T20 は 2 つ現れる。
    expect(within(best).getAllByText('T20')).toHaveLength(2);
    expect(within(best).getByText('S18')).toBeInTheDocument();
    expect(best.textContent).toContain('残り 167');
  });

  it('とりあえず TON の罠を警告する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-setup'));

    const input = screen.getByTestId('score-input');
    await user.clear(input);
    await user.type(input, '269');
    await user.click(screen.getByTestId('score-input-apply'));

    expect(screen.getByTestId('status-note').textContent).toContain('169');
  });
});

describe('TRAINING 画面', () => {
  it('回答して確定すると採点結果が出る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('start-training'));

    // 3 投を選ぶ（成立するかは問題によるが、確定できることを見る）。
    await user.click(screen.getByTestId('segment-t20'));
    expect(screen.getByTestId('answer-0')).toHaveTextContent('T20');

    await user.click(screen.getByTestId('training-submit'));
    expect(screen.getByTestId('training-result')).toBeInTheDocument();
    expect(screen.getByTestId('stat-attempts')).toHaveTextContent('1');
  });

  it('自動確定はせず、「回答する」を押すまで採点しない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('start-training'));

    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-d20'));
    expect(screen.queryByTestId('training-result')).not.toBeInTheDocument();
  });

  it('Undo で 1 投戻せる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('start-training'));

    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('training-undo'));
    expect(screen.getByTestId('answer-0')).toHaveTextContent('—');
  });

  it('学習履歴を消去できる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('start-training'));
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('training-submit'));
    expect(screen.getByTestId('stat-attempts')).toHaveTextContent('1');

    await user.click(screen.getByTestId('clear-history'));
    expect(screen.getByTestId('stat-attempts')).toHaveTextContent('0');
  });
});

describe('設定画面', () => {
  it('得意ダブルを選ぶと順位づけされる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-settings'));

    const list = screen.getByTestId('preferred-doubles');
    expect(within(list).getByText('D16')).toBeInTheDocument();

    await user.click(screen.getByTestId('select-D16'));
    expect(within(screen.getByTestId('preferred-doubles')).queryByText('D16')).toBeNull();
  });
});
