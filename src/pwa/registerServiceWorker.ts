/**
 * Service Worker の登録。
 *
 * キャッシュするのはアプリの静的ファイルだけで、学習履歴や設定は
 * Service Worker / Cache API へ保存しない（localStorage が担当）。
 *
 * registerType: 'prompt' なので、新しいビルドは待機したままになる。
 * 検出したことを `updateStore` へ伝え、更新するかどうかは画面（UpdateBanner）で
 * ユーザーへ尋ねる。勝手にリロードしない。
 */
import { markUpdateAvailable, setUpdateApplier } from './updateStore';

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  void import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateServiceWorker = registerSW({
        immediate: true,
        onNeedRefresh() {
          markUpdateAvailable();
        },
        onRegisterError(error: unknown) {
          console.warn('Service Worker の登録に失敗しました', error);
        },
      });
      // 押されたときに待機中の Service Worker へ skipWaiting を送る。
      setUpdateApplier(() => updateServiceWorker(true));
    })
    .catch((error: unknown) => {
      console.warn('Service Worker モジュールの読み込みに失敗しました', error);
    });
}
