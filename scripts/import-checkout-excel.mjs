/**
 * 添付 Excel「checkout_table_added_routes_final.xlsx」を読み込み、
 * STANDARD 基準ルートの TypeScript データを生成する。
 *
 *   node scripts/import-checkout-excel.mjs [--check]
 *
 * --check を付けると生成物を書き出さず、検算結果だけを出力する（CI 用）。
 *
 * 重要:
 *   このスクリプトは Excel の第1候補を「勝手に直さない」。
 *   算術・ルール上の不整合を見つけた場合は、修正せずレポートへ列挙して
 *   終了コード 1 で失敗させる（docs/CHECKOUT_DATA_POLICY.md を参照）。
 */
import { writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkbook } from './lib/xlsx-lite.mjs';
import {
  SAME_AS_STANDARD,
  isFinishingSegment,
  isValidSegmentId,
  parseExcelRoute,
  segmentScore,
} from './lib/notation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'data/source/checkout_table_added_routes_final.xlsx');
const OUTPUT = resolve(ROOT, 'src/data/standardCheckoutRoutes.generated.ts');
const SHEET = 'チェックアウト表';
const HEADER_ROW = 4;

/** 第2〜第5候補の列と、その列が終わるべきダブル。 */
const ALTERNATIVE_COLUMNS = [
  { column: 3, finish: 'D20' },
  { column: 4, finish: 'D16' },
  { column: 5, finish: 'D14' },
  { column: 6, finish: 'D12' },
];

const checkOnly = process.argv.includes('--check');
const problems = [];

function problem(left, kind, message) {
  problems.push({ left, kind, message });
}

/**
 * ルートが「残り left 点・3 本以内」で合法な Double Out ルートかを検証する。
 * 見つかった問題を配列で返す（空なら合法）。
 */
function validateRoute(left, ids, { requiredFinish = null } = {}) {
  const found = [];
  if (ids.length === 0) return ['ルートが空です'];
  if (ids.length > 3) found.push(`ダート数が 3 本を超えています (${ids.length} 本)`);

  for (const id of ids) {
    if (!isValidSegmentId(id)) found.push(`盤面に存在しないセグメント: ${id}`);
  }
  if (found.length > 0) return found;

  const total = ids.reduce((sum, id) => sum + segmentScore(id), 0);
  if (total !== left) found.push(`合計 ${total} が LEFT ${left} と一致しません`);

  const last = ids[ids.length - 1];
  if (!isFinishingSegment(last)) {
    found.push(`最終ダート ${last} が Double / BULL ではありません`);
  }
  if (requiredFinish && last !== requiredFinish) {
    found.push(`最終ダートが指定の ${requiredFinish} ではありません (${last})`);
  }

  // 途中経過が Bust にならないこと（1 残し・マイナス残しの検出）。
  let remaining = left;
  for (let i = 0; i < ids.length; i += 1) {
    remaining -= segmentScore(ids[i]);
    const isLast = i === ids.length - 1;
    if (remaining < 0) found.push(`${i + 1} 投目でマイナス（Bust）になります`);
    else if (!isLast && remaining < 2) found.push(`${i + 1} 投目で残り ${remaining}（Bust）になります`);
  }
  return found;
}

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`一次資料が見つかりません: ${SOURCE}`);
    console.error('docs/CHECKOUT_DATA_POLICY.md の手順で Excel を配置してください。');
    process.exit(2);
  }

  const sheet = readWorkbook(SOURCE).get(SHEET);
  if (!sheet) {
    console.error(`シート「${SHEET}」が見つかりません`);
    process.exit(2);
  }

  const entries = [];
  const seenLeft = new Set();

  for (const rowNumber of [...sheet.keys()].sort((a, b) => a - b)) {
    if (rowNumber <= HEADER_ROW) continue;
    const cells = sheet.get(rowNumber);
    const leftRaw = cells.get(1);
    if (!leftRaw || !/^\d+$/.test(leftRaw.trim())) continue;
    const left = Number(leftRaw.trim());

    if (seenLeft.has(left)) problem(left, 'DUPLICATE_ROW', `LEFT ${left} が重複しています`);
    seenLeft.add(left);

    const standardParsed = parseExcelRoute(cells.get(2));
    if (standardParsed === null || standardParsed.error) {
      problem(left, 'PARSE', standardParsed?.error ?? '第1候補が空です');
      continue;
    }
    for (const message of validateRoute(left, standardParsed)) {
      problem(left, 'STANDARD_INVALID', message);
    }

    const alternatives = [];
    for (const { column, finish } of ALTERNATIVE_COLUMNS) {
      const raw = (cells.get(column) ?? '').trim();
      if (raw === SAME_AS_STANDARD) {
        // 「第1候補と同一」は、第1候補が本当にその Double 終わりであることを検証する。
        if (standardParsed[standardParsed.length - 1] !== finish) {
          problem(
            left,
            'SAME_AS_STANDARD_MISMATCH',
            `「${SAME_AS_STANDARD}」とあるが第1候補の最終ダートは ${standardParsed[standardParsed.length - 1]}（期待: ${finish}）`,
          );
        }
        alternatives.push({ finish, darts: standardParsed, sameAsStandard: true });
        continue;
      }
      const parsed = parseExcelRoute(raw);
      if (parsed === null) {
        alternatives.push({ finish, darts: null, sameAsStandard: false });
        continue;
      }
      if (parsed.error) {
        problem(left, 'PARSE', `${finish} 列: ${parsed.error}`);
        continue;
      }
      for (const message of validateRoute(left, parsed, { requiredFinish: finish })) {
        problem(left, 'ALTERNATIVE_INVALID', `${finish} 列: ${message}`);
      }
      alternatives.push({ finish, darts: parsed, sameAsStandard: false });
    }

    const verdict = (cells.get(7) ?? '').trim();
    entries.push({ left, standard: standardParsed, alternatives, excelVerdict: verdict });
  }

  entries.sort((a, b) => a.left - b.left);

  // --- 全体整合性のチェック ---------------------------------------------
  if (entries.length !== 123) {
    problem(null, 'ROW_COUNT', `データ行数が 123 ではありません: ${entries.length}`);
  }
  for (const entry of entries) {
    if (entry.left < 41 || entry.left > 170) {
      problem(entry.left, 'OUT_OF_RANGE', 'LEFT が 41〜170 の範囲外です');
    }
  }

  console.log(`読み込み行数: ${entries.length}`);
  console.log(`LEFT の範囲: ${entries[0]?.left} 〜 ${entries[entries.length - 1]?.left}`);
  const missing = [];
  for (let n = 41; n <= 170; n += 1) if (!seenLeft.has(n)) missing.push(n);
  console.log(`表に存在しない LEFT (41〜170): ${missing.join(', ') || 'なし'}`);
  console.log(`Excel 検算欄が OK 以外の行: ${entries.filter((e) => e.excelVerdict !== 'OK').length} 件`);

  if (problems.length > 0) {
    console.error(`\n=== 検算で ${problems.length} 件の不一致を検出しました ===`);
    for (const p of problems) {
      console.error(`  [${p.kind}] LEFT=${p.left ?? '-'}: ${p.message}`);
    }
    console.error('\nCHECKOUT_DATA_POLICY.md に従い、データは自動修正しません。');
    process.exit(1);
  }
  console.log('検算結果: 全ルートが「合計=LEFT / 最終ダートがDouble・BULL / 途中Bustなし / 指定ダブル終わり」を満たします。');

  if (checkOnly) return;

  writeFileSync(OUTPUT, renderTypeScript(entries, missing), 'utf8');
  console.log(`生成しました: ${OUTPUT}`);
}

function renderList(ids) {
  return `[${ids.map((id) => `'${id}'`).join(', ')}]`;
}

function renderTypeScript(entries, missing) {
  const rows = entries
    .map((entry) => {
      const alts = entry.alternatives
        .map(
          (alt) =>
            `      { finish: '${alt.finish}', darts: ${alt.darts ? renderList(alt.darts) : 'null'}, sameAsStandard: ${alt.sameAsStandard} },`,
        )
        .join('\n');
      return `  {
    left: ${entry.left},
    standard: ${renderList(entry.standard)},
    alternatives: [
${alts}
    ],
  },`;
    })
    .join('\n');

  return `/* eslint-disable */
/**
 * 自動生成ファイル — 直接編集しないこと。
 *
 * 生成元 : data/source/checkout_table_added_routes_final.xlsx（シート「${SHEET}」）
 * 生成器 : scripts/import-checkout-excel.mjs
 * 再生成 : npm run import:checkout
 *
 * 第1候補をこのアプリの「基準ルート（Standard Route）」として扱う。
 * 出典の一次資料が確認できていないため、「PDC公式ルート」とは呼ばない
 * （docs/CHECKOUT_DATA_POLICY.md を参照）。
 *
 * 収録範囲: LEFT ${entries[0].left}〜${entries[entries.length - 1].left} の ${entries.length} 件。
 * 41〜170 のうち表に存在しない LEFT: ${missing.join(', ')}
 *   （いずれも 3 本でチェックアウトできない Bogey Number）
 */

/** 第2〜第5候補が終わるべきダブル。 */
export type AlternativeFinish = 'D20' | 'D16' | 'D14' | 'D12';

export interface StandardAlternative {
  readonly finish: AlternativeFinish;
  /** 3 本以内で成立しない場合は null（Excel の「—」）。 */
  readonly darts: readonly string[] | null;
  /** Excel で「${SAME_AS_STANDARD}」と記載されていた行。 */
  readonly sameAsStandard: boolean;
}

export interface StandardCheckoutRow {
  readonly left: number;
  /** 第1候補 = 基準ルート。 */
  readonly standard: readonly string[];
  readonly alternatives: readonly StandardAlternative[];
}

export const EXCEL_STANDARD_ROWS: readonly StandardCheckoutRow[] = [
${rows}
];
`;
}

main();
