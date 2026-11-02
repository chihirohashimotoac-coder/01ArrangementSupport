/**
 * ゲームの振り返り（GAME REVIEW）で使う用語の説明。
 *
 * 競技用語（BUST / CHECKOUT / D20 など）とターゲット表記は英語のまま残し、
 * 初見でも意味が分かるよう、ここに短い説明を集める。
 * 画面（`SimulationPage`）は折りたたみで出すだけにする。
 *
 * 定義はアプリの判定と同じもの（`domain/checkoutRules.ts` の `applyDart`、
 * `review.ts` の `summarize`、`data/gradeLabels.ts`）を言葉にしたもので、
 * 新しい戦術判断は含めない。用語の定義そのものは data/glossary.ts（監査フェーズ 2 / 2-8）。
 */
import { glossaryEntry, type GlossaryId } from '../../data/glossary';

export interface GlossaryTerm {
  readonly term: string;
  readonly meaning: string;
}

/** 振り返りで説明する用語（定義は data/glossary.ts。アプリ全体の用語集と共有する）。 */
const REVIEW_TERMS: readonly GlossaryId[] = [
  'checkout',
  'bust',
  'bogey',
  'tenpai',
  'ppr',
  'first9-ppr',
  'grade',
  'my-route',
];

export const REVIEW_GLOSSARY_JA: readonly GlossaryTerm[] = REVIEW_TERMS.map((id) => {
  const entry = glossaryEntry(id);
  return { term: entry.term, meaning: entry.meaning };
});
