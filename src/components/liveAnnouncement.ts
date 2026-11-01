/**
 * 読み上げる 1 文の置き場（LiveAnnouncer.tsx が表示する）。
 *
 * 同じ文を続けて差し込んでも読み上げられるよう、いったん空にしてから入れ直す。
 */
let current = '';
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

export function announce(message: string): void {
  if (timer !== null) clearTimeout(timer);
  current = '';
  emit();
  timer = setTimeout(() => {
    timer = null;
    current = message;
    emit();
  }, 30);
}

export function announcementOf(): string {
  return current;
}

export function subscribeAnnouncement(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** テスト用。 */
export function resetAnnouncement(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  current = '';
}
