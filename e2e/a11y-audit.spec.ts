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

for (const width of [195, 320]) {
  test.describe(`D-M6: 幅 ${width}px（200% 拡大相当を含む）`, () => {
    test.use({ viewport: { width, height: 700 } });

    test('どの画面でも横スクロールが出ず、ナビのモード名を省略しない', async ({ page }) => {
      for (const hash of ['#/', '#/checkout', '#/setup', '#/training', '#/simulation', '#/settings', '#/history', '#/references']) {
        await page.goto(`/${hash}`);
        if (hash === '#/checkout') {
          await page.getByTestId('score-input').fill('103');
          await page.getByTestId('recovery-toggle').click();
        }
        if (hash === '#/setup') await page.getByTestId('score-input').fill('302');
        // フォントの読み込み前は代替フォントの幅で測ってしまうので待つ。
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(() => {
          const title = document.querySelector('.app__title')!.getBoundingClientRect();
          const menu = document.querySelector('[data-testid="menu-toggle"]')!.getBoundingClientRect();
          return {
            scrollWidth: document.documentElement.scrollWidth,
            truncated: [...document.querySelectorAll<HTMLElement>('.app__nav button')].filter(
              (button) => button.scrollWidth > button.clientWidth + 1,
            ).length,
            titleOverlapsMenu: title.right > menu.left + 0.5 && title.bottom > menu.top && title.top < menu.bottom,
          };
        });
        expect(metrics.scrollWidth, hash).toBeLessThanOrEqual(width);
        expect(metrics.truncated, hash).toBe(0);
        expect(metrics.titleOverlapsMenu, hash).toBe(false);
      }
    });
  });
}

test('D-M1: ルートの T / D / S は数字と同じ大きさで、トリプルとダブルは形でも区別する', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('score-input').fill('121');
  const chips = page.getByTestId('standard-route').locator('.route-card__dart');
  await expect(chips.first()).toBeVisible();
  const styles = await chips.evaluateAll((elements) =>
    elements.map((element) => {
      const own = getComputedStyle(element);
      const letter = getComputedStyle(element, '::first-letter');
      return {
        id: element.getAttribute('data-dart'),
        sameSize: letter.fontSize === own.fontSize,
        boxShadow: own.boxShadow,
        borderTop: own.borderTopWidth,
      };
    }),
  );
  // 121 の基準ルートは T20 → S11 → BULL。
  expect(styles.map((style) => style.id)).toEqual(['T20', 'S11', 'BULL']);
  expect(styles.every((style) => style.sameSize)).toBe(true);
  expect(styles[0].boxShadow).toContain('3.5px');
  expect(styles[1].boxShadow).not.toContain('3.5px');

  await page.getByTestId('score-input').fill('40');
  const double = page.getByTestId('standard-route').locator('.route-card__dart').first();
  await expect(double).toHaveAttribute('data-dart', 'D20');
  expect(await double.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('4px');
});

test('D-M4: 盤面は Tab 1 か所で、中は矢印キーで移り、最前面にフォーカス枠を描く', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('score-input').fill('103');
  await page.getByTestId('recovery-toggle').click();
  const board = page.getByTestId('dartboard');
  // Tab で止まる区画は 1 か所だけ。
  expect(await board.locator('[role="button"][tabindex="0"]').count()).toBe(1);

  await board.locator('[data-testid="segment-t20"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('segment-t1')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('segment-s1-outer')).toBeFocused();
  await expect(page.getByTestId('segment-s1-outer')).toHaveAttribute('aria-label', 'シングル1（外側）、1点');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('segment-s1-inner')).toHaveAttribute('aria-label', 'シングル1（内側）、1点');
  await expect(page.getByTestId('segment-s1-inner')).toBeFocused();
  await expect(page.getByTestId('board-focus-ring')).toHaveCount(1);
  expect(await board.locator('[role="button"][tabindex="0"]').count()).toBe(1);

  // 中心へ: 内側シングル → S-BULL → D-BULL。
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('segment-inner-bull')).toHaveAttribute('aria-label', 'D-BULL（インナーブル）、50点');
  await expect(page.getByTestId('segment-inner-bull')).toBeFocused();

  // Enter で入力される（D-BULL で 103 → 53）。
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('next-remaining')).toHaveText('53');
});

test('D-M3: 盤面の狙う的に投げる順番の番号札を置く', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('score-input').fill('121');
  await page.getByTestId('recovery-toggle').click();
  // 121 の基準ルートは T20 → S11 → BULL。
  await expect(page.getByTestId('board-order-T20')).toHaveText('1');
  await expect(page.getByTestId('board-order-S11')).toHaveText('2');
  await expect(page.getByTestId('board-order-BULL')).toHaveText('3');

  await page.getByTestId('score-input').fill('100');
  await page.getByTestId('recovery-toggle').click();
  // 同じ的を続けるときは 1·2 と並べる（100 は T20 → D20）。
  await expect(page.getByTestId('board-order-T20')).toHaveText('1');
  await expect(page.getByTestId('board-order-D20')).toHaveText('2');
});


/** 盤面全体が、画面下に固定した NEXT のまとまりより上に見える位置へ移る。 */
async function showWholeBoard(page: Page) {
  await page.evaluate(() => {
    document.querySelector('.dartboard__svg')!.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -8);
  });
}

test.describe('D-M2: タッチの拡大鏡', () => {
  // 動きを減らす設定でも使えること（盤面を開いたときの移動も即座になり、座標が安定する）。
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

  test('押しているあいだは拡大鏡を出し、指を離した区画で確定する', async ({ page }) => {
    await page.getByTestId('nav-checkout').click();
    await page.getByTestId('score-input').fill('103');
    await page.getByTestId('recovery-toggle').click();
    await showWholeBoard(page);
    // 区画の中心を測るのと同じ瞬間に、その位置へポインターイベントを送る（途中のスクロールでずれないように）。
    const pointer = (type: string, testId: string) =>
      page.evaluate(
        ([eventType, id]) => {
          const target = document.querySelector(`.dartboard__svg [data-testid="${id}"]`)!.getBoundingClientRect();
          document.querySelector('.dartboard__svg')!.dispatchEvent(
            new PointerEvent(eventType, {
              pointerType: 'touch',
              pointerId: 7,
              isPrimary: true,
              clientX: target.left + target.width / 2,
              clientY: target.top + target.height / 2,
              bubbles: true,
            }),
          );
        },
        [type, testId],
      );
    const start = 'segment-s20-outer';
    const end = 'segment-t19';

    await pointer('pointerdown', start);
    await expect(page.getByTestId('board-loupe')).toBeVisible();
    await expect(page.getByTestId('board-loupe-label')).toHaveText('シングル20（外側）');
    // まだ確定しない。
    await expect(page.getByTestId('next-remaining')).toHaveText('103');

    await pointer('pointermove', end);
    await expect(page.getByTestId('board-loupe-label')).toHaveText('トリプル19');
    await pointer('pointerup', end);
    await expect(page.getByTestId('board-loupe')).toHaveCount(0);
    // 指を離した T19 で確定（103 → 46）。
    await expect(page.getByTestId('next-remaining')).toHaveText('46');
  });

  test('タップ（押してすぐ離す）でも 1 回だけ入力される', async ({ page }) => {
    await page.getByTestId('nav-checkout').click();
    await page.getByTestId('score-input').fill('103');
    await page.getByTestId('recovery-toggle').click();
    await showWholeBoard(page);
    const box = (await page.getByTestId('segment-s19-outer').boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('next-remaining')).toHaveText('84');
    await expect(page.getByTestId('next-darts')).toHaveText('2');
  });
});
