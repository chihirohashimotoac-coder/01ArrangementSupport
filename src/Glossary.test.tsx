/**
 * 監査フェーズ 2 / 2-8（U-M5）: 用語の説明。
 *   - ホーム・メニューから共通の用語集を開ける
 *   - 本文の用語をタップすると短い意味が開く
 *   - SIMULATION の振り返りの用語説明と、定義を共有する（data/glossary.ts）
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { GLOSSARY, glossaryEntry } from './data/glossary';
import { REVIEW_GLOSSARY_JA } from './engine/simulation/reviewGlossary';
import { glossaryPieces } from './components/GlossaryText';

describe('用語集', () => {
  it('監査で挙がった用語（テンパイ・ノーテン・Bogey・NEXT VISIT・PPR・TON・乗せる・0/1/4/7）がそろっている', () => {
    const text = GLOSSARY.map((entry) => `${entry.term} ${entry.aliases.join(' ')}`).join(' ');
    for (const word of ['テンパイ', 'ノーテン', 'Bogey', 'NEXT VISIT', 'PPR', 'TON', '乗せる', '0・1・4・7']) {
      expect(text).toContain(word);
    }
  });

  it('SIMULATION の振り返りの用語説明は、用語集と同じ定義を使う', () => {
    const tenpai = REVIEW_GLOSSARY_JA.find((item) => item.term === glossaryEntry('tenpai').term);
    expect(tenpai?.meaning).toBe(glossaryEntry('tenpai').meaning);
  });

  it('ホームから開ける', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('home-glossary'));
    expect(window.location.hash).toBe('#/glossary');
    expect(within(screen.getByTestId('glossary-tenpai')).getByText(glossaryEntry('tenpai').meaning)).toBeInTheDocument();
  });

  it('メニューから開ける', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('menu-toggle'));
    await user.click(screen.getByTestId('menu-glossary'));
    expect(screen.getByTestId('glossary-list')).toBeInTheDocument();
  });
});

describe('本文の用語をタップする', () => {
  it('同じ文では最初の 1 回だけを用語にし、英単語の一部は用語にしない', () => {
    const pieces = glossaryPieces('テンパイを作れます。まだテンパイです。SETUPS は対象外。');
    expect(pieces.filter((piece) => piece.id === 'tenpai')).toHaveLength(1);
    expect(pieces.some((piece) => piece.id === 'setup')).toBe(false);
  });

  it('169 の「ノーテン」をタップすると意味が開き、もう一度で閉じる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-checkout'));
    await user.type(screen.getByTestId('score-input'), '169');
    const term = screen.getAllByTestId('glossary-term-bogey')[0];
    expect(screen.queryByTestId('glossary-meaning-bogey')).toBeNull();
    await user.click(term);
    expect(term).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('glossary-meaning-bogey')).toHaveTextContent('3 本あっても上がれない残り');
    await user.click(term);
    expect(screen.queryByTestId('glossary-meaning-bogey')).toBeNull();
  });
});
