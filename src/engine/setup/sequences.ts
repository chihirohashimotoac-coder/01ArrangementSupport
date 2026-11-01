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
import { THROWABLE_DARTS, TRIPLE_DARTS, findDart, type Dart } from '../../domain/dart';
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
  /** 残り点に依存しない評価（難易度・同一ナンバー継続・調整・S-BULL）。 */
  readonly intrinsic: number;
  /** 残り点に依存しない理由コード。 */
  readonly codes: readonly SetupReasonCode[];
  readonly continuityTargetId: string | null;
  readonly thinTargets: number;
}

/** 取得点ごとに保持する上位件数。 */
const TOP_PER_TOTAL = 8;

/**
 * 戦術 v2（docs/APPROVALS.md A-29）で、ビジット最後の 1 投が縦ズレしてもテンパイが残るかを
 * 加点するようになった。この加点は「最後の 1 投を投げる直前の残り（= 取得点と最後の的で決まる）」
 * と「最後の的」だけで決まる。したがって同じ取得点・同じ最後の的の中では intrinsic の順位が
 * 変わらず、取得点ごとの最良より加点ぶん以上低い候補は、加点されても最良を超えられない。
 *
 * そこで取得点ごとの上位 8 件に加えて、「最後の的ごとの上位 TOP_PER_LAST 件のうち、
 * 取得点の最良との差が加点以内のもの」も表に残す（それ以外は加点しても順位に関わらない）。
 */
const TOP_PER_LAST = 2;
const LAST_DART_BONUS_MARGIN = SETUP_REASON_WEIGHTS.SETUP_LAST_DART_MISS_KEEPS_TENPAI;

const sequenceKeyOf = (entry: SequenceEntry) => entry.darts.map((d) => d.id).join('-');

const byIntrinsicThenKey = (a: SequenceEntry, b: SequenceEntry) =>
  b.intrinsic - a.intrinsic || sequenceKeyOf(a).localeCompare(sequenceKeyOf(b));

/** 取得点 1 つぶんの表を作るあいだだけ使う入れ物。 */
interface TotalBuilder {
  readonly top: SequenceEntry[];
  readonly byLast: Map<string, SequenceEntry[]>;
}

const newBuilders = (size: number): TotalBuilder[] =>
  Array.from({ length: size }, () => ({ top: [], byLast: new Map() }));

/**
 * その intrinsic の候補が、どちらの上位にも入れないなら true（実体化せずに捨てる）。
 * keepLast が false のときは、従来どおり取得点ごとの上位 8 件だけを見る。
 */
function cannotEnter(
  builder: TotalBuilder,
  lastId: string,
  intrinsic: number,
  keepLast: boolean,
): boolean {
  const { top } = builder;
  if (top.length < TOP_PER_TOTAL || intrinsic >= top[top.length - 1].intrinsic) return false;
  if (!keepLast || intrinsic < top[0].intrinsic - LAST_DART_BONUS_MARGIN) return true;
  const bucket = builder.byLast.get(lastId);
  return bucket !== undefined && bucket.length >= TOP_PER_LAST && intrinsic < bucket[bucket.length - 1].intrinsic;
}

function addTo(builder: TotalBuilder, entry: SequenceEntry, keepLast: boolean): void {
  insert(builder.top, entry, TOP_PER_TOTAL);
  if (!keepLast) return;
  const lastId = entry.darts[entry.darts.length - 1].id;
  const bucket = builder.byLast.get(lastId) ?? [];
  insert(bucket, entry, TOP_PER_LAST);
  builder.byLast.set(lastId, bucket);
}

/** 取得点ごとの 1 本の並び（intrinsic 降順・キー昇順）へまとめる。 */
function finish(builders: readonly TotalBuilder[]): SequenceEntry[][] {
  return builders.map(({ top, byLast }) => {
    if (top.length === 0) return [];
    const floor = top[0].intrinsic - LAST_DART_BONUS_MARGIN;
    const kept = new Set<SequenceEntry>(top);
    for (const bucket of byLast.values()) {
      for (const entry of bucket) if (entry.intrinsic >= floor) kept.add(entry);
    }
    return [...kept].sort(byIntrinsicThenKey);
  });
}

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
  if (continuityTargetId !== null) codes.push('SETUP_TARGET_CONTINUITY');

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

/** 上位シーケンスへ 1 件挿入する（常に intrinsic 降順・キー昇順で、limit 件まで）。 */
function insert(bucket: SequenceEntry[], entry: SequenceEntry, limit: number): void {
  bucket.push(entry);
  bucket.sort(byIntrinsicThenKey);
  if (bucket.length > limit) bucket.length = limit;
}

/**
 * 配列を新しく作らずに intrinsic だけを求める（表の構築を軽くするための版）。
 * analyzeSequence と同じ値を返すことをユニットテストで担保する。
 */
function intrinsicOf(darts: readonly Dart[], difficulty: number, mainTarget: string): number {
  let value = -difficulty * SETUP_DIFFICULTY_WEIGHT;

  for (let i = 1; i < darts.length; i += 1) {
    if (targetKeyOf(darts[i]) === targetKeyOf(darts[i - 1])) {
      value += SETUP_REASON_WEIGHTS.SETUP_TARGET_CONTINUITY;
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

/**
 * 先頭 `prefix` を固定し、残りを全通り投げたシーケンスを取得点ごとに並べた表を作る。
 * keepLast が true のときは、最後の的ごとの候補（A-29 の加点で順位が変わりうるもの）も残す。
 */
function buildTable(
  dartCount: number,
  mainTarget: string,
  prefix: readonly Dart[],
  keepLast: boolean,
): SequenceEntry[][] {
  const depthLimit = Math.min(Math.max(dartCount, 1), DARTS_PER_VISIT);
  const size = MAX_TOTAL_PER_DART * depthLimit + 1;
  const builders = newBuilders(size);
  const darts = THROWABLE_DARTS;
  const difficulties = darts.map(difficultyOf);
  const acc: Dart[] = [...prefix];

  const walk = (depth: number, total: number, difficulty: number): void => {
    if (depth === 0) {
      const intrinsic = intrinsicOf(acc, difficulty, mainTarget);
      if (cannotEnter(builders[total], acc[acc.length - 1].id, intrinsic, keepLast)) return;
      addTo(builders[total], analyzeSequence([...acc], mainTarget), keepLast);
      return;
    }
    for (let i = 0; i < darts.length; i += 1) {
      acc.push(darts[i]);
      walk(depth - 1, total + darts[i].score, difficulty + difficulties[i]);
      acc.pop();
    }
  };
  walk(
    depthLimit - prefix.length,
    prefix.reduce((sum, dart) => sum + dart.score, 0),
    prefix.reduce((sum, dart) => sum + difficultyOf(dart), 0),
  );
  return finish(builders);
}

const tableCache = new Map<string, SequenceTable>();

/**
 * `dartCount` 本で到達できる取得点ごとに、上位シーケンスを並べた表を返す。
 * 添字が取得点そのもの（0 〜 60 × dartCount）。
 *
 * 構築時は配列のコピーを避け、上位に入る見込みがあるものだけを実体化する。
 * RECOVERY の NEXT VISIT とテンパイ到達判定もこの表を使うので、
 * 取得点ごとの上位 8 件という枝刈りは変えない。
 */
export function sequenceTable(dartCount: number, mainTarget: string): SequenceTable {
  const cacheKey = `${dartCount}/${mainTarget}`;
  const cached = tableCache.get(cacheKey);
  if (cached) return cached;
  const table = buildTable(dartCount, mainTarget, [], false);
  tableCache.set(cacheKey, table);
  return table;
}

const lastDartAwareCache = new Map<string, SequenceTable>();

/**
 * SETUP のランキング用の表。`sequenceTable()` の上位 8 件に加えて、
 * ビジット最後の 1 投の外れでテンパイが残る加点（A-29）で順位が上がりうる候補も持つ。
 */
export function lastDartAwareSequenceTable(dartCount: number, mainTarget: string): SequenceTable {
  const cacheKey = `${dartCount}/${mainTarget}`;
  const cached = lastDartAwareCache.get(cacheKey);
  if (cached) return cached;
  const table = buildTable(dartCount, mainTarget, [], true);
  lastDartAwareCache.set(cacheKey, table);
  return table;
}

const scoringTripleFirstCache = new Map<string, ReadonlyMap<string, SequenceTable>>();

/**
 * 得点用トリプル（T1〜T20）から投げ始めるシーケンスを、**1 投目のトリプルごと**に
 * 取得点で並べた表。
 *
 * SETUP の第一ターゲットは「このビジットで点を取るために狙うトリプル」であり、
 * シングル落ち耐性（isSingleMissTenpaiSafe）はその狙いに対する評価である。
 * ところが `sequenceTable()` は取得点ごとに上位 8 件しか残さないため、
 * 1 投目が T20 のものだけが残り、T19 始動・T18 始動が表から落ちることがある。
 * それでは「T20 が危ないので T19 を狙う」という比較そのものが成立しない。
 *
 * そこで 1 投目のトリプルごとに別の表を持ち、どのトリプルから始めても
 * 取得点ごとの代表シーケンスが必ず残るようにする。枝刈りは表ごとに行うので、
 * ある取得点で T20 始動が上位を占めても T19 始動が消えない。
 *
 * 評価は `sequenceTable()` と同じ `analyzeSequence()` を通す。
 * 新しい重みも新しい評価軸もここには入らない。
 */
export function scoringTripleFirstSequenceTables(
  dartCount: number,
  mainTarget: string,
): ReadonlyMap<string, SequenceTable> {
  const cacheKey = `${dartCount}/${mainTarget}`;
  const cached = scoringTripleFirstCache.get(cacheKey);
  if (cached) return cached;

  const tables = new Map<string, SequenceTable>();
  // SETUP のランキング専用の表なので、最後の 1 投の加点（A-29）で順位が変わりうる候補も持つ。
  for (const first of TRIPLE_DARTS) {
    tables.set(first.id, buildTable(dartCount, mainTarget, [first], true));
  }

  scoringTripleFirstCache.set(cacheKey, tables);
  return tables;
}

const mainTargetFirstCache = new Map<string, SequenceTable>();

/**
 * 主目標から投げ始めるシーケンスだけを、取得点ごとに **枝刈りせず** 並べた表。
 *
 * `sequenceTable()` は取得点ごとに上位 8 件しか残さない。同点のときの残し方は
 * 表記の辞書順なので、たとえば取得 93 点（2 本）では T11-T20 … T18-T13 が残り、
 * **T20-T11 が落ちる**。「同じ結果なら主目標から入る」という戦術判断を
 * 辞書順に決めさせないために、主目標始動のシーケンスだけを別に全件持っておく。
 *
 * 1 本目が固定なので、3 本でも 62^2 = 3844 通りで済む（表の構築は 1 回だけ）。
 * 評価は `sequenceTable()` と同じ `analyzeSequence()` を通すので、
 * 新しい重みも新しい評価軸もここには入らない。
 */
export function mainTargetFirstSequenceTable(
  dartCount: number,
  mainTarget: string,
): SequenceTable {
  const cacheKey = `${dartCount}/${mainTarget}`;
  const cached = mainTargetFirstCache.get(cacheKey);
  if (cached) return cached;

  const depthLimit = Math.min(Math.max(dartCount, 1), DARTS_PER_VISIT);
  const size = MAX_TOTAL_PER_DART * depthLimit + 1;
  const buckets: SequenceEntry[][] = Array.from({ length: size }, () => []);
  const first = findDart(mainTarget);

  if (first !== undefined && THROWABLE_DARTS.includes(first)) {
    const acc: Dart[] = [first];
    const walk = (depth: number, total: number): void => {
      if (depth === 0) {
        buckets[total].push(analyzeSequence([...acc], mainTarget));
        return;
      }
      for (const dart of THROWABLE_DARTS) {
        acc.push(dart);
        walk(depth - 1, total + dart.score);
        acc.pop();
      }
    };
    walk(depthLimit - 1, first.score);
  }

  mainTargetFirstCache.set(cacheKey, buckets);
  return buckets;
}

/** テスト用にキャッシュを空にする。 */
export function clearSequenceTableCache(): void {
  tableCache.clear();
  lastDartAwareCache.clear();
  mainTargetFirstCache.clear();
  scoringTripleFirstCache.clear();
}
