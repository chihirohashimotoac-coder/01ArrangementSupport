import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** vitest は `css: false` で CSS を空にするため、ファイルとして読む。 */
function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

/** コメントは宣言の切れ目を隠すので、構造検査の前に取り除く。 */
const appCss = readText('./App.css').replace(/\/\*[\s\S]*?\*\//g, '');
const indexHtml = readText('../index.html');

/**
 * iOS の PWA（`apple-mobile-web-app-status-bar-style: black-translucent`）では、
 * Web コンテンツがステータスバーやホームインジケーターの下まで広がる。
 * Safe Area の考慮が落ちるとヘッダーが時計や Dynamic Island に重なるため、
 * CSS の構造そのものを回帰テストで固定する。
 *
 * jsdom は `env()` を解決しないので、算出値ではなく宣言の形を検査する。
 */

/** `selector { ... }` の宣言部分を取り出す。ネストした波括弧は使っていない前提。 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[\\n},])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `${selector} のルールが見つからない`).not.toBeNull();
  return match![1];
}

/** 宣言名に対応する値を取り出す（最後に書かれたものが勝つ）。 */
function declaration(body: string, property: string): string | null {
  const matches = [...body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`, 'g'))];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

describe('Safe Area（iOS PWA）', () => {
  const app = ruleBody(appCss, '.app');

  it('.app が 4 辺すべての safe-area-inset を参照する', () => {
    const missing = SIDES.filter((side) => !app.includes(`env(safe-area-inset-${side}`));
    expect(missing).toEqual([]);
  });

  it('safe-area-inset にはフォールバック 0px を書く', () => {
    const withoutFallback = SIDES.filter(
      (side) => !app.includes(`env(safe-area-inset-${side}, 0px)`),
    );
    expect(withoutFallback).toEqual([]);
  });

  it('4 辺の padding が「素の余白 + inset」になっている', () => {
    const paddings = SIDES.map((side) => [side, declaration(app, `padding-${side}`)] as const);
    const broken = paddings.filter(
      ([, value]) => value === null || !/^calc\(var\(--app-gutter-[a-z]+\) \+ var\(--app-safe-[a-z]+\)\)$/.test(value),
    );
    expect(broken).toEqual([]);
  });

  it('env() 非対応ブラウザ向けに、素の padding を先に宣言する', () => {
    // ショートハンドが env() を含むと、非対応ブラウザでは余白ごと無効になる。
    const shorthand = declaration(app, 'padding');
    expect(shorthand).not.toBeNull();
    expect(shorthand).not.toContain('env(');
    expect(app.indexOf('padding:')).toBeLessThan(app.indexOf('padding-top:'));
  });

  it('© フッター側の bottom は従来どおり 1.5rem + inset を保つ', () => {
    expect(declaration(app, '--app-gutter-bottom')).toBe('1.5rem');
    expect(declaration(app, '--app-safe-bottom')).toBe('env(safe-area-inset-bottom, 0px)');
    expect(declaration(app, 'padding-bottom')).toBe(
      'calc(var(--app-gutter-bottom) + var(--app-safe-bottom))',
    );
  });

  it('通常表示の余白は従来の 0.75rem / 1.5rem のまま', () => {
    expect(declaration(app, '--app-gutter-top')).toBe('0.75rem');
    expect(declaration(app, '--app-gutter-x')).toBe('0.75rem');
  });

  it('header だけに場当たり的な safe-area 対応を足さない', () => {
    for (const selector of ['.app__header', '.app__nav', '.app__main']) {
      expect(ruleBody(appCss, selector), selector).not.toContain('safe-area-inset');
    }
  });
});

describe('Safe Area の前提となる meta', () => {
  it('viewport に viewport-fit=cover がある', () => {
    // これが無いと env(safe-area-inset-*) は常に 0 になり、padding が効かない。
    const viewport = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(indexHtml)?.[1];
    expect(viewport).toContain('viewport-fit=cover');
  });

  it('ステータスバーは black-translucent のまま（暗い配色との一体感を維持）', () => {
    expect(indexHtml).toContain(
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    );
  });
});
