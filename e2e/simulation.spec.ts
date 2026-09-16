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

test('狙いをタップすると着弾が盤面に出て、残りが減る', async ({ page }) => {
  await startPerfectGame(page, 170);
  await expect(page.getByTestId('status-left')).toHaveText('170');

  await page.getByTestId('segment-t20').click();
  await expect(page.getByTestId('status-left')).toHaveText('110');
  await expect(page.getByTestId('sim-throw-row-1')).toContainText('着弾 トリプル20');
  // 文字だけでなく、盤面上の位置としても表示する。
  await expect(page.getByTestId('board-marker-hit-1')).toBeAttached();
  await expect(page.getByTestId('board-marker-aim-1')).toBeAttached();
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
  await expect(page.getByTestId('status-left')).toHaveText('384');

  await page.getByTestId('sim-undo').click();
  await expect(page.getByTestId('status-left')).toHaveText('441');
  await expect(page.getByTestId('sim-throw-row-2')).toHaveCount(0);

  await page.getByTestId('segment-t18').click();
  await expect(page.getByTestId('sim-throw-row-2')).toContainText('狙い トリプル18');
});

test('暗算を間違えると CALCULATION MISS が出て、正しい得点で進む', async ({ page }) => {
  await startPerfectGame(page, 501);
  await page.getByTestId('segment-t20').click();
  await page.getByTestId('segment-t20').click();
  await page.getByTestId('segment-t20').click();

  // 3 投そろうまで正解は出さない。
  await expect(page.getByTestId('sim-entry')).not.toContainText('180');
  await page.getByTestId('sim-score-input').fill('170');
  await page.getByTestId('sim-score-submit').click();

  await expect(page.getByTestId('sim-entry-verdict')).toContainText('CALCULATION MISS');
  await expect(page.getByTestId('sim-entry-detail')).toContainText('正しいスコアは 180');
  await page.getByTestId('sim-next-round').click();
  await expect(page.getByTestId('status-left')).toHaveText('321');
});

test('BUST するとラウンド開始時の残りへ戻る', async ({ page }) => {
  await startPerfectGame(page, 100);
  await page.getByTestId('segment-t20').click();
  await expect(page.getByTestId('status-left')).toHaveText('40');
  await page.getByTestId('segment-t20').click();

  await expect(page.getByTestId('status-flag')).toContainText('BUST');
  await page.getByTestId('sim-next-round').click();
  await expect(page.getByTestId('status-left')).toHaveText('100');
  await expect(page.getByTestId('sim-progress')).toContainText('ROUND 2');
});

test('ダブルアウトで上がると GAME REVIEW が出る', async ({ page }) => {
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
  await expect(page.getByTestId('sim-verdict-1')).toContainText('GOOD DECISION');
  // レビューが評価するのは狙いであることを画面にも書く。
  await expect(page.getByTestId('sim-review')).toContainText('狙い');
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
