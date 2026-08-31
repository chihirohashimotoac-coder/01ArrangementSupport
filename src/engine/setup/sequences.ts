/**
 * SETUP 探索のための「取得点ごとの代表シーケンス」表。
 *
 * SETUP のスコアは
 *
 *     残りの質(leave) + 取得点 × 係数 + シーケンス固有の評価
 *
 * に分解できる。前 2 項は「取得点」が決まれば一意なので、
 * 取得点ごとにシーケンス固有の評価が高いものだけを保持しておけば、
 * 探索時は取得点 0〜180 を見るだけで済む。
 *
 * これにより、毎回 62^3 を走査せずに済む（表の構築は 1 回だけ）。
 */
import { THROWABLE_DARTS, type Dart } from '../../domain/dart';
import { DARTS_PER_VISIT } from '../../domain/checkoutRules';
import type { SetupReasonCode } from '../../domain/reasonCodes';
import {
  SEGMENT_DIFFICULTY,
  SETUP_DIFFICULTY_WEIGHT,
  SETUP_REASON_WEIGHTS,
} from '../../data/rankingRules';

/** 1 本を狙う難しさ。 */
export function difficultyOf(dart: Dart): number {
  if (dart.id === 'BULL') return SEGMENT_DIFFICULTY['inner-bull'];
  if (dart.id === 'SB') return SEGMENT_DIFFICULTY['outer-bull'];
  return SEGMENT_DIFFICULTY[dart.kind] ?? 0;
}

/** 狙う的の識別子。BULL とアウターブルは同じ的として扱う。 */
export function targetKeyOf(dart: Dart): string {
  return dart.baseNumber === null ? 'BULL_AREA' : String(dart.baseNumber);
}

export interface SequenceEntry {
  readonly darts: readonly Dart[];
  readonly total: number;
  /** 残り点に依存しない評価（難易度・的の継続・調整・S-BULL）。 */
  readonly intrinsic: number;
  /** 残り点に依存しない理由コード。 */
  readonly codes: readonly SetupReasonCode[];
  readonly continuityTargetId: string | null;
  readonly thinTargets: number;
}

/** 取得点ごとに保持する上位件数。 */
const TOP_PER_TOTAL = 8;

const MAX_TOTAL_PER_DART = 60;

function analyzeSequence(darts: readonly Dart[], mainTarget: string): SequenceEntry {
  const codes: SetupReasonCode[] = [];
  let continuityTargetId: string | null = null;

  for (let i = 1; i < darts.length; i += 1) {
    if (targetKeyOf(darts[i]) === targetKeyOf(darts[i - 1])) {
      continuityTargetId = darts[i].id;
      break;
    }
  }
  if (continuityTargetId !== null) codes.push('SETUP_MAIN_TARGET_CONTINUITY');

  const last = darts[darts.length - 1];
  const headIsMainTarget =
    darts.length >= 2 && darts.slice(0, -1).every((dart) => dart.id === mainTarget);
  if ((last.kind === 'single' || last.id === 'SB') && headIsMainTarget) {
    codes.push('SETUP_THIRD_DART_ADJUST');
  }

  if (darts.some((dart) => dart.id === 'SB')) codes.push('SETUP_USES_SBULL');

  const thinTargets = darts.filter((dart) => dart.kind === 'double').length;
  if (thinTargets > 0) codes.push('SETUP_THIN_TARGET');

  let total = 0;
  let difficulty = 0;
  for (const dart of darts) {
    total += dart.score;
    difficulty += difficultyOf(dart);
  }

  const intrinsic =
    codes.reduce(
      (sum, code) =>
        sum + SETUP_REASON_WEIGHTS[code] * (code === 'SETUP_THIN_TARGET' ? thinTargets : 1),
      0,
    ) - difficulty * SETUP_DIFFICULTY_WEIGHT;

  return { darts, total, intrinsic, codes, continuityTargetId, thinTargets };
}

/** 取得点ごとの上位シーケンスへ 1 件挿入する（常に intrinsic 降順・キー昇順）。 */
function insert(bucket: SequenceEntry[], entry: SequenceEntry): void {
  bucket.push(entry);
  bucket.sort(
    (a, b) =>
      b.intrinsic - a.intrinsic ||
      a.darts.map((d) => d.id).join('-').localeCompare(b.darts.map((d) => d.id).join('-')),
  );
  if (bucket.length > TOP_PER_TOTAL) bucket.length = TOP_PER_TOTAL;
}

/**
 * 配列を新しく作らずに intrinsic だけを求める（表の構築を軽くするための版）。
 * analyzeSequence と同じ値を返すことをユニットテストで担保する。
 */
function intrinsicOf(darts: readonly Dart[], difficulty: number, mainTarget: string): number {
  let value = -difficulty * SETUP_DIFFICULTY_WEIGHT;

  for (let i = 1; i < darts.length; i += 1) {
    if (targetKeyOf(darts[i]) === targetKeyOf(darts[i - 1])) {
      value += SETUP_REASON_WEIGHTS.SETUP_MAIN_TARGET_CONTINUITY;
      break;
    }
  }

  const last = darts[darts.length - 1];
  if (darts.length >= 2 && (last.kind === 'single' || last.id === 'SB')) {
    let headIsMainTarget = true;
    for (let i = 0; i < darts.length - 1; i += 1) {
      if (darts[i].id !== mainTarget) {
        headIsMainTarget = false;
        break;
      }
    }
    if (headIsMainTarget) value += SETUP_REASON_WEIGHTS.SETUP_THIRD_DART_ADJUST;
  }

  let thinTargets = 0;
  let hasSbull = false;
  for (const dart of darts) {
    if (dart.kind === 'double') thinTargets += 1;
    if (dart.id === 'SB') hasSbull = true;
  }
  if (hasSbull) value += SETUP_REASON_WEIGHTS.SETUP_USES_SBULL;
  value += SETUP_REASON_WEIGHTS.SETUP_THIN_TARGET * thinTargets;

  return value;
}

export type SequenceTable = ReadonlyArray<readonly SequenceEntry[]>;

const tableCache = new Map<string, SequenceTable>();

/**
 * `dartCount` 本で到達できる取得点ごとに、上位シーケンスを並べた表を返す。
 * 添字が取得点そのもの（0 〜 60 × dartCount）。
 *
 * 構築時は配列のコピーを避け、上位に入る見込みがあるものだけを実体化する。
 */
export function sequenceTable(dartCount: number, mainTarget: string): SequenceTable {
  const cacheKey = `${dartCount}/${mainTarget}`;
  const cached = tableCache.get(cacheKey);
  if (cached) return cached;

  const depthLimit = Math.min(Math.max(dartCount, 1), DARTS_PER_VISIT);
  const size = MAX_TOTAL_PER_DART * depthLimit + 1;
  const buckets: SequenceEntry[][] = Array.from({ length: size }, () => []);
  const darts = THROWABLE_DARTS;
  const difficulties = darts.map(difficultyOf);
  const acc: Dart[] = [];

  const walk = (depth: number, total: number, difficulty: number): void => {
    if (depth === 0) {
      const bucket = buckets[total];
      const intrinsic = intrinsicOf(acc, difficulty, mainTarget);
      if (bucket.length >= TOP_PER_TOTAL && intrinsic < bucket[bucket.length - 1].intrinsic) {
        return;
      }
      insert(bucket, analyzeSequence([...acc], mainTarget));
      return;
    }
    for (let i = 0; i < darts.length; i += 1) {
      acc.push(darts[i]);
      walk(depth - 1, total + darts[i].score, difficulty + difficulties[i]);
      acc.pop();
    }
  };
  walk(depthLimit, 0, 0);

  tableCache.set(cacheKey, buckets);
  return buckets;
}

/** テスト用にキャッシュを空にする。 */
export function clearSequenceTableCache(): void {
  tableCache.clear();
}
