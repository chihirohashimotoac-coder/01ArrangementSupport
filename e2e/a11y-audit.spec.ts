/**
 * 2026-11-01 監査 フェーズ 4（デザイン・アクセシビリティ）の E2E。
 */
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

async function focusIsInsideMenu(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const menu = document.querySelector('[data-testid="app-menu"]');
    return menu !== null && menu.contains(document.activeElement);
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`D-H1 (${theme}): メニューを開くと Tab が中に閉じ込められ、Esc で閉じる`, async ({ page }) => {
    if (theme === 'light') {
      await page.getByTestId('menu-toggle').click();
      await page.getByRole('radio', { name: /Light/ }).check();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('app-menu')).toHaveCount(0);
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    await page.getByTestId('menu-toggle').click();
    await expect(page.getByTestId('app-menu')).toBeVisible();
    // 背面は inert（Tab でもスクリーンリーダーでも辿れない）。
    await expect(page.locator('#root')).toHaveAttribute('inert', '');

    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInsideMenu(page)).toBe(true);
    }
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await focusIsInsideMenu(page)).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('app-menu')).toHaveCount(0);
    await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  });
}
