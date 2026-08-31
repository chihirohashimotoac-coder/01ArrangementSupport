/**
 * GitHub Pages で直接アクセス・リロードされたときに 404 にならないよう、
 * ビルド成果物の index.html を 404.html としてもコピーする。
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '../dist');
const source = resolve(distDir, 'index.html');
const target = resolve(distDir, '404.html');

if (!existsSync(source)) {
  console.error('dist/index.html が見つかりません。先に vite build を実行してください。');
  process.exit(1);
}

copyFileSync(source, target);
console.log('created dist/404.html (SPA fallback)');
