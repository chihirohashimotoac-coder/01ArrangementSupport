/**
 * GitHub Pages のサブパス（/01ArrangementSupport/）向けビルドの検証。
 *
 * E2E は base = / のビルドに対して走るため、サブパス配信でだけ壊れる不具合
 * （絶対パスで書かれた asset、base を含まない manifest など）を拾えない。
 * ここではビルド成果物を静的に検査して、次を確認する。
 *
 *   - index.html / 404.html が参照する asset がすべて base 配下であること
 *   - webmanifest の start_url / scope / id が base 配下であること
 *   - Service Worker と precache manifest が base 配下を指していること
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const base = process.env.VITE_BASE_PATH ?? '/01ArrangementSupport/';
const outDir = resolve(root, 'dist-base-check');

const problems = [];
const check = (condition, message) => {
  if (!condition) problems.push(message);
};

rmSync(outDir, { recursive: true, force: true });
execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
  cwd: root,
  env: { ...process.env, VITE_BASE_PATH: base },
  stdio: 'inherit',
});

try {
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');

  // index.html が参照するローカル資源はすべて base 配下でなければならない。
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  check(refs.length > 0, 'index.html が asset を参照していません。');
  for (const ref of refs) {
    // 外部 URL と、文書相対（./…）の参照はサブパスでもそのまま解決できる。
    if (/^(https?:|data:|#|mailto:|\.)/.test(ref)) continue;
    check(
      ref.startsWith(base),
      `index.html の参照 "${ref}" が base (${base}) 配下ではありません。`,
    );
  }
  check(html.includes(`${base}manifest.webmanifest`), 'manifest の link が base を含みません。');

  // アプリの起動に必要な JS が実際に出力されているか。
  const scripts = refs.filter((ref) => ref.startsWith(base) && ref.endsWith('.js'));
  check(scripts.length > 0, 'index.html から読み込む JS がありません。');
  for (const script of scripts) {
    const file = join(outDir, script.slice(base.length));
    check(existsSync(file), `${script} に対応するファイルが出力されていません。`);
  }

  const manifestName = readdirSync(outDir).find((name) => name.endsWith('.webmanifest'));
  check(manifestName !== undefined, 'webmanifest が出力されていません。');
  if (manifestName) {
    const manifest = JSON.parse(readFileSync(join(outDir, manifestName), 'utf8'));
    for (const key of ['start_url', 'scope', 'id']) {
      check(
        typeof manifest[key] === 'string' && manifest[key].startsWith(base),
        `manifest.${key} が base (${base}) 配下ではありません: ${manifest[key]}`,
      );
    }
    for (const icon of manifest.icons ?? []) {
      const path = icon.src.startsWith(base) ? icon.src.slice(base.length) : icon.src;
      check(existsSync(join(outDir, path)), `manifest のアイコン ${icon.src} が見つかりません。`);
    }
  }

  const sw = join(outDir, 'sw.js');
  check(existsSync(sw), 'sw.js が出力されていません。');
  if (existsSync(sw)) {
    // precache のエントリは SW スコープからの相対 URL でなければならない。
    // ルート絶対パスが混ざると、サブパス配信でキャッシュが 404 になる。
    const entries = [...readFileSync(sw, 'utf8').matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
    check(entries.length > 0, 'sw.js に precache のエントリがありません。');
    check(entries.includes('index.html'), 'sw.js が index.html を precache していません。');
    for (const entry of entries) {
      check(
        !entry.startsWith('/'),
        `sw.js の precache エントリ "${entry}" がルート絶対パスです（サブパスで 404 になります）。`,
      );
    }
  }

  // Service Worker の登録先も base 配下でなければならない。
  const bundles = readdirSync(join(outDir, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(outDir, 'assets', name), 'utf8'));
  check(
    bundles.some((source) => source.includes(`${base}sw.js`)),
    `Service Worker の登録先が base (${base}) 配下ではありません。`,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`GitHub Pages base path (${base}) のビルド検証に失敗しました:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`GitHub Pages base path (${base}) のビルド検証に成功しました。`);
