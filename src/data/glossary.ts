/**
 * 用語の定義（監査フェーズ 2 / 2-8、U-M5）。
 *
 * 用語集の画面・本文中の用語のタップ・SIMULATION の振り返りの用語説明は、すべてここを読む。
 * 定義はアプリの判定（domain/checkoutRules.ts の applyDart、data/bogeyNumbers.ts など）を言葉にしたもので、
 * 新しい戦術判断は含めない。
 */
import { BOGEY_NUMBERS } from './bogeyNumbers';
import { GRADE_S_OVERVIEW_JA, ROUTE_GRADE_LABEL_JA } from './gradeLabels';

export type GlossaryId =
  | 'checkout'
  | 'bust'
  | 'bogey'
  | 'tenpai'
  | 'next-visit'
  | 'ppr'
  | 'first9-ppr'
  | 'ton'
  | 'noseru'
  | 'digits-0147'
  | 'grade'
  | 'standard'
  | 'my-route'
  | 'best'
  | 'bull'
  | 'setup';

export interface GlossaryEntry {
  readonly id: GlossaryId;
  /** 見出し。 */
  readonly term: string;
  readonly meaning: string;
  /** 本文の中でこの用語として見つける文字列（長いものから順に照合する）。 */
  readonly aliases: readonly string[];
}

const GRADES = ['S', 'A', 'B', 'C'] as const;

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    id: 'checkout',
    term: 'CHECKOUT',
    meaning: '残りをちょうど 0 にして上がること。最後の 1 投はダブル（D-BULL を含む）。',
    aliases: ['チェックアウト', 'CHECKOUT'],
  },
  {
    id: 'bust',
    term: 'BUST',
    meaning:
      '残り点を超える・残り 1 になる・ダブル以外で 0 になる、のどれか。そのビジットは 0 点になり、残りはビジット開始時へ戻る。',
    aliases: ['BUST', 'Bust'],
  },
  {
    id: 'bogey',
    term: 'ノーテン（ボギー / Bogey Number）',
    meaning: `170 以下で、3 本あっても上がれない残り。${BOGEY_NUMBERS.join(' / ')}。`,
    aliases: ['ノーテン', 'ボギー', 'Bogey'],
  },
  {
    id: 'tenpai',
    term: 'テンパイ',
    meaning: '次の 3 投で上がれる残り（170 以下で、ノーテンでないもの）。',
    aliases: ['テンパイ'],
  },
  {
    id: 'next-visit',
    term: 'NEXT VISIT',
    meaning: 'このビジットではもう上がれないときに、次のビジットで上がりやすい残りを作る狙い方。',
    aliases: ['NEXT VISIT'],
  },
  {
    id: 'ppr',
    term: 'PPR（3 投平均）',
    meaning: '3 投あたりの平均得点。BUST したビジットの得点は 0 として数える。',
    aliases: ['PPR'],
  },
  {
    id: 'first9-ppr',
    term: '最初の 9 投の PPR（FIRST 9）',
    meaning: 'ゲーム開始から 9 投までの PPR。9 投より前に上がったときは、投げた本数で平均する。',
    aliases: ['FIRST 9'],
  },
  {
    id: 'ton',
    term: 'TON',
    meaning: '1 ビジットで 100 点以上を取ること。ちょうど 100 点を取るとノーテンが残る残り点もあるので注意が要る。',
    aliases: ['TON'],
  },
  {
    id: 'noseru',
    term: '乗せる',
    meaning: 'セットアップで、次のビジットで上がりやすい残り（167・164・161・160 など）へ残りを合わせること。',
    aliases: ['乗せる', '乗せ'],
  },
  {
    id: 'digits-0147',
    term: '下一桁 0・1・4・7',
    meaning:
      '159〜170 の帯では、下一桁が 0・1・4・7 の残り（160 / 161 / 164 / 167 / 170）が 3 本で上がれる形として覚えやすい、という目安。',
    aliases: ['0・1・4・7', '0 / 1 / 4 / 7'],
  },
  {
    id: 'grade',
    term: '推奨度',
    meaning:
      GRADES.map((grade) => `${grade} = ${grade === 'S' ? GRADE_S_OVERVIEW_JA : ROUTE_GRADE_LABEL_JA[grade]}`).join('、') +
      '。ルート候補の相対評価。C でも成立する上がり方は TRAINING では正解。最後の 1 本の実戦推奨は別の比較軸で表示する。',
    aliases: ['推奨度'],
  },
  {
    id: 'standard',
    term: '基準ルート（STANDARD）',
    meaning:
      'このアプリが最初に示す上がり方。41〜170 は添付の Excel 表、2〜40 は決まった規則から作る（残り 2 本の 51〜70 は別の規則）。PDC などが公式に定めた表ではない。',
    aliases: ['基準ルート', 'STANDARD'],
  },
  {
    id: 'my-route',
    term: 'MY ROUTE',
    meaning: '設定の得意ダブルを優先したルート。これに沿った狙いは良い判断として扱う。',
    aliases: ['MY ROUTE'],
  },
  {
    id: 'best',
    term: 'BEST',
    meaning: 'SETUP（171〜350）で、次のラウンドの残しがいちばん良くなる組み立て。',
    aliases: ['BEST'],
  },
  {
    id: 'bull',
    term: 'D-BULL / S-BULL',
    meaning: 'D-BULL はブルの中心（インナーブル・50 点、ダブル扱いで上がれる）。S-BULL はその外側（アウターブル・25 点、上がれない）。',
    aliases: ['D-BULL', 'S-BULL'],
  },
  {
    id: 'setup',
    term: 'SETUP',
    meaning: '残り 171〜350。このビジットでは上がれないので、次のビジットで上がりやすい残りを作る。',
    aliases: ['SETUP'],
  },
];

export function glossaryEntry(id: GlossaryId): GlossaryEntry {
  const entry = GLOSSARY.find((item) => item.id === id);
  if (entry === undefined) throw new Error(`用語が見つかりません: ${id}`);
  return entry;
}

/** 本文中の用語の照合表（長い文字列から先に照合する）。 */
export const GLOSSARY_ALIASES: readonly { readonly alias: string; readonly id: GlossaryId }[] = GLOSSARY.flatMap(
  (entry) => entry.aliases.map((alias) => ({ alias, id: entry.id })),
).sort((a, b) => b.alias.length - a.alias.length);
