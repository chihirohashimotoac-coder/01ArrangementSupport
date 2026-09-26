/**
 * ゲームの振り返り（GAME REVIEW）で使う用語の説明。
 *
 * 競技用語（BUST / CHECKOUT / D20 など）とターゲット表記は英語のまま残し、
 * 初見でも意味が分かるよう、ここに短い説明を集める。
 * 画面（`SimulationPage`）は折りたたみで出すだけにする。
 *
 * 定義はアプリの判定と同じもの（`domain/checkoutRules.ts` の `applyDart`、
 * `review.ts` の `summarize`、`data/gradeLabels.ts`）を言葉にしたもので、
 * 新しい戦術判断は含めない。
 */
import { BOGEY_NUMBERS } from '../../data/bogeyNumbers';
import { ROUTE_GRADE_LABEL_JA } from '../../data/gradeLabels';
import type { RouteGrade } from '../../data/rankingRules';

export interface GlossaryTerm {
  readonly term: string;
  readonly meaning: string;
}

const GRADES: readonly RouteGrade[] = ['S', 'A', 'B', 'C'];

export const REVIEW_GLOSSARY_JA: readonly GlossaryTerm[] = [
  {
    term: 'CHECKOUT',
    meaning: '残りをちょうど 0 にして上がること。最後の 1 投はダブル（DB を含む）。',
  },
  {
    term: 'BUST',
    meaning:
      '残り点を超える・残り 1 になる・ダブル以外で 0 になる、のどれか。そのビジットは 0 点になり、残りはビジット開始時へ戻る。',
  },
  {
    term: 'ボギー（Bogey Number）',
    meaning: `170 以下で、3 本あっても上がれない残り（ノーテン）。${BOGEY_NUMBERS.join(' / ')}。`,
  },
  {
    term: 'テンパイ',
    meaning: '次の 3 投で上がれる残り。',
  },
  {
    term: 'PPR（3投平均）',
    meaning: '3 投あたりの平均得点。BUST したビジットの得点は 0 として数える。',
  },
  {
    term: '最初の9投のPPR',
    meaning: 'ゲーム開始から 9 投までの PPR。9 投より前に上がったときは、投げた本数で平均する。',
  },
  {
    term: '推奨度',
    meaning: GRADES.map((grade) => `${grade} = ${ROUTE_GRADE_LABEL_JA[grade]}`).join('、') +
      '。ルート候補の相対評価。Cでも成立する上がり方はTRAININGでは正解。最後の1本の実戦推奨は別の比較軸で表示する。',
  },
  {
    term: 'MY ROUTE',
    meaning: '設定の得意ダブルを優先したルート。これに沿った狙いは良い判断として扱う。',
  },
];
