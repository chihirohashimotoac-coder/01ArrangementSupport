import { useEffect, useState } from 'react';
import { PracticePage } from './pages/PracticePage';
import { TrainingPage } from './pages/TrainingPage';
import { SettingsPage } from './pages/SettingsPage';
import { sequenceTable } from './engine/setup/sequences';
import { DEFAULT_SETUP_MAIN_TARGET } from './data/rankingRules';
import './App.css';

type Tab = 'home' | 'checkout' | 'setup' | 'training' | 'settings';

const TABS: ReadonlyArray<{ id: Tab; label: string; sub: string }> = [
  { id: 'checkout', label: 'CHECKOUT', sub: '2〜170' },
  { id: 'setup', label: 'SETUP', sub: '171〜350' },
  { id: 'training', label: 'TRAINING', sub: '反復学習' },
];

function HomePage({ onSelect }: { onSelect: (tab: Tab) => void }) {
  return (
    <div className="home">
      <p className="home__lead">
        01 のアレンジを「答えを覚える」のではなく「判断の規則を身につける」ためのアプリです。
        なぜそのナンバーなのか、外したらどうなるかまで表示します。
      </p>
      <div className="home__modes">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`home-${tab.id}`}
            onClick={() => onSelect(tab.id)}
          >
            <span className="home__mode-label">{tab.label}</span>
            <span className="home__mode-sub">{tab.sub}</span>
          </button>
        ))}
      </div>
      <ul className="home__points">
        <li>すべての判断は決定論的な rule based engine で、オフラインでも動きます。</li>
        <li>1 投ごとに実際の着弾を入れると、残り本数から候補を再計算します。</li>
        <li>成立するルートを不正解にはせず、推奨度（S / A / B / C）と理由を示します。</li>
      </ul>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home');

  // SETUP の探索表は初回だけ構築コストがかかるため、余裕のあるうちに温めておく。
  useEffect(() => {
    const warm = () => sequenceTable(3, DEFAULT_SETUP_MAIN_TARGET);
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(warm);
      return () => window.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(warm, 400);
    return () => window.clearTimeout(handle);
  }, []);

  return (
    <div className="app">
      <header className="app__header">
        <button
          type="button"
          className="app__title"
          data-testid="app-title"
          onClick={() => setTab('home')}
        >
          01 Arrangement Support
        </button>
        <button
          type="button"
          className="app__settings"
          data-testid="nav-settings"
          aria-pressed={tab === 'settings'}
          onClick={() => setTab('settings')}
        >
          設定
        </button>
      </header>

      <nav className="app__nav" aria-label="モード">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`nav-${item.id}`}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="app__main">
        {tab === 'home' && <HomePage onSelect={setTab} />}
        {/* key を分けて、モードを切り替えたら残り点を持ち越さず未入力から始める。 */}
        {tab === 'checkout' && <PracticePage key="checkout" mode="checkout" />}
        {tab === 'setup' && <PracticePage key="setup" mode="setup" />}
        {tab === 'training' && <TrainingPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>

      <footer className="app__footer">
        <p>
          基準ルートは添付資料の第1候補にもとづく「基準ルート」です（PDC 公式ルートではありません）。
          データ・保存はすべて端末内で完結します。
        </p>
      </footer>
    </div>
  );
}
