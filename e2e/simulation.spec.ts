import { expect, test, type Page } from '@playwright/test';

/**
 * SIMULATION の E2E。
 *
 * 能力を 167 にすると散布幅 σ = 0 になり、狙った的へ必ず入る。
 * 着弾が決定論になるので、進行そのものを実ブラウザで確かめられる。
 */
async function startPerfectGame(page: Page, startScore: number) {
  await page.getByTestId('nav-simulation').click();
  await page.getByTestId('sim-start-custom').click();
  await page.getByTestId('sim-start-custom-input').fill(String(startScore));
  await page.getByTestId('sim-first9').fill('167');
  await page.getByTestId('sim-average').fill('167');
  await page.getByTestId('start-simulation').click();
  await expect(page.getByTestId('dartboard')).toBeVisible();
}

/**
 * アウターブル（SB）のリングをタップする。
 *
 * 区画は中心を含む円として描かれていて、真ん中はインナーブル（DB）が覆っている。
 * 既定の「要素の中心をクリック」では DB を押してしまうので、リングの上側を狙う。
 */
async function clickOuterBull(page: Page) {
  const box = await page.getByTestId('segment-outer-bull').boundingBox();
  if (box === null) throw new Error('アウターブルの位置が取れません。');
  // 中心から半径の 3/4 ぶん上（インナーブルの外・アウターブルの内）。
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.125);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('SIMULATION を開いて設定できる', async ({ page }) => {
  await page.getByTestId('nav-simulation').click();
  await expect(page.getByTestId('start-simulation')).toBeVisible();

  await page.getByTestId('sim-start-301').click();
  await expect(page.getByTestId('start-simulation')).toContainText('301 で始める');
  await page.getByTestId('sim-start-701').click();
  await expect(page.getByTestId('start-simulation')).toContainText('701 で始める');

  await page.getByTestId('sim-direction-vertical').click();
  await expect(page.getByTestId('sim-direction-vertical')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('sim-maxmiss-large').click();
  await expect(page.getByTestId('sim-maxmiss-large')).toHaveAttribute('aria-pressed', 'true');
});

test('狙いをタップすると着弾が盤面に出る（LEFT は動かない）', async ({ page }) => {
  await startPerfectGame(page, 170);
  await expect(page.getByTestId('status-left')).toHaveText('170');

  await page.getByTestId('segment-t20').click();
  // LEFT はビジット開始時のまま（残りの暗算も練習のうち）。
  await expect(page.getByTestId('status-left')).toHaveText('170');
  await expect(page.getByTestId('sim-throw-row-1')).toContainText('着弾 T20');
  // 文字だけでなく、盤面上の位置としても表示する。
  await expect(page.getByTestId('board-marker-hit-1')).toBeAttached();
  await expect(page.getByTestId('board-marker-aim-1')).toBeAttached();
});

test('LEFT は得点を確定して次のビジットへ進んだときだけ変わる', async ({ page }) => {
  await startPerfectGame(page, 501);
  for (let dart = 0; dart < 3; dart += 1) {
    await page.getByTestId('segment-t20').click();
    await expect(page.getByTestId('status-left')).toHaveText('501');
  }

  await page.getByTestId('sim-score-input').fill('180');
  await page.getByTestId('sim-score-submit').click();
  await expect(page.getByTestId('status-left')).toHaveText('501');

  await page.getByTestId('sim-next-round').click();
  await expect(page.getByTestId('status-left')).toHaveText('321');
});

test('3 投目より前の Checkout でビジットが終わる（LEFT は開始時のまま）', async ({ page }) => {
  await startPerfectGame(page, 40);
  await page.getByTestId('segment-d20').click();

  await expect(page.getByTestId('status-flag')).toContainText('CHECKOUT!');
  await expect(page.getByTestId('status-left')).toHaveText('40');
  // 残りのダーツは投げられない。
  await page.getByTestId('segment-t20').click();
  await expect(page.getByTestId('sim-throw-row-2')).toHaveCount(0);

  await page.getByTestId('sim-score-input').fill('40');
  await page.getByTestId('sim-score-submit').click();
  await page.getByTestId('sim-next-round').click();
  await expect(page.getByTestId('sim-review')).toBeVisible();
});

test('3 投目の確定と同時に、押さずに数字を打てる', async ({ page }) => {
  await startPerfectGame(page, 501);
  for (let dart = 0; dart < 3; dart += 1) await page.getByTestId('segment-t20').click();

  const input = page.getByTestId('sim-score-input');
  await expect(input).toBeFocused();
  await expect(input).toBeVisible();
  // モバイルで数字キーボードが開く属性。
  await expect(input).toHaveAttribute('inputmode', 'numeric');

  // 入力欄を押さずに、そのままキーボードから打てる。
  await page.keyboard.type('180');
  await expect(input).toHaveValue('180');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sim-entry-verdict')).toContainText('正解');
});

test('自動フォーカスで盤面が画面外へ飛ばない', async ({ page }) => {
  await startPerfectGame(page, 501);
  const board = page.getByTestId('dartboard');
  await expect(board).toBeInViewport();

  for (let dart = 0; dart < 3; dart += 1) await page.getByTestId('segment-t20').click();

  await expect(page.getByTestId('sim-score-input')).toBeFocused();
  // 盤面が完全に画面外へ押し出されていないこと。
  await expect(board).toBeInViewport();
});

test('3 投目のあとでも、得点を確定する前なら UNDO できる', async ({ page }) => {
  await startPerfectGame(page, 501);
  for (let dart = 0; dart < 3; dart += 1) await page.getByTestId('segment-t20').click();
  await expect(page.getByTestId('sim-score-input')).toBeVisible();
  /*
   * 3 投目の確定と同時に、入力欄へのフォーカスと `scrollIntoView` が走る
   * （SimulationPage の useLayoutEffect）。フォーカスが移るまで待たずに
   * UNDO を押すと、スクロール中のボタンをクリックしにいくことがある。
   * 表示だけでなくフォーカスの移動まで待ってから押す。
   */
  await expect(page.getByTestId('sim-score-input')).toBeFocused();

  await page.getByTestId('sim-undo').click();
  await expect(page.getByTestId('sim-score-input')).toHaveCount(0);
  await expect(page.getByTestId('sim-throw-row-3')).toHaveCount(0);
  await expect(page.getByTestId('sim-progress')).toContainText('DART 3 of 3');

  await page.getByTestId('segment-t19').click();
  await expect(page.getByTestId('sim-throw-row-3')).toContainText('狙い T19');
  await expect(page.getByTestId('sim-score-input')).toBeFocused();
});

test('ターゲット表記が Sxx / Txx / Dxx / SB / DB でそろう', async ({ page }) => {
  await startPerfectGame(page, 170);
  await page.getByTestId('segment-t20').click();
  await expect(page.getByTestId('sim-throw-row-1')).toContainText('狙い T20');
  // アウターブル（SB）とインナーブル（DB）は別の的。
  // 中心はインナーブルが覆っているので、SB はリングの部分をタップする。
  await clickOuterBull(page);
  await expect(page.getByTestId('sim-throw-row-2')).toContainText('狙い SB');
  await expect(page.getByTestId('sim-throw-row-2')).toContainText('着弾 SB');
  await page.getByTestId('segment-inner-bull').click();
  await expect(page.getByTestId('sim-throw-row-3')).toContainText('狙い DB');
  await expect(page.getByTestId('sim-throw-row-3')).toContainText('着弾 DB');

  // 読み下し表記が残っていないこと。
  const play = page.getByLabel('SIMULATION プレイ中');
  await expect(play).not.toContainText('トリプル');
  await expect(play).not.toContainText('シングル');
  await expect(play).not.toContainText('ダブル');
  await expect(play).not.toContainText('ブル');
});

test('ゲーム中はアレンジの答えを出さない', async ({ page }) => {
  await startPerfectGame(page, 170);
  await page.getByTestId('segment-t20').click();

  await expect(page.getByTestId('standard-route')).toHaveCount(0);
  await expect(page.getByTestId('my-route')).toHaveCount(0);
  await expect(page.getByTestId('other-routes')).toHaveCount(0);
  await expect(page.getByTestId('recovery-next')).toHaveCount(0);
  await expect(page.getByTestId('next-visit-route')).toHaveCount(0);
});

test('直前の 1 投だけ取り消せる', async ({ page }) => {
  await startPerfectGame(page, 501);
  await expect(page.getByTestId('sim-undo')).toBeDisabled();

  await page.getByTestId('segment-t20').click();
  await page.getByTestId('segment-t19').click();
  await expect(page.getByTestId('status-left')).toHaveText('501');

  await page.getByTestId('sim-undo').click();
  await expect(page.getByTestId('status-left')).toHaveText('501');
  await expect(page.getByTestId('sim-throw-row-2')).toHaveCount(0);

  await page.getByTestId('segment-t18').click();
  await expect(page.getByTestId('sim-throw-row-2')).toContainText('狙い T18');
});

test('「1投戻す」は盤面のすぐ下にあり、直前の狙いと着弾が並ぶ', async ({ page }) => {
  await startPerfectGame(page, 501);
  await page.getByTestId('segment-t20').click();
  await expect(page.getByTestId('sim-last-throw')).toContainText('狙い T20');
  await expect(page.getByTestId('sim-last-throw')).toContainText('着弾 T20');

  // 盤面の下端と「1投戻す」の上端が離れていない（投擲の一覧より前に置く）。
  const board = await page.locator('.dartboard__svg').boundingBox();
  const undo = await page.getByTestId('sim-undo').boundingBox();
  if (board === null || undo === null) throw new Error('位置が取れません。');
  expect(undo.y).toBeGreaterThanOrEqual(board.y + board.height - 1);
  expect(undo.y - (board.y + board.height)).toBeLessThan(40);
  await expect(page.getByTestId('sim-undo')).toBeInViewport();
});

test('暗算を間違えると「計算ミス」が出て、正解するまで次へ進めない', async ({ page }) => {
  await startPerfectGame(page, 501);
  for (let dart = 0; dart < 3; dart += 1) await page.getByTestId('segment-t20').click();

  // 3 投そろっても正解は出さない。
  await expect(page.getByTestId('sim-entry')).not.toContainText('180');
  await page.getByTestId('sim-score-input').fill('170');
  await page.getByTestId('sim-score-submit').click();

  await expect(page.getByTestId('sim-entry-verdict')).toContainText('計算ミス');
  await expect(page.getByTestId('sim-entry-detail')).toContainText('計算が間違っています');
  // 進むボタンは出ない。LEFT も動かない。
  await expect(page.getByTestId('sim-next-round')).toHaveCount(0);
  await expect(page.getByTestId('status-left')).toHaveText('501');

  // 欄は空に戻り、フォーカスもあるのでそのまま打ち直せる。
  const input = page.getByTestId('sim-score-input');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();

  await page.keyboard.type('180');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sim-entry-verdict')).toContainText('正解');
  await expect(page.getByTestId('sim-entry-detail')).toContainText('計算ミス 1 回');
  await page.getByTestId('sim-next-round').click();
  await expect(page.getByTestId('status-left')).toHaveText('321');
});

test('「次のラウンドへ」を Enter キーで押せる', async ({ page }) => {
  await startPerfectGame(page, 501);
  for (let dart = 0; dart < 3; dart += 1) await page.getByTestId('segment-t20').click();

  await page.keyboard.type('180');
  await page.keyboard.press('Enter');
  // 確定すると「次のラウンドへ」へフォーカスが移る。
  await expect(page.getByTestId('sim-next-round')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-left')).toHaveText('321');
  await expect(page.getByTestId('sim-progress')).toContainText('ROUND 2');
});

test('BUST の「次のラウンドへ」も Enter で押せる', async ({ page }) => {
  await startPerfectGame(page, 40);
  await page.getByTestId('segment-t20').click(); // 40 - 60 → BUST

  await expect(page.getByTestId('sim-next-round')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sim-progress')).toContainText('ROUND 2');
});

test('投擲リストに得点を出さない', async ({ page }) => {
  await startPerfectGame(page, 501);
  await page.getByTestId('segment-t20').click();

  const row = page.getByTestId('sim-throw-row-1');
  await expect(row).toContainText('狙い T20');
  await expect(row).not.toContainText('60');
  await expect(row).not.toContainText('点');
});

test('BUST するとラウンド開始時の残りへ戻る', async ({ page }) => {
  await startPerfectGame(page, 100);
  await page.getByTestId('segment-t20').click();
  await expect(page.getByTestId('status-left')).toHaveText('100');
  await page.getByTestId('segment-t20').click();

  await expect(page.getByTestId('status-flag')).toContainText('BUST');
  await page.getByTestId('sim-next-round').click();
  await expect(page.getByTestId('status-left')).toHaveText('100');
  await expect(page.getByTestId('sim-progress')).toContainText('ROUND 2');
});

test('ダブルアウトで上がると「ゲームの振り返り」が出る', async ({ page }) => {
  await startPerfectGame(page, 170);
  await page.getByTestId('segment-t20').click();
  await page.getByTestId('segment-t20').click();
  await page.getByTestId('segment-inner-bull').click();
  await expect(page.getByTestId('status-flag')).toContainText('CHECKOUT!');

  await page.getByTestId('sim-score-input').fill('170');
  await page.getByTestId('sim-score-submit').click();
  await page.getByTestId('sim-next-round').click();

  await expect(page.getByTestId('sim-review')).toBeVisible();
  await expect(page.getByTestId('sim-summary-darts')).toHaveText('3');
  await expect(page.getByTestId('sim-summary-checkout-score')).toHaveText('170');
  await expect(page.getByTestId('sim-verdict-1')).toContainText('良い判断');
  // レビューが評価するのは狙いであることを画面にも書く。
  await expect(page.getByTestId('sim-review')).toContainText('狙い');
});

test('設定の意味と選び方を、折りたたみで読める', async ({ page }) => {
  await page.getByTestId('nav-simulation').click();

  const ppr = page.getByTestId('sim-help-ppr');
  // 設定画面を長くしないため、既定は閉じている。
  expect(await ppr.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
  await ppr.locator('summary').click();
  await expect(ppr).toContainText('開始から 9 投まで');
  await expect(ppr).toContainText('ゲーム全体の精度');
  await expect(ppr).toContainText('501 を約');

  await page.getByTestId('sim-help-direction').locator('summary').click();
  await expect(page.getByTestId('sim-help-direction')).toContainText('同じナンバー');
  await expect(page.getByTestId('sim-help-direction')).toContainText('隣のナンバー');

  await page.getByTestId('sim-help-maxmiss').locator('summary').click();
  await expect(page.getByTestId('sim-help-maxmiss')).toContainText('OUT BOARD');
  await expect(page.getByTestId('sim-help-maxmiss')).toContainText('ひどく外した');

  // 説明をすべて開いても横スクロールは出ない。
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('残り 178 / 最後の 1 投で T19 を狙うと、159 を理由に指摘される', async ({ page }) => {
  /*
   * 添付実例の回帰。258 → T20 → S20 で 178 を残し、最後の 1 投で T19 を狙う。
   * T19 は狙い通りなら 121 だが、シングルへ落ちると 159（Bogey）。
   */
  await startPerfectGame(page, 258);
  await page.getByTestId('segment-t20').click();
  await page.getByTestId('segment-s20-outer').click();
  await page.getByTestId('segment-t19').click();
  await page.getByTestId('sim-score-input').fill('137');
  await page.getByTestId('sim-score-submit').click();
  await page.getByTestId('sim-next-round').click();

  // 121 = T20 → T15 → D8 で上がる。
  await page.getByTestId('segment-t20').click();
  await page.getByTestId('segment-t15').click();
  await page.getByTestId('segment-d8').click();
  await page.getByTestId('sim-score-input').fill('121');
  await page.getByTestId('sim-score-submit').click();
  await page.getByTestId('sim-next-round').click();

  await expect(page.getByTestId('sim-review')).toBeVisible();
  await expect(page.getByTestId('sim-verdict-3')).toContainText('もっと良い狙いあり');
  const round1 = page.getByTestId('sim-round-1');
  await expect(round1).toContainText('159');
  await expect(round1).toContainText('T20');
  await expect(round1).toContainText('T18');
});

test('残り 178 / 最後の 1 投で S18 を狙うと、T18 を勧められる', async ({ page }) => {
  /*
   * 258 → T20 → S20 で 178 を残し、最後の 1 投で S18（160 残し）を狙う。
   * 成立はしているが、T18 ならシングル落ちでも同じ 160 で、当たれば 124。
   */
  await startPerfectGame(page, 258);
  await page.getByTestId('segment-t20').click();
  await page.getByTestId('segment-s20-outer').click();
  await page.getByTestId('segment-s18-outer').click();
  await page.getByTestId('sim-score-input').fill('98');
  await page.getByTestId('sim-score-submit').click();
  await page.getByTestId('sim-next-round').click();

  // 160 = T20 → T20 → D20 で上がる。
  await page.getByTestId('segment-t20').click();
  await page.getByTestId('segment-t20').click();
  await page.getByTestId('segment-d20').click();
  await page.getByTestId('sim-score-input').fill('160');
  await page.getByTestId('sim-score-submit').click();
  await page.getByTestId('sim-next-round').click();

  await expect(page.getByTestId('sim-review')).toBeVisible();
  await expect(page.getByTestId('sim-verdict-3')).toContainText('もっと良い狙いあり');
  const round1 = page.getByTestId('sim-round-1');
  await expect(round1).toContainText('テンパイは作れますが');
  await expect(round1).toContainText('T18');
  await expect(round1).toContainText('124');
});

test('設定は端末に残り、次に開いたときも引き継ぐ', async ({ page }) => {
  await page.getByTestId('nav-simulation').click();
  await page.getByTestId('sim-start-301').click();
  await page.getByTestId('sim-first9').fill('95');
  await page.getByTestId('sim-average').fill('77');
  await page.getByTestId('sim-direction-horizontal').click();
  await page.getByTestId('sim-maxmiss-small').click();

  await page.reload();
  await page.getByTestId('nav-simulation').click();
  await expect(page.getByTestId('sim-first9-value')).toHaveText('95');
  await expect(page.getByTestId('sim-average-value')).toHaveText('77');
  await expect(page.getByTestId('sim-direction-horizontal')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('sim-maxmiss-small')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('start-simulation')).toContainText('301 で始める');
});

test('スマートフォン幅でも横スクロールが出ない', async ({ page }) => {
  await startPerfectGame(page, 501);
  await page.getByTestId('segment-t20').click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('SIMULATION のあとでも CHECKOUT は従来どおり動く', async ({ page }) => {
  await startPerfectGame(page, 501);
  await page.getByTestId('segment-t20').click();

  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('score-input').fill('103');
  const standard = page.getByTestId('standard-route');
  await expect(standard).toContainText('T19');
  await expect(standard).toContainText('D20');
});
