/**
 * 文を「ふつうの文字」と「用語」に分ける（監査フェーズ 2 / 2-8）。
 * 画面部品（components/GlossaryText.tsx）から使う。用語の定義は data/glossary.ts。
 */
import { GLOSSARY_ALIASES, type GlossaryId } from './glossary';

export interface GlossaryPiece {
  readonly text: string;
  readonly id: GlossaryId | null;
}

export function glossaryPieces(text: string): readonly GlossaryPiece[] {
  const pieces: GlossaryPiece[] = [];
  const used = new Set<GlossaryId>();
  let rest = text;
  while (rest.length > 0) {
    let best: { index: number; alias: string; id: GlossaryId } | null = null;
    for (const { alias, id } of GLOSSARY_ALIASES) {
      if (used.has(id)) continue;
      const index = rest.indexOf(alias);
      if (index < 0) continue;
      // 前後が英字の一部（例: 「SETUP」を含む別の英単語）なら用語として扱わない。
      const before = rest[index - 1] ?? '';
      const after = rest[index + alias.length] ?? '';
      if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after)) continue;
      if (best === null || index < best.index || (index === best.index && alias.length > best.alias.length)) {
        best = { index, alias, id };
      }
    }
    if (best === null) {
      pieces.push({ text: rest, id: null });
      break;
    }
    if (best.index > 0) pieces.push({ text: rest.slice(0, best.index), id: null });
    pieces.push({ text: best.alias, id: best.id });
    used.add(best.id);
    rest = rest.slice(best.index + best.alias.length);
  }
  return pieces;
}

