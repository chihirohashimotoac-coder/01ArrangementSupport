/**
 * Excel 表記とアプリ内セグメント表記の変換。
 *
 * Excel（検算メモ シート）の表記規則:
 *   T=Treble / D=Double / 25=Outer Bull / Bull=Inner Bull / 数字のみ=Single
 *   「—」= 3本以内では成立しない / 「第1候補と同一」= 第1候補と同じルート
 */
export const SAME_AS_STANDARD = '第1候補と同一';
export const NOT_AVAILABLE_MARKS = ['—', '-', '―', 'ー', ''];

/** 有効なセグメント表記かどうか（S1-20 / D1-20 / T1-20 / SB / BULL）。 */
export function isValidSegmentId(id) {
  if (id === 'SB' || id === 'BULL') return true;
  const match = /^([SDT])(\d{1,2})$/.exec(id);
  if (!match) return false;
  const n = Number(match[2]);
  return n >= 1 && n <= 20;
}

/** セグメント表記の得点。 */
export function segmentScore(id) {
  if (id === 'SB') return 25;
  if (id === 'BULL') return 50;
  const match = /^([SDT])(\d{1,2})$/.exec(id);
  if (!match) throw new Error(`不正なセグメント表記: ${id}`);
  const multiplier = match[1] === 'S' ? 1 : match[1] === 'D' ? 2 : 3;
  return Number(match[2]) * multiplier;
}

/** Double Out の最終ダートとして合法か（D1-D20 と BULL）。 */
export function isFinishingSegment(id) {
  return id === 'BULL' || /^D\d{1,2}$/.test(id);
}

/** Excel の 1 トークンをセグメント表記へ変換する。変換できなければ null。 */
export function excelTokenToSegmentId(token) {
  const t = token.trim();
  if (t === '') return null;
  if (/^bull$/i.test(t)) return 'BULL';
  if (t === '25') return 'SB';
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= 20 ? `S${n}` : null;
  }
  const match = /^([TtDd])\s*(\d{1,2})$/.exec(t);
  if (!match) return null;
  const n = Number(match[2]);
  if (n < 1 || n > 20) return null;
  return `${match[1].toUpperCase()}${n}`;
}

/**
 * "T19 + 6 + D20" のようなセル文字列をセグメント表記の配列へ変換する。
 * 成立しないマークの場合は null を返す。
 */
export function parseExcelRoute(cell) {
  const text = (cell ?? '').trim();
  if (NOT_AVAILABLE_MARKS.includes(text)) return null;
  const tokens = text.split('+').map((t) => t.trim());
  const ids = [];
  for (const token of tokens) {
    const id = excelTokenToSegmentId(token);
    if (id === null) return { error: `解釈できないトークン: "${token}" (cell="${text}")` };
    ids.push(id);
  }
  return ids;
}
