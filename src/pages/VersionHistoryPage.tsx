import { useEffect, useRef, useState } from 'react';
import { Accordion } from '../components/ui/Accordion';
import { prefersReducedMotion } from '../components/ui/motion';
import { Select } from '../components/ui/Select';
import { VERSION_HISTORY } from '../data/versionHistory';
import './VersionHistoryPage.css';

/**
 * アコーディオンの開閉が終わるまでの待ち時間。Accordion.css の伸縮（`--dur-slow` = 260ms）より少し長く取る。
 * 開閉の途中でスクロール先を計算すると、上の版が縮むぶんだけ行き先がずれる。
 */
const ACCORDION_SETTLE_MS = 300;

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
/** PR 番号・CI・Source of Truth など、プレイヤーが読まなくてよい記録か。 */
const DEVELOPER_NOTE_PATTERN = /PR ?#?\d|\bCI\b|Source of Truth|GitHub|E2E|lint|typecheck|監査スクリプト|npm run/;
function isDeveloperNote(change: string): boolean {
  return DEVELOPER_NOTE_PATTERN.test(change);
}

export function VersionHistoryPage({ onBack }: VersionHistoryPageProps) {
  const [openIds, setOpenIds] = useState<readonly string[]>(() =>
    VERSION_HISTORY.filter((entry) => entry.current).map((entry) => entry.label),
  );

  /** プルダウンで選んだ版への移動の予約。続けて選び直したら前の予約は捨てる。 */
  const jumpTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (jumpTimer.current !== null) window.clearTimeout(jumpTimer.current);
    },
    [],
  );

  const jumpTo = (label: string) => {
    setOpenIds([label]);
    if (jumpTimer.current !== null) window.clearTimeout(jumpTimer.current);
    const reduced = prefersReducedMotion();
    // 開閉の伸縮が終わり、高さが確定してから移動する（動きを減らす設定では伸縮が無いので次の描画で）。
    jumpTimer.current = window.setTimeout(
      () => {
        jumpTimer.current = null;
        [...document.querySelectorAll<HTMLElement>('.version-history [data-accordion-id]')]
          .find((element) => element.dataset.accordionId === label)
          ?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      },
      reduced ? 16 : ACCORDION_SETTLE_MS,
    );
  };

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

      {/* プレイヤー向けの 3 行要約（2026-11-01 監査 3-8）。 */}
      <ul className="version-history__player-summary" data-testid="version-history-summary">
        <li>
          いまの版では、CHECKOUT（2〜170）と SETUP（171〜350）のアレンジと理由、TRAINING、SIMULATION が使えます。
        </li>
        <li>推奨や採点の考え方が変わった版には、そのことを各版の説明に書いています。</li>
        <li>PR 番号・CI・データの管理などの開発者向けの記録は、各版の中にたたんであります。</li>
      </ul>

      {/*
        版ごとのアコーディオン。現在の版だけを開いておき、古い版は見出しと日付だけを並べる。
        プルダウンで版を選ぶと、その版を開いて位置まで移動する。
      */}
      <Select
        className="version-history__jump"
        label="版を選んで開く"
        testId="version-history-jump"
        value={openIds[0] ?? ''}
        options={[
          { value: '', label: '選択してください', disabled: true },
          ...VERSION_HISTORY.map((entry) => ({ value: entry.label, label: `${entry.date}  ${entry.label}` })),
        ]}
        onChange={jumpTo}
      />

      <Accordion
        className="version-history__list"
        testId="version-history-list"
        headingLevel={3}
        openIds={openIds}
        onOpenIdsChange={setOpenIds}
        items={VERSION_HISTORY.map((entry) => ({
          id: entry.label,
          testId: 'version-history-item',
          title: (
            <span className="version-history__meta">
              <span className="version-history__label">{entry.label}</span>
              {entry.current && <span className="version-history__badge">現在</span>}
            </span>
          ),
          meta: (
            <time className="version-history__date" dateTime={entry.date}>
              {entry.date}
            </time>
          ),
          content: (
            <>
              <p className="version-history__summary">{entry.summary}</p>
              <ul className="version-history__changes">
                {entry.changes.filter((change) => !isDeveloperNote(change)).map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
              {entry.changes.some(isDeveloperNote) && (
                <details className="version-history__dev" data-testid="version-history-dev">
                  <summary>開発者向けの記録</summary>
                  <ul className="version-history__changes">
                    {entry.changes.filter(isDeveloperNote).map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ),
        }))}
      />

      <p className="version-history__note">
        日付は変更が取り込まれた日（日本時間）です。バージョン呼称は、その更新で実際に使われたものだけを載せています。
      </p>
    </div>
  );
}
