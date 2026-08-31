import { expect, test } from '@playwright/test';

test('manifest と Service Worker が配信される', async ({ page, request }) => {
  await page.goto('/');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();

  const manifest = await request.get(new URL(manifestHref!, page.url()).toString());
  expect(manifest.ok()).toBe(true);
  const body = (await manifest.json()) as {
    name: string;
    display: string;
    icons: Array<{ sizes: string; purpose?: string }>;
  };
  expect(body.name).toBe('01 Arrangement Support');
  expect(body.display).toBe('standalone');
  expect(body.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
  expect(body.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

  const serviceWorker = await request.get(new URL('sw.js', page.url()).toString());
  expect(serviceWorker.ok()).toBe(true);
});

test('SPA フォールバック（404.html）が用意されている', async ({ page, request }) => {
  await page.goto('/');
  const fallback = await request.get(new URL('404.html', page.url()).toString());
  expect(fallback.ok()).toBe(true);
  expect(await fallback.text()).toContain('<div id="root">');
});

test('Service Worker が登録され、オフラインでも表示できる', async ({ page, context }) => {
  await page.goto('/');
  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('score-input').fill('103');
  await expect(page.getByTestId('standard-route')).toContainText('T19');

  // Service Worker のプリキャッシュが終わるまで待つ。
  await page.waitForFunction(
    () => navigator.serviceWorker?.controller !== null,
    undefined,
    { timeout: 20_000 },
  );

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('app-title')).toBeVisible();
  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('score-input').fill('103');
  await expect(page.getByTestId('standard-route')).toContainText('T19');
  await context.setOffline(false);
});

test('主要な操作対象にアクセシブルな名前がある', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('score-input').fill('103');
  // v1.2: 盤面は「実際の着弾を入力」で開く。
  await page.getByTestId('recovery-toggle').click();

  await expect(page.getByRole('group', { name: /ダーツボード/ })).toBeVisible();
  await expect(page.getByTestId('segment-t20')).toHaveAttribute('aria-label', /トリプル20/);
  await expect(page.getByTestId('segment-inner-bull')).toHaveAttribute('aria-label', /ブル/);
});

test('キーボードだけで盤面を操作できる', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('score-input').fill('103');
  await page.getByTestId('recovery-toggle').click();

  await page.getByTestId('segment-s19-outer').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-left')).toHaveText('84');
});
