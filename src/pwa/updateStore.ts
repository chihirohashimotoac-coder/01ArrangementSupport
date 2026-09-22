/**
 * 「新しいバージョンが待機している」状態の保持。
 *
 * Service Worker の API へは触らない。ここが知っているのは
 *
 *   - 更新が待機しているか（表示するかどうか）
 *   - 更新を適用する関数（登録側から渡される）
 *
 * の 2 つだけで、`virtual:pwa-register` を import しない。
 * そうしておくと、画面側のテストが Service Worker の有無に依存しない。
 */
export type UpdateState =
  /** 更新は待機していない。 */
  | 'idle'
  /** 更新が待機していて、ユーザーへ知らせている。 */
  | 'available'
  /** 更新は待機しているが、ユーザーが閉じた。 */
  | 'dismissed';

type Applier = () => void | Promise<void>;

let state: UpdateState = 'idle';
let applier: Applier | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 状態の変化を受け取る。戻り値を呼ぶと解除される（useSyncExternalStore 用）。 */
export function subscribeUpdateState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getUpdateState(): UpdateState {
  return state;
}

/**
 * 新しいバージョンが待機したことを記録する。
 *
 * 一度閉じられたあとでも、さらに新しいビルドが待機すれば再び知らせる
 * （前に閉じたのは、その時点の更新に対する返事だから）。
 */
export function markUpdateAvailable(): void {
  if (state === 'available') return;
  state = 'available';
  emit();
}

/** ユーザーがお知らせを閉じた。更新そのものは待機したまま。 */
export function dismissUpdate(): void {
  if (state !== 'available') return;
  state = 'dismissed';
  emit();
}

/** 更新を適用する手段を登録する（Service Worker の登録側から呼ぶ）。 */
export function setUpdateApplier(next: Applier | null): void {
  applier = next;
}

/**
 * 待機中の更新を適用する。
 *
 * 適用後のリロードは `virtual:pwa-register` が `controlling` を見て行うため、
 * ここでは待たない。手段が無い場合（登録に失敗した場合など）は何もしない。
 */
export function applyPendingUpdate(): void {
  void applier?.();
}

/** テスト用。モジュール状態を初期化する。 */
export function resetUpdateStore(): void {
  state = 'idle';
  applier = null;
  listeners.clear();
}
