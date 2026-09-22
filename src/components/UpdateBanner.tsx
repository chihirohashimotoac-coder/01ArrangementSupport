import { useSyncExternalStore } from 'react';
import {
  applyPendingUpdate,
  dismissUpdate,
  getUpdateState,
  subscribeUpdateState,
} from '../pwa/updateStore';
import './UpdateBanner.css';

/**
 * 新しいバージョンが待機しているときのお知らせ。
 *
 * 画面いちばん上に出し、押すまで何も起こさない。
 * TRAINING の回答中や SIMULATION のゲーム中でも表示するが、
 * 勝手にリロードしないので進行の邪魔にはならない。
 */
export function UpdateBanner() {
  const state = useSyncExternalStore(subscribeUpdateState, getUpdateState, getUpdateState);
  if (state !== 'available') return null;

  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <p className="update-banner__text">新しいバージョンがあります。</p>
      <div className="update-banner__actions">
        <button
          type="button"
          className="update-banner__apply"
          data-testid="update-banner-apply"
          onClick={applyPendingUpdate}
        >
          更新
        </button>
        <button
          type="button"
          className="update-banner__dismiss"
          data-testid="update-banner-dismiss"
          onClick={dismissUpdate}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
