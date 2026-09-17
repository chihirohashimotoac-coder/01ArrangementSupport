/**
 * SIMULATION の設定説明（初見のユーザー向け）。
 *
 * 設定項目そのものの意味と、「何を基準に選ぶか」を 1 か所に集める。
 * 画面（`SimulationPage`）は、ここの内容を折りたたみで出すだけにする。
 *
 * ## 数値の出どころ
 *
 * - PPR の目安投数は **定義から計算**している（`dartsFor501`）。
 *   PPR は 3 ダーツ平均なので、501 を消化する投数は 501 ÷ PPR × 3。
 *   モデルの実測（`npm run audit:simulation`）ともおおむね一致する
 *   （例: Average 60 は実測・計算ともに約 25 投）。
 * - 「最大ブレ」の外れ方は `accuracy.ts` の混合正規分布の設定そのもの
 *   （大ミスの確率と倍率）で、盤外率は `npm run audit:simulation` の実測。
 * - どちらも**戦術データではない**（`docs/APPROVALS.md` の承認対象ではない）。
 */
import { BOARD_NUMBERS } from '../../domain/boardNumbers';
import { MAX_PPR, type MaxMissLevel, type MissDirection } from './accuracy';

/** 501 の点数。目安投数の計算に使う。 */
const REFERENCE_START_SCORE = 501;

/**
 * その PPR で 501 を上がるのにかかる、おおよその投数。
 *
 * PPR（Points Per Round）は 3 ダーツ平均なので、
 * 501 ÷ PPR × 3 がそのまま投数になる。
 */
export function dartsFor501(ppr: number): number {
  if (ppr <= 0) return Number.POSITIVE_INFINITY;
  return (REFERENCE_START_SCORE / ppr) * 3;
}

export interface PprGuideRow {
  readonly ppr: number;
  /** 501 を上がるまでのおおよその投数（四捨五入）。 */
  readonly darts: number;
}

/**
 * 「ふだん 501 が何投で終わるか」から PPR を選ぶための目安。
 *
 * 自己申告のレーティングではなく、**自分で数えられる事実**を基準にする。
 */
export const PPR_GUIDE_ROWS: readonly PprGuideRow[] = [40, 60, 80, 100, 120].map((ppr) => ({
  ppr,
  darts: Math.round(dartsFor501(ppr)),
}));

export const FIRST9_HELP_JA = {
  title: 'FIRST 9 PPR',
  meaning:
    '開始から 9 投までの精度に影響します。高いほど、序盤の着弾が狙いに近づきます。',
  detail:
    '10 投目から 15 投目にかけて AVERAGE の精度へ徐々に移ります。序盤だけ強い人・' +
    '終盤に崩れない人など、自分の形に近づけるための設定です。',
} as const;

export const AVERAGE_HELP_JA = {
  title: 'AVERAGE PPR',
  meaning:
    'ゲーム全体の精度に影響します。高いほど、全体的に狙いへ集まりやすくなります。',
  detail:
    `${MAX_PPR} のときだけ、狙った的へ 100% 入ります（501 を 9 投で上がる値）。` +
    `${MAX_PPR - 1} ではもう完全一致にはなりません。FIRST 9 だけ ${MAX_PPR} にしても、` +
    '10 投目からは AVERAGE の精度へ戻ります。',
} as const;

/** 「ブレ方向」を選ぶときの説明。 */
export interface DirectionGuide {
  readonly value: MissDirection;
  readonly label: string;
  /** ボタンに出す短い説明。 */
  readonly hint: string;
  /** 折りたたみに出す、意味と選び方。 */
  readonly detail: string;
}

/** 20 の 2 つ隣（大きな横ブレの行き先）。盤面の並びから求める。 */
function neighborNumbers(target: number, distance: number): readonly number[] {
  const index = BOARD_NUMBERS.indexOf(target as (typeof BOARD_NUMBERS)[number]);
  if (index < 0) return [];
  const size = BOARD_NUMBERS.length;
  return [
    BOARD_NUMBERS[(index - distance + size) % size],
    BOARD_NUMBERS[(index + distance + size) % size],
  ];
}

/** 時計の文字盤で `hour` 時の方向にあるナンバー（20 が 12 時）。 */
function sideNumberAt(hour: number): number {
  const index = Math.round((hour / 12) * BOARD_NUMBERS.length) % BOARD_NUMBERS.length;
  return BOARD_NUMBERS[index];
}

const NEIGHBORS_OF_20 = neighborNumbers(20, 1);
const TWO_AWAY_FROM_20 = neighborNumbers(20, 2);

/**
 * 盤面の左右（3 時 / 9 時方向）付近にあるナンバーの例。
 *
 * 散布は**盤面に固定した XY 軸**へかかる（`scatterProfile` は狙いの向きで
 * 回転しない）。そのため「縦ブレ＝同じナンバー内・横ブレ＝隣のナンバー」が
 * 成り立つのは、20 や 3 のように盤面の上下にあるナンバーを狙うときで、
 * 左右にあるナンバーでは向きが入れ替わる。説明文でその例として使う。
 */
const SIDE_NUMBER_EXAMPLES = [sideNumberAt(3), sideNumberAt(9)] as const;

export const DIRECTION_GUIDE: readonly DirectionGuide[] = [
  {
    value: 'vertical',
    label: '縦ブレ',
    hint: '上下に散りやすい',
    detail:
      '着弾が盤面の上下方向へ散ります。20 や 3 のように盤面の上下にあるナンバーでは、' +
      '同じナンバーの中でトリプル帯（幅 8 mm）を上下に外しやすくなり、' +
      `シングルへ落ちる回数が増えます（${SIDE_NUMBER_EXAMPLES.join(' や ')} のように` +
      '盤面の左右にあるナンバーでは、逆に隣のナンバーへ流れる向きになります）。',
  },
  {
    value: 'horizontal',
    label: '横ブレ',
    hint: '左右に散りやすい',
    detail:
      '着弾が盤面の左右方向へ散ります。20 を狙うと ' +
      `${NEIGHBORS_OF_20.join(' や ')} など隣のナンバーへ流れやすくなります` +
      `（${SIDE_NUMBER_EXAMPLES.join(' や ')} のように盤面の左右にあるナンバーでは、` +
      '逆に同じナンバーの中で内外へ外れる向きになります）。',
  },
  {
    value: 'even',
    label: '均等',
    hint: '方向のかたよりなし',
    detail: '縦横のかたよりなく外れます。どちらとも言えないときは、これを選んでください。',
  },
];

export const DIRECTION_CRITERION_JA =
  '自分の外し方で選びます。散布は盤面に対する上下・左右で決まるので、' +
  'グルーピングが盤面のどちら向きに伸びるかで選んでください' +
  '（狙いに対する内外ではありません）。' +
  '同じ PPR ならどの方向でも平均点はほぼ変わらず、外れ方だけが変わります。';

/** 「最大ブレ」を選ぶときの説明。 */
export interface MaxMissGuide {
  readonly value: MaxMissLevel;
  readonly label: string;
  /** ボタンに出す短い説明。 */
  readonly hint: string;
  /** 折りたたみに出す、意味と選び方。 */
  readonly detail: string;
}

export const MAX_MISS_GUIDE: readonly MaxMissGuide[] = [
  {
    value: 'small',
    label: '小',
    hint: '大きく外しても隣の区画あたり',
    detail:
      '大きく外しても、主に隣接エリアにとどまります。盤外はほとんど出ません' +
      '（AVERAGE 60 で 0.1% 未満）。',
  },
  {
    value: 'medium',
    label: '中',
    hint: 'たまに隣のナンバーを越える',
    detail:
      'たまに大きく外れ、隣のナンバーを越えることがあります' +
      '（AVERAGE 60 で盤外 0.5% 前後）。',
  },
  {
    value: 'large',
    label: '大',
    hint: 'まれに大きく外し、盤外もある',
    detail:
      `低確率で、20 の 2 つ隣（${TWO_AWAY_FROM_20.join(' / ')} 方面）や OUT BOARD 級まで飛びます` +
      '（AVERAGE 60 で盤外 2% 前後）。',
  },
];

export const MAX_MISS_CRITERION_JA =
  '自分がひどく外したとき、どこまで飛ぶかを基準に選びます。' +
  'ふだんの精度（PPR）は変えず、大きく外す回数と外れ幅だけが変わります。';

export const SETTINGS_HELP_SUMMARY_JA = 'この設定の意味と選び方';
