import { expect, test, type Page } from '@playwright/test';

async function setLeft(page: Page, value: number) {
  const input = page.getByTestId('score-input');
  await input.fill(String(value));
  await page.getByTestId('score-input-apply').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('アプリが起動し、3 つのモードが並ぶ', async ({ page }) => {
  await expect(page.getByTestId('app-title')).toBeVisible();
  await expect(page.getByTestId('home-checkout')).toBeVisible();
  await expect(page.getByTestId('home-setup')).toBeVisible();
  await expect(page.getByTestId('home-training')).toBeVisible();
});

test('CHECKOUT 103 で基準ルートと理由を確認できる', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();

  await expect(page.getByTestId('status-left')).toHaveText('103');
  await expect(page.getByTestId('status-darts')).toHaveText('3');

  const standard = page.getByTestId('standard-route');
  await expect(standard).toContainText('T19');
  await expect(standard).toContainText('S6');
  await expect(standard).toContainText('D20');
  await expect(standard).toContainText('STANDARD');

  // 基準ルートの理由は既定で開いている。
  await expect(standard.locator('button[aria-controls]')).toHaveAttribute('aria-expanded', 'true');
  await expect(standard.locator('li[data-code="STANDARD_ROUTE"]')).toBeVisible();
});

test('OTHER ROUTES の理由は開閉できる（progressive disclosure）', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  // 開閉でボタン名が変わるため、カードを固定してからボタンを取る。
  const card = page.getByTestId(/^route-/).first();
  const toggle = card.locator('button[aria-controls]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('.route-card__reasons')).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.route-card__reasons')).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('「すべて表示」で合法な追加候補を出せる', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  const before = await page.getByTestId(/^route-/).count();
  await page.getByTestId('show-all-routes').click();
  expect(await page.getByTestId(/^route-/).count()).toBeGreaterThan(before);
});

test('1 投ごとのリカバリーが追従する', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();

  // T19 を狙って S19 に落ちた場合。
  await page.getByTestId('segment-s19-outer').click();
  await expect(page.getByTestId('status-left')).toHaveText('84');
  await expect(page.getByTestId('status-darts')).toHaveText('2');
  await expect(page.getByTestId('thrown-0')).toHaveText('S19');
  // 残り 2 本での候補が出る。
  await expect(page.getByTestId('standard-route')).toBeVisible();
});

test('Undo で 1 投戻せる', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('segment-s19-outer').click();
  await expect(page.getByTestId('status-left')).toHaveText('84');
  await page.getByTestId('undo-button').click();
  await expect(page.getByTestId('status-left')).toHaveText('103');
  await expect(page.getByTestId('status-darts')).toHaveText('3');
});

test('Bust するとビジット開始時の残りへ戻る', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('segment-t19').click();
  await expect(page.getByTestId('status-left')).toHaveText('46');
  await page.getByTestId('segment-t20').click();

  await expect(page.getByTestId('status-flag')).toHaveText('BUST');
  await expect(page.getByTestId('status-left')).toHaveText('103');
  await expect(page.getByTestId('board-disabled-reason')).toBeVisible();
});

test('122 では T18 始動が基準ルートになる', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await setLeft(page, 122);
  const standard = page.getByTestId('standard-route');
  await expect(standard).toContainText('T18');
  await expect(page.getByTestId('standard-route-headline')).toContainText('104');
});

test('Bogey を入れると理由を示して候補を出さない', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await setLeft(page, 169);
  await expect(page.getByTestId('no-routes')).toContainText('ノーテン');
});

test('SETUP 305 は T20 → T20 → S18 で 167 残しを提案する', async ({ page }) => {
  await page.getByTestId('nav-setup').click();
  await expect(page.getByTestId('status-left')).toHaveText('305');
  const best = page.getByTestId('standard-route');
  await expect(best).toContainText('S18');
  await expect(best).toContainText('残り 167');
});

test('SETUP 269 でとりあえず TON の罠を警告する', async ({ page }) => {
  await page.getByTestId('nav-setup').click();
  await setLeft(page, 269);
  await expect(page.getByTestId('status-note')).toContainText('169');
});

test('TRAINING で回答し、確定すると採点される', async ({ page }) => {
  await page.getByTestId('nav-training').click();
  await page.getByTestId('start-training').click();

  await page.getByTestId('segment-t20').click();
  await expect(page.getByTestId('answer-0')).toHaveText('T20');

  // 自動確定はしない。
  await expect(page.getByTestId('training-result')).toHaveCount(0);

  await page.getByTestId('training-submit').click();
  await expect(page.getByTestId('training-result')).toBeVisible();
  await expect(page.getByTestId('stat-attempts')).toHaveText('1');
});

test('TRAINING の Undo で 1 投戻せる', async ({ page }) => {
  await page.getByTestId('nav-training').click();
  await page.getByTestId('start-training').click();
  await page.getByTestId('segment-t20').click();
  await page.getByTestId('training-undo').click();
  await expect(page.getByTestId('answer-0')).toHaveText('—');
});

test('学習履歴がリロード後も復元される', async ({ page }) => {
  await page.getByTestId('nav-training').click();
  await page.getByTestId('start-training').click();
  await page.getByTestId('segment-t20').click();
  await page.getByTestId('training-submit').click();
  await expect(page.getByTestId('stat-attempts')).toHaveText('1');

  await page.reload();
  await page.getByTestId('nav-training').click();
  await expect(page.getByTestId('stat-attempts')).toHaveText('1');
});

test('MY ROUTE の設定がリロード後も残る', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('select-D16').click();
  await expect(page.getByTestId('preferred-doubles')).not.toContainText('D16');

  await page.reload();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('preferred-doubles')).not.toContainText('D16');
});
