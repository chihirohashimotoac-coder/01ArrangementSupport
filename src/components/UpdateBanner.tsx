import { useState, useSyncExternalStore } from 'react';
import {
  applyPendingUpdate,
  dismissUpdate,
  getUpdateState,
  subscribeUpdateState,
} from '../pwa/updateStore';
import { ConfirmDialog } from './ui/Modal';
import './UpdateBanner.css';

export interface UpdateBannerProps {
  /**
   * TRAINING / SIMULATION が進行中か。進行中に「更新」を押したら確認を出す。
   * 進行中の内容は一時保存してあるので、更新後に再開できることも伝える。
   */
  readonly sessionActive?: boolean;
}

/**
 * 新しいバージョンが待機しているときのお知らせ。
 *
 * 画面いちばん上に出し、押すまで何も起こさない。
 * TRAINING の回答中や SIMULATION のゲーム中でも表示するが、
 * 勝手にリロードしないので進行の邪魔にはならない。
 */
export function UpdateBanner({ sessionActive = false }: UpdateBannerProps = {}) {
  const state = useSyncExternalStore(subscribeUpdateState, getUpdateState, getUpdateState);
  const [confirming, setConfirming] = useState(false);
  if (state !== 'available') return null;

  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <p className="update-banner__text">新しいバージョンがあります。</p>
      <div className="update-banner__actions">
        <button
          type="button"
          className="update-banner__apply"
          data-testid="update-banner-apply"
          onClick={() => (sessionActive ? setConfirming(true) : applyPendingUpdate())}
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
      <ConfirmDialog
        open={confirming}
        title="いま更新しますか？"
        confirmLabel="更新する"
        onConfirm={() => {
          setConfirming(false);
          applyPendingUpdate();
        }}
        onCancel={() => setConfirming(false)}
        testId="update-confirm"
      >
        <p>
          更新すると画面を読み込み直します。進行中の内容は一時保存してあるので、
          更新したあと同じ画面を開けば続きから再開できます。
        </p>
      </ConfirmDialog>
    </div>
  );
}
