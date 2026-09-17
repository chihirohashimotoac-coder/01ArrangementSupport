import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { MAX_PPR } from './engine/simulation/accuracy';
import {
  PPR_GUIDE_ROWS,
  SETTINGS_HELP_SUMMARY_JA,
} from './engine/simulation/settingsGuide';
import { SIMULATION_SETTINGS_KEY } from './storage/simulationSettings';

type User = ReturnType<typeof userEvent.setup>;

/** LEFT はちょうどその値であること（部分一致だと 2170 が 170 を通してしまう）。 */
function expectLeft(value: number) {
  expect(screen.getByTestId('status-left').textContent).toBe(String(value));
}

/**
 * 能力を 167 にすると σ = 0 になり、狙った的へ必ず入る。
 * 画面のテストを乱数に左右されないようにするために使う。
 */
function setPerfectAbility() {
  fireEvent.change(screen.getByTestId('sim-first9'), { target: { value: String(MAX_PPR) } });
  fireEvent.change(screen.getByTestId('sim-average'), { target: { value: String(MAX_PPR) } });
}

async function openSimulation(user: User) {
  await user.click(screen.getByTestId('nav-simulation'));
}

/** 任意の開始点数で、狙い通りに入るゲームを始める。 */
async function startPerfectGame(user: User, startScore: number) {
  await openSimulation(user);
  await user.click(screen.getByTestId('sim-start-custom'));
  const input = screen.getByTestId('sim-start-custom-input');
  await user.clear(input);
  await user.type(input, String(startScore));
  setPerfectAbility();
  await user.click(screen.getByTestId('start-simulation'));
}

describe('SIMULATION の導線', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('既存モードと同じ階層に SIMULATION がある', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByTestId('nav-simulation')).toBeInTheDocument();
    expect(screen.getByTestId('home-simulation')).toBeInTheDocument();
    await user.click(screen.getByTestId('home-simulation'));
    expect(screen.getByTestId('start-simulation')).toBeInTheDocument();
  });

  it('301 / 501 / 701 / CUSTOM を選べる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSimulation(user);
    for (const score of [301, 501, 701]) {
      await user.click(screen.getByTestId(`sim-start-${score}`));
      expect(screen.getByTestId(`sim-start-${score}`)).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('start-simulation')).toHaveTextContent(`${score} で始める`);
    }
    await user.click(screen.getByTestId('sim-start-custom'));
    const input = screen.getByTestId('sim-start-custom-input');
    await user.clear(input);
    await user.type(input, '407');
    expect(screen.getByTestId('start-simulation')).toHaveTextContent('407 で始める');
  });

  it('設定の意味と選び方を、折りたたみで読める', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSimulation(user);

    // 設定画面を長くしないため、既定は閉じた状態にする。
    const ppr = screen.getByTestId('sim-help-ppr');
    expect(ppr).not.toHaveAttribute('open');

    // FIRST 9 / AVERAGE の意味と、167 だけが完全一致であること。
    expect(ppr).toHaveTextContent('開始から 9 投まで');
    expect(ppr).toHaveTextContent('ゲーム全体の精度');
    expect(ppr).toHaveTextContent(`${MAX_PPR} のときだけ`);
    // 設定目安は「501 が何投で終わるか」。
    const rows = within(screen.getByTestId('sim-help-ppr-rows')).getAllByRole('listitem');
    expect(rows.length).toBe(PPR_GUIDE_ROWS.length);
    expect(rows[0]).toHaveTextContent(String(PPR_GUIDE_ROWS[0].ppr));
    expect(rows[0]).toHaveTextContent(`${PPR_GUIDE_ROWS[0].darts} 投`);

    // ブレ方向は、縦 = 同じナンバー内の上下 / 横 = 隣のナンバー。
    const direction = screen.getByTestId('sim-help-direction');
    expect(direction).toHaveTextContent('同じナンバー');
    expect(direction).toHaveTextContent('隣のナンバー');
    expect(direction).toHaveTextContent('設定目安');

    // 最大ブレは、外れ幅と「ひどく外したときどこまで飛ぶか」。
    const maxMiss = screen.getByTestId('sim-help-maxmiss');
    expect(maxMiss).toHaveTextContent('隣接エリア');
    expect(maxMiss).toHaveTextContent('OUT BOARD');
    expect(maxMiss).toHaveTextContent('ひどく外した');

    // 開けること（折りたたみは summary のクリックで開く）。
    await user.click(within(ppr).getByText(SETTINGS_HELP_SUMMARY_JA));
    expect(ppr).toHaveAttribute('open');
  });

  it('プレイヤー設定は端末へ保存され、次に開いたときも残る', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await openSimulation(user);
    await user.click(screen.getByTestId('sim-start-701'));
    fireEvent.change(screen.getByTestId('sim-first9'), { target: { value: '92' } });
    fireEvent.change(screen.getByTestId('sim-average'), { target: { value: '81' } });
    await user.click(screen.getByTestId('sim-direction-horizontal'));
    await user.click(screen.getByTestId('sim-maxmiss-large'));

    const stored = JSON.parse(window.localStorage.getItem(SIMULATION_SETTINGS_KEY) ?? '{}');
    expect(stored).toMatchObject({
      startScore: 701,
      first9Ppr: 92,
      averagePpr: 81,
      missDirection: 'horizontal',
      maxMiss: 'large',
    });

    first.unmount();
    render(<App />);
    await openSimulation(user);
    expect(screen.getByTestId('sim-first9-value')).toHaveTextContent('92');
    expect(screen.getByTestId('sim-average-value')).toHaveTextContent('81');
    expect(screen.getByTestId('sim-direction-horizontal')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sim-maxmiss-large')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('SIMULATION のプレイ', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('盤面で狙いを決めると、着弾が盤面に表示されて残りが減る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 170);

    expectLeft(170);
    expect(screen.getByTestId('sim-progress')).toHaveTextContent('ROUND 1');

    await user.click(screen.getByTestId('segment-t20'));
    // LEFT は投げても動かさない（残りの暗算まで含めて練習のため）。
    expectLeft(170);
    expect(screen.getByTestId('sim-throw-row-1')).toHaveTextContent('狙い T20');
    expect(screen.getByTestId('sim-throw-row-1')).toHaveTextContent('着弾 T20');
    // 着弾は文字だけでなく、盤面上の位置としても出す。
    expect(screen.getByTestId('board-marker-hit-1')).toBeInTheDocument();
    expect(screen.getByTestId('board-marker-aim-1')).toBeInTheDocument();
  });

  it('ゲーム中はアレンジの答えを一切出さない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 170);
    await user.click(screen.getByTestId('segment-t20'));

    const play = screen.getByLabelText('SIMULATION プレイ中');
    expect(within(play).queryByText(/おすすめ/)).toBeNull();
    expect(within(play).queryByText(/MY ROUTE/)).toBeNull();
    expect(within(play).queryByText(/OTHER ROUTE/)).toBeNull();
    expect(within(play).queryByText(/次に狙う/)).toBeNull();
    // 既存モードで答えを出している要素が、SIMULATION には現れない。
    expect(screen.queryByTestId('recovery-next')).toBeNull();
    expect(screen.queryByTestId('standard-route')).toBeNull();
    expect(screen.queryByTestId('my-route')).toBeNull();
    expect(screen.queryByTestId('other-routes')).toBeNull();
    expect(screen.queryByTestId('next-visit-route')).toBeNull();
  });

  it('3 投そろうまでは、正しい合計を表示しない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 170);
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-s20-outer'));

    const entry = screen.getByTestId('sim-entry');
    expect(entry).toHaveTextContent('暗算');
    expect(entry).not.toHaveTextContent('140');
  });

  it('合計が合っていれば、そのまま次のラウンドへ進む', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 501);
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));

    await user.type(screen.getByTestId('sim-score-input'), '180');
    await user.click(screen.getByTestId('sim-score-submit'));
    expect(screen.getByTestId('sim-entry-verdict')).toHaveTextContent('正解');

    await user.click(screen.getByTestId('sim-next-round'));
    expectLeft(321);
    expect(screen.getByTestId('sim-progress')).toHaveTextContent('ROUND 2');
  });

  it('暗算を間違えると CALCULATION MISS を出し、正解するまで次へ進めない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 501);
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t19'));
    await user.click(screen.getByTestId('segment-s5-outer'));

    await user.type(screen.getByTestId('sim-score-input'), '126');
    await user.click(screen.getByTestId('sim-score-submit'));
    expect(screen.getByTestId('sim-entry-verdict')).toHaveTextContent('CALCULATION MISS');
    expect(screen.getByTestId('sim-entry-detail')).toHaveTextContent('計算が間違っています');
    // 正しい合計は教えない（教えたら暗算にならない）。
    expect(screen.getByTestId('sim-entry-detail')).not.toHaveTextContent('122 です');
    // 「次のラウンドへ」は出ない。
    expect(screen.queryByTestId('sim-next-round')).toBeNull();
    expectLeft(501);

    // 入力欄が空に戻り、フォーカスも戻っているので、そのまま打ち直せる。
    const input = screen.getByTestId('sim-score-input');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();

    // もう一度間違えても進めない。
    await user.keyboard('130{Enter}');
    expect(screen.queryByTestId('sim-next-round')).toBeNull();

    // 正解して初めて進める。
    await user.keyboard('122{Enter}');
    expect(screen.getByTestId('sim-entry-verdict')).toHaveTextContent('正解');
    expect(screen.getByTestId('sim-entry-detail')).toHaveTextContent('CALCULATION MISS 2 回');
    await user.click(screen.getByTestId('sim-next-round'));
    expectLeft(379);
  });

  it('「次のラウンドへ」は Enter キーで押せる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 501);
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));

    // 3 投目 → 数字 → Enter で確定 → ボタンへフォーカスが移る。
    await user.keyboard('180{Enter}');
    const nextButton = screen.getByTestId('sim-next-round');
    expect(nextButton).toHaveFocus();

    // そのまま Enter でもう一度押せる（マウスへ持ち替えなくてよい）。
    await user.keyboard('{Enter}');
    expectLeft(321);
    expect(screen.getByTestId('sim-progress')).toHaveTextContent('ROUND 2');
  });

  it('BUST の「次のラウンドへ」も Enter で押せる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 40);
    await user.click(screen.getByTestId('segment-t20')); // BUST

    expect(screen.getByTestId('sim-next-round')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('sim-progress')).toHaveTextContent('ROUND 2');
  });

  it('投擲リストに得点を出さない（暗算の手がかりにしない）', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 501);
    await user.click(screen.getByTestId('segment-t20'));

    const row = screen.getByTestId('sim-throw-row-1');
    expect(row).toHaveTextContent('狙い T20');
    expect(row).toHaveTextContent('着弾 T20');
    expect(row).not.toHaveTextContent('60');
    expect(row).not.toHaveTextContent('点');
  });

  it('アウターブルとインナーブルを別の的として扱う', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 501);

    await user.click(screen.getByTestId('segment-outer-bull'));
    expect(screen.getByTestId('sim-throw-row-1')).toHaveTextContent('狙い SB');
    expect(screen.getByTestId('sim-throw-row-1')).toHaveTextContent('着弾 SB');

    await user.click(screen.getByTestId('segment-inner-bull'));
    expect(screen.getByTestId('sim-throw-row-2')).toHaveTextContent('狙い DB');
    expect(screen.getByTestId('sim-throw-row-2')).toHaveTextContent('着弾 DB');
  });

  it('BUST ではラウンド開始時の残りへ戻る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 100);
    await user.click(screen.getByTestId('segment-t20')); // 内部 100 → 40
    expectLeft(100);
    await user.click(screen.getByTestId('segment-t20')); // 40 - 60 → BUST

    expect(screen.getByTestId('status-flag')).toHaveTextContent('BUST');
    expect(screen.getByTestId('sim-entry')).toHaveTextContent('BUST');
    await user.click(screen.getByTestId('sim-next-round'));
    expectLeft(100);
    expect(screen.getByTestId('sim-progress')).toHaveTextContent('ROUND 2');
  });

  it('LEFT はビジット中ずっと動かず、得点を確定して次へ進んだときだけ変わる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 501);
    expectLeft(501);

    await user.click(screen.getByTestId('segment-t20'));
    expectLeft(501); // 1 投目
    await user.click(screen.getByTestId('segment-t20'));
    expectLeft(501); // 2 投目
    await user.click(screen.getByTestId('segment-t20'));
    expectLeft(501); // 3 投目・得点の確定前

    await user.type(screen.getByTestId('sim-score-input'), '180');
    await user.click(screen.getByTestId('sim-score-submit'));
    expectLeft(501); // 正誤を確認している間もまだ変えない

    await user.click(screen.getByTestId('sim-next-round'));
    expectLeft(321); // 次のビジットへ進んだときに初めて変わる
  });

  it('3 投目より前に Checkout しても、LEFT はビジット開始時のまま', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 40);

    await user.click(screen.getByTestId('segment-d20'));
    expect(screen.getByTestId('status-flag')).toHaveTextContent('CHECKOUT!');
    // 途中で LEFT 0 を出さない。
    expectLeft(40);
    // 残りのダーツは投げられない。
    expect(screen.getByTestId('sim-throw-row-1')).toBeInTheDocument();
    await user.click(screen.getByTestId('segment-t20'));
    expect(screen.queryByTestId('sim-throw-row-2')).toBeNull();
  });

  it('3 投目より前に BUST してもビジットが終わり、次は同じ LEFT で始まる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 40);

    await user.click(screen.getByTestId('segment-t20')); // 40 - 60 → BUST
    expect(screen.getByTestId('status-flag')).toHaveTextContent('BUST');
    expectLeft(40);
    await user.click(screen.getByTestId('segment-d20'));
    expect(screen.queryByTestId('sim-throw-row-2')).toBeNull();

    await user.click(screen.getByTestId('sim-next-round'));
    expectLeft(40);
    expect(screen.getByTestId('sim-progress')).toHaveTextContent('ROUND 2');
  });

  it('3 投目の確定と同時に、得点入力欄へフォーカスが移る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 501);
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));

    const input = screen.getByTestId('sim-score-input');
    // 欄を押さなくても、そのまま数字を打てる状態になっている。
    expect(input).toHaveFocus();
    // モバイルで数字キーボードが開く属性。
    expect(input).toHaveAttribute('inputmode', 'numeric');

    await user.keyboard('180{Enter}');
    expect(screen.getByTestId('sim-entry-verdict')).toHaveTextContent('正解');
  });

  it('自動フォーカスで画面を大きく動かさない', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const focus = vi.spyOn(HTMLInputElement.prototype, 'focus');
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 501);
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));

    // フォーカスによる自動スクロールは抑止する。
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    // 必要なときだけ最小限動かす（block: 'nearest'）。盤面へは寄せない。
    for (const call of scrollIntoView.mock.calls) {
      expect(call[0]).toMatchObject({ block: 'nearest' });
    }
    for (const context of scrollIntoView.mock.contexts as HTMLElement[]) {
      expect(context).toBe(screen.getByTestId('sim-entry'));
    }
  });

  it('Checkout / BUST のビジットでは入力欄を出さないのでフォーカスも移らない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 40);
    await user.click(screen.getByTestId('segment-t20')); // BUST
    expect(screen.queryByTestId('sim-score-input')).toBeNull();
  });

  it('3 投目のあとでも、得点を確定する前なら UNDO できる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 501);
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));
    expect(screen.getByTestId('sim-score-input')).toBeInTheDocument();

    await user.click(screen.getByTestId('sim-undo'));
    // 入力状態が解除され、3 投目を狙い直せる。
    expect(screen.queryByTestId('sim-score-input')).toBeNull();
    expect(screen.queryByTestId('sim-throw-row-3')).toBeNull();
    expect(screen.getByTestId('sim-progress')).toHaveTextContent('DART 3 of 3');

    await user.click(screen.getByTestId('segment-t19'));
    expect(screen.getByTestId('sim-throw-row-3')).toHaveTextContent('狙い T19');
    // 入力欄が戻り、再びフォーカスされる。
    expect(screen.getByTestId('sim-score-input')).toHaveFocus();
  });

  it('直前の 1 投だけ取り消せる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 501);
    expect(screen.getByTestId('sim-undo')).toBeDisabled();

    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t19'));
    // 2 投しても LEFT はビジット開始時のまま。
    expectLeft(501);

    await user.click(screen.getByTestId('sim-undo'));
    expectLeft(501);
    expect(screen.queryByTestId('sim-throw-row-2')).toBeNull();

    // 同じ DART 番号から狙い直せる。
    await user.click(screen.getByTestId('segment-t18'));
    expect(screen.getByTestId('sim-throw-row-2')).toHaveTextContent('狙い T18');
  });
});

describe('GAME REVIEW', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('ダブルアウトで終わると GAME REVIEW を表示する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 170);

    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-t20'));
    await user.click(screen.getByTestId('segment-inner-bull'));
    expect(screen.getByTestId('status-flag')).toHaveTextContent('CHECKOUT!');

    await user.type(screen.getByTestId('sim-score-input'), '170');
    await user.click(screen.getByTestId('sim-score-submit'));
    await user.click(screen.getByTestId('sim-next-round'));

    const review = screen.getByTestId('sim-review');
    expect(review).toBeInTheDocument();
    expect(screen.getByTestId('sim-summary-start')).toHaveTextContent('170');
    expect(screen.getByTestId('sim-summary-darts')).toHaveTextContent('3');
    expect(screen.getByTestId('sim-summary-ppr')).toHaveTextContent('170.00');
    expect(screen.getByTestId('sim-summary-miss')).toHaveTextContent('0 回');
    expect(screen.getByTestId('sim-summary-checkout-darts')).toHaveTextContent('3');
    expect(screen.getByTestId('sim-summary-checkout-score')).toHaveTextContent('170');

    // 1 投ごとの判断が、狙いに対する評価として出る。
    expect(screen.getByTestId('sim-verdict-1')).toHaveTextContent('GOOD DECISION');
    expect(screen.getByTestId('sim-throw-1')).toHaveTextContent('狙い T20');
  });

  it('レビューには CALCULATION MISS も残る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 40);
    await user.click(screen.getByTestId('segment-d20'));
    // 一度間違えてから正解する。
    await user.type(screen.getByTestId('sim-score-input'), '20');
    await user.click(screen.getByTestId('sim-score-submit'));
    expect(screen.getByTestId('sim-entry-verdict')).toHaveTextContent('CALCULATION MISS');
    await user.keyboard('40{Enter}');
    await user.click(screen.getByTestId('sim-next-round'));

    expect(screen.getByTestId('sim-summary-miss')).toHaveTextContent('1 回');
    expect(screen.getByTestId('sim-round-miss-1')).toHaveTextContent('正しくは 40');
  });

  it('設定へ戻ると、次のゲームを始められる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 40);
    await user.click(screen.getByTestId('segment-d20'));
    await user.type(screen.getByTestId('sim-score-input'), '40');
    await user.click(screen.getByTestId('sim-score-submit'));
    await user.click(screen.getByTestId('sim-next-round'));

    await user.click(screen.getByTestId('sim-restart'));
    expect(screen.getByTestId('start-simulation')).toBeInTheDocument();
  });
});

describe('既存モードへの影響', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('SIMULATION を触ったあとでも CHECKOUT は同じように動く', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startPerfectGame(user, 501);
    await user.click(screen.getByTestId('segment-t20'));

    await user.click(screen.getByTestId('nav-checkout'));
    const input = screen.getByTestId('score-input');
    await user.clear(input);
    await user.type(input, '170');
    // CHECKOUT では従来どおり答えが出る。
    expect(await screen.findByTestId('standard-route')).toBeInTheDocument();
  });
});
