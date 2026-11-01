/**
 * 2026-11-01 監査 フェーズ 3（画面の使い勝手）の E2E。
 *
 * U-H1 「実際の着弾を入力」を開いたら盤面の先頭へ移る
 * U-H2 着弾入力中は「ラウンド開始」を控えめにし、いまの残りと NEXT を画面下に固定する
 * U-H3 「戻る」で前の画面へ戻る / 再読み込み後に TRAINING・SIMULATION を再開できる
 * U-H4 TRAINING を 360 × 780 の 1 画面で回せる
 * U-M1 範囲外の残り点を、もう一方のモードへ案内する
 */
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

async function rectOf(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: window.innerHeight };
  });
}

test('U-H3: 「戻る」で前の画面へ戻り、ホームまで戻れる', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('nav-training').click();
  await expect(page).toHaveURL(/#\/training$/);

  await page.goBack();
  await expect(page.getByTestId('nav-checkout')).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(page.getByTestId('home-quick')).toBeVisible();
});

test('U-H3: 再読み込みしても SIMULATION の途中から再開できる', async ({ page }) => {
  await page.getByTestId('nav-simulation').click();
  await page.getByTestId('start-simulation').click();
  await page.getByTestId('segment-t20').click();
  const lastThrow = await page.getByTestId('sim-last-throw').textContent();

  await page.reload();
  await expect(page.getByTestId('nav-simulation')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('sim-resume')).toBeVisible();
  await page.getByTestId('sim-resume-apply').click();
  await expect(page.getByTestId('sim-last-throw')).toHaveText(lastThrow ?? '');
});

test('U-H3: 再読み込みしても TRAINING の同じ問題から再開できる', async ({ page }) => {
  await page.getByTestId('nav-training').click();
  await page.getByTestId('start-training').click();
  const left = await page.getByTestId('status-left').textContent();
  await page.getByTestId('segment-t20').click();

  await page.reload();
  await expect(page.getByTestId('training-resume')).toBeVisible();
  await page.getByTestId('training-resume-apply').click();
  await expect(page.getByTestId('status-left')).toHaveText(left ?? '');
  await expect(page.getByTestId('answer-0')).toHaveText('T20');
});

test.describe('U-H4: TRAINING を 1 画面で回す（360 × 780）', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  for (const mode of ['checkout', 'setup'] as const) {
    test(`${mode}: 問題・盤面・回答欄が 1 画面に収まり、回答と次の問題で自動で移動する`, async ({ page }) => {
      await page.getByTestId('nav-training').click();
      await page.getByTestId(`training-mode-${mode}`).click();
      await page.getByTestId('start-training').click();
      await expect(page.getByTestId('training-settings-summary')).toBeVisible();
      await expect(page.getByTestId('start-training')).toHaveCount(0);

      await expect
        .poll(async () => {
          const status = await page.locator('.training__stage .status-bar').evaluate((e) => e.getBoundingClientRect().top);
          const answer = await page.locator('.training__answer').evaluate((e) => e.getBoundingClientRect().bottom);
          return status >= -1 && answer <= 780;
        })
        .toBe(true);

      // SETUP は盤面のウェッジ、CHECKOUT は区画をタップする。
      await page.getByTestId(mode === 'setup' ? 'wedge-20' : 'segment-t20').first().click();
      await page.getByTestId('training-submit').click();
      await expect
        .poll(async () => (await rectOf(page, 'training-result')).top)
        .toBeLessThan(200);

      await page.getByTestId('training-next').click();
      await expect
        .poll(async () => page.locator('.training__stage .status-bar').evaluate((e) => e.getBoundingClientRect().top))
        .toBeLessThan(40);
    });
  }

  test('出題中の「設定を変えてやり直す」は確認を出す', async ({ page }) => {
    await page.getByTestId('nav-training').click();
    await page.getByTestId('start-training').click();
    await page.getByTestId('training-restart').click();
    await expect(page.getByTestId('training-restart-confirm')).toBeVisible();
    await page.getByTestId('training-restart-confirm-cancel').click();
    await expect(page.getByTestId('training-progress')).toHaveText('1 / 10 問目');
  });
});

test.describe('U-H1 / U-H2: 着弾の入力（390 × 844）', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('開いたら盤面の先頭へ移り、入力中はいまの残りと NEXT を画面下に固定する', async ({ page }) => {
    await page.getByTestId('nav-checkout').click();
    await page.getByTestId('score-input').fill('103');
    await expect(page.getByTestId('standard-route')).toBeVisible();
    await page.getByTestId('recovery-toggle').click();
    await expect
      .poll(async () => page.locator('#practice-recovery').evaluate((e) => e.getBoundingClientRect().top))
      .toBeLessThan(80);

    await page.getByTestId('segment-s19-outer').click();
    // 上部は「ラウンド開始」の控えめな表示。答えの見出しに「残り 84」と書く。
    await expect(page.locator('.score-input--compact')).toBeVisible();
    await expect(page.getByText('ラウンド開始', { exact: true })).toBeVisible();
    await expect(page.getByTestId('standard-heading')).toHaveText('残り 84 の基準ルート');

    // 画面のどこにいても、いまの残り・NEXT・1投戻すが画面下に見えている。
    await page.locator('#practice-recovery').evaluate((e) => e.scrollIntoView({ block: 'start' }));
    const bar = await rectOf(page, 'entry-bar');
    expect(bar.bottom).toBeLessThanOrEqual(bar.height + 1);
    expect(bar.top).toBeGreaterThan(0);
    await expect(page.getByTestId('next-remaining')).toHaveText('84');
    await expect(page.getByTestId('recovery-next-route')).toBeVisible();

    // 「残り点を変える」で上の入力欄へ戻る。
    await page.getByTestId('change-left').click();
    await expect(page.getByTestId('score-input')).toBeFocused();
  });
});

test('U-M1: CHECKOUT に 250 を入れたら SETUP へ案内し、その値で開く', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  const input = page.getByTestId('score-input');
  await input.fill('250');
  await input.press('Enter');
  await expect(page.getByTestId('score-redirect')).toContainText('250 は SETUP');
  await page.getByTestId('score-redirect-action').click();
  await expect(page.getByTestId('nav-setup')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('score-input')).toHaveValue('250');
  await expect(page.getByTestId('standard-route')).toBeVisible();
});

test('3-8: ホームの入力欄に入れた残り点で、帯に合ったモードを開く', async ({ page }) => {
  const input = page.getByTestId('score-input');
  await input.fill('302');
  await input.press('Enter');
  await expect(page.getByTestId('nav-setup')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('standard-route')).toBeVisible();
});
