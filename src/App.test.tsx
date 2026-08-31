import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

async function openCheckout(user: User) {
  await user.click(screen.getByTestId('nav-checkout'));
}

/** LEFT を入力する。確定ボタンはないので、入力しただけで反映される。 */
async function typeLeft(user: User, value: string) {
  const input = screen.getByTestId('score-input');
  await user.clear(input);
  await user.type(input, value);
}

async function openCheckoutWith(user: User, value: string) {
  await openCheckout(user);
  await typeLeft(user, value);
}

async function openSetupWith(user: User, value: string) {
  await user.click(screen.getByTestId('nav-setup'));
  await typeLeft(user, value);
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
    await openCheckoutWith(user, '103');
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    await user.click(screen.getByTestId('nav-training'));
    expect(screen.getByTestId('start-training')).toBeInTheDocument();
  });
});

describe('CHECKOUT 画面', () => {
  it('103 の基準ルートと理由を表示する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');

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
    await openCheckoutWith(user, '103');

    // T19 を狙って S19 に落ちた、という入力。
    await user.click(screen.getByTestId('segment-s19-outer'));
    expect(screen.getByTestId('status-left')).toHaveTextContent('84');
    expect(screen.getByTestId('status-darts')).toHaveTextContent('2');
    expect(screen.getByTestId('thrown-0')).toHaveTextContent('S19');
  });

  it('Undo で 1 投戻せる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');

    await user.click(screen.getByTestId('segment-s19-outer'));
    expect(screen.getByTestId('status-left')).toHaveTextContent('84');
    await user.click(screen.getByTestId('undo-button'));
    expect(screen.getByTestId('status-left')).toHaveTextContent('103');
    expect(screen.getByTestId('status-darts')).toHaveTextContent('3');
  });

  it('Bust するとビジット開始時の残りへ戻ることが分かる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');

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
    await openCheckoutWith(user, '103');

    await user.click(screen.getByTestId('segment-t19'));
    await user.click(screen.getByTestId('segment-s6-outer'));
    await user.click(screen.getByTestId('segment-d20'));
    expect(screen.getByTestId('status-flag')).toHaveTextContent('CHECKOUT!');
    expect(screen.getByTestId('status-left')).toHaveTextContent('0');
  });

  it('理由は「開く」まで隠れている（progressive disclosure）', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');

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
    await openCheckoutWith(user, '103');

    const before = screen.getAllByTestId(/^route-/).length;
    await user.click(screen.getByTestId('show-all-routes'));
    expect(screen.getAllByTestId(/^route-/).length).toBeGreaterThan(before);
  });

  it('Bogey を入力すると理由を示して候補を出さない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    await typeLeft(user, '169');

    expect(screen.getByTestId('no-routes').textContent).toContain('ノーテン');
  });

  it('122 では T18 始動が基準として出る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    await typeLeft(user, '122');

    const standard = screen.getByTestId('standard-route');
    expect(within(standard).getByText('T18')).toBeInTheDocument();
    expect(screen.getByTestId('standard-route-headline').textContent).toContain('104');
  });
});

describe('PR #1 レビュー指摘の回帰テスト', () => {
  it('「次のビジットへ」で残り点が進むと、入力欄も追従する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');

    // 103 → T20 で 43 残り、3 投使い切ってビジット終了。
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-miss'));
    await user.click(screen.getByTestId('segment-miss'));
    expect(screen.getByTestId('status-left')).toHaveTextContent('43');

    await user.click(screen.getByTestId('next-visit-button'));
    // 入力欄が古い 103 のままだと、次の入力でビジットが巻き戻ってしまう。
    expect(screen.getByTestId('score-input')).toHaveValue('43');
    expect(screen.getByTestId('status-left')).toHaveTextContent('43');
  });

  it('セッション開始後に出題数を変えても、進行中のセッションは影響を受けない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('start-training'));
    expect(screen.getByTestId('training-progress')).toHaveTextContent('1 / 10 問目');

    await user.click(screen.getByRole('button', { name: '詳細設定' }));
    await user.click(screen.getByRole('button', { name: '30問' }));

    // 進行中のセッションは開始時の設定（10 問）のまま。
    expect(screen.getByTestId('training-progress')).toHaveTextContent('1 / 10 問目');
  });

  it('出題できない設定では開始できず、理由を表示する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('training-mode-recovery'));
    await user.click(screen.getByRole('button', { name: '詳細設定' }));

    const min = screen.getByLabelText('CHECKOUT 最小値');
    const max = screen.getByLabelText('CHECKOUT 最大値');
    await user.clear(min);
    await user.type(min, '2');
    await user.clear(max);
    await user.type(max, '3');

    expect(screen.getByTestId('training-unusable')).toBeInTheDocument();
    expect(screen.getByTestId('start-training')).toBeDisabled();
  });
});

describe('SETUP 画面', () => {
  it('305 で T20 → T20 → S18 を最上位に出し、残り 167 を示す', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSetupWith(user, '305');

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
    await openSetupWith(user, '269');

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

describe('v1.1 入力 UX（LEFT 即時反映）', () => {
  it('CHECKOUT を開いた直後は LEFT が空欄で、候補を出さない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    expect(screen.getByTestId('score-input')).toHaveValue('');
    expect(screen.getByTestId('practice-idle')).toBeInTheDocument();
    // 既定値 103 のルートを勝手に出さない。
    expect(screen.queryByTestId('standard-route')).toBeNull();
    expect(screen.queryByTestId('status-bar')).toBeNull();
  });

  it('SETUP を開いた直後は LEFT が空欄で、候補を出さない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-setup'));

    expect(screen.getByTestId('score-input')).toHaveValue('');
    expect(screen.getByTestId('practice-idle')).toBeInTheDocument();
    // 既定値 305 のルートを勝手に出さない。
    expect(screen.queryByTestId('standard-route')).toBeNull();
  });

  it('空欄はエラー扱いにしない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    await user.click(screen.getByTestId('score-input'));
    await user.tab();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('score-input')).toHaveAttribute('aria-invalid', 'false');
  });

  it('「セット」ボタンは存在しない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    expect(screen.queryByTestId('score-input-apply')).toBeNull();
    expect(screen.queryByRole('button', { name: 'セット' })).toBeNull();
  });

  it('CHECKOUT で 103 を入力するだけで T19 → S6 → D20 が出る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);
    await typeLeft(user, '103');

    // 確定操作は挟まない。
    const standard = screen.getByTestId('standard-route');
    expect(within(standard).getByText('T19')).toBeInTheDocument();
    expect(within(standard).getByText('S6')).toBeInTheDocument();
    expect(within(standard).getByText('D20')).toBeInTheDocument();
    expect(screen.getByTestId('status-left')).toHaveTextContent('103');
  });

  it('SETUP で 302 を入力するだけで候補が出る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-setup'));
    await typeLeft(user, '302');

    expect(screen.getByTestId('status-left')).toHaveTextContent('302');
    expect(screen.getByTestId('standard-route')).toBeInTheDocument();
    expect(screen.getByTestId('setup-routes').childElementCount).toBeGreaterThan(0);
  });

  it('空欄へ戻すと候補が消えて未入力状態になる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');
    expect(screen.getByTestId('standard-route')).toBeInTheDocument();

    await user.clear(screen.getByTestId('score-input'));

    expect(screen.queryByTestId('standard-route')).toBeNull();
    expect(screen.queryByTestId('status-bar')).toBeNull();
    expect(screen.getByTestId('practice-idle')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('範囲外の値ではルートを計算せず、入力を終えた時点で理由を示す', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    // CHECKOUT の下限未満。
    await user.type(screen.getByTestId('score-input'), '1');
    expect(screen.getByTestId('practice-idle')).toBeInTheDocument();
    expect(screen.queryByTestId('standard-route')).toBeNull();

    await user.tab();
    expect(screen.getByRole('alert').textContent).toContain('2〜170');
  });

  it('SETUP でも範囲外ならルートを計算しない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-setup'));

    // 100 は 171〜350 の外。途中の "1" "10" も範囲外なので一度も計算しない。
    await user.type(screen.getByTestId('score-input'), '100');
    expect(screen.getByTestId('practice-idle')).toBeInTheDocument();
    expect(screen.queryByTestId('standard-route')).toBeNull();

    await user.tab();
    expect(screen.getByRole('alert').textContent).toContain('171〜350');
  });

  it('入力途中の一時的な無効値でも画面が壊れない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    const input = screen.getByTestId('score-input');
    // 103 を打つ途中の "1" は無効だが、エラーも出さず落ちもしない。
    await user.type(input, '1');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.type(input, '0');
    expect(screen.getByTestId('status-left')).toHaveTextContent('10');
    await user.type(input, '3');
    expect(screen.getByTestId('status-left')).toHaveTextContent('103');
  });

  it('入力欄に focus すると現在値が全選択され、そのまま置き換えられる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');

    const input = screen.getByTestId('score-input') as HTMLInputElement;
    await user.tab(); // いったん外へ出てから、実戦と同じようにタップし直す。
    await user.click(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(3);

    // 3 桁を消さずに次の数字で置き換わる。
    await user.keyboard('61');
    expect(input).toHaveValue('61');
    expect(screen.getByTestId('status-left')).toHaveTextContent('61');
  });

  it('プリセットを押すと確定操作なしで反映される', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    await user.click(screen.getByRole('button', { name: '122' }));
    expect(screen.getByTestId('score-input')).toHaveValue('122');
    expect(screen.getByTestId('status-left')).toHaveTextContent('122');
    expect(within(screen.getByTestId('standard-route')).getByText('T18')).toBeInTheDocument();
  });

  it('CHECKOUT の LEFT を SETUP へ持ち越さない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');
    expect(screen.getByTestId('score-input')).toHaveValue('103');

    await user.click(screen.getByTestId('nav-setup'));
    expect(screen.getByTestId('score-input')).toHaveValue('');
    expect(screen.getByTestId('practice-idle')).toBeInTheDocument();

    // SETUP で入れた値も CHECKOUT へ戻らない。
    await typeLeft(user, '305');
    await openCheckout(user);
    expect(screen.getByTestId('score-input')).toHaveValue('');
  });
});

describe('AUD-P2-001「すべて表示」の打ち切り', () => {
  it('40 件を超える OTHER ROUTES を 40 件で打ち切らず、ボタンの件数と一致させる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '130');

    const button = screen.getByTestId('show-all-routes');
    const total = Number(/(\d+)\s*件/.exec(button.textContent ?? '')?.[1]);
    expect(total).toBeGreaterThan(40);

    await user.click(button);
    // ボタンが言った件数がそのまま並ぶ（40 件で切れない）。
    expect(screen.getByTestId('other-routes').childElementCount).toBe(total);
  });

  it('段階表示でも最終的に全候補へ到達できる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '130');

    const total = Number(
      /(\d+)\s*件/.exec(screen.getByTestId('show-all-routes').textContent ?? '')?.[1],
    );
    // 「さらに表示」を押し続ければ、いずれ全件が並ぶ。
    for (let guard = 0; guard < 20; guard += 1) {
      const more = screen.queryByTestId('show-more-routes');
      if (!more) break;
      await user.click(more);
    }
    await user.click(screen.getByTestId('show-all-routes'));
    expect(screen.getByTestId('other-routes').childElementCount).toBe(total);
    // 全件出したあとは「上位 5 件だけ表示」へ戻せる。
    expect(screen.getByTestId('show-all-routes').textContent).toContain('上位 5 件');
  });

  it('SETUP の件数表示も実際の表示件数と一致する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSetupWith(user, '305');

    const button = screen.getByTestId('show-all-routes');
    const total = Number(/(\d+)\s*件/.exec(button.textContent ?? '')?.[1]);
    await user.click(button);
    expect(screen.getByTestId('setup-routes').childElementCount).toBe(total);
  });
});
