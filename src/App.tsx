import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { HomePage, type HomeDestination } from './pages/HomePage';
import { GlossaryPage } from './pages/GlossaryPage';
import { PracticePage } from './pages/PracticePage';
import { TrainingPage } from './pages/TrainingPage';
import { SimulationPage } from './pages/SimulationPage';
import { SettingsPage } from './pages/SettingsPage';
import { VersionHistoryPage } from './pages/VersionHistoryPage';
import { ReferencesPage } from './pages/ReferencesPage';
import { UpdateBanner } from './components/UpdateBanner';
import { LiveAnnouncer } from './components/LiveAnnouncer';
import { AppMenu, MenuToggle, type MenuDestination } from './components/AppMenu';
import { Breadcrumbs, type BreadcrumbItem } from './components/ui/Breadcrumbs';
import { scoringTripleFirstSequenceTables, sequenceTable } from './engine/setup/sequences';
import { DEFAULT_SETUP_MAIN_TARGET } from './data/rankingRules';
import { VERSION_HISTORY } from './data/versionHistory';
import { usePreferences } from './hooks/usePreferences';
import { MAX_CHECKOUT } from './domain/checkoutRules';
import type { Theme } from './storage/preferences';
import { hashOf, tabFromHash, type Tab } from './navigation';
import './App.css';


type ModeTab = 'checkout' | 'setup' | 'training' | 'simulation';

const TABS: ReadonlyArray<{ id: ModeTab; label: string; scope: string; sub: string }> = [
  { id: 'checkout', label: 'CHECKOUT', scope: '2–170', sub: 'この3投で上がる' },
  { id: 'setup', label: 'SETUP', scope: '171–350', sub: '次の3投に向けて整える' },
  { id: 'training', label: 'TRAINING', scope: '2–350', sub: '反復練習で判断を磨く' },
  { id: 'simulation', label: 'SIMULATION', scope: '301 / 501 / 701', sub: '1ゲーム通して自力でプレイする' },
];

/** パンくずリストに出す画面名。 */
const TAB_LABEL: Record<Tab, string> = {
  home: 'ホーム',
  checkout: 'CHECKOUT',
  setup: 'SETUP',
  training: 'TRAINING',
  simulation: 'SIMULATION',
  settings: '設定',
  history: 'バージョン履歴',
  references: '参考資料・出典',
  glossary: '用語集',
};

const THEME_COLOR: Record<Theme, string> = {
  dark: '#15181b',
  light: '#e7e9ec',
};

/** 版の呼称（「v1.4.9 …」の先頭）。呼称の無い版なら出さない。 */
const CURRENT_VERSION = (() => {
  const label = VERSION_HISTORY.find((entry) => entry.current)?.label ?? '';
  const head = label.split(' ')[0] ?? '';
  return /^v\d/.test(head) ? head : null;
})();

const isPractice = (tab: Tab) => tab === 'checkout' || tab === 'setup';

export default function App() {
  const [tab, setTab] = useState<Tab>(() => tabFromHash(window.location.hash));
  const [practiceSession, setPracticeSession] = useState(0);
  /** ホームの例題・入力欄・範囲外の案内から開いたときだけ、その残り点を入れた状態で始める。 */
  const [practiceInitial, setPracticeInitial] = useState<number | null>(null);
  /** TRAINING / SIMULATION が進行中か（更新バナーで確認を出すため）。 */
  const [sessionActive, setSessionActive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** パンくずの末尾に添える、画面の中の状況（「残り 103」「3 / 10 問目」など）。 */
  const [context, setContext] = useState<string | null>(null);
  const { preferences, setTheme } = usePreferences();

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.style.colorScheme = preferences.theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLOR[preferences.theme]);
  }, [preferences.theme]);

  // SETUP の探索表は初回だけ構築コストがかかるため、余裕のあるうちに温めておく。
  useEffect(() => {
    const warm = () => {
      sequenceTable(3, DEFAULT_SETUP_MAIN_TARGET);
      // 第一ターゲット用の表も同じ桁の構築コストがかかる（v1.3.7）。
      scoringTripleFirstSequenceTables(3, DEFAULT_SETUP_MAIN_TARGET);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(warm);
      return () => window.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(warm, 400);
    return () => window.clearTimeout(handle);
  }, []);

  /*
   * 「戻る」（Android の戻る・ブラウザの戻る）で前の画面へ戻す。
   * 以前は画面の切り替えが state だけで、戻るとアプリそのものが閉じていた。
   * 初回表示の履歴項目にも画面を書いておき、最初の画面へ戻れるようにする。
   */
  useEffect(() => {
    if (window.location.hash !== hashOf(tab)) {
      window.history.replaceState(window.history.state, '', hashOf(tab));
    }
    // 初回だけ。以降は navigate / popstate が URL と state をそろえる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  useEffect(() => {
    const onPopState = () => {
      const next = tabFromHash(window.location.hash);
      const current = tabRef.current;
      setMenuOpen(false);
      if (current !== next && isPractice(current) && isPractice(next)) {
        setPracticeSession((value) => value + 1);
      }
      setPracticeInitial(null);
      setTab(next);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  /**
   * 画面を移る。ヘッダーのモード切り替え・メニュー・パンくず・ホームの導線はすべてここを通る。
   *
   * CHECKOUT と SETUP のあいだを移るときは、別の場面として入力をやり直す（従来どおり）。
   * 同じ CHECKOUT / SETUP を選び直したときは何もしない。
   * 移った画面は履歴に積むので、「戻る」で前の画面へ戻れる。
   */
  const pushTab = useCallback((next: Tab) => {
    if (window.location.hash !== hashOf(next)) {
      window.history.pushState({ tab: next }, '', hashOf(next));
    }
  }, []);

  const navigate = useCallback(
    (next: Tab) => {
      setMenuOpen(false);
      if (next === tab) return;
      if (isPractice(tab) && isPractice(next)) setPracticeSession((value) => value + 1);
      setPracticeInitial(null);
      pushTab(next);
      setTab(next);
    },
    [tab, pushTab],
  );

  // バージョン履歴・参考資料のスクロール位置をトップページへ持ち越さない。
  const backToHome = useCallback(() => {
    navigate('home');
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [navigate]);

  /** 残り点を入れた状態で CHECKOUT / SETUP を開く（例題・ホームの入力欄・範囲外の案内）。 */
  const openPracticeWith = useCallback(
    (mode: 'checkout' | 'setup', remaining: number) => {
      setMenuOpen(false);
      setPracticeInitial(remaining);
      setPracticeSession((value) => value + 1);
      pushTab(mode);
      setTab(mode);
    },
    [pushTab],
  );
  const openCheckoutWith = useCallback(
    (remaining: number) => openPracticeWith('checkout', remaining),
    [openPracticeWith],
  );

  /** 残り点の帯から、CHECKOUT（2〜170）か SETUP（171〜350）かを決めて開く。 */
  const openPracticeFor = useCallback(
    (remaining: number) => openPracticeWith(remaining <= MAX_CHECKOUT ? 'checkout' : 'setup', remaining),
    [openPracticeWith],
  );

  const crumbs: BreadcrumbItem[] =
    tab === 'home'
      ? []
      : [
          { label: TAB_LABEL.home, onSelect: () => navigate('home'), testId: 'crumb-home' },
          {
            label: TAB_LABEL[tab],
            // CHECKOUT / SETUP で残り点を入れているときは、モード名から空欄の初期表示へ戻れる。
            onSelect:
              context !== null && isPractice(tab)
                ? () => {
                    setPracticeInitial(null);
                    setPracticeSession((value) => value + 1);
                  }
                : undefined,
            testId: 'crumb-section',
          },
          ...(context !== null ? [{ label: context, testId: 'crumb-context' }] : []),
        ];

  const navIndex = TABS.findIndex((item) => item.id === tab);
  /*
   * CHECKOUT / SETUP は同じ PracticePage を使い回すので、画面の入場アニメーションの
   * key もそろえる（モードの自動切り替えで入力中の状態を失わせない）。
   */
  const viewKey = isPractice(tab) ? `practice-${practiceSession}` : tab;

  return (
    <div className="app" data-theme={preferences.theme}>
      {/* 更新が待機しているときだけ出る。どの画面でも、いちばん上。 */}
      <UpdateBanner sessionActive={sessionActive} />

      {/*
        ヘッダー = アプリ名 / モードの切り替え / メニュー。
        狭い画面ではアプリ名とメニューの下へモードの切り替えを 1 段で、広い画面では同じ 1 行に並ぶ（App.css）。
      */}
      <header className="app__header">
        <button
          type="button"
          className="app__title"
          data-testid="app-title"
          onClick={() => navigate('home')}
        >
          <span className="app__mark">01</span>
          <span className="app__name"> Arrangement Support</span>
        </button>

        <nav
          className="app__nav"
          aria-label="モード"
          data-selected={navIndex >= 0 ? 'true' : 'false'}
          style={{ '--nav-index': Math.max(navIndex, 0) } as CSSProperties}
        >
          {/* 選んだモードの下を滑って移る面（見た目だけ）。 */}
          <span className="app__nav-thumb" aria-hidden="true" />
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-${item.id}`}
              aria-pressed={tab === item.id}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <MenuToggle open={menuOpen} onClick={() => setMenuOpen((value) => !value)} />
      </header>

      <AppMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        current={tab}
        modes={TABS}
        onNavigate={(destination: MenuDestination) => navigate(destination)}
        theme={preferences.theme}
        onThemeChange={setTheme}
        versionLabel={CURRENT_VERSION}
      />

      <Breadcrumbs items={crumbs} />

      <main className="app__main">
        <div className="app__view" key={viewKey}>
          {tab === 'home' && (
            <HomePage
              modes={TABS}
              onSelect={(destination: HomeDestination) => navigate(destination)}
              onOpenCheckout={openCheckoutWith}
              onOpenRemaining={openPracticeFor}
            />
          )}
          {isPractice(tab) && (
            <PracticePage
              key={practiceSession}
              mode={tab as 'checkout' | 'setup'}
              onModeChange={(mode) => {
                // 自動の切り替え（BUST からの復帰など）は同じ履歴項目のまま書き換える。
                window.history.replaceState(window.history.state, '', hashOf(mode));
                setTab(mode);
              }}
              onOpenOtherMode={openPracticeWith}
              initialRemaining={practiceInitial}
              onContextChange={setContext}
            />
          )}
          {tab === 'training' && (
            <TrainingPage onContextChange={setContext} onSessionActiveChange={setSessionActive} />
          )}
          {tab === 'simulation' && (
            <SimulationPage onContextChange={setContext} onSessionActiveChange={setSessionActive} />
          )}
          {tab === 'settings' && <SettingsPage theme={preferences.theme} onThemeChange={setTheme} />}
          {tab === 'history' && <VersionHistoryPage onBack={backToHome} />}
          {tab === 'references' && <ReferencesPage onBack={backToHome} />}
          {tab === 'glossary' && <GlossaryPage onBack={backToHome} />}
        </div>
      </main>

      {/* 判定・BUST・CHECKOUT!・次の狙いを読み上げる、常に置いておく空の live 領域。 */}
      <LiveAnnouncer />

      <footer className="app__footer">
        <p>&copy; 2026 Chihiro Hashimoto</p>
      </footer>
    </div>
  );
}
