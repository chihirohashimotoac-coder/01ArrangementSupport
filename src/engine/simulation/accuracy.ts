/**
 * プレイヤー能力（PPR）→ 着弾の散布モデル。
 *
 * ## 考え方
 *
 * First9 / Average の PPR を「T20 命中率」のような的別の確率へは変換しない。
 * PPR は **着弾が狙い点からどれだけ散らばるか（散布幅 σ, mm）** を決めるための
 * 能力パラメータとしてだけ使う。得点は最後に座標から判定する。
 *
 * ## 散布の形
 *
 * 狙い点を中心とする 2 次元正規分布に、低確率で大きく外れる成分を混ぜた
 * **混合正規分布**とする。
 *
 *   通常成分:  確率 1 - q   標準偏差 σ
 *   大ミス成分: 確率 q       標準偏差 σ × m
 *
 * 「最大ブレ」（小 / 中 / 大）は q と m だけを変える。通常成分の σ は変えない
 * ので、最大ブレを上げても「普段の精度」は変わらず、**たまに大きく外れる回数と
 * 外れ幅だけ**が増える。得点は上限のある非線形な関数なので、これでも平均 PPR は
 * 数点しか動かない（最大ブレ 大のほうがわずかに下がる）。
 *
 * ## ブレ方向
 *
 * 縦 / 横 / 均等は σx : σy の比を変える。ただし同じ σ でも、縦に広い散布は
 * トリプル帯（幅 8 mm）を外しやすく、横に広い散布はウェッジ（幅 18 度）の
 * 中に収まりやすいため、得点への影響が方向によって大きく違う。
 * そこで **σ のアンカー表を方向ごとに持つ**（下記 SIGMA_ANCHORS）。
 * 同じ設定 PPR なら、どの方向を選んでも実測 PPR がほぼ同じになる。
 */

/** ブレの主方向。 */
export type MissDirection = 'vertical' | 'horizontal' | 'even';

/** 大きなミスの出かた。 */
export type MaxMissLevel = 'small' | 'medium' | 'large';

export const MISS_DIRECTIONS: readonly MissDirection[] = ['vertical', 'horizontal', 'even'];
export const MAX_MISS_LEVELS: readonly MaxMissLevel[] = ['small', 'medium', 'large'];

/**
 * PPR の上限。501 を 9 ダーツで消化した場合の 501 / 9 × 3 = 167。
 * この値ちょうどのときだけ、狙った的へ 100% 着弾する。
 */
export const MAX_PPR = 167;

/** σx : σy の比（縦ブレ・横ブレのとき）。 */
const DIRECTION_RATIO = 2;

/** 大きなミスの出現率と倍率。 */
const MAX_MISS_PARAMS: Record<MaxMissLevel, { rate: number; scale: number }> = {
  /** 大きく外しても、おおむね隣接区画の周辺にとどまる。 */
  small: { rate: 0.04, scale: 2.0 },
  /** 低確率で隣接区画を越えるミスが出る。 */
  medium: { rate: 0.06, scale: 3.4 },
  /** 低確率でかなり大きく外れ、OUT BOARD も起こりうる。 */
  large: { rate: 0.08, scale: 5.5 },
};

/** PPR → 散布幅 σ（mm）のアンカー。 */
export interface SigmaAnchor {
  readonly ppr: number;
  readonly sigma: number;
}

/**
 * **精度一定で投げ切ったときの** ゲーム全体 PPR → 通常成分の散布幅 σ（mm）のアンカー表。
 * ブレ方向ごとに持つ。
 *
 * `npm run audit:simulation -- --solve` の逆算で求めた値。
 * 「アプリのおすすめをそのまま狙う固定戦略のプレイヤー」に 501 を大量に
 * 投げさせ、得点の場面も上がりの場面も同じ σ で、平均 PPR が目標値になる σ を二分探索している。
 * 最大ブレは中で逆算した（小 / 大との差は数点に収まることを監査で確認する）。
 *
 * 着弾モデル v2（案 2）では 1 投の σ には直接使わない。First9 の行が無いほど低い設定で
 * 上がりの σ を近似するときと、監査（精度一定のキャリブレーション）で使う。
 *
 * 直線ではなく、低 PPR 側ほど σ の増え方が急になる。
 */
export const SIGMA_ANCHORS: Readonly<Record<MissDirection, readonly SigmaAnchor[]>> = {
  vertical: [
    { ppr: 20, sigma: 40.2 },
    { ppr: 30, sigma: 27.5 },
    { ppr: 40, sigma: 20.0 },
    { ppr: 50, sigma: 15.6 },
    { ppr: 60, sigma: 12.2 },
    { ppr: 70, sigma: 9.4 },
    { ppr: 80, sigma: 7.2 },
    { ppr: 90, sigma: 5.6 },
    { ppr: 100, sigma: 4.5 },
    { ppr: 110, sigma: 3.7 },
    { ppr: 120, sigma: 3.1 },
    { ppr: 130, sigma: 2.5 },
    { ppr: 140, sigma: 2.1 },
    { ppr: 150, sigma: 1.6 },
    { ppr: 160, sigma: 1.1 },
    { ppr: MAX_PPR, sigma: 0 },
  ],
  horizontal: [
    { ppr: 20, sigma: 40.4 },
    { ppr: 30, sigma: 25.8 },
    { ppr: 40, sigma: 17.9 },
    { ppr: 50, sigma: 14.1 },
    { ppr: 60, sigma: 11.7 },
    { ppr: 70, sigma: 10.0 },
    { ppr: 80, sigma: 8.4 },
    { ppr: 90, sigma: 7.4 },
    { ppr: 100, sigma: 6.3 },
    { ppr: 110, sigma: 5.5 },
    { ppr: 120, sigma: 4.7 },
    { ppr: 130, sigma: 4.0 },
    { ppr: 140, sigma: 3.3 },
    { ppr: 150, sigma: 2.6 },
    { ppr: 160, sigma: 1.7 },
    { ppr: MAX_PPR, sigma: 0 },
  ],
  even: [
    { ppr: 20, sigma: 41.1 },
    { ppr: 30, sigma: 26.6 },
    { ppr: 40, sigma: 19.4 },
    { ppr: 50, sigma: 15.2 },
    { ppr: 60, sigma: 12.4 },
    { ppr: 70, sigma: 10.0 },
    { ppr: 80, sigma: 8.5 },
    { ppr: 90, sigma: 7.0 },
    { ppr: 100, sigma: 5.7 },
    { ppr: 110, sigma: 4.7 },
    { ppr: 120, sigma: 4.0 },
    { ppr: 130, sigma: 3.3 },
    { ppr: 140, sigma: 2.7 },
    { ppr: 150, sigma: 2.1 },
    { ppr: 160, sigma: 1.5 },
    { ppr: MAX_PPR, sigma: 0 },
  ],
};

/**
 * **First9 の** PPR → σ（mm）のアンカー表。着弾モデル v2（案 2）では「得点の場面」の σ。
 *
 * ## なぜ別表が要るのか
 *
 * 同じ σ でも、最初の 9 投の PPR とゲーム全体の PPR は一致しない。
 * 最初の 9 投は純粋な得点投げ（ダブル狙いも BUST も無い）だが、
 * ゲーム全体にはフィニッシュ狙いと BUST が入るぶん平均が下がるためで、
 * 全体用の表をそのまま使うと **First9 が設定値より 10〜15 点も高く出る**。
 *
 * そこで First9 だけは「最初の 9 投の PPR」を目標に逆算した表を使う。
 * 逆算の手順は全体用とまったく同じ（固定戦略・501・最大ブレ中・精度一定）。
 */
export const FIRST9_SIGMA_ANCHORS: Readonly<Record<MissDirection, readonly SigmaAnchor[]>> = {
  vertical: [
    { ppr: 20, sigma: 111.1 },
    { ppr: 30, sigma: 53.4 },
    { ppr: 40, sigma: 32.7 },
    { ppr: 50, sigma: 23.7 },
    { ppr: 60, sigma: 17.9 },
    { ppr: 70, sigma: 13.9 },
    { ppr: 80, sigma: 10.7 },
    { ppr: 90, sigma: 7.9 },
    { ppr: 100, sigma: 5.9 },
    { ppr: 110, sigma: 4.6 },
    { ppr: 120, sigma: 3.7 },
    { ppr: 130, sigma: 3.0 },
    { ppr: 140, sigma: 2.5 },
    { ppr: 150, sigma: 2.0 },
    { ppr: 160, sigma: 1.5 },
    { ppr: MAX_PPR, sigma: 0 },
  ],
  horizontal: [
    { ppr: 20, sigma: 96.9 },
    { ppr: 30, sigma: 57.5 },
    { ppr: 40, sigma: 29.4 },
    { ppr: 50, sigma: 18.2 },
    { ppr: 60, sigma: 14.5 },
    { ppr: 70, sigma: 12.2 },
    { ppr: 80, sigma: 10.7 },
    { ppr: 90, sigma: 9.4 },
    { ppr: 100, sigma: 8.2 },
    { ppr: 110, sigma: 7.1 },
    { ppr: 120, sigma: 6.1 },
    { ppr: 130, sigma: 5.3 },
    { ppr: 140, sigma: 4.5 },
    { ppr: 150, sigma: 3.7 },
    { ppr: 160, sigma: 2.7 },
    { ppr: MAX_PPR, sigma: 0 },
  ],
  even: [
    { ppr: 20, sigma: 111.9 },
    { ppr: 30, sigma: 60.3 },
    { ppr: 40, sigma: 30.6 },
    { ppr: 50, sigma: 20.1 },
    { ppr: 60, sigma: 16.1 },
    { ppr: 70, sigma: 13.3 },
    { ppr: 80, sigma: 11.1 },
    { ppr: 90, sigma: 9.2 },
    { ppr: 100, sigma: 7.6 },
    { ppr: 110, sigma: 6.2 },
    { ppr: 120, sigma: 5.1 },
    { ppr: 130, sigma: 4.2 },
    { ppr: 140, sigma: 3.4 },
    { ppr: 150, sigma: 2.8 },
    { ppr: 160, sigma: 2.1 },
    { ppr: MAX_PPR, sigma: 0 },
  ],
};

/** PPR の入力を 0〜167 に収める。 */
export function clampPpr(ppr: number): number {
  if (!Number.isFinite(ppr)) return 0;
  return Math.min(Math.max(ppr, 0), MAX_PPR);
}

/**
 * PPR から通常成分の散布幅 σ（mm）を求める。アンカー表の区間線形補間。
 *
 * PPR = 167 でのみ σ = 0（狙い通り 100%）になる。166 では 0 にならない。
 */
export function sigmaForPpr(ppr: number, direction: MissDirection = 'even'): number {
  return interpolate(SIGMA_ANCHORS[direction], ppr);
}

/**
 * First9 の PPR から σ（mm）を求める。表だけが違い、考え方は `sigmaForPpr` と同じ。
 */
export function sigmaForFirst9Ppr(ppr: number, direction: MissDirection = 'even'): number {
  return interpolate(FIRST9_SIGMA_ANCHORS[direction], ppr);
}

function interpolate(anchors: readonly SigmaAnchor[], ppr: number): number {
  const value = clampPpr(ppr);
  const first = anchors[0];
  if (value <= first.ppr) {
    // 最低アンカーより下は、そこから先も同じ傾きで広げる（σ は発散させない）。
    const second = anchors[1];
    const slope = (second.sigma - first.sigma) / (second.ppr - first.ppr);
    return first.sigma + (value - first.ppr) * slope;
  }
  for (let i = 1; i < anchors.length; i += 1) {
    const from = anchors[i - 1];
    const to = anchors[i];
    if (value <= to.ppr) {
      const t = (value - from.ppr) / (to.ppr - from.ppr);
      return from.sigma + t * (to.sigma - from.sigma);
    }
  }
  return 0;
}

/**
 * 上がりの場面の境界（着弾モデル v2 / 戦術 v2 の 1-9、2026-11-01 オーナー承認・案 2）。
 * 投げる前の残りがこれ以下なら「上がりの場面」、より大きければ「得点の場面」。
 */
export const FINISHING_PHASE_MAX = 170;

/**
 * First9 ごとの「上がりの場面の σ」の表（1 行）。
 *
 * 得点の場面は First9 の σ（`FIRST9_SIGMA_ANCHORS`）のまま投げ、ゲーム全体の PPR が
 * Average になる上がりの場面の σ を `npm run audit:simulation -- --solve` で逆算した値。
 */
export interface FinishingSigmaRow {
  /** First9 の PPR（`FIRST9_SIGMA_ANCHORS` と同じアンカー。最後の行は MAX_PPR）。 */
  readonly first9: number;
  /**
   * First9 の精度のまま上がりまで投げ切ったときのゲーム全体 PPR。
   * 上がりの σ を得点の σ より小さくしないので、これが Average の上限になる。
   */
  readonly cap: number;
  /** Average の PPR → 上がりの場面の σ（cap 未満のアンカーだけ）。 */
  readonly points: readonly SigmaAnchor[];
}

/** 逆算した表。値は `npm run audit:simulation -- --solve` の出力をそのまま貼る。 */
export const FINISHING_SIGMA_TABLE: Readonly<Record<MissDirection, readonly FinishingSigmaRow[]>> = {
  vertical: [
    { first9: 20, cap: 8.0, points: [] },
    { first9: 30, cap: 14.9, points: [] },
    {
      first9: 40,
      cap: 25.0,
      points: [
        { ppr: 20, sigma: 42.6 },
      ],
    },
    {
      first9: 50,
      cap: 34.1,
      points: [
        { ppr: 20, sigma: 45.9 },
        { ppr: 30, sigma: 29.2 },
      ],
    },
    {
      first9: 60,
      cap: 43.8,
      points: [
        { ppr: 20, sigma: 47.3 },
        { ppr: 30, sigma: 32.4 },
        { ppr: 40, sigma: 21.3 },
      ],
    },
    {
      first9: 70,
      cap: 54.1,
      points: [
        { ppr: 20, sigma: 49.6 },
        { ppr: 30, sigma: 33.6 },
        { ppr: 40, sigma: 23.0 },
        { ppr: 50, sigma: 16.6 },
      ],
    },
    {
      first9: 80,
      cap: 64.5,
      points: [
        { ppr: 20, sigma: 49.8 },
        { ppr: 30, sigma: 35.1 },
        { ppr: 40, sigma: 25.6 },
        { ppr: 50, sigma: 18.5 },
        { ppr: 60, sigma: 13.1 },
      ],
    },
    {
      first9: 90,
      cap: 76.6,
      points: [
        { ppr: 20, sigma: 51.3 },
        { ppr: 30, sigma: 36.3 },
        { ppr: 40, sigma: 26.9 },
        { ppr: 50, sigma: 20.4 },
        { ppr: 60, sigma: 15.4 },
        { ppr: 70, sigma: 10.7 },
      ],
    },
    {
      first9: 100,
      cap: 88.0,
      points: [
        { ppr: 20, sigma: 51.2 },
        { ppr: 30, sigma: 37.1 },
        { ppr: 40, sigma: 28.2 },
        { ppr: 50, sigma: 21.5 },
        { ppr: 60, sigma: 16.4 },
        { ppr: 70, sigma: 12.1 },
        { ppr: 80, sigma: 8.4 },
      ],
    },
    {
      first9: 110,
      cap: 99.4,
      points: [
        { ppr: 20, sigma: 52.7 },
        { ppr: 30, sigma: 37.2 },
        { ppr: 40, sigma: 28.6 },
        { ppr: 50, sigma: 22.7 },
        { ppr: 60, sigma: 18.0 },
        { ppr: 70, sigma: 13.4 },
        { ppr: 80, sigma: 9.8 },
        { ppr: 90, sigma: 6.8 },
      ],
    },
    {
      first9: 120,
      cap: 109.8,
      points: [
        { ppr: 20, sigma: 51.1 },
        { ppr: 30, sigma: 38.4 },
        { ppr: 40, sigma: 29.0 },
        { ppr: 50, sigma: 23.0 },
        { ppr: 60, sigma: 18.5 },
        { ppr: 70, sigma: 14.8 },
        { ppr: 80, sigma: 11.0 },
        { ppr: 90, sigma: 7.9 },
        { ppr: 100, sigma: 5.5 },
      ],
    },
    {
      first9: 130,
      cap: 121.3,
      points: [
        { ppr: 20, sigma: 53.0 },
        { ppr: 30, sigma: 40.3 },
        { ppr: 40, sigma: 30.0 },
        { ppr: 50, sigma: 24.2 },
        { ppr: 60, sigma: 19.4 },
        { ppr: 70, sigma: 15.6 },
        { ppr: 80, sigma: 11.9 },
        { ppr: 90, sigma: 9.2 },
        { ppr: 100, sigma: 6.6 },
        { ppr: 110, sigma: 4.8 },
        { ppr: 120, sigma: 3.2 },
      ],
    },
    {
      first9: 140,
      cap: 130.1,
      points: [
        { ppr: 20, sigma: 54.6 },
        { ppr: 30, sigma: 38.9 },
        { ppr: 40, sigma: 30.5 },
        { ppr: 50, sigma: 24.6 },
        { ppr: 60, sigma: 20.1 },
        { ppr: 70, sigma: 16.4 },
        { ppr: 80, sigma: 12.5 },
        { ppr: 90, sigma: 9.8 },
        { ppr: 100, sigma: 7.4 },
        { ppr: 110, sigma: 5.7 },
        { ppr: 120, sigma: 4.0 },
      ],
    },
    {
      first9: 150,
      cap: 141.0,
      points: [
        { ppr: 20, sigma: 54.9 },
        { ppr: 30, sigma: 40.0 },
        { ppr: 40, sigma: 31.8 },
        { ppr: 50, sigma: 25.7 },
        { ppr: 60, sigma: 20.6 },
        { ppr: 70, sigma: 16.6 },
        { ppr: 80, sigma: 13.7 },
        { ppr: 90, sigma: 10.6 },
        { ppr: 100, sigma: 8.5 },
        { ppr: 110, sigma: 6.6 },
        { ppr: 120, sigma: 5.1 },
        { ppr: 130, sigma: 3.5 },
      ],
    },
    {
      first9: 160,
      cap: 152.9,
      points: [
        { ppr: 20, sigma: 55.0 },
        { ppr: 30, sigma: 40.0 },
        { ppr: 40, sigma: 32.0 },
        { ppr: 50, sigma: 26.1 },
        { ppr: 60, sigma: 21.6 },
        { ppr: 70, sigma: 17.4 },
        { ppr: 80, sigma: 14.6 },
        { ppr: 90, sigma: 11.8 },
        { ppr: 100, sigma: 9.3 },
        { ppr: 110, sigma: 7.5 },
        { ppr: 120, sigma: 5.9 },
        { ppr: 130, sigma: 4.4 },
        { ppr: 140, sigma: 3.1 },
        { ppr: 150, sigma: 1.9 },
      ],
    },
    {
      first9: MAX_PPR,
      cap: 167.0,
      points: [
        { ppr: 20, sigma: 54.4 },
        { ppr: 30, sigma: 40.9 },
        { ppr: 40, sigma: 31.2 },
        { ppr: 50, sigma: 26.2 },
        { ppr: 60, sigma: 21.4 },
        { ppr: 70, sigma: 17.7 },
        { ppr: 80, sigma: 14.4 },
        { ppr: 90, sigma: 11.9 },
        { ppr: 100, sigma: 9.6 },
        { ppr: 110, sigma: 8.0 },
        { ppr: 120, sigma: 6.4 },
        { ppr: 130, sigma: 4.9 },
        { ppr: 140, sigma: 3.7 },
        { ppr: 150, sigma: 2.6 },
        { ppr: 160, sigma: 1.6 },
      ],
    },
  ],
  horizontal: [
    { first9: 20, cap: 8.3, points: [] },
    { first9: 30, cap: 13.7, points: [] },
    {
      first9: 40,
      cap: 27.2,
      points: [
        { ppr: 20, sigma: 43.1 },
      ],
    },
    {
      first9: 50,
      cap: 39.7,
      points: [
        { ppr: 20, sigma: 45.8 },
        { ppr: 30, sigma: 27.6 },
      ],
    },
    {
      first9: 60,
      cap: 49.0,
      points: [
        { ppr: 20, sigma: 47.5 },
        { ppr: 30, sigma: 31.7 },
        { ppr: 40, sigma: 21.3 },
      ],
    },
    {
      first9: 70,
      cap: 57.1,
      points: [
        { ppr: 20, sigma: 49.5 },
        { ppr: 30, sigma: 34.3 },
        { ppr: 40, sigma: 23.2 },
        { ppr: 50, sigma: 16.3 },
      ],
    },
    {
      first9: 80,
      cap: 65.6,
      points: [
        { ppr: 20, sigma: 50.4 },
        { ppr: 30, sigma: 35.0 },
        { ppr: 40, sigma: 25.1 },
        { ppr: 50, sigma: 18.3 },
        { ppr: 60, sigma: 12.8 },
      ],
    },
    {
      first9: 90,
      cap: 73.1,
      points: [
        { ppr: 20, sigma: 50.6 },
        { ppr: 30, sigma: 35.9 },
        { ppr: 40, sigma: 26.3 },
        { ppr: 50, sigma: 19.9 },
        { ppr: 60, sigma: 15.3 },
        { ppr: 70, sigma: 10.4 },
      ],
    },
    {
      first9: 100,
      cap: 81.7,
      points: [
        { ppr: 20, sigma: 50.9 },
        { ppr: 30, sigma: 36.2 },
        { ppr: 40, sigma: 27.7 },
        { ppr: 50, sigma: 21.3 },
        { ppr: 60, sigma: 16.3 },
        { ppr: 70, sigma: 12.3 },
        { ppr: 80, sigma: 8.8 },
      ],
    },
    {
      first9: 110,
      cap: 91.8,
      points: [
        { ppr: 20, sigma: 52.0 },
        { ppr: 30, sigma: 37.3 },
        { ppr: 40, sigma: 28.2 },
        { ppr: 50, sigma: 21.8 },
        { ppr: 60, sigma: 17.4 },
        { ppr: 70, sigma: 13.1 },
        { ppr: 80, sigma: 10.3 },
        { ppr: 90, sigma: 7.5 },
      ],
    },
    {
      first9: 120,
      cap: 102.5,
      points: [
        { ppr: 20, sigma: 53.7 },
        { ppr: 30, sigma: 37.9 },
        { ppr: 40, sigma: 29.2 },
        { ppr: 50, sigma: 22.4 },
        { ppr: 60, sigma: 18.0 },
        { ppr: 70, sigma: 14.2 },
        { ppr: 80, sigma: 11.3 },
        { ppr: 90, sigma: 8.8 },
        { ppr: 100, sigma: 6.7 },
      ],
    },
    {
      first9: 130,
      cap: 111.4,
      points: [
        { ppr: 20, sigma: 53.8 },
        { ppr: 30, sigma: 38.2 },
        { ppr: 40, sigma: 29.5 },
        { ppr: 50, sigma: 24.1 },
        { ppr: 60, sigma: 18.9 },
        { ppr: 70, sigma: 14.9 },
        { ppr: 80, sigma: 12.0 },
        { ppr: 90, sigma: 9.8 },
        { ppr: 100, sigma: 7.7 },
        { ppr: 110, sigma: 5.6 },
      ],
    },
    {
      first9: 140,
      cap: 122.8,
      points: [
        { ppr: 20, sigma: 54.7 },
        { ppr: 30, sigma: 38.9 },
        { ppr: 40, sigma: 30.4 },
        { ppr: 50, sigma: 24.2 },
        { ppr: 60, sigma: 19.7 },
        { ppr: 70, sigma: 16.3 },
        { ppr: 80, sigma: 13.0 },
        { ppr: 90, sigma: 10.5 },
        { ppr: 100, sigma: 8.5 },
        { ppr: 110, sigma: 6.7 },
        { ppr: 120, sigma: 4.9 },
      ],
    },
    {
      first9: 150,
      cap: 133.9,
      points: [
        { ppr: 20, sigma: 54.5 },
        { ppr: 30, sigma: 39.5 },
        { ppr: 40, sigma: 31.1 },
        { ppr: 50, sigma: 25.3 },
        { ppr: 60, sigma: 20.5 },
        { ppr: 70, sigma: 16.9 },
        { ppr: 80, sigma: 13.9 },
        { ppr: 90, sigma: 11.3 },
        { ppr: 100, sigma: 9.1 },
        { ppr: 110, sigma: 7.4 },
        { ppr: 120, sigma: 5.7 },
        { ppr: 130, sigma: 4.2 },
      ],
    },
    {
      first9: 160,
      cap: 148.2,
      points: [
        { ppr: 20, sigma: 54.2 },
        { ppr: 30, sigma: 40.5 },
        { ppr: 40, sigma: 31.5 },
        { ppr: 50, sigma: 25.5 },
        { ppr: 60, sigma: 20.7 },
        { ppr: 70, sigma: 17.5 },
        { ppr: 80, sigma: 14.4 },
        { ppr: 90, sigma: 11.6 },
        { ppr: 100, sigma: 9.9 },
        { ppr: 110, sigma: 8.1 },
        { ppr: 120, sigma: 6.5 },
        { ppr: 130, sigma: 5.0 },
        { ppr: 140, sigma: 3.7 },
      ],
    },
    {
      first9: MAX_PPR,
      cap: 167.0,
      points: [
        { ppr: 20, sigma: 54.3 },
        { ppr: 30, sigma: 40.7 },
        { ppr: 40, sigma: 31.4 },
        { ppr: 50, sigma: 25.6 },
        { ppr: 60, sigma: 21.0 },
        { ppr: 70, sigma: 17.2 },
        { ppr: 80, sigma: 14.5 },
        { ppr: 90, sigma: 12.3 },
        { ppr: 100, sigma: 10.5 },
        { ppr: 110, sigma: 8.6 },
        { ppr: 120, sigma: 7.1 },
        { ppr: 130, sigma: 5.8 },
        { ppr: 140, sigma: 4.5 },
        { ppr: 150, sigma: 3.4 },
        { ppr: 160, sigma: 2.2 },
      ],
    },
  ],
  even: [
    { first9: 20, cap: 7.8, points: [] },
    { first9: 30, cap: 13.3, points: [] },
    {
      first9: 40,
      cap: 26.5,
      points: [
        { ppr: 20, sigma: 43.2 },
      ],
    },
    {
      first9: 50,
      cap: 38.2,
      points: [
        { ppr: 20, sigma: 47.3 },
        { ppr: 30, sigma: 29.4 },
      ],
    },
    {
      first9: 60,
      cap: 47.1,
      points: [
        { ppr: 20, sigma: 49.1 },
        { ppr: 30, sigma: 31.8 },
        { ppr: 40, sigma: 21.8 },
      ],
    },
    {
      first9: 70,
      cap: 56.3,
      points: [
        { ppr: 20, sigma: 50.2 },
        { ppr: 30, sigma: 34.4 },
        { ppr: 40, sigma: 23.6 },
        { ppr: 50, sigma: 17.2 },
      ],
    },
    {
      first9: 80,
      cap: 65.1,
      points: [
        { ppr: 20, sigma: 50.7 },
        { ppr: 30, sigma: 35.1 },
        { ppr: 40, sigma: 25.6 },
        { ppr: 50, sigma: 19.1 },
        { ppr: 60, sigma: 13.6 },
      ],
    },
    {
      first9: 90,
      cap: 75.5,
      points: [
        { ppr: 20, sigma: 51.7 },
        { ppr: 30, sigma: 37.4 },
        { ppr: 40, sigma: 27.5 },
        { ppr: 50, sigma: 20.7 },
        { ppr: 60, sigma: 15.3 },
        { ppr: 70, sigma: 10.9 },
      ],
    },
    {
      first9: 100,
      cap: 85.2,
      points: [
        { ppr: 20, sigma: 53.1 },
        { ppr: 30, sigma: 37.2 },
        { ppr: 40, sigma: 28.1 },
        { ppr: 50, sigma: 21.8 },
        { ppr: 60, sigma: 16.9 },
        { ppr: 70, sigma: 12.6 },
        { ppr: 80, sigma: 9.2 },
      ],
    },
    {
      first9: 110,
      cap: 95.6,
      points: [
        { ppr: 20, sigma: 53.7 },
        { ppr: 30, sigma: 37.3 },
        { ppr: 40, sigma: 29.4 },
        { ppr: 50, sigma: 22.7 },
        { ppr: 60, sigma: 18.3 },
        { ppr: 70, sigma: 14.1 },
        { ppr: 80, sigma: 10.7 },
        { ppr: 90, sigma: 7.7 },
      ],
    },
    {
      first9: 120,
      cap: 106.0,
      points: [
        { ppr: 20, sigma: 54.5 },
        { ppr: 30, sigma: 39.9 },
        { ppr: 40, sigma: 29.5 },
        { ppr: 50, sigma: 23.4 },
        { ppr: 60, sigma: 19.0 },
        { ppr: 70, sigma: 15.0 },
        { ppr: 80, sigma: 11.7 },
        { ppr: 90, sigma: 8.7 },
        { ppr: 100, sigma: 6.5 },
      ],
    },
    {
      first9: 130,
      cap: 117.2,
      points: [
        { ppr: 20, sigma: 54.5 },
        { ppr: 30, sigma: 40.2 },
        { ppr: 40, sigma: 29.9 },
        { ppr: 50, sigma: 23.9 },
        { ppr: 60, sigma: 19.7 },
        { ppr: 70, sigma: 16.0 },
        { ppr: 80, sigma: 12.6 },
        { ppr: 90, sigma: 9.8 },
        { ppr: 100, sigma: 7.4 },
        { ppr: 110, sigma: 5.5 },
      ],
    },
    {
      first9: 140,
      cap: 127.9,
      points: [
        { ppr: 20, sigma: 53.9 },
        { ppr: 30, sigma: 40.5 },
        { ppr: 40, sigma: 30.9 },
        { ppr: 50, sigma: 24.5 },
        { ppr: 60, sigma: 20.1 },
        { ppr: 70, sigma: 16.8 },
        { ppr: 80, sigma: 14.0 },
        { ppr: 90, sigma: 10.8 },
        { ppr: 100, sigma: 8.6 },
        { ppr: 110, sigma: 6.5 },
        { ppr: 120, sigma: 4.7 },
      ],
    },
    {
      first9: 150,
      cap: 138.0,
      points: [
        { ppr: 20, sigma: 53.6 },
        { ppr: 30, sigma: 40.5 },
        { ppr: 40, sigma: 31.3 },
        { ppr: 50, sigma: 26.4 },
        { ppr: 60, sigma: 20.6 },
        { ppr: 70, sigma: 17.4 },
        { ppr: 80, sigma: 14.5 },
        { ppr: 90, sigma: 11.8 },
        { ppr: 100, sigma: 9.6 },
        { ppr: 110, sigma: 7.5 },
        { ppr: 120, sigma: 5.6 },
        { ppr: 130, sigma: 4.1 },
      ],
    },
    {
      first9: 160,
      cap: 150.9,
      points: [
        { ppr: 20, sigma: 55.8 },
        { ppr: 30, sigma: 40.4 },
        { ppr: 40, sigma: 32.8 },
        { ppr: 50, sigma: 26.7 },
        { ppr: 60, sigma: 21.8 },
        { ppr: 70, sigma: 17.9 },
        { ppr: 80, sigma: 15.1 },
        { ppr: 90, sigma: 12.7 },
        { ppr: 100, sigma: 10.5 },
        { ppr: 110, sigma: 8.3 },
        { ppr: 120, sigma: 6.5 },
        { ppr: 130, sigma: 4.8 },
        { ppr: 140, sigma: 3.6 },
      ],
    },
    {
      first9: MAX_PPR,
      cap: 167.0,
      points: [
        { ppr: 20, sigma: 54.9 },
        { ppr: 30, sigma: 41.6 },
        { ppr: 40, sigma: 31.2 },
        { ppr: 50, sigma: 27.0 },
        { ppr: 60, sigma: 22.0 },
        { ppr: 70, sigma: 18.4 },
        { ppr: 80, sigma: 15.5 },
        { ppr: 90, sigma: 12.8 },
        { ppr: 100, sigma: 10.4 },
        { ppr: 110, sigma: 8.7 },
        { ppr: 120, sigma: 7.0 },
        { ppr: 130, sigma: 5.6 },
        { ppr: 140, sigma: 4.3 },
        { ppr: 150, sigma: 3.2 },
        { ppr: 160, sigma: 2.0 },
      ],
    },
  ],
};

/** 得点の場面の σ（mm）。First9 の表から求める。 */
export function scoringSigma(first9Ppr: number, direction: MissDirection = 'even'): number {
  return sigmaForFirst9Ppr(first9Ppr, direction);
}

/** First9 の行を挟む 2 行と、その間の位置（0〜1）。 */
function bracketRows(
  rows: readonly FinishingSigmaRow[],
  first9: number,
): { readonly lower: FinishingSigmaRow; readonly upper: FinishingSigmaRow; readonly t: number } {
  if (first9 <= rows[0].first9) return { lower: rows[0], upper: rows[0], t: 0 };
  for (let i = 1; i < rows.length; i += 1) {
    if (first9 <= rows[i].first9) {
      const lower = rows[i - 1];
      const upper = rows[i];
      return { lower, upper, t: (first9 - lower.first9) / (upper.first9 - lower.first9) };
    }
  }
  const last = rows[rows.length - 1];
  return { lower: last, upper: last, t: 0 };
}

/**
 * Average の上限（mm ではなく PPR）。First9 の精度のまま投げ切ったときのゲーム全体 PPR。
 *
 * 上がりの場面の精度を得点の場面より高くしない（案 2）ので、これより高い Average は作れない。
 */
export function averageCapFor(first9Ppr: number, direction: MissDirection = 'even'): number {
  const first9 = clampPpr(first9Ppr);
  const rows = FINISHING_SIGMA_TABLE[direction];
  if (rows.length === 0) return MAX_PPR;
  if (first9 < rows[0].first9) return (rows[0].cap * first9) / rows[0].first9;
  const { lower, upper, t } = bracketRows(rows, first9);
  return lower.cap + (upper.cap - lower.cap) * t;
}

/** 実際に使う Average（上限を超える設定は上限に丸める）。 */
export function effectiveAveragePpr(
  first9Ppr: number,
  averagePpr: number,
  direction: MissDirection = 'even',
): number {
  return Math.min(clampPpr(averagePpr), averageCapFor(first9Ppr, direction));
}

/** その Average の設定が上限に丸められるか（画面で理由を出すため）。 */
export function isAverageCapped(
  first9Ppr: number,
  averagePpr: number,
  direction: MissDirection = 'even',
): boolean {
  return clampPpr(averagePpr) > averageCapFor(first9Ppr, direction) + 1e-9;
}

/** 1 行の中で、Average → 上がりの場面の σ。 */
function rowFinishingSigma(row: FinishingSigmaRow, average: number, direction: MissDirection): number {
  const rowScoring = row.first9 >= MAX_PPR ? 0 : scoringSigma(row.first9, direction);
  if (average >= row.cap) return rowScoring;
  const anchors = [...row.points, { ppr: row.cap, sigma: rowScoring }];
  // 低い First9 では cap が最低アンカーより下になり、表に点が無い。精度一定の表で近似する。
  if (anchors.length < 2) return Math.max(rowScoring, sigmaForPpr(average, direction));
  return Math.max(rowScoring, interpolate(anchors, average));
}

/**
 * 上がりの場面（投げる前の残りが 170 以下）の σ（mm）。
 *
 * First9 の行のあいだは線形に補間し、**得点の場面の σ より小さくしない**。
 * Average は上限（`averageCapFor`）に丸めてから使う。
 */
export function finishingSigma(
  first9Ppr: number,
  averagePpr: number,
  direction: MissDirection = 'even',
): number {
  const first9 = clampPpr(first9Ppr);
  const own = first9 >= MAX_PPR ? 0 : scoringSigma(first9, direction);
  const rows = FINISHING_SIGMA_TABLE[direction];
  const average = effectiveAveragePpr(first9, averagePpr, direction);
  if (rows.length === 0) return Math.max(own, sigmaForPpr(average, direction));
  const { lower, upper, t } = bracketRows(rows, first9);
  const blended =
    rowFinishingSigma(lower, average, direction) * (1 - t) +
    rowFinishingSigma(upper, average, direction) * t;
  return Math.max(own, blended);
}

/**
 * 1 投に使う σ（mm）。場面で分ける（着弾モデル v2 / 案 2）。
 *
 * - 得点の場面（投げる前の残りが 171 以上）: First9 の σ
 * - 上がりの場面（170 以下）: ゲーム全体の平均が Average になる σ（得点の σ 以上）
 *
 * 以前は投数で分けていた（1〜9 投目は First9、10 投目から 6 投かけて Average へ移る）。
 * その作りでは Average の表が上がりの場面を含むゲーム全体から逆算されていたため、
 * 上がりの場面ほど精度が高くなっていた（docs/SIMULATION_DESIGN.md 付録 A）。
 * First9 も Average も 167 のときだけ、狙った的へ 100% 入る。
 */
export function sigmaForThrow(
  first9Ppr: number,
  averagePpr: number,
  leftBefore: number,
  direction: MissDirection = 'even',
): number {
  if (leftBefore > FINISHING_PHASE_MAX) {
    return clampPpr(first9Ppr) >= MAX_PPR ? 0 : scoringSigma(first9Ppr, direction);
  }
  return finishingSigma(first9Ppr, averagePpr, direction);
}

/** 1 投ぶんの散布パラメータ。 */
export interface ScatterProfile {
  /** 通常成分の横方向標準偏差（mm）。 */
  readonly sigmaX: number;
  /** 通常成分の縦方向標準偏差（mm）。 */
  readonly sigmaY: number;
  /** 大ミス成分が出る確率。 */
  readonly outlierRate: number;
  /** 大ミス成分の倍率。 */
  readonly outlierScale: number;
}

/**
 * σ（通常成分）・ブレ方向・最大ブレから、1 投ぶんの散布パラメータを作る。
 *
 * 散布の面積（σx·σy）は方向によらず一定に保ち、比だけを変える。
 * 「同じ σ でも縦ブレのほうが得点が落ちる」ぶんは、方向ごとの
 * アンカー表（`SIGMA_ANCHORS`）側で吸収している。
 */
export function scatterProfile(
  sigma: number,
  direction: MissDirection,
  maxMiss: MaxMissLevel,
): ScatterProfile {
  const { rate, scale } = MAX_MISS_PARAMS[maxMiss];
  if (sigma <= 0) {
    return { sigmaX: 0, sigmaY: 0, outlierRate: rate, outlierScale: scale };
  }

  const k = Math.sqrt(DIRECTION_RATIO);
  switch (direction) {
    case 'vertical':
      return { sigmaX: sigma / k, sigmaY: sigma * k, outlierRate: rate, outlierScale: scale };
    case 'horizontal':
      return { sigmaX: sigma * k, sigmaY: sigma / k, outlierRate: rate, outlierScale: scale };
    case 'even':
      return { sigmaX: sigma, sigmaY: sigma, outlierRate: rate, outlierScale: scale };
  }
}
