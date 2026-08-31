/**
 * PWA 用アイコンを生成するスクリプト。
 *
 * 外部の画像素材やロゴは一切使用せず、アプリ本体と同じ配置ルールで
 * ダーツボードをピクセル単位に描画して PNG を書き出す（依存パッケージなし）。
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../public/icons');

/** src/domain/boardNumbers.ts と同じナンバー配置。 */
const BOARD_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/** src/geometry/dartboardGeometry.ts の RADII と同じ比率（missOuter = 205 を 1.0 とする）。 */
const R = {
  innerBull: 16 / 205,
  outerBull: 34 / 205,
  tripleInner: 90 / 205,
  tripleOuter: 110 / 205,
  doubleInner: 148 / 205,
  doubleOuter: 170 / 205,
  boardOuter: 1,
};

/** src/index.css の配色と揃える。 */
const COLORS = {
  background: [16, 19, 26, 255],
  surround: [11, 13, 19, 255],
  edge: [74, 82, 95, 255],
  dark: [28, 30, 35, 255],
  light: [240, 227, 194, 255],
  red: [208, 42, 50, 255],
  green: [23, 134, 74, 255],
  wire: [195, 201, 210, 255],
};

function colorAt(nx, ny, boardScale) {
  const r = Math.hypot(nx, ny) / boardScale;
  if (r > R.boardOuter) return COLORS.background;
  if (r > R.boardOuter - 0.02) return COLORS.edge;
  if (r > R.doubleOuter) return COLORS.surround;

  for (const wr of [R.doubleOuter, R.doubleInner, R.tripleOuter, R.tripleInner, R.outerBull]) {
    if (Math.abs(r - wr) < 0.006) return COLORS.wire;
  }

  if (r <= R.innerBull) return COLORS.red;
  if (r <= R.outerBull) return COLORS.green;

  const deg = (Math.atan2(ny, nx) * 180) / Math.PI;
  const shifted = ((((deg + 90 + 9) % 360) + 360) % 360);
  const index = Math.floor(shifted / 18) % BOARD_NUMBERS.length;
  const isDarkWedge = index % 2 === 0;

  const isRing = (r > R.tripleInner && r < R.tripleOuter) || (r > R.doubleInner && r < R.doubleOuter);
  if (isRing) return isDarkWedge ? COLORS.red : COLORS.green;
  return isDarkWedge ? COLORS.dark : COLORS.light;
}

function renderBoard(size, boardScale) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / (size / 2) - 1;
      const ny = (y + 0.5) / (size / 2) - 1;
      const [r, g, b, a] = colorAt(nx, ny, boardScale);
      const offset = (y * size + x) * 4;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = a;
    }
  }
  return pixels;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { name: 'icon-192.png', size: 192, scale: 1 },
  { name: 'icon-512.png', size: 512, scale: 1 },
  // maskable はセーフゾーン確保のため盤面を小さめに描く。
  { name: 'icon-maskable-512.png', size: 512, scale: 1 / 0.72 },
  { name: 'apple-touch-icon-180.png', size: 180, scale: 1 / 0.92 },
  { name: 'favicon-32.png', size: 32, scale: 1 },
];

for (const target of targets) {
  const png = encodePng(target.size, renderBoard(target.size, target.scale));
  writeFileSync(resolve(OUT_DIR, target.name), png);
  console.log(`wrote ${target.name} (${target.size}x${target.size})`);
}
