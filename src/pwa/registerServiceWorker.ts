/**
 * Service Worker の登録。
 *
 * キャッシュするのはアプリの静的ファイルだけで、学習履歴や設定は
 * Service Worker / Cache API へ保存しない（localStorage が担当）。
 * registerType: 'autoUpdate' により、新しいビルドを検出すると置き換える。
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  void import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onRegisterError(error: unknown) {
          console.warn('Service Worker の登録に失敗しました', error);
        },
      });
    })
    .catch((error: unknown) => {
      console.warn('Service Worker モジュールの読み込みに失敗しました', error);
    });
}
