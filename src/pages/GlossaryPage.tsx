import { useEffect } from 'react';
import { GLOSSARY } from '../data/glossary';
import './GlossaryPage.css';

export interface GlossaryPageProps {
  /** トップページへ戻る。 */
  readonly onBack: () => void;
}

/**
 * 用語集（監査フェーズ 2 / 2-8、U-M5）。
 *
 * ホームとメニューから開ける。中身は data/glossary.ts で、本文中の用語のタップ・
 * SIMULATION の振り返りの用語説明と同じ定義を使う。
 */
export function GlossaryPage({ onBack }: GlossaryPageProps) {
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  return (
    <div className="glossary">
      <div className="glossary__bar">
        <button type="button" className="glossary__back" data-testid="glossary-back" onClick={onBack}>
          トップへ戻る
        </button>
      </div>
      <h2 className="glossary__title">用語集</h2>
      <p className="glossary__lead">
        画面に出てくる用語の意味です。本文の中の点線が付いた用語をタップしても、同じ説明が開きます。
      </p>
      <dl className="glossary__list" data-testid="glossary-list">
        {GLOSSARY.map((entry) => (
          <div key={entry.id} className="glossary__item" data-testid={`glossary-${entry.id}`}>
            <dt className="glossary__term">{entry.term}</dt>
            <dd className="glossary__meaning">{entry.meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
