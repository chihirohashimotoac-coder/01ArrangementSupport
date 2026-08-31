/**
 * localStorage への安全な読み書き。
 *
 * プライベートブラウジングや容量超過で例外が出る環境があるため、
 * 失敗しても呼び出し側が壊れないようにする。
 */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 何もしない（保存できない環境でもアプリは動かす）
  }
}
