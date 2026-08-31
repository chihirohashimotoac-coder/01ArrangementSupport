/**
 * 依存パッケージなしの最小 xlsx リーダー。
 *
 * xlsx は ZIP アーカイブなので、中央ディレクトリを読んで各エントリを
 * zlib.inflateRawSync で展開し、必要な XML だけを取り出す。
 * 数式・書式・グラフは扱わない（このプロジェクトでは値だけあればよい）。
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** ZIP を読み、エントリ名 -> Buffer の Map を返す。 */
export function readZipEntries(filePath) {
  const buf = readFileSync(filePath);

  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP の End of central directory が見つかりません');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let n = 0; n < entryCount; n += 1) {
    if (buf.readUInt32LE(offset) !== SIG_CENTRAL) {
      throw new Error(`中央ディレクトリの署名が不正です (entry ${n})`);
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);

    // ローカルヘッダは可変長なので、そこから実データ開始位置を再計算する。
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * 開始タグ名で XML を素朴に走査する。
 * 名前空間接頭辞（<x:sheet> など）・属性つきタグ・自己終了タグに対応する。
 * 同名タグの入れ子は xlsx には現れないため、対応する終了タグは最初の 1 つでよい。
 */
function* iterateElements(xml, tagName) {
  const openRe = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tagName}(\\s[^>]*?)?(/)?>`, 'g');
  const closeRe = new RegExp(`</(?:[A-Za-z0-9_.-]+:)?${tagName}>`, 'g');
  let match;
  while ((match = openRe.exec(xml)) !== null) {
    if (match[2] === '/') {
      yield { attrs: match[1] ?? '', inner: '' };
      continue;
    }
    closeRe.lastIndex = openRe.lastIndex;
    const close = closeRe.exec(xml);
    if (!close) return;
    yield { attrs: match[1] ?? '', inner: xml.slice(openRe.lastIndex, close.index) };
    openRe.lastIndex = close.index + close[0].length;
  }
}

function attr(attrs, name) {
  const match = new RegExp(`${name.replace(':', '\\:')}="([^"]*)"`).exec(attrs);
  return match ? match[1] : null;
}

function decodeXmlText(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/** セル参照 "B12" から 1 始まりの列番号を返す。 */
export function columnNumber(ref) {
  const match = /^([A-Z]+)/.exec(ref);
  if (!match) throw new Error(`セル参照が不正です: ${ref}`);
  let column = 0;
  for (const ch of match[1]) column = column * 26 + (ch.charCodeAt(0) - 64);
  return column;
}

function readSharedStrings(entries) {
  const xml = entries.get('xl/sharedStrings.xml');
  if (!xml) return [];
  const text = xml.toString('utf8');
  const result = [];
  for (const si of iterateElements(text, 'si')) {
    let value = '';
    for (const t of iterateElements(si.inner, 't')) value += decodeXmlText(t.inner);
    result.push(value);
  }
  return result;
}

function parseSheet(xml, sharedStrings) {
  const rows = new Map();
  for (const row of iterateElements(xml, 'row')) {
    const rowNumber = Number(attr(row.attrs, 'r'));
    const cells = new Map();
    for (const cell of iterateElements(row.inner, 'c')) {
      const ref = attr(cell.attrs, 'r');
      const type = attr(cell.attrs, 't');
      let value = null;
      if (type === 'inlineStr') {
        let text = '';
        for (const t of iterateElements(cell.inner, 't')) text += decodeXmlText(t.inner);
        value = text;
      } else {
        for (const v of iterateElements(cell.inner, 'v')) {
          const raw = decodeXmlText(v.inner);
          // t="s" は共有文字列テーブルへの添字、それ以外は値そのもの。
          value = type === 's' ? (sharedStrings[Number(raw)] ?? '') : raw;
          break;
        }
      }
      if (value !== null && value !== '') cells.set(columnNumber(ref), value);
    }
    rows.set(rowNumber, cells);
  }
  return rows;
}

/** ワークブックを読み、シート名 -> 行 Map（行番号 -> 列番号 -> 文字列）を返す。 */
export function readWorkbook(filePath) {
  const entries = readZipEntries(filePath);
  const sharedStrings = readSharedStrings(entries);

  const workbookXml = entries.get('xl/workbook.xml').toString('utf8');
  const relsXml = entries.get('xl/_rels/workbook.xml.rels').toString('utf8');

  const relTargets = new Map();
  for (const rel of iterateElements(relsXml, 'Relationship')) {
    relTargets.set(attr(rel.attrs, 'Id'), attr(rel.attrs, 'Target'));
  }

  const sheets = new Map();
  for (const sheet of iterateElements(workbookXml, 'sheet')) {
    const name = decodeXmlText(attr(sheet.attrs, 'name') ?? '');
    const relId = attr(sheet.attrs, 'r:id');
    const target = (relTargets.get(relId) ?? '').replace(/^\//, '').replace(/^xl\//, '');
    const entry = entries.get(`xl/${target}`);
    if (!entry) continue;
    sheets.set(name, parseSheet(entry.toString('utf8'), sharedStrings));
  }
  return sheets;
}
