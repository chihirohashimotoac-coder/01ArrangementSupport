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
 * PPR → 通常成分の散布幅 σ（mm）のアンカー表。ブレ方向ごとに持つ。
 *
 * `npm run audit:simulation -- --solve` の逆算で求めた値。
 * 「アプリのおすすめをそのまま狙う固定戦略のプレイヤー」に 501 を大量に
 * 投げさせ、平均 PPR が目標値になる σ を二分探索している。
 * 最大ブレは中で逆算した（小 / 大との差は数点に収まることを監査で確認する）。
 *
 * 直線ではなく、低 PPR 側ほど σ の増え方が急になる。
 */
export const SIGMA_ANCHORS: Readonly<Record<MissDirection, readonly SigmaAnchor[]>> = {
  even: [
    { ppr: 20, sigma: 41.9 },
    { ppr: 30, sigma: 26.6 },
    { ppr: 40, sigma: 19.2 },
    { ppr: 50, sigma: 15.2 },
    { ppr: 60, sigma: 12.4 },
    { ppr: 70, sigma: 10.1 },
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
  vertical: [
    { ppr: 20, sigma: 39.9 },
    { ppr: 30, sigma: 27.3 },
    { ppr: 40, sigma: 20.1 },
    { ppr: 50, sigma: 15.4 },
    { ppr: 60, sigma: 12.2 },
    { ppr: 70, sigma: 9.6 },
    { ppr: 80, sigma: 7.3 },
    { ppr: 90, sigma: 5.6 },
    { ppr: 100, sigma: 4.6 },
    { ppr: 110, sigma: 3.7 },
    { ppr: 120, sigma: 3.1 },
    { ppr: 130, sigma: 2.5 },
    { ppr: 140, sigma: 2.1 },
    { ppr: 150, sigma: 1.6 },
    { ppr: 160, sigma: 1.1 },
    { ppr: MAX_PPR, sigma: 0 },
  ],
  horizontal: [
    { ppr: 20, sigma: 41.2 },
    { ppr: 30, sigma: 25.8 },
    { ppr: 40, sigma: 17.8 },
    { ppr: 50, sigma: 14.0 },
    { ppr: 60, sigma: 11.7 },
    { ppr: 70, sigma: 10.0 },
    { ppr: 80, sigma: 8.4 },
    { ppr: 90, sigma: 7.3 },
    { ppr: 100, sigma: 6.3 },
    { ppr: 110, sigma: 5.4 },
    { ppr: 120, sigma: 4.7 },
    { ppr: 130, sigma: 4.0 },
    { ppr: 140, sigma: 3.3 },
    { ppr: 150, sigma: 2.6 },
    { ppr: 160, sigma: 1.7 },
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
  const anchors = SIGMA_ANCHORS[direction];
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

/** First9 から Average へ移り変わる投数（10 投目から数えて）。 */
export const TRANSITION_DARTS = 6;

/**
 * 投数から、その 1 投に使う σ（mm）を返す。
 *
 * - 1〜9 投目: First9 の σ
 * - 10 投目以降: Average の σ へ向けて `TRANSITION_DARTS` 投かけて線形に移る
 *
 * 9 投目と 10 投目で精度が不連続に飛ばないようにするための遷移。
 * Average が 167 のときは、ゲーム全体で σ = 0（100% 狙い通り）にする。
 *
 * @param dartIndex 1 から数えた通し投数。
 */
export function sigmaForDart(
  first9Ppr: number,
  averagePpr: number,
  dartIndex: number,
  direction: MissDirection = 'even',
): number {
  if (clampPpr(averagePpr) >= MAX_PPR) return 0;
  const firstSigma = sigmaForPpr(first9Ppr, direction);
  const averageSigma = sigmaForPpr(averagePpr, direction);
  if (dartIndex <= 9) return firstSigma;
  const step = Math.min(dartIndex - 9, TRANSITION_DARTS);
  const weight = 1 - step / TRANSITION_DARTS;
  return firstSigma * weight + averageSigma * (1 - weight);
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
