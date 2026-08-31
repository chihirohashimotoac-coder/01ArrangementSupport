import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

/**
 * 実戦入力（盤面）を開く。
 * v1.2 では通常表示で盤面をたたむので、着弾を入れるテストは必ずここを通る。
 */
async function openRecovery(user: User) {
  await user.click(screen.getByTestId('recovery-toggle'));
}

/** a が b より前（DOM 順）にあるか。 */
function precedes(a: Element, b: Element) {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
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
    expect(screen.getByTestId('standard-route')).toBeInTheDocument();
    await user.click(screen.getByTestId('nav-training'));
    expect(screen.getByTestId('start-training')).toBeInTheDocument();
  });
});

describe('CHECKOUT 画面', () => {
  it('103 の基準ルートと理由を表示する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');

    // v1.2: 通常表示では StatusBar / 盤面を通らず、いきなり答えが出る。
    expect(screen.queryByTestId('status-bar')).toBeNull();
    expect(screen.queryByTestId('dartboard')).toBeNull();

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
    await openRecovery(user);

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
    await openRecovery(user);

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
    await openRecovery(user);

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
    await openRecovery(user);

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
    await openRecovery(user);

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

    expect(screen.getByTestId('score-input')).toHaveValue('305');
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
    expect(screen.getByTestId('score-input')).toHaveValue('103');
  });

  it('SETUP で 302 を入力するだけで候補が出る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-setup'));
    await typeLeft(user, '302');

    expect(screen.getByTestId('score-input')).toHaveValue('302');
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
    // 10 も合法な CHECKOUT 値なので、この時点で候補は出る（画面は動かさない）。
    expect(within(screen.getByTestId('standard-route')).getByText('D5')).toBeInTheDocument();
    await user.type(input, '3');
    expect(within(screen.getByTestId('standard-route')).getByText('T19')).toBeInTheDocument();
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
    expect(within(screen.getByTestId('standard-route')).getByText('T15')).toBeInTheDocument();
  });

  it('範囲外へ書き換えたら、前の残り点の候補を残さない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '170');
    expect(screen.getByTestId('standard-route')).toBeInTheDocument();

    // 170 を 171 へ書き換える。途中で 17 が有効になるが、
    // 入力欄が 171 のまま 17 の候補を出したままにはしない。
    await user.clear(screen.getByTestId('score-input'));
    await user.type(screen.getByTestId('score-input'), '171');

    expect(screen.getByTestId('score-input')).toHaveValue('171');
    expect(screen.queryByTestId('standard-route')).toBeNull();
    expect(screen.getByTestId('practice-idle')).toBeInTheDocument();
  });

  it('選択状態のまま範囲外を打ち込んでも、前の候補を残さない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSetupWith(user, '305');
    expect(screen.getByTestId('standard-route')).toBeInTheDocument();

    // タップで全選択 → 100 を打つ。SETUP の範囲外なので候補は消える。
    await user.tab();
    await user.click(screen.getByTestId('score-input'));
    await user.keyboard('100');

    expect(screen.getByTestId('score-input')).toHaveValue('100');
    expect(screen.queryByTestId('standard-route')).toBeNull();
    expect(screen.getByTestId('practice-idle')).toBeInTheDocument();
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

describe('v1.1 ユーザー向け文言', () => {
  it('footer は Copyright 表記だけになっている', () => {
    const { container } = render(<App />);
    const footer = container.querySelector('.app__footer');
    expect(footer?.textContent).toBe('© 2026 Chihiro Hashimoto');
  });

  it('footer に開発内部の注記が残っていない', () => {
    const { container } = render(<App />);
    const footer = container.querySelector('.app__footer')?.textContent ?? '';
    for (const phrase of ['添付資料', '第1候補', 'PDC 公式', 'Excel', '端末内']) {
      expect(footer).not.toContain(phrase);
    }
  });

  it('設定画面に開発内部の情報を出さない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-settings'));

    const text = screen.getByTestId('nav-settings').closest('.app')?.textContent ?? '';
    for (const phrase of ['添付', '第1候補', 'human-approved-v1', '123 件', '一次資料', 'Excel']) {
      expect(text).not.toContain(phrase);
    }
    // 出典（PDC）は主張しない。APPROVALS.md A-1。
    expect(text).not.toContain('PDC');
  });

  it('設定画面に基準ルートのユーザー向け説明が出る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-settings'));

    expect(screen.getByRole('heading', { name: '基準ルートについて' })).toBeInTheDocument();
    const note = screen.getByTestId('standard-route-note').textContent ?? '';
    expect(note).toContain('実戦で使われる標準的なアレンジ');
    expect(note).toContain('MY ROUTE');
    // APPROVALS.md A-1: 一次資料が確認できていないため、出典は主張しない。
    for (const phrase of ['PDC', '公式']) {
      expect(note).not.toContain(phrase);
    }
  });
});

describe('v1.2 UX（答えを先に見せる）', () => {
  it('A: CHECKOUT の通常表示では、答えが盤面より先に来る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');

    // 通常表示では盤面自体を出さない（答えの前を大きく占有させない）。
    expect(screen.queryByTestId('dartboard')).toBeNull();

    // 開いたあとも、DOM 順は STANDARD が先。
    await openRecovery(user);
    expect(precedes(screen.getByTestId('standard-route'), screen.getByTestId('dartboard'))).toBe(
      true,
    );
  });

  it('B: SETUP の通常表示では、BEST が盤面より先に来る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSetupWith(user, '302');

    expect(screen.queryByTestId('dartboard')).toBeNull();
    const best = screen.getByTestId('standard-route');
    expect(within(best).getByText('BEST')).toBeInTheDocument();

    await openRecovery(user);
    expect(precedes(best, screen.getByTestId('dartboard'))).toBe(true);
  });

  it('C: 通常状態では実戦入力が展開されていない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');

    expect(screen.getByTestId('recovery-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('dartboard')).toBeNull();
    expect(screen.queryByTestId('status-bar')).toBeNull();
    expect(screen.queryByTestId('visit-trail')).toBeNull();
  });

  it('D: 「実際の着弾を入力」で盤面が出る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');

    const toggle = screen.getByTestId('recovery-toggle');
    expect(toggle.textContent).toContain('実際の着弾を入力');
    // 英語の Recovery だけを主ボタン文言にしない。
    expect(toggle.textContent).not.toBe('Recovery');

    await user.click(toggle);
    expect(screen.getByTestId('dartboard')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('E: 実戦入力は閉じられる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');
    await openRecovery(user);
    expect(screen.getByTestId('dartboard')).toBeInTheDocument();

    await user.click(screen.getByTestId('recovery-toggle'));
    expect(screen.queryByTestId('dartboard')).toBeNull();
    expect(screen.getByTestId('standard-route')).toBeInTheDocument();
  });

  it('E2: 同じ画面にいるあいだ、開いた実戦入力は保たれる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');
    await openRecovery(user);
    await user.click(screen.getByTestId('segment-s19-outer'));
    expect(screen.getByTestId('dartboard')).toBeInTheDocument();

    // 理由を開閉するといった別の操作では閉じない。
    await user.click(
      within(screen.getByTestId('standard-route')).getByRole('button', { name: /理由/ }),
    );
    expect(screen.getByTestId('dartboard')).toBeInTheDocument();
    expect(screen.getByTestId('status-left')).toHaveTextContent('84');
  });

  it('E3: LEFT を別の残り点へ変えたら、新しいビジットとして初期化する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');
    await openRecovery(user);
    await user.click(screen.getByTestId('segment-s19-outer'));
    expect(screen.getByTestId('thrown-0')).toHaveTextContent('S19');

    await typeLeft(user, '122');
    // 前のビジットの着弾を持ち越さず、まず答えを見せる状態へ戻る。
    expect(screen.queryByTestId('dartboard')).toBeNull();
    await openRecovery(user);
    expect(screen.getByTestId('thrown-0')).toHaveTextContent('—');
    expect(screen.getByTestId('status-left')).toHaveTextContent('122');
  });

  it('F: 103 → S19 で、盤面のすぐ下に 84 / 2 DARTS と NEXT が出る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');
    await openRecovery(user);

    await user.click(screen.getByTestId('segment-s19-outer'));

    const next = screen.getByTestId('recovery-next');
    expect(within(next).getByTestId('next-remaining')).toHaveTextContent('84');
    expect(within(next).getByTestId('next-darts')).toHaveTextContent('2');

    const nextRoute = screen.getByTestId('recovery-next-route');
    expect(nextRoute.textContent).toContain('NEXT');
    expect(within(nextRoute).getByLabelText('次に狙うルート').childElementCount).toBeGreaterThan(0);

    // 盤面の直後（スクロールせずに一緒に見える位置）にある。
    const board = screen.getByTestId('dartboard');
    expect(precedes(board, next)).toBe(true);
    expect(board.parentElement).toBe(next.parentElement);
  });

  it('G: 盤面のそばの Undo が効く', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');
    await openRecovery(user);

    const undo = screen.getByTestId('undo-button');
    expect(undo).toBeDisabled();
    // Undo は盤面の直下（NEXT 表示の中）にひとつだけ。
    expect(screen.getAllByRole('button', { name: '1投戻す' })).toHaveLength(1);
    expect(screen.getByTestId('recovery-next').contains(undo)).toBe(true);

    await user.click(screen.getByTestId('segment-s19-outer'));
    expect(screen.getByTestId('status-left')).toHaveTextContent('84');
    await user.click(screen.getByTestId('undo-button'));
    expect(screen.getByTestId('status-left')).toHaveTextContent('103');
    expect(screen.getByTestId('thrown-0')).toHaveTextContent('—');
  });

  it('H: LEFT のラベルは「残り点 LEFT」', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    expect(screen.getByLabelText(/残り点 LEFT/)).toBe(screen.getByTestId('score-input'));

    await user.click(screen.getByTestId('nav-setup'));
    expect(screen.getByLabelText(/残り点 LEFT/)).toBe(screen.getByTestId('score-input'));
  });

  it('I: CHECKOUT の placeholder は入力例（例 103）', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    const input = screen.getByTestId('score-input');
    expect(input).toHaveAttribute('placeholder', '例 103');
    expect(input).toHaveValue('');
    expect(screen.getByLabelText(/残り点 LEFT/).closest('.score-input')?.textContent).toContain(
      '2〜170',
    );
  });

  it('J: SETUP の placeholder は入力例（例 302）', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-setup'));

    const input = screen.getByTestId('score-input');
    expect(input).toHaveAttribute('placeholder', '例 302');
    expect(input).toHaveValue('');
    expect(screen.getByLabelText(/残り点 LEFT/).closest('.score-input')?.textContent).toContain(
      '171〜350',
    );
  });

  it('K: 有効値になっただけでは画面を動かさない', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    // 103 を打つ途中の "10" も合法な CHECKOUT 値。ここで動くと入力できない。
    await user.type(screen.getByTestId('score-input'), '103');
    expect(screen.getByTestId('standard-route')).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();

    // 入力を終えていないので、待っても動かない。
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('L: Enter / Done で答えの位置へ移動する', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    await user.type(screen.getByTestId('score-input'), '103{Enter}');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());

    // 移動先は StatusBar ではなく、答えである STANDARD の先頭。
    const target = scrollIntoView.mock.contexts[0] as HTMLElement;
    expect(target.contains(screen.getByTestId('standard-route'))).toBe(true);
  });

  it('L2: SETUP でも Enter で答えの位置へ移動する', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-setup'));

    await user.type(screen.getByTestId('score-input'), '302{Enter}');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const target = scrollIntoView.mock.contexts[0] as HTMLElement;
    expect(target.contains(screen.getByTestId('standard-route'))).toBe(true);
  });

  it('M / O: CHECKOUT に旧プリセットボタンが残っていない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    for (const preset of ['170', '167', '164', '161', '160', '122', '103', '61', '46', '40']) {
      expect(screen.queryByRole('button', { name: preset })).toBeNull();
    }
    expect(document.querySelector('.score-input__presets')).toBeNull();
  });

  it('N / P: SETUP に旧プリセットボタンが残っていない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-setup'));

    for (const preset of ['350', '340', '309', '305', '302', '275', '271', '269', '235', '231']) {
      expect(screen.queryByRole('button', { name: preset })).toBeNull();
    }
    expect(document.querySelector('.score-input__presets')).toBeNull();
  });

  it('Q: プリセットがなくても 103 を直接入力すれば STANDARD が出る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');

    const standard = screen.getByTestId('standard-route');
    expect(within(standard).getByText('T19')).toBeInTheDocument();
    expect(within(standard).getByText('S6')).toBeInTheDocument();
    expect(within(standard).getByText('D20')).toBeInTheDocument();
  });

  it('R: プリセットがなくても 302 を直接入力すれば BEST が出る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSetupWith(user, '302');

    const best = screen.getByTestId('standard-route');
    expect(within(best).getAllByText('T20')).toHaveLength(2);
    expect(within(best).getByText('S18')).toBeInTheDocument();
    expect(best.textContent).toContain('残り 164');
  });

  it('S: TRAINING は採点後にだけ、結果の直下へ「次の問題」を出す', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-training'));
    await user.click(screen.getByTestId('start-training'));

    // 回答前には出さない（上部の操作群にも置かない）。
    expect(screen.queryByTestId('training-next')).toBeNull();

    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('training-submit'));

    const result = screen.getByTestId('training-result');
    const next = screen.getByTestId('training-next');
    expect(precedes(result, next)).toBe(true);
    expect(result.parentElement).toBe(next.parentElement);
    // 「次の問題」はひとつだけ。
    expect(screen.getAllByRole('button', { name: '次の問題' })).toHaveLength(1);
  });
});

describe('v1.3 テーマとユーザー向け文言', () => {
  it('Settings で Light / Dark を選び、document と theme-color へ反映する', async () => {
    const themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    document.head.append(themeColor);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-settings'));

    expect(screen.getByTestId('theme-dark')).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByTestId('theme-light'));

    expect(screen.getByTestId('theme-light')).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#edf4fb',
    );
    expect(JSON.parse(window.localStorage.getItem('oas.preferences.v1') ?? '{}').theme).toBe(
      'light',
    );

    await user.keyboard('{ArrowRight}');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByTestId('theme-dark')).toHaveFocus();
  });

  it('保存済み Light テーマを初期表示で復元する', () => {
    window.localStorage.setItem(
      'oas.preferences.v1',
      JSON.stringify({ version: 1, preferredDoubles: [], setupMainTarget: 'T20', theme: 'light' }),
    );
    render(<App />);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('ユーザー向け画面に「ビジット」を表示しない', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(document.body).not.toHaveTextContent('ビジット');

    await openCheckoutWith(user, '103');
    await openRecovery(user);
    expect(document.body).not.toHaveTextContent('ビジット');

    await user.click(screen.getByTestId('nav-setup'));
    expect(document.body).toHaveTextContent('次の3投に向けて整える');
    expect(document.body).not.toHaveTextContent('ビジット');

    await user.click(screen.getByTestId('nav-training'));
    expect(document.body).not.toHaveTextContent('ビジット');
    await user.click(screen.getByTestId('nav-settings'));
    expect(document.body).not.toHaveTextContent('ビジット');
  });
});

describe('v1.2 レビュー指摘の回帰テスト', () => {
  /** ルートカードの n 投目のチップ。 */
  function chipOf(card: HTMLElement, index: number) {
    return within(card).getByRole('button', { name: new RegExp(`^${index} 投目`) });
  }

  /** 直近の scrollIntoView が盤面を含む領域（＝実戦入力）へ向いていたか。 */
  function scrolledToRecovery(spy: { mock: { contexts: unknown[] } }) {
    const target = spy.mock.contexts.at(-1) as HTMLElement | undefined;
    return target !== undefined && target.contains(screen.getByTestId('dartboard'));
  }

  it('STANDARD のチップを押すと、盤面を開いてその位置まで移動する', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');
    scrollIntoView.mockClear();

    await user.click(chipOf(screen.getByTestId('standard-route'), 1));

    expect(screen.getByTestId('dartboard')).toBeInTheDocument();
    expect(screen.getByTestId('segment-t19')).toHaveAttribute('data-focused', 'true');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrolledToRecovery(scrollIntoView)).toBe(true);
  });

  it('OTHER ROUTES のチップからでも、盤面まで移動する', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');
    scrollIntoView.mockClear();

    // 盤面より下にあるカード。開いた盤面が viewport の上へ出てしまわないこと。
    const other = screen.getAllByTestId(/^route-/)[0];
    await user.click(chipOf(other, 1));

    expect(screen.getByTestId('dartboard')).toBeInTheDocument();
    expect(scrolledToRecovery(scrollIntoView)).toBe(true);
  });

  it('MY ROUTE のチップからでも、盤面まで移動する', async () => {
    window.localStorage.setItem(
      'oas.preferences.v1',
      JSON.stringify({ version: 1, preferredDoubles: ['D16'] }),
    );
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');
    scrollIntoView.mockClear();

    await user.click(chipOf(screen.getByTestId('my-route'), 1));

    expect(screen.getByTestId('dartboard')).toBeInTheDocument();
    expect(scrolledToRecovery(scrollIntoView)).toBe(true);
  });

  it('SETUP の候補チップからでも、盤面まで移動する', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    render(<App />);
    await openSetupWith(user, '302');
    scrollIntoView.mockClear();

    const other = screen.getByTestId('setup-routes').firstElementChild as HTMLElement;
    await user.click(chipOf(other, 1));

    expect(screen.getByTestId('dartboard')).toBeInTheDocument();
    expect(scrolledToRecovery(scrollIntoView)).toBe(true);
  });

  it('盤面がすでに開いているときは、チップを押しても画面を動かさない', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    render(<App />);
    await openCheckoutWith(user, '103');
    await openRecovery(user);
    scrollIntoView.mockClear();

    await user.click(chipOf(screen.getByTestId('standard-route'), 3));
    expect(screen.getByTestId('segment-d20')).toHaveAttribute('data-focused', 'true');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('blur で予約された移動は、「実際の着弾を入力」を押した時点で取り消す', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);
    await user.type(screen.getByTestId('score-input'), '103');

    // 入力欄から実戦入力ボタンへ移ると blur → click の順に起きる。
    await user.click(screen.getByTestId('recovery-toggle'));
    expect(screen.getByTestId('dartboard')).toBeInTheDocument();

    // 予約されていた 250ms 後の移動は起きない（開いた盤面から画面が動かない）。
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByTestId('dartboard')).toBeInTheDocument();
  });

  it('blur で予約された移動は、ルートチップを押した時点で取り消す', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);
    await user.type(screen.getByTestId('score-input'), '103');

    await user.click(chipOf(screen.getByTestId('standard-route'), 1));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrolledToRecovery(scrollIntoView)).toBe(true);

    // 答えの先頭へ戻す移動が後から割り込まない。
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('Enter / Done による「答えへ移動」自体は残っている', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    render(<App />);
    await openCheckout(user);

    await user.type(screen.getByTestId('score-input'), '103{Enter}');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const target = scrollIntoView.mock.contexts.at(-1) as HTMLElement;
    expect(target.contains(screen.getByTestId('standard-route'))).toBe(true);
  });
});
