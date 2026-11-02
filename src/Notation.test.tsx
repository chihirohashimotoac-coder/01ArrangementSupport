/**
 * 監査フェーズ 2 / 2-3（U-M7）: BULL の表記を「D-BULL / S-BULL」に統一する。
 *
 * 画面に出る文字を 1 つずつ（テキストノードと aria-label）走査し、単独の「BULL」「SB」「DB」が
 * 残っていないことを確かめる。内部 ID（BULL / SB）は data-* 属性・保存データにだけ残る。
 *
 * 意図的に対象外にしているもの:
 *   - 更新履歴（#/history）: 過去の変更の記録なので、当時の表記のまま残す。
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

/** 単独の BULL / SB / DB（D-BULL・S-BULL の一部は除く）。 */
const LEGACY = /(?<![A-Za-z-])(?:BULL|SB|DB)(?![A-Za-z-])/;

function legacyNotations(root: ParentNode): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (LEGACY.test(text)) found.push(text.trim());
  }
  for (const element of (root as Element).querySelectorAll?.('[aria-label]') ?? []) {
    const label = element.getAttribute('aria-label') ?? '';
    if (LEGACY.test(label)) found.push(`aria-label: ${label}`);
  }
  return found;
}

async function typeLeft(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = screen.getByTestId('score-input');
  await user.clear(input);
  await user.type(input, value);
}

describe('BULL の表記（D-BULL / S-BULL）', () => {
  it.each(['170', '50', '121', '122', '100', '136', '81', '169'])(
    'CHECKOUT %s: 候補一覧・理由・盤面に単独の BULL / SB / DB が無い',
    async (left) => {
      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByTestId('nav-checkout'));
      await typeLeft(user, left);
      for (const button of screen.queryAllByRole('button', { name: /理由を見る/ })) await user.click(button);
      const all = screen.queryByTestId('show-all-routes');
      if (all) await user.click(all);
      await user.click(screen.getByTestId('recovery-toggle'));
      expect(legacyNotations(document.body)).toEqual([]);
    },
    30_000,
  );

  it.each(['231', '271', '309', '330', '192'])(
    'SETUP %s: 単独の BULL / SB / DB が無い',
    async (left) => {
      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByTestId('nav-setup'));
      await typeLeft(user, left);
      for (const button of screen.queryAllByRole('button', { name: /理由を見る/ })) await user.click(button);
      await user.click(screen.getByTestId('recovery-toggle'));
      expect(legacyNotations(document.body)).toEqual([]);
    },
    30_000,
  );

  it.each(['#/', '#/settings', '#/references', '#/simulation', '#/training'])(
    '%s: 単独の BULL / SB / DB が無い',
    (hash) => {
      window.history.replaceState(null, '', `/${hash}`);
      render(<App />);
      for (const details of document.querySelectorAll('details')) details.open = true;
      expect(legacyNotations(document.body)).toEqual([]);
    },
  );
});
