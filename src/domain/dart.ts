/**
 * 1 投（ダート）のモデル。
 *
 * ルート探索・評価・表示のすべてでこの型を使う。
 * `id` は "T20" / "S6" / "D16" / "SB" / "BULL" / "MISS" という安定した表記で、
 * データファイル・テストフィクスチャ・localStorage の永続表現も同じ表記を使う。
 */
import { BOARD_NUMBERS } from './boardNumbers';
import {
  INNER_BULL_SCORE,
  OUTER_BULL_SCORE,
  type SegmentKind,
  calculateScore,
} from './scoring';

export interface Dart {
  /** 安定した識別子・表記（例: T20, S6, D16, SB, BULL, MISS）。 */
  readonly id: string;
  readonly kind: SegmentKind;
  /** 1〜20 の表示数字。BULL / MISS は null。 */
  readonly baseNumber: number | null;
  readonly score: number;
  /** 日本語の読み上げ・説明用の名前。 */
  readonly nameJa: string;
}

function wedgeDart(kind: 'single' | 'double' | 'triple', baseNumber: number): Dart {
  const prefix = kind === 'single' ? 'S' : kind === 'double' ? 'D' : 'T';
  const nameKind = kind === 'single' ? 'シングル' : kind === 'double' ? 'ダブル' : 'トリプル';
  return {
    id: `${prefix}${baseNumber}`,
    kind,
    baseNumber,
    score: calculateScore({ kind, baseNumber, bullType: null }),
    nameJa: `${nameKind}${baseNumber}`,
  };
}

export const MISS_DART: Dart = {
  id: 'MISS',
  kind: 'miss',
  baseNumber: null,
  score: 0,
  nameJa: 'ミス',
};

export const OUTER_BULL_DART: Dart = {
  id: 'SB',
  kind: 'bull',
  baseNumber: null,
  score: OUTER_BULL_SCORE,
  nameJa: 'アウターブル',
};

export const INNER_BULL_DART: Dart = {
  id: 'BULL',
  kind: 'bull',
  baseNumber: null,
  score: INNER_BULL_SCORE,
  nameJa: 'ブル',
};

const NUMBERS_ASC = [...BOARD_NUMBERS].sort((a, b) => a - b);

/** シングル S1〜S20。 */
export const SINGLE_DARTS: readonly Dart[] = NUMBERS_ASC.map((n) => wedgeDart('single', n));
/** ダブル D1〜D20。 */
export const DOUBLE_DARTS: readonly Dart[] = NUMBERS_ASC.map((n) => wedgeDart('double', n));
/** トリプル T1〜T20。 */
export const TRIPLE_DARTS: readonly Dart[] = NUMBERS_ASC.map((n) => wedgeDart('triple', n));

/**
 * 「狙って投げられる」全セグメント（MISS を除く 62 種）。
 * S1-20 / D1-20 / T1-20 / SB / BULL。
 */
export const THROWABLE_DARTS: readonly Dart[] = [
  ...SINGLE_DARTS,
  ...DOUBLE_DARTS,
  ...TRIPLE_DARTS,
  OUTER_BULL_DART,
  INNER_BULL_DART,
];

/** MISS を含む全ダート（実戦入力で使う）。 */
export const ALL_DARTS: readonly Dart[] = [...THROWABLE_DARTS, MISS_DART];

/**
 * Double Out の最終ダートとして合法なセグメント。
 * D1〜D20 に加え、BULL（50点）は Double 25 として合法な finish として扱う。
 * アウターブル（25点）は Double ではないため含めない。
 */
export const FINISHING_DARTS: readonly Dart[] = [...DOUBLE_DARTS, INNER_BULL_DART];

const DART_BY_ID = new Map<string, Dart>(ALL_DARTS.map((dart) => [dart.id, dart]));

/** 表記から Dart を得る。存在しない表記は undefined。 */
export function findDart(id: string): Dart | undefined {
  return DART_BY_ID.get(id);
}

/** 表記から Dart を得る。存在しない表記は例外にする（データ検証用）。 */
export function requireDart(id: string): Dart {
  const dart = DART_BY_ID.get(id);
  if (!dart) {
    throw new Error(`盤面に存在しないセグメント表記です: "${id}"`);
  }
  return dart;
}

/** Double Out の最終ダートとして合法か。 */
export function isFinishingDart(dart: Dart): boolean {
  return dart.kind === 'double' || dart.id === INNER_BULL_DART.id;
}

/** ルートを "T19 → S6 → D20" のような表示文字列にする。 */
export function formatRoute(darts: readonly Dart[]): string {
  return darts.map((dart) => dart.id).join(' → ');
}

/** ルートの安定キー（ソートの決定性・重複排除に使う）。 */
export function routeKey(darts: readonly Dart[]): string {
  return darts.map((dart) => dart.id).join('-');
}

/** 表記の配列から Dart 配列を作る（データファイル読み込み用）。 */
export function parseRoute(ids: readonly string[]): Dart[] {
  return ids.map(requireDart);
}

/** ルートの合計得点。 */
export function routeTotal(darts: readonly Dart[]): number {
  return darts.reduce((sum, dart) => sum + dart.score, 0);
}
