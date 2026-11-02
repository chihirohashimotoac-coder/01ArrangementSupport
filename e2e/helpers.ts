import { expect, type Page } from '@playwright/test';

/**
 * 画面のスクロールが止まるまで待つ。
 *
 * 実戦入力を開くと盤面の位置まで滑らかにスクロールする（約 0.5 秒）。途中で区画の座標を
 * 測って押すと、押すまでに盤面が動いて別の場所を押してしまう。150ms あけて 2 回測り、
 * 同じ位置なら止まったとみなす。
 */
export async function waitForScrollEnd(page: Page) {
  let last = Number.NaN;
  await expect
    .poll(
      async () => {
        const y = await page.evaluate(() => window.scrollY);
        const settled = y === last;
        last = y;
        return settled;
      },
      { intervals: [150] },
    )
    .toBe(true);
}
