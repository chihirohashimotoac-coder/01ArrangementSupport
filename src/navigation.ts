/**
 * 画面（タブ）と URL の hash の対応（2026-11-01 監査 U-H3）。
 *
 * 画面の切り替えを履歴に積むために hash を使う。GitHub Pages の base path
 * （`/01ArrangementSupport/`）や SPA fallback（404.html）はパス部分の話なので、
 * hash だけを書き換えればどちらにも触れない。
 */
export type Tab =
  | 'home'
  | 'checkout'
  | 'setup'
  | 'training'
  | 'simulation'
  | 'settings'
  | 'history'
  | 'references'
  | 'glossary';

const ALL_TABS: readonly Tab[] = [
  'home',
  'checkout',
  'setup',
  'training',
  'simulation',
  'settings',
  'history',
  'references',
  'glossary',
];

/** 知らない hash はホームとして扱う。 */
export function tabFromHash(hash: string): Tab {
  const name = hash.replace(/^#\/?/, '');
  return (ALL_TABS as readonly string[]).includes(name) ? (name as Tab) : 'home';
}

export function hashOf(tab: Tab): string {
  return tab === 'home' ? '#/' : `#/${tab}`;
}

