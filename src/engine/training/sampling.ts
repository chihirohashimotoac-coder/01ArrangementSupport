/**
 * TRAINING の出題 sampler。
 *
 * v1 は「毎回 pool から乱数で 1 件引く」だけだったため、
 *  - 同じ問題が連続する
 *  - 難易度・カテゴリが偏る
 *  - MIXED の種別が偏る
 * という問題があった。
 *
 * v1.3 では
 *   1. quota 計算（種別 / カテゴリ / 難易度 / 形式）
 *   2. 各 bucket を seed 付き shuffle
 *   3. review bag 生成
 *   4. 直近履歴による除外
 *   5. 候補選択
 *   6. 足りないときだけ決定論的に条件を緩める
 * という順で決める。random retry loop は使わない。
 */
import {
  SETUP_CATEGORIES,
  contextKeyOf,
  reviewTargetFromScore,
  type ReviewTarget,
  type SetupCategory,
  type TrainingCategory,
  type TrainingDifficulty,
  type TrainingFormat,
  type TrainingKind,
  type TrainingQuestion,
} from './model';
import {
  buildCheckoutQuestion,
  buildPools,
  buildRecoveryQuestion,
  buildSetupAdjustmentQuestion,
  buildSetupFirstDartQuestion,
  buildSetupFullQuestion,
  kindsWithCandidates,
  type TrainingPools,
  type TrainingSettings,
} from './questions';
import { createRandom, type RandomSource } from './random';

// ---------------------------------------------------------------------------
// 候補の共通表現
// ---------------------------------------------------------------------------

interface Candidate {
  readonly kind: TrainingKind;
  readonly format: TrainingFormat;
  readonly difficulty: TrainingDifficulty;
  readonly category: TrainingCategory;
  readonly tags: readonly string[];
  readonly trivial: boolean;
  readonly directOneDart: boolean;
  readonly problemKey: string;
  readonly contextKey: string;
  readonly startRemaining: number;
  readonly build: (index: number) => TrainingQuestion;
}

function candidatesOf(pools: TrainingPools): Candidate[] {
  const items: Candidate[] = [];

  for (const candidate of pools.checkout) {
    const question = buildCheckoutQuestion(candidate, 0);
    items.push({
      kind: 'checkout',
      format: 'checkout-route',
      difficulty: candidate.difficulty,
      category: candidate.primaryCategory,
      tags: candidate.learningTags,
      trivial: candidate.trivial,
      directOneDart: candidate.directOneDart,
      problemKey: question.problemKey,
      contextKey: contextKeyOf(question),
      startRemaining: candidate.left,
      build: (index) => buildCheckoutQuestion(candidate, index),
    });
  }

  for (const candidate of pools.recovery) {
    const question = buildRecoveryQuestion(candidate, 0);
    items.push({
      kind: 'recovery',
      format: 'recovery-route',
      difficulty: candidate.difficulty,
      category: candidate.primaryCategory,
      tags: candidate.learningTags,
      trivial: candidate.trivial,
      directOneDart: false,
      problemKey: question.problemKey,
      contextKey: contextKeyOf(question),
      startRemaining: candidate.visitStartRemaining,
      build: (index) => buildRecoveryQuestion(candidate, index),
    });
  }

  for (const candidate of pools.setupAdjustment) {
    const question = buildSetupAdjustmentQuestion(candidate, 0);
    items.push({
      kind: 'setup',
      format: 'setup-adjustment',
      difficulty: candidate.difficulty,
      category: candidate.primaryCategory,
      tags: candidate.learningTags,
      trivial: candidate.trivial,
      directOneDart: false,
      problemKey: question.problemKey,
      contextKey: contextKeyOf(question),
      startRemaining: candidate.startRemaining,
      build: (index) => buildSetupAdjustmentQuestion(candidate, index),
    });
  }

  for (const candidate of pools.setupFirstDart) {
    const question = buildSetupFirstDartQuestion(candidate, 0);
    items.push({
      kind: 'setup',
      format: 'setup-first-dart',
      difficulty: candidate.difficulty,
      category: candidate.primaryCategory,
      tags: candidate.learningTags,
      trivial: false,
      directOneDart: false,
      problemKey: question.problemKey,
      contextKey: contextKeyOf(question),
      startRemaining: candidate.startRemaining,
      build: (index) => buildSetupFirstDartQuestion(candidate, index),
    });
  }

  // setup-full は新規出題を停止した（pools.setupFull は常に空）。
  // 保存済み履歴の再評価と、直接呼び出しからの互換のために分岐だけ残す。
  for (const candidate of pools.setupFull) {
    const question = buildSetupFullQuestion(candidate, 0);
    items.push({
      kind: 'setup',
      format: 'setup-full',
      difficulty: candidate.difficulty,
      category: candidate.primaryCategory,
      tags: candidate.learningTags,
      trivial: false,
      directOneDart: false,
      problemKey: question.problemKey,
      contextKey: contextKeyOf(question),
      startRemaining: candidate.startRemaining,
      build: (index) => buildSetupFullQuestion(candidate, index),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// quota
// ---------------------------------------------------------------------------

/** 10 問 / 30 問の既定 quota から、任意の問題数へ決定論的に割り振る。 */
function scaleQuota<K extends string>(
  base: Readonly<Record<K, number>>,
  priority: readonly K[],
  count: number,
): Record<K, number> {
  const baseTotal = priority.reduce((sum, key) => sum + base[key], 0);
  const result = {} as Record<K, number>;
  const fractions: Array<{ key: K; fraction: number }> = [];
  let assigned = 0;
  for (const key of priority) {
    const exact = (base[key] * count) / baseTotal;
    const floor = Math.floor(exact);
    result[key] = floor;
    assigned += floor;
    fractions.push({ key, fraction: exact - floor });
  }
  const order = [...fractions].sort(
    (a, b) => b.fraction - a.fraction || priority.indexOf(a.key) - priority.indexOf(b.key),
  );
  let cursor = 0;
  while (assigned < count) {
    const key = order[cursor % order.length].key;
    result[key] += 1;
    assigned += 1;
    cursor += 1;
  }
  return result;
}

/** SETUP カテゴリの出題優先順（本仕様 19 節）。 */
export const SETUP_CATEGORY_PRIORITY: readonly SetupCategory[] = [
  'setup-302-309',
  'setup-ton-trap',
  'setup-landing-95-105',
  'setup-sbull',
  'setup-digits-0147',
  'setup-same-number-worse',
  'setup-adjust-18-19-20',
  'setup-bogey-avoid',
  'setup-basics',
  // 第一ターゲット選択は形式（setup-first-dart）の側で枠を取るので、
  // カテゴリ quota は 0。末尾に置いて、余り枠の配り直しでも拾われにくくする。
  'setup-first-dart-safety',
];

const SETUP_QUOTA_10: Readonly<Record<SetupCategory, number>> = {
  'setup-bogey-avoid': 2,
  'setup-adjust-18-19-20': 1,
  'setup-digits-0147': 1,
  'setup-302-309': 1,
  'setup-ton-trap': 1,
  'setup-landing-95-105': 1,
  'setup-sbull': 1,
  'setup-same-number-worse': 1,
  'setup-basics': 1,
  'setup-first-dart-safety': 0,
};

const SETUP_QUOTA_30: Readonly<Record<SetupCategory, number>> = {
  'setup-bogey-avoid': 6,
  'setup-adjust-18-19-20': 4,
  'setup-digits-0147': 3,
  'setup-302-309': 4,
  'setup-ton-trap': 4,
  'setup-landing-95-105': 3,
  'setup-sbull': 3,
  'setup-same-number-worse': 2,
  'setup-basics': 1,
  'setup-first-dart-safety': 0,
};

export function setupCategoryQuota(count: number): Record<SetupCategory, number> {
  if (count === 10) return { ...SETUP_QUOTA_10 };
  if (count === 30) return { ...SETUP_QUOTA_30 };
  return scaleQuota(SETUP_QUOTA_30, SETUP_CATEGORY_PRIORITY, count);
}

/** 1 投調整のカテゴリ（A〜I）。setup-first-dart-safety は形式側で枠を取る。 */
export const ADJUSTMENT_CATEGORY_PRIORITY: readonly SetupCategory[] =
  SETUP_CATEGORY_PRIORITY.filter((category) => category !== 'setup-first-dart-safety');

/**
 * 1 投調整のカテゴリ quota を、出題できるカテゴリと実際の枠数へ配り直す。
 *
 * `sessionCount` は quota の基準（セッションの SETUP 問題数）、
 * `slotCount` は 1 投調整へ実際に配る枠数（= SETUP 問題数 − 1 投目問題数）。
 * 出せないカテゴリ（候補が 1 件も無いもの）の枠は、優先度順に配り直す。
 * v1.3.4 では 1 投調整を「調整判断が要る問題」だけに絞ったので、
 * `setup-basics` のように成立しなくなるカテゴリが出る。
 */
export function normalizedSetupCategoryQuota(
  sessionCount: number,
  slotCount: number,
  available: readonly SetupCategory[],
  capacityOf: (category: SetupCategory) => number = () => Number.MAX_SAFE_INTEGER,
): Record<SetupCategory, number> {
  const quota = setupCategoryQuota(sessionCount);
  const result = {} as Record<SetupCategory, number>;
  for (const category of SETUP_CATEGORIES) result[category] = 0;
  if (available.length === 0 || slotCount <= 0) return result;

  let assigned = 0;
  for (const category of available) {
    result[category] = quota[category] ?? 0;
    assigned += result[category];
  }

  /*
   * 余った枠は「候補の多いカテゴリ」から順に配る。
   *
   * 優先度順に配ると、いちばん具体的で候補の少ないカテゴリ
   * （302〜309 は 6 件しかない）へ枠が集まり、直近 5 問の
   * anti-repeat と両立できなくなる。候補数の多い順に回すと、
   * 同じ問題を出し直さずに枠を埋められる。
   */
  const byCapacity = [...available].sort(
    (a, b) =>
      capacityOf(b) - capacityOf(a) ||
      SETUP_CATEGORY_PRIORITY.indexOf(a) - SETUP_CATEGORY_PRIORITY.indexOf(b),
  );
  let cursor = 0;
  while (assigned < slotCount) {
    result[byCapacity[cursor % byCapacity.length]] += 1;
    assigned += 1;
    cursor += 1;
  }
  // 減らすときは、候補の少ないカテゴリから先に削る。
  const byScarcity = [...byCapacity].reverse();
  cursor = 0;
  while (assigned > slotCount) {
    const category = byScarcity[cursor % byScarcity.length];
    if (result[category] > 0) {
      result[category] -= 1;
      assigned -= 1;
    }
    cursor += 1;
  }
  return result;
}

/**
 * 1 セッションで計画される SETUP のカテゴリ内訳。
 * sampler と監査スクリプトが同じ式を使うために export する。
 */
export function plannedSetupCategoryQuota(input: {
  readonly count: number;
  readonly availableAdjustmentCategories: readonly SetupCategory[];
  readonly firstDartCandidateCount: number;
  /** カテゴリごとの 1 投調整候補数（余り枠の配り方に使う）。 */
  readonly adjustmentCapacity?: Readonly<Partial<Record<SetupCategory, number>>>;
}): Record<SetupCategory, number> {
  const wantedFirstDart = Math.min(
    setupFirstDartCount(input.count),
    input.count,
    input.firstDartCandidateCount,
  );
  const usable = ADJUSTMENT_CATEGORY_PRIORITY.filter((category) =>
    input.availableAdjustmentCategories.includes(category),
  );
  const capacity = input.adjustmentCapacity;
  const result = normalizedSetupCategoryQuota(
    input.count,
    input.count - wantedFirstDart,
    usable,
    capacity === undefined
      ? undefined
      : (category) => capacity[category] ?? 0,
  );
  result['setup-first-dart-safety'] = wantedFirstDart;
  return result;
}

/**
 * SETUP で「1 投目だけを選ぶ」形式の問題数（既定 20%）。
 *
 * v1.3.3 までは同じ 20% を 3 投フル形式（setup-full）に充てていた。
 * 残り 80% はこれまでどおり 1 投調整（setup-adjustment）。
 */
export function setupFirstDartCount(count: number): number {
  if (count === 10) return 2;
  if (count === 30) return 6;
  return Math.round(count * 0.2);
}

const DIFFICULTY_ORDER: readonly TrainingDifficulty[] = ['easy', 'medium', 'hard'];

/**
 * 出せる難易度だけへ quota を配り直す。
 * 出せない難易度の枠は、易しい方から順に配り直す（決定論的）。
 */
function normalizeDifficultyQuota(
  quota: Record<TrainingDifficulty, number>,
  offered: readonly TrainingDifficulty[],
  total: number,
): Record<TrainingDifficulty, number> {
  const result: Record<TrainingDifficulty, number> = { easy: 0, medium: 0, hard: 0 };
  if (offered.length === 0 || total <= 0) return result;
  let assigned = 0;
  for (const difficulty of offered) {
    result[difficulty] = quota[difficulty];
    assigned += result[difficulty];
  }
  let cursor = 0;
  while (assigned < total) {
    result[offered[cursor % offered.length]] += 1;
    assigned += 1;
    cursor += 1;
  }
  while (assigned > total) {
    const difficulty = offered[cursor % offered.length];
    if (result[difficulty] > 0) {
      result[difficulty] -= 1;
      assigned -= 1;
    }
    cursor += 1;
  }
  return result;
}

const CHECKOUT_DIFFICULTY_10 = { easy: 2, medium: 4, hard: 4 } as const;
const RECOVERY_DIFFICULTY_10 = { easy: 2, medium: 5, hard: 3 } as const;
const SETUP_DIFFICULTY_10 = { easy: 2, medium: 5, hard: 3 } as const;

export function difficultyQuota(
  kind: TrainingKind,
  count: number,
): Record<TrainingDifficulty, number> {
  const base =
    kind === 'checkout'
      ? CHECKOUT_DIFFICULTY_10
      : kind === 'recovery'
        ? RECOVERY_DIFFICULTY_10
        : SETUP_DIFFICULTY_10;
  return scaleQuota(base, DIFFICULTY_ORDER, count);
}

/** MIXED の種別 quota（本仕様 27 節）。 */
export function modeQuota(count: number): Record<TrainingKind, number> {
  if (count === 10) return { checkout: 4, setup: 3, recovery: 3 };
  if (count === 30) return { checkout: 10, setup: 10, recovery: 10 };
  return scaleQuota(
    { checkout: 4, setup: 3, recovery: 3 },
    ['checkout', 'setup', 'recovery'],
    count,
  );
}

/** 復習に充てる問題数（本仕様 31 節）。 */
export function reviewQuota(count: number): number {
  if (count === 10) return 3;
  if (count === 30) return 10;
  return Math.max(0, Math.round(count / 3));
}

/** trivial 問題の上限（本仕様 47 節）。 */
export function trivialCap(count: number): number {
  if (count === 10) return 2;
  if (count === 30) return 6;
  return Math.max(1, Math.round(count * 0.2));
}

/** CHECKOUT の 1 投上がりの上限。 */
export function directOneDartCap(count: number): number {
  if (count === 10) return 1;
  if (count === 30) return 3;
  return Math.max(1, Math.round(count * 0.1));
}

// ---------------------------------------------------------------------------
// 並びの組み立て
// ---------------------------------------------------------------------------

function shuffled<T>(items: readonly T[], random: RandomSource): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = random.nextInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * quota を「同じ値が maxRun より長く続かない」並びへ決定論的に展開する。
 *
 * shuffle してから入れ替える方式は、列の末尾に同じ値が固まったときに
 * 交換相手が見つからず失敗する。残り枚数の多いものから置く貪欲法にすると、
 * 実現可能なかぎり必ず制約を満たせる。
 */
function orderedBag<K extends string>(
  counts: Readonly<Record<K, number>>,
  keys: readonly K[],
  random: RandomSource,
  maxRun: number,
): K[] {
  const remaining = {} as Record<K, number>;
  let total = 0;
  for (const key of keys) {
    remaining[key] = counts[key] ?? 0;
    total += remaining[key];
  }

  const result: K[] = [];
  while (total > 0) {
    const last = result[result.length - 1];
    const inRun =
      result.length >= maxRun && result.slice(-maxRun).every((item) => item === last)
        ? last
        : null;

    let pool = keys.filter((key) => remaining[key] > 0 && key !== inRun);
    if (pool.length === 0) pool = keys.filter((key) => remaining[key] > 0);

    const max = pool.reduce((best, key) => Math.max(best, remaining[key]), 0);
    const tied = pool.filter((key) => remaining[key] === max);
    const chosen = tied[random.nextInt(0, tied.length - 1)];

    result.push(chosen);
    remaining[chosen] -= 1;
    total -= 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// 出題生成
// ---------------------------------------------------------------------------


/**
 * その slot で選ばれる見込みの難易度。
 *
 * CHECKOUT / RECOVERY は quota がそのまま難易度なので確定する。
 * SETUP はカテゴリで難易度がほぼ決まる（TON トラップ・95〜105・S-BULL・3 投フルは HARD）ので、
 * bucket の代表値を使う。
 */
function expectedDifficultyOf(
  slot: Slot,
  all: readonly Candidate[],
  reviewTargets: readonly ReviewTarget[],
): TrainingDifficulty {
  // 復習枠は難易度 quota を見ずに score 順で配るので、計画上の希望難易度ではなく
  // 「実際に配られる復習候補の難易度」で並びを決めないと、出題順の制約が崩れる。
  if (slot.review) {
    const reviewable = all.filter(
      (candidate) =>
        candidate.kind === slot.kind &&
        (slot.format === null || candidate.format === slot.format) &&
        (slot.category === null || candidate.category === slot.category) &&
        reviewScoreOf(candidate, reviewTargets) > 0,
    );
    if (reviewable.length > 0) {
      return reviewable.reduce((best, candidate) =>
        reviewScoreOf(candidate, reviewTargets) > reviewScoreOf(best, reviewTargets)
          ? candidate
          : best,
      ).difficulty;
    }
  }
  if (slot.kind !== 'setup') return slot.preferredDifficulty ?? 'medium';
  const bucket = all.filter(
    (candidate) =>
      candidate.kind === 'setup' &&
      (slot.format === null || candidate.format === slot.format) &&
      (slot.category === null || candidate.category === slot.category),
  );
  if (bucket.length === 0) return slot.preferredDifficulty ?? 'medium';
  if (
    slot.preferredDifficulty !== null &&
    bucket.some((candidate) => candidate.difficulty === slot.preferredDifficulty)
  ) {
    return slot.preferredDifficulty;
  }
  const counts: Record<TrainingDifficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const candidate of bucket) counts[candidate.difficulty] += 1;
  return DIFFICULTY_ORDER.reduce(
    (best, difficulty) => (counts[difficulty] > counts[best] ? difficulty : best),
    'easy' as TrainingDifficulty,
  );
}

/** 出題順の制約に違反している位置（先頭が最も手前）。 */
function orderingViolations(
  difficulties: readonly TrainingDifficulty[],
  count: number,
): Array<{ kind: 'run' | 'first' | 'final'; index: number }> {
  const violations: Array<{ kind: 'run' | 'first' | 'final'; index: number }> = [];
  const endpointsApply = count >= 10 && difficulties.length >= 3;

  if (endpointsApply && difficulties[0] === 'hard') {
    violations.push({ kind: 'first', index: 0 });
  }
  for (let i = 2; i < difficulties.length; i += 1) {
    if (
      difficulties[i] === 'hard' &&
      difficulties[i - 1] === 'hard' &&
      difficulties[i - 2] === 'hard'
    ) {
      violations.push({ kind: 'run', index: i });
    }
  }
  const last = difficulties.length - 1;
  if (endpointsApply && difficulties[last] !== 'hard' && difficulties[last - 1] !== 'hard') {
    violations.push({ kind: 'final', index: last });
  }
  return violations;
}

/**
 * 出題順の制約（本仕様 28 節）を、選択の前に slot の並びで満たしておく。
 *
 *  - HARD を 3 連続させない
 *  - 1 問目は EASY か MEDIUM
 *  - 最後の 2 問のどちらかは HARD
 *
 * 並べ替えるだけで、種別ごとの (カテゴリ, 形式, 難易度) の多重集合は変えない。
 * MIXED の種別並び・SETUP の 80/20・カテゴリ quota はそのまま保たれる。
 *
 * 1 回ずつ交換して違反を減らす貪欲法では解けない。
 * 「交換すると別の違反が生まれるが、2 手先では解ける」並びがあるため
 * （例: 171〜182 の 10 問で 3 投フルがすべて HARD になり、1 問目へ来る場合）。
 * 難易度の並びを決定論的な深さ優先探索で 1 度だけ決め、その並びへ slot を配り直す。
 * 探索は失敗状態を記録して打ち切るので、無限 retry にはならない。
 */
function repairSlotOrder(
  slots: Slot[],
  all: readonly Candidate[],
  count: number,
  reviewTargets: readonly ReviewTarget[],
): boolean {
  const expected = slots.map((slot) => expectedDifficultyOf(slot, all, reviewTargets));
  if (orderingViolations(expected, count).length === 0) return true;

  const kinds = slots.map((slot) => slot.kind);

  // 種別 × 難易度 × 「難易度が確定しているか」ごとに、元の並び順を保った待ち行列を作る。
  //
  // 復習枠だけは、実際に配られる候補の難易度が計画とずれることがある。
  // 復習 bucket は score 順で、直近履歴や出題順で弾かれると別の候補へ落ちるためで、
  // 計画時点の難易度は予測でしかない（独立監査 F-010）。
  const queues = new Map<string, Slot[]>();
  const remaining = new Map<string, number>();
  const queueKey = (
    kind: TrainingKind,
    difficulty: TrainingDifficulty,
    review: boolean,
  ): string => `${kind}|${difficulty}|${review ? 'review' : 'fixed'}`;
  for (const [index, slot] of slots.entries()) {
    const key = queueKey(slot.kind, expected[index], slot.review);
    const queue = queues.get(key);
    if (queue) queue.push(slot);
    else queues.set(key, [slot]);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const endpointsApply = count >= 10 && slots.length >= 3;
  const order: TrainingDifficulty[] = [];
  /** その位置の難易度が計画どおりに確定するか（復習枠は確定しない）。 */
  const fixed: boolean[] = [];
  const dead = new Set<string>();
  let steps = 0;
  // 状態を記録しながら探索するので、この上限に当たることは実際には無い。
  // それでも、計画段階で時間を使い切らないための保険として置く。
  const maxSteps = 20000;

  const stateKey = (index: number, hardRun: number, previousFixedHard: boolean): string => {
    const counts = [...remaining.entries()]
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${key}:${value}`)
      .sort()
      .join(',');
    return `${index}|${hardRun}|${previousFixedHard ? 1 : 0}|${counts}`;
  };

  const search = (index: number, hardRun: number, previousFixedHard: boolean): boolean => {
    if (index >= slots.length) return true;
    steps += 1;
    if (steps > maxSteps) return false;
    const key = stateKey(index, hardRun, previousFixedHard);
    if (dead.has(key)) return false;

    const kind = kinds[index];
    // 計画どおりの難易度を最優先で試し、駄目なら決まった順で他を試す。
    // 実現できる並びのうち、元の計画にいちばん近いものが選ばれる。
    const preference: TrainingDifficulty[] = [
      expected[index],
      ...DIFFICULTY_ORDER.filter((difficulty) => difficulty !== expected[index]),
    ];

    for (const difficulty of preference) {
      const isHard = difficulty === 'hard';
      if (isHard && hardRun >= 2) continue;
      if (endpointsApply && index === 0 && isHard) continue;

      // 復習枠は anchor で散らしてあるので、その位置がもともと復習枠だったかを優先する。
      // 端点の条件（最後の 2 問のどちらかは HARD）だけは確定側で満たす。
      const order0 = slots[index].review ? [false, true] : [true, false];
      for (const isFixed of order0) {
        const slotKey = queueKey(kind, difficulty, !isFixed);
        const left = remaining.get(slotKey) ?? 0;
        if (left <= 0) continue;

        // 最後の 2 問の HARD は、実際にその難易度で出ることが確定している slot で満たす。
        // 復習枠の予測difficultyに頼ると、予測が外れたときに末尾で HARD を作り直すことになり、
        // カテゴリ quota を崩してしまう（独立監査 F-010）。
        if (endpointsApply && index === slots.length - 1 && !previousFixedHard) {
          if (!(isHard && isFixed)) continue;
        }

        remaining.set(slotKey, left - 1);
        order.push(difficulty);
        fixed.push(isFixed);
        if (search(index + 1, isHard ? hardRun + 1 : 0, isHard && isFixed)) return true;
        order.pop();
        fixed.pop();
        remaining.set(slotKey, left);
      }
    }

    dead.add(key);
    return false;
  };

  // 実現できる並びが無い場合は、計画を変えずに false を返す（呼び出し側が復習枠を減らす）。
  if (!search(0, 0, false)) return false;

  const cursor = new Map<string, number>();
  for (const [index, difficulty] of order.entries()) {
    const key = queueKey(kinds[index], difficulty, !fixed[index]);
    const at = cursor.get(key) ?? 0;
    cursor.set(key, at + 1);
    const queue = queues.get(key);
    if (queue === undefined) return false;
    slots[index] = queue[at];
  }
  return true;
}

/** 直近に出した問題（chunk をまたいで anti-repeat を維持するために渡す）。 */
export interface RecentEntry {
  readonly problemKey: string;
  readonly contextKey: string;
}

export interface GenerateOptions {
  readonly settings: TrainingSettings;
  readonly seed: number;
  /** 重点的に再出題したい対象。数値だけの legacy 形式も受け付ける。 */
  readonly reviewTargets?: readonly (ReviewTarget | number)[];
  /** 生成する問題数。settings.questionCount が null のときに使う。 */
  readonly count?: number;
  /** 直前の chunk の末尾（無限モードで境界の連続を防ぐ）。 */
  readonly recentHistory?: readonly RecentEntry[];
}

export interface SamplingReport {
  readonly requested: number;
  readonly generated: number;
  /** 条件を緩めた回数。 */
  readonly relaxCount: number;
  /** quota を利用可能 bucket へ再配分した回数。 */
  readonly quotaNormalizedCount: number;
  /**
   * setup-first-dart の枠に候補が足りず、setup-adjustment へ戻した問題数。
   * 出題範囲を狭く設定したときにここが増える（本仕様 7-1 節）。
   */
  readonly firstDartShortfall: number;
  readonly reviewPlaced: number;
  readonly trivialCount: number;
  readonly directOneDartCount: number;
  readonly modeDistribution: Readonly<Record<string, number>>;
  readonly formatDistribution: Readonly<Record<string, number>>;
  readonly difficultyDistribution: Readonly<Record<string, number>>;
  readonly categoryDistribution: Readonly<Record<string, number>>;
  readonly maxSameModeRun: number;
}

interface Slot {
  readonly kind: TrainingKind;
  category: TrainingCategory | null;
  format: TrainingFormat | null;
  preferredDifficulty: TrainingDifficulty | null;
  review: boolean;
}

function normalizeReviewTargets(
  targets: readonly (ReviewTarget | number)[] | undefined,
): ReviewTarget[] {
  if (!targets) return [];
  return targets.map((target) =>
    typeof target === 'number' ? reviewTargetFromScore(target) : target,
  );
}

function reviewScoreOf(candidate: Candidate, targets: readonly ReviewTarget[]): number {
  let best = 0;
  for (const target of targets) {
    if (target.kind !== null && target.kind !== candidate.kind) continue;
    let score = 0;
    if (target.problemKey !== null && target.problemKey === candidate.problemKey) score = 100;
    else if (target.primaryCategory !== null && target.primaryCategory === candidate.category) {
      score = 60;
    } else if (
      target.learningTags.length > 0 &&
      target.learningTags.some((tag) => candidate.tags.includes(tag))
    ) {
      score = 40;
    } else if (
      target.startRemaining !== null &&
      target.startRemaining === candidate.startRemaining
    ) {
      score = 30;
    }
    if (score > 0) best = Math.max(best, score + target.weight);
  }
  return best;
}

interface Ring {
  readonly items: readonly Candidate[];
  cursor: number;
}

/**
 * bucket ごとに 1 度だけ shuffle し、cursor を進めながら配る。
 * 同じ bucket を何度引いても順に一巡するので、乱数の引き直しが要らない。
 *
 * `priority` を渡すと、shuffle したうえで優先度の高い順に安定ソートする。
 * 復習 bucket で「間違えた問題そのもの」を、同じカテゴリの別問題より先に配るために使う。
 */
function createBucketIndex(all: readonly Candidate[], random: RandomSource) {
  const rings = new Map<string, Ring>();
  return {
    ring(
      key: string,
      filter: (candidate: Candidate) => boolean,
      priority?: (candidate: Candidate) => number,
    ): Ring {
      const existing = rings.get(key);
      if (existing) return existing;
      let items = shuffled(all.filter(filter), random);
      if (priority) {
        const rank = new Map(items.map((item, index) => [item, index]));
        items = [...items].sort(
          (a, b) => priority(b) - priority(a) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0),
        );
      }
      const ring: Ring = { items, cursor: 0 };
      rings.set(key, ring);
      return ring;
    },
  };
}

/**
 * 難易度の縛り方。
 *  preferred: slot に割り当てた難易度そのもの
 *  budget   : 種別の難易度 quota がまだ残っている難易度
 *  any      : 制約なし
 */
type DifficultyConstraint = 'preferred' | 'budget' | 'any';

interface HistoryLevel {
  readonly keyWindow: number;
  readonly contextWindow: number;
}

/**
 * 条件を緩める順序（本仕様 49 節 / 独立監査 F-008）。
 *
 * 狭い出題範囲では「同じカテゴリの 1 件を早く出し直す」か
 * 「形式を保ったまま別カテゴリへ広げる」かの二択になる。優先順位は
 *
 *   形式 quota → 出題順 → trivial / 1 投上がり上限 → 直近履歴 → カテゴリ → 難易度
 *
 * なので、直近履歴の窓を縮める前にカテゴリを外した bucket を試す。
 * 選択ループの入れ子はこの順に対応していて、外側ほど後まで守られる。
 *
 * 難易度は「希望 → 種別 quota の残 → 制約なし」の 3 段階。
 * 希望が出題順の制約で弾かれたときに quota を使い切った難易度を選び直さないための段階で、
 * ここを飛ばすと EASY が quota を超え、EASY = trivial な RECOVERY / SETUP 基礎確認で
 * trivial 上限を押し出す。
 */
const HISTORY_LEVELS: readonly HistoryLevel[] = [
  { keyWindow: 5, contextWindow: 3 },
  { keyWindow: 5, contextWindow: 1 },
  { keyWindow: 5, contextWindow: 0 },
  { keyWindow: 3, contextWindow: 0 },
  { keyWindow: 1, contextWindow: 0 },
];

const DIFFICULTY_CONSTRAINTS: readonly DifficultyConstraint[] = ['preferred', 'budget', 'any'];

/** 直近履歴の除外窓（5 問 / 3 問）を保ったままの段階。 */
const STRICT_HISTORY_LEVEL = 0;

/**
 * slot（各問のわく）を先に決める。
 *
 *  1. 種別の並び（MIXED は mode bag）
 *  2. 種別ごとの quota → カテゴリ / 形式 / 難易度の希望
 *  3. 出題順の制約（HARD の連続・1 問目・最後の 2 問）
 *  4. 復習枠の位置
 *
 * 候補の選択はここでは行わない（quota と並びの決定だけを担う）。
 */
function planSlots(input: {
  readonly settings: TrainingSettings;
  readonly count: number;
  readonly all: readonly Candidate[];
  readonly availableKinds: readonly TrainingKind[];
  readonly reviewTargets: readonly ReviewTarget[];
  readonly random: RandomSource;
}): { slots: Slot[]; quotaNormalizedCount: number; firstDartShortfall: number } {
  const { settings, count, all, availableKinds, reviewTargets, random } = input;
  let quotaNormalizedCount = 0;
  let firstDartShortfall = 0;

  // --- 1. 種別の並び --------------------------------------------------------
  let kindSequence: TrainingKind[];
  if (settings.mode === 'mixed') {
    const quota = modeQuota(count);
    const usable = availableKinds;
    let total = usable.reduce((sum, kind) => sum + quota[kind], 0);
    if (total === 0) {
      kindSequence = Array.from({ length: count }, (_, i) => usable[i % usable.length]);
    } else {
      const adjusted: Record<TrainingKind, number> = { checkout: 0, setup: 0, recovery: 0 };
      for (const kind of usable) adjusted[kind] = quota[kind];
      // 使えない種別のぶんを、使える種別へ決定論的に配り直す。
      let missing = count - total;
      let cursor = 0;
      while (missing > 0) {
        adjusted[usable[cursor % usable.length]] += 1;
        missing -= 1;
        cursor += 1;
        quotaNormalizedCount += 1;
      }
      while (missing < 0) {
        const kind = usable[cursor % usable.length];
        if (adjusted[kind] > 0) {
          adjusted[kind] -= 1;
          missing += 1;
        }
        cursor += 1;
        quotaNormalizedCount += 1;
      }
      total = usable.reduce((sum, kind) => sum + adjusted[kind], 0);
      kindSequence = orderedBag(adjusted, usable, random, 2);
    }
  } else {
    kindSequence = Array.from({ length: count }, () => settings.mode as TrainingKind);
  }

  // --- 2. 種別ごとの slot 仕様 ---------------------------------------------
  const slots: Slot[] = kindSequence.map((kind) => ({
    kind,
    category: null,
    format: null,
    preferredDifficulty: null,
    review: false,
  }));

  const indicesByKind = new Map<TrainingKind, number[]>();
  for (const [index, slot] of slots.entries()) {
    const bucket = indicesByKind.get(slot.kind);
    if (bucket) bucket.push(index);
    else indicesByKind.set(slot.kind, [index]);
  }

  for (const [kind, indices] of indicesByKind) {
    const kindCount = indices.length;
    if (kind === 'setup') {
      /*
       * SETUP の枠は 2 段階で決める。
       *
       *   1. 20% を「1 投目だけを選ぶ」形式（setup-first-dart）へ回す。
       *      候補が足りないときは無限 retry をせず、不足分を
       *      setup-adjustment へ決定論的に戻す（本仕様 7-1 節）。
       *   2. 残りの枠へ、1 投調整のカテゴリ quota（A〜I）を配る。
       *
       * こうすると「どのカテゴリが何問出るか」が計画の時点で確定するので、
       * 監査側でも同じ関数（plannedSetupCategoryQuota）で検算できる。
       */
      const firstDartPool = all.filter(
        (c) => c.kind === 'setup' && c.format === 'setup-first-dart',
      );
      const distinctFirstDart = new Set(firstDartPool.map((c) => c.problemKey)).size;
      const requestedFirstDart = Math.min(setupFirstDartCount(kindCount), kindCount);
      const wantedFirstDart = Math.min(requestedFirstDart, distinctFirstDart);
      firstDartShortfall += requestedFirstDart - wantedFirstDart;

      const adjustmentCount = kindCount - wantedFirstDart;
      const availableAdjustment = new Set(
        all
          .filter((c) => c.kind === 'setup' && c.format === 'setup-adjustment')
          .map((c) => c.category),
      );
      const usable = ADJUSTMENT_CATEGORY_PRIORITY.filter((category) =>
        availableAdjustment.has(category),
      );
      const adjustmentCapacity = new Map<SetupCategory, number>();
      for (const candidate of all) {
        if (candidate.kind !== 'setup' || candidate.format !== 'setup-adjustment') continue;
        const category = candidate.category as SetupCategory;
        adjustmentCapacity.set(category, (adjustmentCapacity.get(category) ?? 0) + 1);
      }
      const adjusted = normalizedSetupCategoryQuota(
        kindCount,
        adjustmentCount,
        usable,
        (category) => adjustmentCapacity.get(category) ?? 0,
      );
      const baseQuota = setupCategoryQuota(kindCount);
      quotaNormalizedCount += ADJUSTMENT_CATEGORY_PRIORITY.reduce(
        (sum, category) => sum + Math.abs((adjusted[category] ?? 0) - (baseQuota[category] ?? 0)),
        0,
      );

      const adjustmentSlots = orderedBag<SetupCategory>(adjusted, usable, random, 2);

      // 1 投目の問題は、セッション全体へ均等に散らす。
      const firstDartSlotIndices = new Set<number>();
      if (wantedFirstDart > 0) {
        const step = kindCount / wantedFirstDart;
        for (let n = 0; n < wantedFirstDart; n += 1) {
          firstDartSlotIndices.add(Math.min(kindCount - 1, Math.floor(n * step + step / 2)));
        }
        // 端数で位置が重なった場合だけ、前から空いている枠へ寄せる。
        for (let n = 0; n < kindCount && firstDartSlotIndices.size < wantedFirstDart; n += 1) {
          firstDartSlotIndices.add(n);
        }
      }

      const categorySlots: Array<SetupCategory | null> = [];
      const formatSlots: TrainingFormat[] = [];
      let adjustmentCursor = 0;
      for (let n = 0; n < kindCount; n += 1) {
        if (firstDartSlotIndices.has(n)) {
          categorySlots.push('setup-first-dart-safety');
          formatSlots.push('setup-first-dart');
        } else {
          categorySlots.push(adjustmentSlots[adjustmentCursor] ?? null);
          adjustmentCursor += 1;
          formatSlots.push('setup-adjustment');
        }
      }

      // 難易度は「そのカテゴリ・形式で実際に出せるもの」から quota を消化する。
      // カテゴリ quota が優先なので、出せない難易度を希望しても意味がない（本仕様 21 節）。
      const difficultyRemaining = difficultyQuota('setup', kindCount);

      /*
       * 1 投目の問題の難易度は、その枠数ぶんだけ先に配る。
       *
       * この形式の候補は
       *   medium = 主目標の 20 がそのまま安全だと見抜く問題（295・300・304 …）
       *   hard   = 20 を捨てて 18 / 19 から入る問題（299・302・303 …）
       * に分かれている。1 問ずつ「残り枠の多い難易度」を選ぶ配り方だと、
       * SETUP 全体では medium の枠が多いため 1 投目の枠がすべて medium になり、
       * 教材の核である hard 側が 1 問も出なくなる。
       * 枠数に比例した内訳をここで決めてから、残りを 1 投調整へ回す。
       */
      const firstDartOffered = new Set(
        firstDartPool.map((candidate) => candidate.difficulty),
      );
      const firstDartDifficulties = orderedBag(
        normalizeDifficultyQuota(
          difficultyQuota('setup', wantedFirstDart),
          DIFFICULTY_ORDER.filter((difficulty) => firstDartOffered.has(difficulty)),
          wantedFirstDart,
        ),
        DIFFICULTY_ORDER,
        random,
        2,
      );
      for (const difficulty of firstDartDifficulties) {
        if (difficultyRemaining[difficulty] > 0) difficultyRemaining[difficulty] -= 1;
      }

      const difficultySlots: Array<TrainingDifficulty | null> = [];
      let firstDartDifficultyCursor = 0;
      for (let n = 0; n < kindCount; n += 1) {
        const category = categorySlots[n];
        const format = formatSlots[n];
        if (format === 'setup-first-dart') {
          difficultySlots.push(firstDartDifficulties[firstDartDifficultyCursor] ?? null);
          firstDartDifficultyCursor += 1;
          continue;
        }
        const offered = new Set(
          all
            .filter(
              (c) => c.kind === 'setup' && c.category === category && c.format === format,
            )
            .map((c) => c.difficulty),
        );
        const withQuota = DIFFICULTY_ORDER.filter(
          (difficulty) => offered.has(difficulty) && difficultyRemaining[difficulty] > 0,
        );
        const pick =
          withQuota.length > 0
            ? withQuota.reduce((best, difficulty) =>
                difficultyRemaining[difficulty] > difficultyRemaining[best] ? difficulty : best,
              )
            : (DIFFICULTY_ORDER.find((difficulty) => offered.has(difficulty)) ?? null);
        if (pick !== null && difficultyRemaining[pick] > 0) difficultyRemaining[pick] -= 1;
        difficultySlots.push(pick);
      }

      for (const [n, slotIndex] of indices.entries()) {
        slots[slotIndex].category = categorySlots[n] ?? null;
        slots[slotIndex].preferredDifficulty = difficultySlots[n] ?? null;
        slots[slotIndex].format = formatSlots[n];
      }
    } else {
      const difficultySlots = orderedBag(
        difficultyQuota(kind, kindCount),
        DIFFICULTY_ORDER,
        random,
        2,
      );
      for (const [n, slotIndex] of indices.entries()) {
        slots[slotIndex].preferredDifficulty = difficultySlots[n] ?? null;
      }
    }
  }

  // --- 3. review slot ------------------------------------------------------
  //
  // 復習枠は「計画した形式・カテゴリと両立する slot」へ置く。
  // 種別だけ合わせて任意の slot を差し替えると、SETUP の 80/20 と A〜I の
  // カテゴリ quota が壊れる（復習を有効にしたときだけ構成が変わってしまう）。
  const wantedReview = settings.reviewWeakFirst && reviewTargets.length > 0 ? reviewQuota(count) : 0;
  if (wantedReview > 0) {
    const reviewable = all.filter((candidate) => reviewScoreOf(candidate, reviewTargets) > 0);

    // 計画した形式もカテゴリも両立する slot だけを復習枠にする。
    // 形式だけ合わせて別カテゴリの問題を差し込むと、A〜I の quota が崩れる。
    const compatible = (slot: Slot): Candidate[] =>
      reviewable.filter(
        (candidate) =>
          candidate.kind === slot.kind &&
          (slot.format === null || candidate.format === slot.format) &&
          (slot.category === null || candidate.category === slot.category),
      );
    const matches = (slot: Slot): boolean => compatible(slot).length > 0;

    // 復習枠は難易度 quota ではなく score 順で配るので、置く場所を選ばないと
    // その slot の難易度が計画と変わり、出題順の制約が実現できなくなる
    // （HARD の苦手問題が 3 枠に入ると HARD が増えすぎる）。
    // 計画した難易度と一致する slot を先に使う。
    const keepsDifficulty = (slot: Slot): boolean => {
      const pool = compatible(slot);
      if (pool.length === 0) return false;
      const best = pool.reduce((top, candidate) =>
        reviewScoreOf(candidate, reviewTargets) > reviewScoreOf(top, reviewTargets)
          ? candidate
          : top,
      );
      return best.difficulty === expectedDifficultyOf(slot, all, reviewTargets);
    };

    /*
     * 「間違えた問題そのもの」を出せる slot を最優先で確保する。
     *
     * 復習 ring は slot の形式・カテゴリに合わせて絞るので、
     * 復習枠が別カテゴリの slot に置かれると、その問題は二度と配られない。
     * 1 投目の選択（setup-first-dart）のように枠が 20% しか無い形式では、
     * 均等に散らした位置がほぼ必ず 1 投調整の slot に当たり、
     * 苦手として登録した問題の露出がまったく増えなかった。
     */
    const exactKeys = new Set(
      reviewTargets
        .map((target) => target.problemKey)
        .filter((key): key is string => key !== null),
    );
    const hasExactMatch = (slot: Slot): boolean =>
      exactKeys.size > 0 &&
      compatible(slot).some((candidate) => exactKeys.has(candidate.problemKey));
    const exactAndKeepsDifficulty = (slot: Slot): boolean =>
      hasExactMatch(slot) && keepsDifficulty(slot);

    // 均等に散らした位置を起点に、近い順で両立する slot を探す。
    const anchors: number[] = [];
    for (let r = 0; r < Math.min(wantedReview, count); r += 1) {
      anchors.push(Math.min(count - 1, Math.floor(((r + 0.5) * count) / wantedReview)));
    }

    const taken = new Set<number>();
    // 1 巡目は「間違えた問題そのものを出せて、計画した難易度も変えない slot」、
    // 2 巡目は「計画した難易度を変えない slot」、
    // 足りなければ 3 巡目で両立する slot から埋める。
    for (const acceptable of [exactAndKeepsDifficulty, keepsDifficulty, matches]) {
      for (const anchor of anchors) {
        if (taken.size >= wantedReview) break;
        for (let distance = 0; distance < count; distance += 1) {
          const nearby = distance === 0 ? [anchor] : [anchor + distance, anchor - distance];
          let claimed = false;
          for (const index of nearby) {
            if (index < 0 || index >= count || taken.has(index)) continue;
            if (!acceptable(slots[index])) continue;
            taken.add(index);
            claimed = true;
            break;
          }
          if (claimed) break;
        }
      }
    }
    // 両立する slot が quota より少ない場合は、復習枠を減らす。
    // 苦手を出すために出題構成を崩さない、という優先順位にする。
    for (const index of taken) slots[index].review = true;
  }

  // --- 4. 出題順 -----------------------------------------------------------
  //
  // 復習枠を決めたあとに並べる。復習枠の難易度は quota ではなく
  // 「配られる復習候補」で決まるので、先に並べると計画と実際がずれる。
  let ordered = repairSlotOrder(slots, all, count, reviewTargets);
  if (!ordered) {
    // 復習候補の難易度によっては、その多重集合では出題順の制約を満たす並びが
    // 存在しない（例: HARD が 7 問になると、HARD 3 連続を避けて並べられない）。
    // 出題順・quota を崩す代わりに、復習枠を後ろから 1 つずつ諦める。
    // 復習で出題構成を崩さない、という優先順位（本仕様 31 節）に合わせる。
    const reviewed = slots
      .map((slot, index) => (slot.review ? index : -1))
      .filter((index) => index >= 0);
    for (let n = reviewed.length - 1; n >= 0 && !ordered; n -= 1) {
      slots[reviewed[n]].review = false;
      ordered = repairSlotOrder(slots, all, count, reviewTargets);
    }
  }

  return { slots, quotaNormalizedCount, firstDartShortfall };
}

/** 設定に従って出題列を作る。同じ seed からは常に同じ並びになる。 */
export function generateQuestions(options: GenerateOptions): TrainingQuestion[] {
  return generateQuestionsWithReport(options).questions;
}

export function generateQuestionsWithReport(options: GenerateOptions): {
  questions: TrainingQuestion[];
  report: SamplingReport;
} {
  const { settings, seed } = options;
  const count = settings.questionCount ?? options.count ?? 10;
  const random = createRandom(seed);
  const pools = buildPools(settings);
  const availableKinds = kindsWithCandidates(settings.mode, pools);

  const emptyReport: SamplingReport = {
    requested: count,
    generated: 0,
    relaxCount: 0,
    quotaNormalizedCount: 0,
    firstDartShortfall: 0,
    reviewPlaced: 0,
    trivialCount: 0,
    directOneDartCount: 0,
    modeDistribution: {},
    formatDistribution: {},
    difficultyDistribution: {},
    categoryDistribution: {},
    maxSameModeRun: 0,
  };

  if (availableKinds.length === 0 || count <= 0) {
    return { questions: [], report: emptyReport };
  }

  const all = candidatesOf(pools);
  if (all.length === 0) return { questions: [], report: emptyReport };

  const reviewTargets = normalizeReviewTargets(options.reviewTargets);
  const { slots, quotaNormalizedCount, firstDartShortfall } = planSlots({
    settings,
    count,
    all,
    availableKinds,
    reviewTargets,
    random,
  });


  // --- 4. 選択 -------------------------------------------------------------
  const buckets = createBucketIndex(all, random);
  const recent: RecentEntry[] = [...(options.recentHistory ?? [])];
  const questions: TrainingQuestion[] = [];
  const difficulties: TrainingDifficulty[] = [];
  let relaxCount = 0;
  let categoryNormalizedCount = 0;
  let reviewPlaced = 0;
  let trivialCount = 0;
  let directCount = 0;
  const maxTrivial = trivialCap(count);
  const maxDirect = directOneDartCap(count);

  /**
   * 種別ごとの難易度 quota の残数。
   *
   * CHECKOUT / RECOVERY は難易度そのものが quota なので、実際に選んだぶんを減らす。
   * SETUP は難易度が (カテゴリ, 形式) から一意に決まるため、カテゴリ quota 側で決まる。
   */
  const difficultyBudget = new Map<TrainingKind, Record<TrainingDifficulty, number>>();
  const slotsPerKind = new Map<TrainingKind, number>();
  for (const slot of slots) {
    slotsPerKind.set(slot.kind, (slotsPerKind.get(slot.kind) ?? 0) + 1);
  }
  for (const [kind, size] of slotsPerKind) {
    if (kind === 'setup') continue;
    difficultyBudget.set(kind, { ...difficultyQuota(kind, size) });
  }

  const budgetAllows = (candidate: Candidate): boolean => {
    const budget = difficultyBudget.get(candidate.kind);
    return budget === undefined || budget[candidate.difficulty] > 0;
  };

  const orderingAllows = (candidate: Candidate, index: number): boolean => {
    // HARD を 3 連続させない。
    if (
      candidate.difficulty === 'hard' &&
      difficulties.length >= 2 &&
      difficulties[difficulties.length - 1] === 'hard' &&
      difficulties[difficulties.length - 2] === 'hard'
    ) {
      return false;
    }
    if (count >= 10) {
      // 1 問目は EASY か MEDIUM から始める。
      if (index === 0 && candidate.difficulty === 'hard') return false;
      // 最後の 2 問のどちらかは HARD にする。
      if (
        index === count - 1 &&
        candidate.difficulty !== 'hard' &&
        difficulties[difficulties.length - 1] !== 'hard'
      ) {
        return false;
      }
    }
    return true;
  };

  const capsAllow = (candidate: Candidate): boolean => {
    if (candidate.trivial && trivialCount >= maxTrivial) return false;
    if (candidate.directOneDart && directCount >= maxDirect) return false;
    return true;
  };

  const passesHistory = (candidate: Candidate, level: HistoryLevel): boolean => {
    const keyWindow = recent.slice(-level.keyWindow);
    if (level.keyWindow > 0 && keyWindow.some((item) => item.problemKey === candidate.problemKey)) {
      return false;
    }
    const contextWindow = recent.slice(-level.contextWindow);
    if (
      level.contextWindow > 0 &&
      contextWindow.some((item) => item.contextKey === candidate.contextKey)
    ) {
      return false;
    }
    return true;
  };

  for (let index = 0; index < count; index += 1) {
    const slot = slots[index];

    /**
     * 候補集合を、条件の強い順に用意する。
     *
     * 形式は絶対に落とさない。カテゴリを外した ring は「決定論的な quota 正規化」として扱い、
     * 使った回数を report の `quotaNormalizedCount` に足す。
     */
    interface RingSpec {
      readonly ring: Ring;
      /** この ring を使ってよい直近履歴の段階（HISTORY_LEVELS の index）。 */
      readonly historyMin: number;
      readonly historyMax: number;
      /** 難易度 quota を見ない（復習枠）。 */
      readonly ignoreDifficulty: boolean;
      /** カテゴリを外した ring か。 */
      readonly categoryRelaxed: boolean;
    }

    const ringSpecs: RingSpec[] = [];
    const pushRing = (
      ring: Ring,
      options: Partial<Omit<RingSpec, 'ring'>> = {},
    ): void => {
      ringSpecs.push({
        ring,
        historyMin: options.historyMin ?? 0,
        historyMax: options.historyMax ?? HISTORY_LEVELS.length - 1,
        ignoreDifficulty: options.ignoreDifficulty ?? false,
        categoryRelaxed: options.categoryRelaxed ?? false,
      });
    };

    if (slot.review) {
      // 間違えた問題そのもの（problemKey 一致）を、同じカテゴリ・同じタグの
      // 別問題より先に配る。score をふるい分けだけに使うと、
      // 復習枠が「関連しているだけの問題」で埋まってしまう。
      //
      // ただし、計画した形式・カテゴリを無視して差し替えてはいけない。
      // SETUP の 80/20 とカテゴリ quota を保ったまま復習する。
      const reviewRing = buckets.ring(
        `review|${slot.kind}|${slot.format ?? '*'}|${slot.category ?? '*'}`,
        (candidate) =>
          candidate.kind === slot.kind &&
          (slot.format === null || candidate.format === slot.format) &&
          (slot.category === null || candidate.category === slot.category) &&
          reviewScoreOf(candidate, reviewTargets) > 0,
        (candidate) => reviewScoreOf(candidate, reviewTargets),
      );
      // 復習枠でも「直近 5 問に同じ問題」「直近 3 問に同じ状況」は外さない（本仕様 31 節）。
      // 逆に難易度 quota と trivial 上限は見ない。復習枠は「その問題をもう一度出す」ための
      // 枠なので、難易度が合う別問題を先に選んでしまうと目的を果たせない。
      if (reviewRing.items.length > 0) {
        pushRing(reviewRing, {
          historyMin: STRICT_HISTORY_LEVEL,
          historyMax: STRICT_HISTORY_LEVEL,
          ignoreDifficulty: true,
        });
      }
    }
    if (slot.format !== null) {
      // 形式は SETUP の 80/20 そのものなので、bucket を広げても外さない。
      // 形式を落とした ring を挟むと、計画した 3 投フルの枠が
      // 「同じカテゴリの 1 投調整」で埋まり、形式 quota が崩れる（独立監査 F-006）。
      if (slot.category !== null) {
        pushRing(
          buckets.ring(
            `${slot.kind}|${slot.format}|${slot.category}`,
            (candidate) =>
              candidate.kind === slot.kind &&
              candidate.format === slot.format &&
              candidate.category === slot.category,
          ),
        );
      }
      const formatRing = buckets.ring(`${slot.kind}|${slot.format}|*`, (candidate) =>
        candidate.kind === slot.kind && candidate.format === slot.format,
      );
      if (formatRing.items.length > 0) {
        pushRing(formatRing, { categoryRelaxed: slot.category !== null });
      } else {
        // その形式の候補が 1 件も無いときだけ、種別まで戻す。
        pushRing(
          buckets.ring(`${slot.kind}`, (candidate) => candidate.kind === slot.kind),
          { categoryRelaxed: slot.category !== null },
        );
      }
    } else {
      if (slot.category !== null) {
        pushRing(
          buckets.ring(`${slot.kind}|*|${slot.category}`, (candidate) =>
            candidate.kind === slot.kind && candidate.category === slot.category,
          ),
        );
      }
      pushRing(
        buckets.ring(`${slot.kind}`, (candidate) => candidate.kind === slot.kind),
        { categoryRelaxed: slot.category !== null },
      );
    }

    let chosen: Candidate | null = null;
    let chosenRing: Ring | null = null;
    let chosenSpec: RingSpec | null = null;
    let usedRelax = 0;

    // 入れ子は優先順位そのもの。外側ほど後まで守られる。
    //
    //   出題順 → trivial / 1 投上がり上限 → 直近履歴 → カテゴリ（ring）→ 難易度
    //
    // 直近履歴より内側でカテゴリを外すのが F-008 の要点。
    // 候補が足りているのに同じ問題を早く出し直すより、形式を保ったまま
    // 別カテゴリへ広げるほうが学習として正しい。
    outer: for (const enforceOrdering of [true, false]) {
      for (const enforceCaps of [true, false]) {
        for (const [historyIndex, history] of HISTORY_LEVELS.entries()) {
          for (const [ringIndex, spec] of ringSpecs.entries()) {
            if (historyIndex < spec.historyMin || historyIndex > spec.historyMax) continue;
            const ring = spec.ring;
            if (ring.items.length === 0) continue;
            for (const difficulty of DIFFICULTY_CONSTRAINTS) {
              if (spec.ignoreDifficulty && difficulty !== 'any') continue;
              for (let step = 0; step < ring.items.length; step += 1) {
                const candidate = ring.items[(ring.cursor + step) % ring.items.length];
                if (!passesHistory(candidate, history)) continue;
                if (enforceOrdering && !orderingAllows(candidate, index)) continue;
                if (enforceCaps && !capsAllow(candidate)) continue;
                if (difficulty !== 'any') {
                  if (!budgetAllows(candidate)) continue;
                  if (
                    difficulty === 'preferred' &&
                    slot.preferredDifficulty !== null &&
                    candidate.difficulty !== slot.preferredDifficulty
                  ) {
                    continue;
                  }
                }
                chosen = candidate;
                chosenRing = ring;
                chosenSpec = spec;
                usedRelax =
                  historyIndex +
                  DIFFICULTY_CONSTRAINTS.indexOf(difficulty) +
                  (enforceOrdering ? 0 : 1) +
                  (enforceCaps ? 0 : 1) +
                  (ringIndex > 0 ? 1 : 0);
                ring.cursor = (ring.cursor + step + 1) % ring.items.length;
                break outer;
              }
            }
          }
        }
      }
    }

    if (chosen === null) {
      // 候補が 1 件しかない bucket では、直前と同じ問題を許可する（無限 retry はしない）。
      for (const spec of ringSpecs) {
        const ring = spec.ring;
        if (ring.items.length === 0) continue;
        chosen = ring.items[ring.cursor % ring.items.length];
        chosenRing = ring;
        chosenSpec = spec;
        ring.cursor = (ring.cursor + 1) % ring.items.length;
        usedRelax = HISTORY_LEVELS.length + DIFFICULTY_CONSTRAINTS.length;
        break;
      }
    }
    if (chosen === null) break;
    void chosenRing;
    // カテゴリを外して選んだぶんは、決定論的な quota 正規化として数える。
    if (chosenSpec !== null && chosenSpec.categoryRelaxed && chosen.category !== slot.category) {
      categoryNormalizedCount += 1;
    }

    const budget = difficultyBudget.get(chosen.kind);
    if (budget !== undefined && budget[chosen.difficulty] > 0) {
      budget[chosen.difficulty] -= 1;
    }

    if (usedRelax > 0) relaxCount += 1;
    if (slot.review && reviewScoreOf(chosen, reviewTargets) > 0) reviewPlaced += 1;
    if (chosen.trivial) trivialCount += 1;
    if (chosen.directOneDart) directCount += 1;

    const question = chosen.build(index);
    questions.push(question);
    difficulties.push(chosen.difficulty);
    recent.push({ problemKey: chosen.problemKey, contextKey: chosen.contextKey });
  }

  return {
    questions,
    report: buildReport(
      count,
      questions,
      relaxCount,
      quotaNormalizedCount + categoryNormalizedCount,
      firstDartShortfall,
      reviewPlaced,
      trivialCount,
      directCount,
    ),
  };
}

function buildReport(
  requested: number,
  questions: readonly TrainingQuestion[],
  relaxCount: number,
  quotaNormalizedCount: number,
  firstDartShortfall: number,
  reviewPlaced: number,
  trivialCount: number,
  directOneDartCount: number,
): SamplingReport {
  const modeDistribution: Record<string, number> = {};
  const formatDistribution: Record<string, number> = {};
  const difficultyDistribution: Record<string, number> = {};
  const categoryDistribution: Record<string, number> = {};
  let maxSameModeRun = 0;
  let run = 0;
  let previous: string | null = null;

  for (const question of questions) {
    modeDistribution[question.kind] = (modeDistribution[question.kind] ?? 0) + 1;
    formatDistribution[question.format] = (formatDistribution[question.format] ?? 0) + 1;
    difficultyDistribution[question.difficulty] =
      (difficultyDistribution[question.difficulty] ?? 0) + 1;
    categoryDistribution[question.primaryCategory] =
      (categoryDistribution[question.primaryCategory] ?? 0) + 1;
    run = question.kind === previous ? run + 1 : 1;
    previous = question.kind;
    maxSameModeRun = Math.max(maxSameModeRun, run);
  }

  return {
    requested,
    generated: questions.length,
    relaxCount,
    quotaNormalizedCount,
    firstDartShortfall,
    reviewPlaced,
    trivialCount,
    directOneDartCount,
    modeDistribution,
    formatDistribution,
    difficultyDistribution,
    categoryDistribution,
    maxSameModeRun,
  };
}

/** 直近履歴を次の chunk へ引き継ぐための末尾。 */
export function recentTailOf(
  questions: readonly TrainingQuestion[],
  size = 5,
): RecentEntry[] {
  return questions.slice(-size).map((question) => ({
    problemKey: question.problemKey,
    contextKey: contextKeyOf(question),
  }));
}
