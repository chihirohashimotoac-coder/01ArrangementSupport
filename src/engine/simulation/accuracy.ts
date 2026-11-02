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
 * 投げさせ、ゲームを通して同じ σ で、平均 PPR が目標値になる σ を二分探索している。
 * 最大ブレは中で逆算した（小 / 大との差は数点に収まることを監査で確認する）。
 *
 * 着弾モデル v3（案 3'）では 1 投の σ には直接使わない。後半の σ の表に点が無いほど低い設定で
 * 後半の σ を近似するときと、監査（精度一定のキャリブレーション）で使う。
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
 * **First9 の** PPR → σ（mm）のアンカー表。1〜9 投目の σ（着弾モデル v3 / 案 3'）。
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
 * 着弾モデル v3（2026-11-02 オーナー承認・案 3'。docs/APPROVALS.md A-33 / v2.2）。
 *
 * - 1〜9 投目: FIRST 9 の σ（`FIRST9_SIGMA_ANCHORS`）。FIRST 9 は文字どおり「最初の 9 投」の精度。
 * - 10 投目以降: `TRANSITION_DARTS` 投かけて「後半の σ」へなめらかに移る。
 * - 後半の σ は、ゲーム全体の平均がちょうど AVERAGE になるように逆算した値（`LATE_SIGMA_TABLE`）。
 *
 * 序盤の着弾を見て狙いを調整する人・数ラウンドでフォームやテンポが安定する人・序盤に緊張する人は、
 * FIRST 9 が AVERAGE より低く（あるいは近く）なる。後半の精度が序盤より高くなるのはそのまま認め、
 * 上限での丸めも画面のお知らせもしない。
 * 後半を狙いどおり（σ = 0）にしても届かない AVERAGE（例: FIRST 9 20 / AVERAGE 150）だけは、
 * 届く上限（`averageCapFor`）として投げる。
 *
 * 案 2（残り 171 以上 / 170 以下の場面で分け、上がりの σ を得点の σ より小さくしない）は、
 * FIRST 9 60 / AVERAGE 60 のような実在するユーザーを上限で丸めてしまうため置き換えた。
 */
export const TRANSITION_DARTS = 6;

/** FIRST 9 ごとの「後半の σ」の表（1 行）。`npm run audit:simulation -- --solve` の逆算値。 */
export interface LateSigmaRow {
  /**
   * First9 の PPR（`FIRST9_SIGMA_ANCHORS` と同じアンカー、20〜160）。First9 167 の行は持たない
   * （最初の 9 投で必ず上がるので、後半の σ が効かない）。160 を超える First9 は 160 の行を使う。
   */
  readonly first9: number;
  /** 後半を狙いどおり（σ = 0）にしたときのゲーム全体 PPR。AVERAGE はこれより高くできない。 */
  readonly cap: number;
  /** AVERAGE の PPR → 後半の σ（cap 未満のアンカーだけ）。 */
  readonly points: readonly SigmaAnchor[];
}

/** 逆算した表。値は `npm run audit:simulation -- --solve` の出力をそのまま貼る。 */
export const LATE_SIGMA_TABLE: Readonly<Record<MissDirection, readonly LateSigmaRow[]>> = {
  vertical: [
    {
      first9: 20,
      cap: 70.8,
      points: [
        { ppr: 20, sigma: 37.2 },
        { ppr: 30, sigma: 22.8 },
        { ppr: 40, sigma: 14.1 },
        { ppr: 50, sigma: 8.0 },
        { ppr: 60, sigma: 3.8 },
      ],
    },
    {
      first9: 30,
      cap: 74.1,
      points: [
        { ppr: 20, sigma: 38.7 },
        { ppr: 30, sigma: 24.2 },
        { ppr: 40, sigma: 15.9 },
        { ppr: 50, sigma: 9.7 },
        { ppr: 60, sigma: 5.0 },
        { ppr: 70, sigma: 2.1 },
      ],
    },
    {
      first9: 40,
      cap: 78.0,
      points: [
        { ppr: 20, sigma: 40.5 },
        { ppr: 30, sigma: 26.6 },
        { ppr: 40, sigma: 17.5 },
        { ppr: 50, sigma: 11.6 },
        { ppr: 60, sigma: 6.5 },
        { ppr: 70, sigma: 3.1 },
      ],
    },
    {
      first9: 50,
      cap: 81.8,
      points: [
        { ppr: 20, sigma: 42.7 },
        { ppr: 30, sigma: 28.4 },
        { ppr: 40, sigma: 19.1 },
        { ppr: 50, sigma: 13.1 },
        { ppr: 60, sigma: 8.0 },
        { ppr: 70, sigma: 4.2 },
        { ppr: 80, sigma: 1.3 },
      ],
    },
    {
      first9: 60,
      cap: 85.5,
      points: [
        { ppr: 20, sigma: 43.8 },
        { ppr: 30, sigma: 30.3 },
        { ppr: 40, sigma: 21.0 },
        { ppr: 50, sigma: 14.3 },
        { ppr: 60, sigma: 9.8 },
        { ppr: 70, sigma: 5.4 },
        { ppr: 80, sigma: 2.4 },
      ],
    },
    {
      first9: 70,
      cap: 89.4,
      points: [
        { ppr: 20, sigma: 46.4 },
        { ppr: 30, sigma: 31.4 },
        { ppr: 40, sigma: 22.4 },
        { ppr: 50, sigma: 16.2 },
        { ppr: 60, sigma: 11.2 },
        { ppr: 70, sigma: 6.9 },
        { ppr: 80, sigma: 3.6 },
      ],
    },
    {
      first9: 80,
      cap: 93.8,
      points: [
        { ppr: 20, sigma: 48.2 },
        { ppr: 30, sigma: 33.5 },
        { ppr: 40, sigma: 24.9 },
        { ppr: 50, sigma: 17.4 },
        { ppr: 60, sigma: 13.1 },
        { ppr: 70, sigma: 8.5 },
        { ppr: 80, sigma: 5.0 },
        { ppr: 90, sigma: 1.8 },
      ],
    },
    {
      first9: 90,
      cap: 98.8,
      points: [
        { ppr: 20, sigma: 48.7 },
        { ppr: 30, sigma: 35.1 },
        { ppr: 40, sigma: 26.7 },
        { ppr: 50, sigma: 19.7 },
        { ppr: 60, sigma: 15.0 },
        { ppr: 70, sigma: 10.6 },
        { ppr: 80, sigma: 6.7 },
        { ppr: 90, sigma: 3.3 },
      ],
    },
    {
      first9: 100,
      cap: 104.5,
      points: [
        { ppr: 20, sigma: 52.7 },
        { ppr: 30, sigma: 36.6 },
        { ppr: 40, sigma: 27.6 },
        { ppr: 50, sigma: 21.2 },
        { ppr: 60, sigma: 16.5 },
        { ppr: 70, sigma: 12.4 },
        { ppr: 80, sigma: 8.6 },
        { ppr: 90, sigma: 5.2 },
        { ppr: 100, sigma: 2.1 },
      ],
    },
    {
      first9: 110,
      cap: 111.3,
      points: [
        { ppr: 20, sigma: 53.5 },
        { ppr: 30, sigma: 39.0 },
        { ppr: 40, sigma: 30.0 },
        { ppr: 50, sigma: 23.6 },
        { ppr: 60, sigma: 18.9 },
        { ppr: 70, sigma: 14.9 },
        { ppr: 80, sigma: 10.4 },
        { ppr: 90, sigma: 7.4 },
        { ppr: 100, sigma: 4.4 },
        { ppr: 110, sigma: 0.8 },
      ],
    },
    {
      first9: 120,
      cap: 118.5,
      points: [
        { ppr: 20, sigma: 54.5 },
        { ppr: 30, sigma: 40.3 },
        { ppr: 40, sigma: 31.9 },
        { ppr: 50, sigma: 26.2 },
        { ppr: 60, sigma: 20.9 },
        { ppr: 70, sigma: 17.3 },
        { ppr: 80, sigma: 13.4 },
        { ppr: 90, sigma: 9.8 },
        { ppr: 100, sigma: 6.8 },
        { ppr: 110, sigma: 3.6 },
      ],
    },
    {
      first9: 130,
      cap: 126.8,
      points: [
        { ppr: 20, sigma: 59.5 },
        { ppr: 30, sigma: 42.5 },
        { ppr: 40, sigma: 35.6 },
        { ppr: 50, sigma: 29.3 },
        { ppr: 60, sigma: 24.0 },
        { ppr: 70, sigma: 19.7 },
        { ppr: 80, sigma: 16.4 },
        { ppr: 90, sigma: 13.5 },
        { ppr: 100, sigma: 10.0 },
        { ppr: 110, sigma: 7.1 },
        { ppr: 120, sigma: 3.4 },
      ],
    },
    {
      first9: 140,
      cap: 133.4,
      points: [
        { ppr: 20, sigma: 62.5 },
        { ppr: 30, sigma: 46.6 },
        { ppr: 40, sigma: 38.9 },
        { ppr: 50, sigma: 32.8 },
        { ppr: 60, sigma: 27.9 },
        { ppr: 70, sigma: 23.0 },
        { ppr: 80, sigma: 20.0 },
        { ppr: 90, sigma: 16.6 },
        { ppr: 100, sigma: 13.7 },
        { ppr: 110, sigma: 10.1 },
        { ppr: 120, sigma: 7.0 },
        { ppr: 130, sigma: 2.6 },
      ],
    },
    {
      first9: 150,
      cap: 142.7,
      points: [
        { ppr: 20, sigma: 72.5 },
        { ppr: 30, sigma: 53.1 },
        { ppr: 40, sigma: 44.1 },
        { ppr: 50, sigma: 39.2 },
        { ppr: 60, sigma: 34.6 },
        { ppr: 70, sigma: 29.9 },
        { ppr: 80, sigma: 26.5 },
        { ppr: 90, sigma: 22.3 },
        { ppr: 100, sigma: 19.7 },
        { ppr: 110, sigma: 15.4 },
        { ppr: 120, sigma: 12.7 },
        { ppr: 130, sigma: 8.7 },
        { ppr: 140, sigma: 2.9 },
      ],
    },
    {
      first9: 160,
      cap: 153.3,
      points: [
        { ppr: 20, sigma: 100.3 },
        { ppr: 30, sigma: 72.5 },
        { ppr: 40, sigma: 59.8 },
        { ppr: 50, sigma: 53.0 },
        { ppr: 60, sigma: 46.3 },
        { ppr: 70, sigma: 41.2 },
        { ppr: 80, sigma: 37.3 },
        { ppr: 90, sigma: 34.1 },
        { ppr: 100, sigma: 31.3 },
        { ppr: 110, sigma: 27.1 },
        { ppr: 120, sigma: 23.1 },
        { ppr: 130, sigma: 19.2 },
        { ppr: 140, sigma: 13.9 },
        { ppr: 150, sigma: 5.6 },
      ],
    },
  ],
  horizontal: [
    {
      first9: 20,
      cap: 70.9,
      points: [
        { ppr: 20, sigma: 37.1 },
        { ppr: 30, sigma: 21.5 },
        { ppr: 40, sigma: 13.4 },
        { ppr: 50, sigma: 8.9 },
        { ppr: 60, sigma: 5.5 },
      ],
    },
    {
      first9: 30,
      cap: 73.8,
      points: [
        { ppr: 20, sigma: 39.4 },
        { ppr: 30, sigma: 23.6 },
        { ppr: 40, sigma: 14.7 },
        { ppr: 50, sigma: 9.7 },
        { ppr: 60, sigma: 6.3 },
        { ppr: 70, sigma: 2.8 },
      ],
    },
    {
      first9: 40,
      cap: 78.5,
      points: [
        { ppr: 20, sigma: 40.6 },
        { ppr: 30, sigma: 25.0 },
        { ppr: 40, sigma: 16.1 },
        { ppr: 50, sigma: 11.0 },
        { ppr: 60, sigma: 7.3 },
        { ppr: 70, sigma: 4.2 },
      ],
    },
    {
      first9: 50,
      cap: 84.3,
      points: [
        { ppr: 20, sigma: 43.1 },
        { ppr: 30, sigma: 27.3 },
        { ppr: 40, sigma: 17.9 },
        { ppr: 50, sigma: 12.3 },
        { ppr: 60, sigma: 8.6 },
        { ppr: 70, sigma: 5.5 },
        { ppr: 80, sigma: 2.5 },
      ],
    },
    {
      first9: 60,
      cap: 88.5,
      points: [
        { ppr: 20, sigma: 45.0 },
        { ppr: 30, sigma: 29.8 },
        { ppr: 40, sigma: 20.1 },
        { ppr: 50, sigma: 13.9 },
        { ppr: 60, sigma: 9.8 },
        { ppr: 70, sigma: 6.5 },
        { ppr: 80, sigma: 3.7 },
      ],
    },
    {
      first9: 70,
      cap: 92.8,
      points: [
        { ppr: 20, sigma: 46.5 },
        { ppr: 30, sigma: 30.8 },
        { ppr: 40, sigma: 22.0 },
        { ppr: 50, sigma: 15.3 },
        { ppr: 60, sigma: 11.1 },
        { ppr: 70, sigma: 7.7 },
        { ppr: 80, sigma: 4.9 },
        { ppr: 90, sigma: 1.6 },
      ],
    },
    {
      first9: 80,
      cap: 96.8,
      points: [
        { ppr: 20, sigma: 48.2 },
        { ppr: 30, sigma: 32.5 },
        { ppr: 40, sigma: 23.1 },
        { ppr: 50, sigma: 16.9 },
        { ppr: 60, sigma: 12.4 },
        { ppr: 70, sigma: 9.0 },
        { ppr: 80, sigma: 6.1 },
        { ppr: 90, sigma: 3.1 },
      ],
    },
    {
      first9: 90,
      cap: 100.9,
      points: [
        { ppr: 20, sigma: 49.0 },
        { ppr: 30, sigma: 34.3 },
        { ppr: 40, sigma: 25.0 },
        { ppr: 50, sigma: 18.8 },
        { ppr: 60, sigma: 14.0 },
        { ppr: 70, sigma: 10.3 },
        { ppr: 80, sigma: 7.3 },
        { ppr: 90, sigma: 4.4 },
      ],
    },
    {
      first9: 100,
      cap: 105.7,
      points: [
        { ppr: 20, sigma: 50.7 },
        { ppr: 30, sigma: 36.1 },
        { ppr: 40, sigma: 26.5 },
        { ppr: 50, sigma: 20.5 },
        { ppr: 60, sigma: 16.5 },
        { ppr: 70, sigma: 12.4 },
        { ppr: 80, sigma: 8.8 },
        { ppr: 90, sigma: 5.7 },
        { ppr: 100, sigma: 2.7 },
      ],
    },
    {
      first9: 110,
      cap: 111.0,
      points: [
        { ppr: 20, sigma: 52.2 },
        { ppr: 30, sigma: 37.8 },
        { ppr: 40, sigma: 28.9 },
        { ppr: 50, sigma: 23.0 },
        { ppr: 60, sigma: 18.5 },
        { ppr: 70, sigma: 14.2 },
        { ppr: 80, sigma: 11.0 },
        { ppr: 90, sigma: 7.7 },
        { ppr: 100, sigma: 4.6 },
        { ppr: 110, sigma: 0.7 },
      ],
    },
    {
      first9: 120,
      cap: 117.3,
      points: [
        { ppr: 20, sigma: 54.3 },
        { ppr: 30, sigma: 40.2 },
        { ppr: 40, sigma: 31.5 },
        { ppr: 50, sigma: 25.4 },
        { ppr: 60, sigma: 20.4 },
        { ppr: 70, sigma: 17.4 },
        { ppr: 80, sigma: 13.4 },
        { ppr: 90, sigma: 10.5 },
        { ppr: 100, sigma: 7.1 },
        { ppr: 110, sigma: 3.5 },
      ],
    },
    {
      first9: 130,
      cap: 123.0,
      points: [
        { ppr: 20, sigma: 55.1 },
        { ppr: 30, sigma: 42.3 },
        { ppr: 40, sigma: 34.4 },
        { ppr: 50, sigma: 28.0 },
        { ppr: 60, sigma: 23.9 },
        { ppr: 70, sigma: 19.3 },
        { ppr: 80, sigma: 16.1 },
        { ppr: 90, sigma: 12.9 },
        { ppr: 100, sigma: 9.6 },
        { ppr: 110, sigma: 5.9 },
        { ppr: 120, sigma: 1.9 },
      ],
    },
    {
      first9: 140,
      cap: 129.9,
      points: [
        { ppr: 20, sigma: 61.1 },
        { ppr: 30, sigma: 46.2 },
        { ppr: 40, sigma: 37.4 },
        { ppr: 50, sigma: 31.6 },
        { ppr: 60, sigma: 26.5 },
        { ppr: 70, sigma: 23.3 },
        { ppr: 80, sigma: 20.0 },
        { ppr: 90, sigma: 16.7 },
        { ppr: 100, sigma: 13.5 },
        { ppr: 110, sigma: 9.5 },
        { ppr: 120, sigma: 5.6 },
      ],
    },
    {
      first9: 150,
      cap: 138.1,
      points: [
        { ppr: 20, sigma: 70.0 },
        { ppr: 30, sigma: 52.9 },
        { ppr: 40, sigma: 42.6 },
        { ppr: 50, sigma: 35.6 },
        { ppr: 60, sigma: 31.7 },
        { ppr: 70, sigma: 27.8 },
        { ppr: 80, sigma: 24.5 },
        { ppr: 90, sigma: 21.0 },
        { ppr: 100, sigma: 18.6 },
        { ppr: 110, sigma: 14.8 },
        { ppr: 120, sigma: 10.4 },
        { ppr: 130, sigma: 5.7 },
      ],
    },
    {
      first9: 160,
      cap: 149.8,
      points: [
        { ppr: 20, sigma: 90.3 },
        { ppr: 30, sigma: 67.4 },
        { ppr: 40, sigma: 54.8 },
        { ppr: 50, sigma: 49.7 },
        { ppr: 60, sigma: 41.6 },
        { ppr: 70, sigma: 36.2 },
        { ppr: 80, sigma: 32.4 },
        { ppr: 90, sigma: 28.6 },
        { ppr: 100, sigma: 25.4 },
        { ppr: 110, sigma: 22.0 },
        { ppr: 120, sigma: 18.7 },
        { ppr: 130, sigma: 15.0 },
        { ppr: 140, sigma: 9.6 },
      ],
    },
  ],
  even: [
    {
      first9: 20,
      cap: 70.7,
      points: [
        { ppr: 20, sigma: 38.2 },
        { ppr: 30, sigma: 22.3 },
        { ppr: 40, sigma: 14.3 },
        { ppr: 50, sigma: 9.0 },
        { ppr: 60, sigma: 4.8 },
      ],
    },
    {
      first9: 30,
      cap: 73.7,
      points: [
        { ppr: 20, sigma: 40.0 },
        { ppr: 30, sigma: 24.4 },
        { ppr: 40, sigma: 15.6 },
        { ppr: 50, sigma: 10.2 },
        { ppr: 60, sigma: 5.8 },
        { ppr: 70, sigma: 2.5 },
      ],
    },
    {
      first9: 40,
      cap: 78.3,
      points: [
        { ppr: 20, sigma: 42.8 },
        { ppr: 30, sigma: 26.2 },
        { ppr: 40, sigma: 16.9 },
        { ppr: 50, sigma: 11.6 },
        { ppr: 60, sigma: 7.4 },
        { ppr: 70, sigma: 3.7 },
      ],
    },
    {
      first9: 50,
      cap: 83.2,
      points: [
        { ppr: 20, sigma: 44.1 },
        { ppr: 30, sigma: 28.4 },
        { ppr: 40, sigma: 18.9 },
        { ppr: 50, sigma: 13.1 },
        { ppr: 60, sigma: 8.9 },
        { ppr: 70, sigma: 5.2 },
        { ppr: 80, sigma: 2.1 },
      ],
    },
    {
      first9: 60,
      cap: 87.2,
      points: [
        { ppr: 20, sigma: 45.5 },
        { ppr: 30, sigma: 30.0 },
        { ppr: 40, sigma: 20.6 },
        { ppr: 50, sigma: 14.8 },
        { ppr: 60, sigma: 10.3 },
        { ppr: 70, sigma: 6.6 },
        { ppr: 80, sigma: 3.3 },
      ],
    },
    {
      first9: 70,
      cap: 91.1,
      points: [
        { ppr: 20, sigma: 46.6 },
        { ppr: 30, sigma: 30.9 },
        { ppr: 40, sigma: 21.9 },
        { ppr: 50, sigma: 16.2 },
        { ppr: 60, sigma: 11.8 },
        { ppr: 70, sigma: 7.9 },
        { ppr: 80, sigma: 4.3 },
        { ppr: 90, sigma: 0.9 },
      ],
    },
    {
      first9: 80,
      cap: 95.4,
      points: [
        { ppr: 20, sigma: 48.4 },
        { ppr: 30, sigma: 33.3 },
        { ppr: 40, sigma: 23.7 },
        { ppr: 50, sigma: 17.9 },
        { ppr: 60, sigma: 13.3 },
        { ppr: 70, sigma: 9.2 },
        { ppr: 80, sigma: 5.8 },
        { ppr: 90, sigma: 2.5 },
      ],
    },
    {
      first9: 90,
      cap: 100.1,
      points: [
        { ppr: 20, sigma: 49.8 },
        { ppr: 30, sigma: 34.1 },
        { ppr: 40, sigma: 25.0 },
        { ppr: 50, sigma: 20.0 },
        { ppr: 60, sigma: 15.0 },
        { ppr: 70, sigma: 10.9 },
        { ppr: 80, sigma: 7.5 },
        { ppr: 90, sigma: 4.3 },
      ],
    },
    {
      first9: 100,
      cap: 104.8,
      points: [
        { ppr: 20, sigma: 51.6 },
        { ppr: 30, sigma: 37.4 },
        { ppr: 40, sigma: 28.2 },
        { ppr: 50, sigma: 22.2 },
        { ppr: 60, sigma: 17.4 },
        { ppr: 70, sigma: 12.9 },
        { ppr: 80, sigma: 9.3 },
        { ppr: 90, sigma: 6.0 },
        { ppr: 100, sigma: 2.5 },
      ],
    },
    {
      first9: 110,
      cap: 111.1,
      points: [
        { ppr: 20, sigma: 53.7 },
        { ppr: 30, sigma: 38.8 },
        { ppr: 40, sigma: 30.6 },
        { ppr: 50, sigma: 24.0 },
        { ppr: 60, sigma: 19.7 },
        { ppr: 70, sigma: 15.1 },
        { ppr: 80, sigma: 11.8 },
        { ppr: 90, sigma: 8.2 },
        { ppr: 100, sigma: 4.7 },
        { ppr: 110, sigma: 0.6 },
      ],
    },
    {
      first9: 120,
      cap: 118.1,
      points: [
        { ppr: 20, sigma: 54.4 },
        { ppr: 30, sigma: 41.0 },
        { ppr: 40, sigma: 32.1 },
        { ppr: 50, sigma: 26.8 },
        { ppr: 60, sigma: 22.2 },
        { ppr: 70, sigma: 17.9 },
        { ppr: 80, sigma: 14.4 },
        { ppr: 90, sigma: 10.8 },
        { ppr: 100, sigma: 7.4 },
        { ppr: 110, sigma: 3.5 },
      ],
    },
    {
      first9: 130,
      cap: 125.3,
      points: [
        { ppr: 20, sigma: 57.5 },
        { ppr: 30, sigma: 42.8 },
        { ppr: 40, sigma: 34.9 },
        { ppr: 50, sigma: 29.1 },
        { ppr: 60, sigma: 24.0 },
        { ppr: 70, sigma: 20.8 },
        { ppr: 80, sigma: 16.8 },
        { ppr: 90, sigma: 13.8 },
        { ppr: 100, sigma: 10.3 },
        { ppr: 110, sigma: 7.0 },
        { ppr: 120, sigma: 3.2 },
      ],
    },
    {
      first9: 140,
      cap: 132.6,
      points: [
        { ppr: 20, sigma: 64.0 },
        { ppr: 30, sigma: 47.7 },
        { ppr: 40, sigma: 38.3 },
        { ppr: 50, sigma: 32.6 },
        { ppr: 60, sigma: 28.2 },
        { ppr: 70, sigma: 24.5 },
        { ppr: 80, sigma: 21.8 },
        { ppr: 90, sigma: 17.7 },
        { ppr: 100, sigma: 14.6 },
        { ppr: 110, sigma: 10.7 },
        { ppr: 120, sigma: 6.9 },
        { ppr: 130, sigma: 2.2 },
      ],
    },
    {
      first9: 150,
      cap: 140.2,
      points: [
        { ppr: 20, sigma: 71.3 },
        { ppr: 30, sigma: 53.5 },
        { ppr: 40, sigma: 44.1 },
        { ppr: 50, sigma: 37.8 },
        { ppr: 60, sigma: 32.6 },
        { ppr: 70, sigma: 29.0 },
        { ppr: 80, sigma: 24.8 },
        { ppr: 90, sigma: 22.9 },
        { ppr: 100, sigma: 19.5 },
        { ppr: 110, sigma: 15.5 },
        { ppr: 120, sigma: 11.9 },
        { ppr: 130, sigma: 7.5 },
      ],
    },
    {
      first9: 160,
      cap: 151.8,
      points: [
        { ppr: 20, sigma: 93.1 },
        { ppr: 30, sigma: 70.6 },
        { ppr: 40, sigma: 58.0 },
        { ppr: 50, sigma: 49.4 },
        { ppr: 60, sigma: 45.1 },
        { ppr: 70, sigma: 39.3 },
        { ppr: 80, sigma: 35.1 },
        { ppr: 90, sigma: 31.9 },
        { ppr: 100, sigma: 26.9 },
        { ppr: 110, sigma: 24.2 },
        { ppr: 120, sigma: 20.5 },
        { ppr: 130, sigma: 17.1 },
        { ppr: 140, sigma: 12.7 },
        { ppr: 150, sigma: 3.3 },
      ],
    },
  ],
};

/** First9 の行を挟む 2 行と、その間の位置（0〜1）。 */
function bracketRows(
  rows: readonly LateSigmaRow[],
  first9: number,
): { readonly lower: LateSigmaRow; readonly upper: LateSigmaRow; readonly t: number } {
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

/** その FIRST 9 で届く AVERAGE の上限（後半を狙いどおりにしたときのゲーム全体 PPR）。 */
export function averageCapFor(first9Ppr: number, direction: MissDirection = 'even'): number {
  const first9 = clampPpr(first9Ppr);
  const rows = LATE_SIGMA_TABLE[direction];
  if (rows.length === 0) return MAX_PPR;
  const { lower, upper, t } = bracketRows(rows, first9);
  return lower.cap + (upper.cap - lower.cap) * t;
}

/** 実際に使う AVERAGE（届かない設定は届く上限として投げる。画面には出さない）。 */
export function effectiveAveragePpr(
  first9Ppr: number,
  averagePpr: number,
  direction: MissDirection = 'even',
): number {
  return Math.min(clampPpr(averagePpr), averageCapFor(first9Ppr, direction));
}

/** 1 行の中で、AVERAGE → 後半の σ。 */
function rowLateSigma(row: LateSigmaRow, average: number, direction: MissDirection): number {
  if (average >= row.cap) return 0;
  const anchors = [...row.points, { ppr: row.cap, sigma: 0 }];
  // 低い FIRST 9 では表に点が少ない。精度一定の表で近似する。
  if (anchors.length < 2) return sigmaForPpr(average, direction);
  return Math.max(0, interpolate(anchors, average));
}

/** 10 投目以降に移る先の σ（mm）。First9 の行のあいだは線形に補間する。 */
export function lateSigma(
  first9Ppr: number,
  averagePpr: number,
  direction: MissDirection = 'even',
): number {
  const first9 = clampPpr(first9Ppr);
  const average = effectiveAveragePpr(first9, averagePpr, direction);
  const rows = LATE_SIGMA_TABLE[direction];
  if (rows.length === 0) return sigmaForPpr(average, direction);
  const { lower, upper, t } = bracketRows(rows, first9);
  return (
    rowLateSigma(lower, average, direction) * (1 - t) + rowLateSigma(upper, average, direction) * t
  );
}

/**
 * 1 投に使う σ（mm）。投数で分ける（着弾モデル v3 / 案 3'）。
 *
 * - 1〜9 投目: FIRST 9 の σ
 * - 10 投目以降: 後半の σ へ `TRANSITION_DARTS` 投かけて線形に移る
 *
 * FIRST 9 と AVERAGE をどちらも 167 にしたときだけ、ゲーム全体で狙った的へ 100% 入る。
 *
 * @param dartIndex 1 から数えた通し投数。
 */
export function sigmaForDart(
  first9Ppr: number,
  averagePpr: number,
  dartIndex: number,
  direction: MissDirection = 'even',
): number {
  const firstSigma = sigmaForFirst9Ppr(first9Ppr, direction);
  if (dartIndex <= 9) return firstSigma;
  const late = lateSigma(first9Ppr, averagePpr, direction);
  const step = Math.min(dartIndex - 9, TRANSITION_DARTS);
  const weight = 1 - step / TRANSITION_DARTS;
  return firstSigma * weight + late * (1 - weight);
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
