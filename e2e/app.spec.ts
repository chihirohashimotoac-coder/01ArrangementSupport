import { expect, test, type Page } from '@playwright/test';

/** LEFT を入力する。確定ボタンはないので、入力しただけで反映される。 */
async function setLeft(page: Page, value: number) {
  await page.getByTestId('score-input').fill(String(value));
  // v1.2: 入力したら StatusBar ではなく答え（STANDARD / BEST）が出る。
  await expect(page.getByTestId('standard-route')).toBeVisible();
}

/** 実戦入力（盤面）を開く。v1.2 では通常表示でたたまれている。 */
async function openRecovery(page: Page) {
  await page.getByTestId('recovery-toggle').click();
  await expect(page.getByTestId('dartboard')).toBeVisible();
}

/** CHECKOUT を開いて LEFT を入れる。初期状態は空欄なので毎回必要。 */
async function openCheckout(page: Page, value: number) {
  await page.getByTestId('nav-checkout').click();
  await setLeft(page, value);
}

async function openSetup(page: Page, value: number) {
  await page.getByTestId('nav-setup').click();
  await setLeft(page, value);
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
  await openCheckout(page, 103);

  // 答えより先に盤面を通過させない。
  await expect(page.getByTestId('dartboard')).toHaveCount(0);
  await expect(page.getByTestId('status-bar')).toHaveCount(0);

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
  await openCheckout(page, 103);
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

test('「すべて表示」は 40 件で打ち切らず、ボタンの件数と一致する', async ({ page }) => {
  await openCheckout(page, 130);

  const button = page.getByTestId('show-all-routes');
  const label = (await button.textContent()) ?? '';
  const total = Number(/(\d+)\s*件/.exec(label)?.[1]);
  expect(total).toBeGreaterThan(40);

  await button.click();
  // AUD-P2-001: 以前は 40 件で黙って打ち切られていた。
  expect(await page.getByTestId('other-routes').locator('> *').count()).toBe(total);
  await expect(page.getByTestId('show-all-routes')).toContainText('上位 5 件');
});

test('1 投ごとのリカバリーが追従する', async ({ page }) => {
  await openCheckout(page, 103);
  await openRecovery(page);

  // T19 を狙って S19 に落ちた場合。
  await page.getByTestId('segment-s19-outer').click();
  await expect(page.getByTestId('status-left')).toHaveText('84');
  await expect(page.getByTestId('status-darts')).toHaveText('2');
  await expect(page.getByTestId('thrown-0')).toHaveText('S19');
  // 残り 2 本での候補が出る。
  await expect(page.getByTestId('standard-route')).toBeVisible();
});

test('Undo で 1 投戻せる', async ({ page }) => {
  await openCheckout(page, 103);
  await openRecovery(page);
  await page.getByTestId('segment-s19-outer').click();
  await expect(page.getByTestId('status-left')).toHaveText('84');
  await page.getByTestId('undo-button').click();
  await expect(page.getByTestId('status-left')).toHaveText('103');
  await expect(page.getByTestId('status-darts')).toHaveText('3');
});

test('Bust するとビジット開始時の残りへ戻る', async ({ page }) => {
  await openCheckout(page, 103);
  await openRecovery(page);
  await page.getByTestId('segment-t19').click();
  await expect(page.getByTestId('status-left')).toHaveText('46');
  await page.getByTestId('segment-t20').click();

  await expect(page.getByTestId('status-flag')).toHaveText('BUST');
  await expect(page.getByTestId('status-left')).toHaveText('103');
  await expect(page.getByTestId('board-disabled-reason')).toBeVisible();
});

test('122 では T18 始動が基準ルートになる', async ({ page }) => {
  await openCheckout(page, 122);
  const standard = page.getByTestId('standard-route');
  await expect(standard).toContainText('T18');
  await expect(page.getByTestId('standard-route-headline')).toContainText('104');
});

test('Bogey を入れると理由を示して候補を出さない', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('score-input').fill('169');
  await expect(page.getByTestId('no-routes')).toContainText('ノーテン');
});

test('SETUP 305 は T20 → T20 → S18 で 167 残しを提案する', async ({ page }) => {
  await openSetup(page, 305);
  await expect(page.getByTestId('score-input')).toHaveValue('305');
  const best = page.getByTestId('standard-route');
  await expect(best).toContainText('S18');
  await expect(best).toContainText('残り 167');
});

test('SETUP 269 でとりあえず TON の罠を警告する', async ({ page }) => {
  await openSetup(page, 269);
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

test('Light / Dark テーマを切り替え、リロード後も復元する', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('theme-dark')).toHaveAttribute('aria-checked', 'true');

  await page.getByTestId('theme-light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#edf4fb');

  for (const destination of ['nav-checkout', 'nav-setup', 'nav-training', 'app-title'] as const) {
    await page.getByTestId(destination).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  }

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('theme-light')).toHaveAttribute('aria-checked', 'true');

  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#07111f');
});

test('ユーザー向けUIに「ビジット」を表示しない', async ({ page }) => {
  await expect(page.locator('body')).not.toContainText('ビジット');

  await openCheckout(page, 103);
  await openRecovery(page);
  await expect(page.locator('body')).not.toContainText('ビジット');

  await page.getByTestId('nav-setup').click();
  await page.getByTestId('score-input').fill('302');
  await expect(page.locator('body')).not.toContainText('ビジット');

  await page.getByTestId('nav-training').click();
  await expect(page.locator('body')).not.toContainText('ビジット');
  await page.getByTestId('nav-settings').click();
  await expect(page.locator('body')).not.toContainText('ビジット');
});

test('LEFT は空欄から始まり、入力するだけで候補が出る', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await expect(page.getByTestId('score-input')).toHaveValue('');
  await expect(page.getByTestId('practice-idle')).toBeVisible();
  await expect(page.getByTestId('standard-route')).toHaveCount(0);
  // 「セット」ボタンは廃止した。
  await expect(page.getByTestId('score-input-apply')).toHaveCount(0);

  await page.getByTestId('score-input').fill('103');
  await expect(page.getByTestId('standard-route')).toContainText('T19');

  // 空欄へ戻すと未入力状態に戻る。
  await page.getByTestId('score-input').fill('');
  await expect(page.getByTestId('practice-idle')).toBeVisible();
  await expect(page.getByTestId('standard-route')).toHaveCount(0);
});

test('LEFT をタップすると現在値が全選択され、そのまま置き換えられる', async ({ page }) => {
  await openCheckout(page, 103);

  const input = page.getByTestId('score-input');
  await input.blur();
  await input.click();

  // focus した時点で現在値が全選択されている。
  expect(
    await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
  ).toEqual([0, 3]);

  // Backspace で 3 桁消さずに、次の数字がそのまま置き換わる。
  await page.keyboard.type('61');
  await expect(input).toHaveValue('61');
  await expect(page.getByTestId('standard-route')).toContainText('T15');
});

test('LEFT プリセットは廃止されている（CHECKOUT / SETUP）', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  for (const preset of ['170', '167', '164', '161', '160', '122', '103', '61', '46', '40']) {
    await expect(page.getByRole('button', { name: preset, exact: true })).toHaveCount(0);
  }
  await expect(page.locator('.score-input__presets')).toHaveCount(0);

  // プリセットが無くても、直接入力すれば答えが出る。
  await page.getByTestId('score-input').fill('122');
  await expect(page.getByTestId('standard-route')).toContainText('T18');

  await page.getByTestId('nav-setup').click();
  for (const preset of ['350', '340', '309', '305', '302', '275', '271', '269', '235', '231']) {
    await expect(page.getByRole('button', { name: preset, exact: true })).toHaveCount(0);
  }
  await expect(page.locator('.score-input__presets')).toHaveCount(0);

  await page.getByTestId('score-input').fill('302');
  await expect(page.getByTestId('standard-route')).toContainText('S18');
});

test('v1.2: 答えが先、盤面は「実際の着弾を入力」で開く', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();

  // 未入力時はプリセットの無い、入力欄だけのシンプルな画面。
  await expect(page.getByTestId('score-input')).toHaveAttribute('placeholder', '例 103');
  await expect(page.getByText('残り点 LEFT')).toBeVisible();

  await page.getByTestId('score-input').fill('103');
  const standard = page.getByTestId('standard-route');
  await expect(standard).toContainText('T19');
  await expect(page.getByTestId('dartboard')).toHaveCount(0);

  // 答えは盤面を経由せず、スクロールなしで viewport に入る。
  expect(
    await standard.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.top < window.innerHeight;
    }),
  ).toBe(true);

  const toggle = page.getByTestId('recovery-toggle');
  await expect(toggle).toContainText('実際の着弾を入力');
  await toggle.click();
  await expect(page.getByTestId('dartboard')).toBeVisible();

  // 閉じられる。
  await toggle.click();
  await expect(page.getByTestId('dartboard')).toHaveCount(0);
});

test('v1.2: 着弾を入れると盤面の直下に NEXT と 1投戻す が出る', async ({ page }) => {
  await openCheckout(page, 103);
  await openRecovery(page);

  const undo = page.getByTestId('undo-button');
  await expect(undo).toBeDisabled();

  await page.getByTestId('segment-s19-outer').click();

  const next = page.getByTestId('recovery-next');
  await expect(next.getByTestId('next-remaining')).toHaveText('84');
  await expect(next.getByTestId('next-darts')).toHaveText('2');
  await expect(page.getByTestId('recovery-next-route')).toContainText('NEXT');

  // 盤面と NEXT が一緒に見える（大きくスクロールしないと読めない、を防ぐ）。
  const boardBottom = await page
    .getByTestId('dartboard')
    .evaluate((el) => el.getBoundingClientRect().bottom);
  const nextTop = await next.evaluate((el) => el.getBoundingClientRect().top);
  expect(nextTop - boardBottom).toBeLessThan(80);

  // Undo は盤面のそば。押せば 1 投戻る。
  await expect(page.getByRole('button', { name: '1投戻す' })).toHaveCount(1);
  await undo.click();
  await expect(page.getByTestId('status-left')).toHaveText('103');
});

test('v1.2: 入力途中では画面が動かず、Enter で答えへ移動する', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await page.evaluate(() => {
    const w = window as unknown as { __scrolls: number };
    w.__scrolls = 0;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function patched(...args: unknown[]) {
      w.__scrolls += 1;
      return (original as (...a: unknown[]) => void).apply(this, args);
    };
  });

  const input = page.getByTestId('score-input');
  await input.click();
  // 1 → 10 → 103。10 の時点で合法な CHECKOUT 値になるが、画面は動かさない。
  await page.keyboard.type('103');
  await expect(page.getByTestId('standard-route')).toBeVisible();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { __scrolls: number }).__scrolls)).toBe(0);

  await page.keyboard.press('Enter');
  await expect
    .poll(
      async () => page.evaluate(() => (window as unknown as { __scrolls: number }).__scrolls),
      { timeout: 3000 },
    )
    .toBeGreaterThan(0);
});

test('v1.2: 盤面より下のルートチップから開いても、盤面が見える位置へ移動する', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await openCheckout(page, 103);

  // OTHER ROUTES は盤面（実戦入力）より下にある。
  const card = page.getByTestId(/^route-/).first();
  await card.scrollIntoViewIfNeeded();
  await card.locator('.route-card__dart').first().click();

  const board = page.getByTestId('dartboard');
  await expect(board).toBeVisible();
  // 開いた盤面が viewport の上へ出てしまっていない。
  expect(
    await board.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    }),
  ).toBe(true);
  await expect(page.locator('[data-focused="true"]').first()).toBeVisible();
});

test('v1.2: 盤面が開いているときは、チップを押しても画面を動かさない', async ({ page }) => {
  await openCheckout(page, 103);
  await openRecovery(page);
  // Playwright 自身のクリック前スクロールと区別するため、呼び出し回数で見る。
  await page.evaluate(() => {
    const w = window as unknown as { __scrolls: number };
    w.__scrolls = 0;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function patched(...args: unknown[]) {
      w.__scrolls += 1;
      return (original as (...a: unknown[]) => void).apply(this, args);
    };
  });

  await page.getByTestId('standard-route').locator('.route-card__dart').first().click();
  await expect(page.locator('[data-focused="true"]').first()).toBeVisible();
  await page.waitForTimeout(400);

  expect(await page.evaluate(() => (window as unknown as { __scrolls: number }).__scrolls)).toBe(0);
});

test('v1.2: LEFT の blur で予約された移動は、実戦入力を開いた時点で取り消す', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await page.evaluate(() => {
    const w = window as unknown as { __scrolls: number };
    w.__scrolls = 0;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function patched(...args: unknown[]) {
      w.__scrolls += 1;
      return (original as (...a: unknown[]) => void).apply(this, args);
    };
  });

  await page.getByTestId('score-input').click();
  await page.keyboard.type('103');
  await expect(page.getByTestId('standard-route')).toBeVisible();

  // 入力欄から実戦入力ボタンへ移ると blur → click の順に起きる。
  await page.getByTestId('recovery-toggle').click();
  await expect(page.getByTestId('dartboard')).toBeVisible();

  // 予約されていた 250ms 後の移動は起きない。
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __scrolls: number }).__scrolls)).toBe(0);
  await expect(page.getByTestId('dartboard')).toBeVisible();
});

test('v1.2: TRAINING は採点後にだけ結果の直下へ「次の問題」を出す', async ({ page }) => {
  await page.getByTestId('nav-training').click();
  await page.getByTestId('start-training').click();

  await expect(page.getByTestId('training-next')).toHaveCount(0);

  await page.getByTestId('segment-t20').click();
  await page.getByTestId('training-submit').click();

  await expect(page.getByTestId('training-result')).toBeVisible();
  await expect(page.getByRole('button', { name: '次の問題' })).toHaveCount(1);

  const resultBottom = await page
    .getByTestId('training-result')
    .evaluate((el) => el.getBoundingClientRect().bottom);
  const nextTop = await page
    .getByTestId('training-next')
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(nextTop - resultBottom).toBeLessThan(40);
});

test('CHECKOUT の LEFT を SETUP へ持ち越さない', async ({ page }) => {
  await openCheckout(page, 103);
  await page.getByTestId('nav-setup').click();
  await expect(page.getByTestId('score-input')).toHaveValue('');
  await expect(page.getByTestId('practice-idle')).toBeVisible();
});

test('Safe Area の余白は通常ブラウザの見た目を変えない', async ({ page }) => {
  const app = page.locator('.app');

  // env(safe-area-inset-*) は通常ブラウザで 0px。従来どおり 0.75rem / 1.5rem になる。
  const padding = await app.evaluate((el) => {
    const style = getComputedStyle(el);
    return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
  });
  expect(padding).toEqual(['12px', '12px', '24px', '12px']);

  // 縦・横どちらでも横スクロールを生まないこと（横画面のノッチ対応で崩れないかの確認）。
  // 320px は小さめの iPhone SE 相当。v1.2 のレイアウトはここでも崩さない。
  for (const size of [
    { width: 393, height: 852 },
    { width: 852, height: 393 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(size);
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, `${size.width}x${size.height} で横スクロールが出ている`).toBe(false);
  }
});

test('320px でも CHECKOUT / SETUP の主要部が横にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });

  for (const [nav, value] of [
    ['nav-checkout', '103'],
    ['nav-setup', '302'],
  ] as const) {
    await page.getByTestId(nav).click();
    await page.getByTestId('score-input').fill(value);
    await expect(page.getByTestId('standard-route')).toBeVisible();
    await page.getByTestId('recovery-toggle').click();
    await expect(page.getByTestId('dartboard')).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, `${nav} の 320px で横スクロールが出ている`).toBe(false);
  }
});

test('footer は Copyright 表記だけ', async ({ page }) => {
  const footer = page.locator('.app__footer');
  await expect(footer).toHaveText('© 2026 Chihiro Hashimoto');
  await expect(footer).not.toContainText('添付資料');
});

test('設定画面は基準ルートをユーザー向けの言葉で説明する', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByRole('heading', { name: '基準ルートについて' })).toBeVisible();
  await expect(page.getByTestId('standard-route-note')).toContainText(
    '実戦で使われる標準的なアレンジ',
  );
  const settings = page.locator('.settings');
  await expect(settings).not.toContainText('添付');
  await expect(settings).not.toContainText('human-approved-v1');
  // APPROVALS.md A-1: 一次資料が確認できていないため、出典は主張しない。
  await expect(settings).not.toContainText('PDC');
});

// ---------------------------------------------------------------------------
// v1.3 TRAINING 教育設計
// ---------------------------------------------------------------------------

/** SETUP TRAINING を開き、1 投調整の問題まで進める。 */
async function openSetupAdjustment(page: Page) {
  await page.getByTestId('nav-training').click();
  await page.getByTestId('training-mode-setup').click();
  await page.getByTestId('start-training').click();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await page.getByTestId('training-context').count()) > 0) return;
    await page.getByTestId('segment-s20-outer').click();
    await page.getByTestId('training-submit').click();
    await page.getByTestId('training-next').click();
  }
  throw new Error('SETUP の 1 投調整問題が出題されませんでした');
}

test('TRAINING: SETUP は開始残り・ここまでの結果・現在の残り・残り 1 投を出す', async ({ page }) => {
  await openSetupAdjustment(page);

  await expect(page.getByTestId('training-context')).toBeVisible();
  const start = Number(await page.getByTestId('training-context-start').textContent());
  const current = Number(await page.getByTestId('training-context-current').textContent());
  expect(start).toBeGreaterThanOrEqual(171);
  expect(current).toBeLessThan(start);
  await expect(page.getByTestId('training-context-throws')).toContainText('→');
  await expect(page.getByTestId('training-context-darts')).toHaveText('1 投');
  await expect(page.getByTestId('status-left')).toHaveText(String(current));
  await expect(page.getByTestId('answer-0')).toHaveText('—');
});

test('TRAINING: SETUP の 1 投調整は自動確定せず、Undo できる', async ({ page }) => {
  await openSetupAdjustment(page);

  await page.getByTestId('segment-s20-outer').click();
  await expect(page.getByTestId('answer-0')).toHaveText('S20');
  await expect(page.getByTestId('answer-1')).toHaveCount(0);
  await expect(page.getByTestId('training-result')).toHaveCount(0);

  await page.getByTestId('training-undo').click();
  await expect(page.getByTestId('answer-0')).toHaveText('—');

  await page.getByTestId('segment-s19-outer').click();
  await page.getByTestId('training-submit').click();
  await expect(page.getByTestId('training-result')).toBeVisible();
});

test('TRAINING: SETUP の結果は「あなたの回答」と「おすすめ」を並べて見せる', async ({ page }) => {
  await openSetupAdjustment(page);

  await page.getByTestId('segment-s20-outer').click();
  await page.getByTestId('training-submit').click();

  await expect(page.getByTestId('training-verdict')).toBeVisible();
  await expect(page.getByTestId('training-your-answer')).toContainText('S20');
  await expect(page.getByTestId('training-recommended')).toContainText('おすすめ');
  await expect(page.getByTestId('training-difference')).toBeVisible();
  expect((await page.getByTestId('training-difference').textContent())?.length ?? 0).toBeGreaterThan(
    0,
  );
});

test('TRAINING: CHECKOUT で成立しない回答をしても、おすすめの上がり方を出す', async ({ page }) => {
  await page.getByTestId('nav-training').click();
  await page.getByTestId('start-training').click();

  await page.getByTestId('segment-s1-outer').click();
  await page.getByTestId('training-submit').click();

  await expect(page.getByTestId('training-recommended')).toBeVisible();
  await expect(page.getByTestId('training-difference')).toContainText('上がれます');
});

test('TRAINING: RECOVERY でも不成立の回答におすすめを出す', async ({ page }) => {
  await page.getByTestId('nav-training').click();
  await page.getByTestId('training-mode-recovery').click();
  await page.getByTestId('start-training').click();

  await expect(page.getByTestId('status-darts')).toHaveText('2');
  await page.getByTestId('segment-s1-outer').click();
  await page.getByTestId('training-submit').click();

  await expect(page.getByTestId('training-recommended')).toBeVisible();
  await expect(page.getByTestId('training-difference')).toContainText('上がれます');
});

test('TRAINING: MIXED で 10 問を終えられる', async ({ page }) => {
  await page.getByTestId('nav-training').click();
  await page.getByTestId('training-mode-mixed').click();
  await page.getByTestId('start-training').click();

  for (let i = 0; i < 10; i += 1) {
    await expect(page.getByTestId('training-progress')).toHaveText(`${i + 1} / 10 問目`);
    await page.getByTestId('segment-t20').click();
    await page.getByTestId('training-submit').click();
    await expect(page.getByTestId('training-result')).toBeVisible();
    await page.getByTestId('training-next').click();
  }

  await expect(page.getByTestId('training-finished')).toBeVisible();
  await expect(page.getByTestId('stat-attempts')).toHaveText('10');
});

test('TRAINING: 無限モードは 10 問を超えても続く', async ({ page }) => {
  await page.getByTestId('nav-training').click();
  await page.getByRole('button', { name: '詳細設定' }).click();
  await page.getByRole('button', { name: '無限' }).click();
  await page.getByTestId('start-training').click();

  for (let i = 0; i < 11; i += 1) {
    await expect(page.getByTestId('training-progress')).toHaveText(`${i + 1} 問目`);
    await page.getByTestId('segment-t20').click();
    await page.getByTestId('training-submit').click();
    await page.getByTestId('training-next').click();
  }
  await expect(page.getByTestId('training-progress')).toHaveText('12 問目');
});

test('TRAINING: 読み取れない古い履歴を正答率へ混ぜない', async ({ page }) => {
  await page.evaluate(() => {
    window.localStorage.setItem(
      'oas.training.v1',
      JSON.stringify({
        version: 1,
        records: [
          {
            id: 'ok',
            at: 1,
            kind: 'checkout',
            remaining: 103,
            dartsAvailable: 3,
            answer: ['T19', 'S6', 'D20'],
            valid: true,
            grade: 'S',
            finishDouble: 'D20',
            elapsedMs: 3000,
          },
          null,
          { kind: 'setup', remaining: 302, dartsAvailable: 3, answer: ['ZZ'], valid: true },
        ],
      }),
    );
  });
  await page.reload();
  await page.getByTestId('nav-training').click();

  await expect(page.getByTestId('stat-attempts')).toHaveText('1');
  await expect(page.getByTestId('stat-accuracy')).toHaveText('100%');
  await expect(page.getByTestId('training-migration-skipped')).toContainText('2 件');
});

test('バージョン履歴: トップから開き、「トップへ戻る」で戻れる', async ({ page }) => {
  await page.getByTestId('home-version-history').click();

  await expect(page.getByRole('heading', { name: 'バージョン履歴' })).toBeVisible();
  const items = page.getByTestId('version-history-item');
  await expect(items.first()).toContainText('現在');
  await expect(items.first()).toContainText('v1.3');
  expect(await items.count()).toBeGreaterThan(1);

  // トップページのボタンは、この画面では出さない。
  await expect(page.getByTestId('home-version-history')).toHaveCount(0);

  // 下までスクロールしても「トップへ戻る」は画面上部に残る。
  const back = page.getByTestId('version-history-back');
  await items.last().scrollIntoViewIfNeeded();
  await expect(back).toBeInViewport();

  await back.click();
  await expect(page.getByTestId('home-checkout')).toBeVisible();
  await expect(page.getByTestId('version-history-list')).toHaveCount(0);
  // 履歴のスクロール位置を持ち越さない。
  expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
});

test('バージョン履歴: 320px 幅でも横へはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByTestId('home-version-history').click();
  await expect(page.getByTestId('version-history-list')).toBeVisible();

  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const targets = document.querySelectorAll(
      '.version-history, .version-history *, .app__header, .app__nav',
    );
    return [...targets]
      .map((el) => ({ cls: el.className.toString(), right: el.getBoundingClientRect().right }))
      .filter((box) => box.right > width + 1);
  });
  expect(overflow).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('v1.3.1: 上がれない残りでは NEXT VISIT が盤面より先に出る', async ({ page }) => {
  await page.getByTestId('nav-checkout').click();
  await page.getByTestId('score-input').fill('169');

  const empty = page.getByTestId('no-routes');
  const card = page.getByTestId('next-visit-route');
  await expect(empty).toContainText('ノーテン');
  await expect(card).toBeVisible();
  await expect(card).toContainText('取得');
  await expect(card).toContainText('残り');

  // 「上がれません」→ NEXT VISIT →「実際の着弾を入力」の順で読める。
  const order = await page.evaluate(() => {
    const ids = ['no-routes', 'next-visit-route', 'recovery-toggle'];
    return ids.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return el ? el.getBoundingClientRect().top : Number.NaN;
    });
  });
  expect(order[0]).toBeLessThan(order[1]);
  expect(order[1]).toBeLessThan(order[2]);
});

test('v1.3.1: 320px でも TIP と NEXT VISIT が横へはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByTestId('nav-checkout').click();

  // 未入力の余白に TIP が出る。
  await expect(page.getByTestId('practice-tip')).toBeVisible();
  let overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows, 'TIP 表示中の 320px で横スクロールが出ている').toBe(false);

  // 入力したら TIP は消え、上がれない残りでは NEXT VISIT が出る。
  await page.getByTestId('score-input').fill('169');
  await expect(page.getByTestId('practice-tip')).toHaveCount(0);
  await expect(page.getByTestId('next-visit-route')).toBeVisible();
  await page.getByTestId('recovery-toggle').click();
  await expect(page.getByTestId('dartboard')).toBeVisible();

  overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows, 'NEXT VISIT 表示中の 320px で横スクロールが出ている').toBe(false);
});

test('v1.3.1: 上がれる残りでは TIP も NEXT VISIT も出さない', async ({ page }) => {
  await openCheckout(page, 103);
  await expect(page.getByTestId('practice-tip')).toHaveCount(0);
  await expect(page.getByTestId('next-visit-route')).toHaveCount(0);

  // SETUP では MY ROUTE の TIP を出さない。
  await page.getByTestId('nav-setup').click();
  await expect(page.getByTestId('practice-idle')).toBeVisible();
  await expect(page.getByTestId('practice-tip')).toHaveCount(0);
});

test('v1.3.2: 134 から T5 を刺した 119 / 2 本で、40 残しを案内する', async ({ page }) => {
  // 実機で見つかった事故の再現。モバイル相当の幅で確認する。
  await page.setViewportSize({ width: 390, height: 844 });
  await openCheckout(page, 134);
  await openRecovery(page);

  // 実際の着弾は T5（15 点）。134 - 15 = 119、残り 2 本。
  await page.getByTestId('segment-t5').click();
  await expect(page.getByTestId('status-bar')).toContainText('119');

  const card = page.getByTestId('next-visit-route');
  await expect(card).toBeVisible();
  await expect(card).toContainText('T20');
  await expect(card).toContainText('S19');
  await expect(card).toContainText('取得 79 点 → 残り 40');

  // 候補を並べて選ばせない。NEXT VISIT は常に 1 件だけ。
  await expect(page.getByTestId('next-visit-route')).toHaveCount(1);

  // 横スクロールを増やさない。
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows, 'NEXT VISIT 表示中に横スクロールが出ている').toBe(false);
});

test('v1.3.2: 119 / 2 本では、警告・NEXT VISIT・実戦入力が近い位置に並ぶ', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCheckout(page, 134);
  await openRecovery(page);
  await page.getByTestId('segment-t5').click();
  // 盤面をたたんで、通常の読み順（警告 → 答え → 実戦入力）へ戻す。
  await page.getByTestId('recovery-toggle').click();
  await expect(page.getByTestId('dartboard')).toHaveCount(0);

  const notice = page.getByTestId('no-routes');
  await expect(notice).toContainText('上がれません');
  await expect(page.getByTestId('next-visit-route')).toBeVisible();

  // 警告 → NEXT VISIT →「実際の着弾を入力」の順で、過度なスクロールなしに読める。
  const tops = await page.evaluate(() => {
    const ids = ['no-routes', 'next-visit-route', 'recovery-toggle'];
    return ids.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return el ? el.getBoundingClientRect().top : Number.NaN;
    });
  });
  expect(tops[0]).toBeLessThan(tops[1]);
  expect(tops[1]).toBeLessThan(tops[2]);
  // 3 つとも 1 画面（844px）に収まる。
  expect(tops[2]).toBeLessThan(844);
});
