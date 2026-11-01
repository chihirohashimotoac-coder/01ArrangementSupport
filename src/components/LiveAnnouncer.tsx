import { useSyncExternalStore } from 'react';
import { announcementOf, subscribeAnnouncement } from './liveAnnouncement';

/**
 * 画面の読み上げ（aria-live）の差し込み先（2026-11-01 監査 D-M5）。
 *
 * live 領域は、内容と同時に出現すると読み上げられないことがある。そこで
 * App に空の領域を 1 つだけ常に置いておき、判定・BUST・CHECKOUT!・次の狙いを
 * `announce()` で短い 1 文として差し込む。見た目には出さない。
 */
export function LiveAnnouncer() {
  const message = useSyncExternalStore(subscribeAnnouncement, announcementOf, announcementOf);
  return (
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="live-announcer">
      {message}
    </div>
  );
}
