import { useEffect } from 'react';
import { VERSION_HISTORY } from '../data/versionHistory';
import './VersionHistoryPage.css';

export interface VersionHistoryPageProps {
  /** トップページへ戻る。 */
  readonly onBack: () => void;
}

/**
 * バージョン履歴。
 *
 * 初回リリースから現在の版までを新しい順に並べる。
 * 内容は `src/data/versionHistory.ts`（merge 済み PR と commit 履歴から作成）。
 */
export function VersionHistoryPage({ onBack }: VersionHistoryPageProps) {
  // 直前の画面のスクロール位置を持ち越さず、履歴の先頭から読み始められるようにする。
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  return (
    <div className="version-history">
      <div className="version-history__bar">
        <button
          type="button"
          className="version-history__back"
          data-testid="version-history-back"
          onClick={onBack}
        >
          トップへ戻る
        </button>
      </div>

      <div className="version-history__head">
        <h2 className="version-history__title">バージョン履歴</h2>
        <p className="version-history__lead">
          初回リリースから現在の版までの主な変更です。新しいものが上にあります。
        </p>
      </div>

      <ol className="version-history__list" data-testid="version-history-list">
        {VERSION_HISTORY.map((entry) => (
          <li key={entry.label} className="version-history__item" data-testid="version-history-item">
            <div className="version-history__meta">
              <span className="version-history__label">{entry.label}</span>
              {entry.current && <span className="version-history__badge">現在</span>}
              <time className="version-history__date" dateTime={entry.date}>
                {entry.date}
              </time>
            </div>
            <p className="version-history__summary">{entry.summary}</p>
            <ul className="version-history__changes">
              {entry.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <p className="version-history__note">
        日付は変更が取り込まれた日（日本時間）です。バージョン呼称は、その更新で実際に使われたものだけを載せています。
      </p>
    </div>
  );
}
