import { Fragment, useId, useState, type ReactNode } from 'react';
import { glossaryEntry, type GlossaryId } from '../data/glossary';
import { glossaryPieces } from '../data/glossaryPieces';
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
