import { Fragment, useId, useState, type ReactNode } from 'react';
import { GLOSSARY_ALIASES, glossaryEntry, type GlossaryId } from '../data/glossary';
import './GlossaryText.css';

/**
 * 本文の中の用語をタップすると、短い意味が開く（監査フェーズ 2 / 2-8、U-M5）。
 *
 * 用語の定義は data/glossary.ts。同じ文の中では、各用語の最初の 1 回だけをボタンにする。
 * 意味は開いているときだけ描画するので、閉じているときの文字は元の文と同じ。
 */
export function GlossaryText({ text }: { readonly text: string }) {
  return <>{splitByGlossary(text)}</>;
}

interface Piece {
  readonly text: string;
  readonly id: GlossaryId | null;
}

/** 文を「ふつうの文字」と「用語」に分ける。 */
export function glossaryPieces(text: string): readonly Piece[] {
  const pieces: Piece[] = [];
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

function splitByGlossary(text: string): ReactNode[] {
  return glossaryPieces(text).map((piece, index) =>
    piece.id === null ? (
      <Fragment key={index}>{piece.text}</Fragment>
    ) : (
      <GlossaryTerm key={index} id={piece.id}>
        {piece.text}
      </GlossaryTerm>
    ),
  );
}

export function GlossaryTerm({ id, children }: { readonly id: GlossaryId; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const meaningId = useId();
  const entry = glossaryEntry(id);
  return (
    <span className="glossary-term">
      <button
        type="button"
        className="glossary-term__button"
        aria-expanded={open}
        aria-controls={open ? meaningId : undefined}
        aria-label={`${typeof children === 'string' ? children : entry.term}（用語の意味を${open ? '閉じる' : '見る'}）`}
        data-testid={`glossary-term-${id}`}
        onClick={(event) => {
          // カードのチップやトグルなど、外側のクリックへ伝えない。
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {children}
      </button>
      {open && (
        <span className="glossary-term__meaning" id={meaningId} role="note" data-testid={`glossary-meaning-${id}`}>
          {entry.meaning}
        </span>
      )}
    </span>
  );
}
