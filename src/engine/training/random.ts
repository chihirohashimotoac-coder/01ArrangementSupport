/**
 * 再現可能な擬似乱数（mulberry32）。
 *
 * 出題はテストで検証できる必要があるため、Math.random は使わず、
 * seed から決定論的に生成する。
 */
export interface RandomSource {
  /** 0 以上 1 未満。 */
  next(): number;
  /** min 以上 max 以下の整数。 */
  nextInt(min: number, max: number): number;
  /** 配列から 1 つ選ぶ。空配列では null。 */
  pick<T>(items: readonly T[]): T | null;
}

export function createRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: <T,>(items: readonly T[]): T | null =>
      items.length === 0 ? null : items[Math.floor(next() * items.length)],
  };
}
