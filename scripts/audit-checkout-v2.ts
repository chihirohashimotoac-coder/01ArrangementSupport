/**
 * 戦術 v2（2026-11-01 監査指摘・フェーズ 1）の差分表を作る。
 *
 *   npm run audit:tactics-v2            # docs/reports/tactics-v2-diff.md を書き出す
 *   npm run audit:tactics-v2 -- --stdout # 標準出力にも出す
 *
 * 本体（src/**）は一切変更しない。scripts/lib/tacticsV2Trial.ts の試算実装と比べる。
 *
 * 戦術 v2 の承認（2026-11-01、docs/APPROVALS.md A-27〜A-31）後は、**承認した案（CHECKOUT_FLAGS_V2 /
 * SETUP 案 A）の試算と実装後のエンジンを全件照合**する（承認前は、フラグを外した試算と当時のエンジンを照合していた）。
 * 照合が 1 件でも食い違えば終了コード 1（承認した差分表どおりに実装されていることの担保）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { routeKey, type Dart } from '../src/domain/dart';
import { MAX_CHECKOUT, isCheckoutable } from '../src/domain/checkoutRules';
import {
  CHECKOUT_REASON_WEIGHTS,
  DISCOURAGING_REASON_CODES,
  SETUP_REASON_WEIGHTS,
  type RouteGrade,
} from '../src/data/rankingRules';
import { rankCheckoutRoutes, selectMyRoute } from '../src/engine/ranking/checkoutRanking';
import { rankSetupRoutes } from '../src/engine/setup/enumerate';
import { suggestFor } from '../src/engine/recovery/suggest';
import {
  CHECKOUT_FLAGS_OFF,
  CHECKOUT_FLAGS_V2,
  PROPOSED_CHECKOUT_WEIGHTS,
  SETUP_FLAGS_OFF,
  isNegativeCode,
  myRouteTopTrial,
  rankCheckoutTrial,
  rankSetupTrial,
  setupRouteText,
  setupSequenceCount,
  standardDartsFor,
  type CheckoutV2Flags,
  type SetupTrialState,
  type SetupV2Flags,
  type TrialCheckoutRoute,
} from './lib/tacticsV2Trial';

const out: string[] = [];
const line = (text = '') => out.push(text);
const ids = (darts: readonly Dart[]) => darts.map((dart) => dart.id).join(' → ');
const pretty = (key: string) => key.split('-').join(' → ');
let failures = 0;

// ---------------------------------------------------------------------------
// 0. 照合
// ---------------------------------------------------------------------------
/** MY ROUTE の照合・集計に使う得意ダブルの設定（15 通り）。 */
const MY_ROUTE_SETTINGS: readonly (readonly string[])[] = [
  ...['D20', 'D16', 'D8', 'D10', 'D12', 'D18', 'D4', 'D2', 'D6', 'D14', 'D1', 'BULL'].map((id) => [id]),
  ['D16', 'D20'],
  ['D20', 'D16'],
  ['D16', 'D20', 'D8'],
];

function verifyReproduction(): void {
  let checkoutStates = 0;
  let checkoutMismatch = 0;
  for (const preferredDoubles of [[], ['D20'], ['D16', 'D20']]) {
    for (const applyStandardBonus of [undefined, false] as const) {
      for (let r = 2; r <= MAX_CHECKOUT; r += 1) {
        for (let d = 1; d <= 3; d += 1) {
          const options = { preferredDoubles, applyStandardBonus };
          const engine = rankCheckoutRoutes(r, d, options);
          const trial = rankCheckoutTrial(r, d, options, CHECKOUT_FLAGS_V2);
          checkoutStates += 1;
          const same =
            engine.length === trial.length &&
            engine.every((route, i) => {
              const other = trial[i];
              return (
                route.key === other.key &&
                route.grade === other.grade &&
                route.score === other.score &&
                route.reasons.map((x) => x.code).sort().join() === [...other.codes].sort().join()
              );
            });
          if (!same) checkoutMismatch += 1;
        }
      }
    }
  }
  let myRouteStates = 0;
  let myRouteMismatch = 0;
  for (const preferred of MY_ROUTE_SETTINGS) {
    for (const { r, d } of checkoutStates_()) {
      myRouteStates += 1;
      const engine = selectMyRoute(r, d, preferred)?.key ?? null;
      const trial = myRouteTopTrial(r, d, preferred, CHECKOUT_FLAGS_V2, true)?.mine.key ?? null;
      if (engine !== trial) myRouteMismatch += 1;
    }
  }
  let setupMismatch = 0;
  for (let r = 171; r <= 350; r += 1) {
    for (let d = 1; d <= 3; d += 1) {
      const engine = rankSetupRoutes(r, d).slice(0, 5);
      const trial = setupState(r, d, SETUP_OPTION_A).leaders;
      const n = Math.min(engine.length, trial.length);
      const same =
        n > 0 &&
        engine.slice(0, n).every(
          (route, i) => route.key === trial[i].key && Math.abs(route.score - trial[i].score) <= 1e-9,
        );
      if (!same) setupMismatch += 1;
    }
  }
  // 承認した重みが、そのまま本体（src/data/rankingRules.ts）に入っていること。
  const weightsMatch =
    CHECKOUT_REASON_WEIGHTS.SPENDS_EXTRA_DART === PROPOSED_CHECKOUT_WEIGHTS.SPENDS_EXTRA_DART &&
    CHECKOUT_REASON_WEIGHTS.BELOW_TOP_ROUTE === PROPOSED_CHECKOUT_WEIGHTS.BELOW_TOP_ROUTE &&
    SETUP_REASON_WEIGHTS.SETUP_LAST_DART_MISS_KEEPS_TENPAI === SETUP_OPTION_A.lastDartMissBonus;
  if (checkoutMismatch + myRouteMismatch + setupMismatch > 0 || !weightsMatch) failures += 1;
  line('## 0. 実装後のエンジンと、承認した案の試算の照合');
  line();
  line('承認（2026-11-01、Q1〜Q8 すべて提案どおり）後は、CHECKOUT は `CHECKOUT_FLAGS_V2`、SETUP は案 A の試算と、');
  line('実装後のエンジンを全件照合する。承認前の照合（フラグをすべて外した試算 = 当時のエンジン）も食い違い 0 件だった。');
  line();
  line('| 対象 | 照合した状態 | 食い違い |');
  line('| --- | ---: | ---: |');
  line(`| CHECKOUT 全ルートの並び・推奨度・スコア・理由コード（得意ダブル 3 設定 × 基準加点あり / なし） | ${checkoutStates} | ${checkoutMismatch} |`);
  line(`| MY ROUTE の最上位（得意ダブル 15 設定 × 2〜170 × 1〜3 本） | ${myRouteStates} | ${myRouteMismatch} |`);
  line(`| SETUP 上位 5 件とスコア（171〜350 × 1〜3 本・総当たり） | 540 | ${setupMismatch} |`);
  line(`| 承認した重みと \`src/data/rankingRules.ts\` | 3 | ${weightsMatch ? 0 : 1} |`);
  line();
  line('以下の「修正前」は試算のフラグを外した値（v1 の規則）、「修正後」は承認した案の値で、修正後はエンジンの出力と一致する。');
  line();
}

/** 2〜170 × 1〜3 本（照合用。下の checkoutStates と同じ並び）。 */
function checkoutStates_(): { r: number; d: number }[] {
  const states: { r: number; d: number }[] = [];
  for (let r = 2; r <= MAX_CHECKOUT; r += 1) for (let d = 1; d <= 3; d += 1) states.push({ r, d });
  return states;
}

// ---------------------------------------------------------------------------
// CHECKOUT
// ---------------------------------------------------------------------------
const checkoutStates: { r: number; d: number }[] = [];
for (let r = 2; r <= MAX_CHECKOUT; r += 1) for (let d = 1; d <= 3; d += 1) checkoutStates.push({ r, d });

const rank = (r: number, d: number, flags: CheckoutV2Flags) => rankCheckoutTrial(r, d, {}, flags);
const gradeLabel = (route: TrialCheckoutRoute | undefined) =>
  route === undefined ? '—' : `${pretty(route.key)}（${route.grade}）`;

function checkoutSummary(label: string, flags: CheckoutV2Flags): string {
  let topChanged = 0;
  let gradeChanged = 0;
  let standardNotFirst = 0;
  for (const { r, d } of checkoutStates) {
    const before = rank(r, d, CHECKOUT_FLAGS_OFF);
    const after = rank(r, d, flags);
    if (before.length === 0) continue;
    if (before[0].key !== after[0].key) topChanged += 1;
    const gradeBefore = new Map(before.map((route) => [route.key, route.grade]));
    for (const route of after) if (gradeBefore.get(route.key) !== route.grade) gradeChanged += 1;
    const standard = standardDartsFor(r, d, flags);
    if (standard && standard.length <= d && after[0].key !== routeKey(standard)) standardNotFirst += 1;
  }
  if (standardNotFirst > 0) failures += 1;
  return `| ${label} | ${topChanged} | ${gradeChanged} | ${standardNotFirst} |`;
}

function checkoutSection(): void {
  line('## 1. CHECKOUT（2〜170 × 1〜3 本 = 507 状態）');
  line();
  line('### 1-0. 項目ごとの影響');
  line();
  line('| 適用した項目 | 第 1 候補が変わる状態 | 推奨度が変わるルート | 基準ルートが第 1 候補でない状態 |');
  line('| --- | ---: | ---: | ---: |');
  const only = (patch: Partial<CheckoutV2Flags>) => ({ ...CHECKOUT_FLAGS_OFF, ...patch });
  line(checkoutSummary('1-1 BULL → S-BULL の外れ', only({ bullMiss: true })));
  line(checkoutSummary('1-2 ダブル→ダブルを「トリプル不要」の代替に数えない', only({ tripleFreeExcludesNonFinalDouble: true })));
  line(checkoutSummary('1-4 本数を使う繋ぎのシングル（SPENDS_EXTRA_DART）', only({ spendsExtraDart: true })));
  line(checkoutSummary('1-5 残り 2 本の 51〜70 の基準ルート', only({ twoDartSixtiesStandard: true })));
  line(checkoutSummary('1-8 点差だけの C に理由を付ける（表示のみ）', only({ belowTopReason: true })));
  line(checkoutSummary('1-10 外れてちょうど上がる場合を上がりとして扱う', only({ exactFinishOnMiss: true })));
  line(checkoutSummary('**すべて適用（v2 案）**', CHECKOUT_FLAGS_V2));
  line();
  line('「基準ルートが第 1 候補でない状態」は、基準ルートが残り本数で投げられる状態だけを数えています（0 件が前提）。');
  line();

  // 第 1 候補が変わる状態の一覧
  const changed: string[] = [];
  for (const { r, d } of checkoutStates) {
    const before = rank(r, d, CHECKOUT_FLAGS_OFF);
    const after = rank(r, d, CHECKOUT_FLAGS_V2);
    if (before.length === 0 || before[0].key === after[0].key) continue;
    const oldInNew = after.find((route) => route.key === before[0].key);
    changed.push(
      `| ${r} | ${d} | ${gradeLabel(before[0])} | ${gradeLabel(after[0])} | ${oldInNew ? oldInNew.grade : '—'} |`,
    );
  }
  line(`### 1-1. 第 1 候補が変わる状態（v2 案・${changed.length} 件）`);
  line();
  line('| 残り | 本数 | 修正前の第 1 候補（推奨度） | 修正後の第 1 候補（推奨度） | 旧第 1 候補の修正後の推奨度 |');
  line('| ---: | ---: | --- | --- | :---: |');
  for (const row of changed) line(row);
  line();

  // 推奨度の遷移
  const transitions = new Map<string, { count: number; examples: string[] }>();
  for (const { r, d } of checkoutStates) {
    const before = new Map(rank(r, d, CHECKOUT_FLAGS_OFF).map((route) => [route.key, route.grade]));
    for (const route of rank(r, d, CHECKOUT_FLAGS_V2)) {
      const old = before.get(route.key);
      if (old === undefined || old === route.grade) continue;
      const key = `${old} → ${route.grade}`;
      const entry = transitions.get(key) ?? { count: 0, examples: [] };
      entry.count += 1;
      if (entry.examples.length < 4) entry.examples.push(`${r}/${d} 本 ${pretty(route.key)}`);
      transitions.set(key, entry);
    }
  }
  const total = [...transitions.values()].reduce((sum, item) => sum + item.count, 0);
  line(`### 1-2. 推奨度が変わるルート（v2 案・合計 ${total} 件）`);
  line();
  line('| 遷移 | 件数 | 代表例 |');
  line('| --- | ---: | --- |');
  for (const [key, entry] of [...transitions.entries()].sort((a, b) => b[1].count - a[1].count)) {
    line(`| ${key} | ${entry.count} | ${entry.examples.join(' / ')} |`);
  }
  line();
}

function itemDetails(): void {
  line('### 1-3. 項目別の確認');
  line();

  // 1-1
  const bullRisk = (flags: CheckoutV2Flags) => {
    let count = 0;
    const examples: string[] = [];
    for (const { r, d } of checkoutStates) {
      if (d < 2) continue;
      for (const route of rank(r, d, flags)) {
        if (route.darts[0].id !== 'BULL' || route.isStandard) continue;
        if (route.grade !== 'S' && route.grade !== 'A') continue;
        const leave = r - 25;
        if (leave >= 2 && isCheckoutable(leave, d - 1)) continue;
        count += 1;
        if (examples.length < 6) examples.push(`${r}/${d} 本 ${pretty(route.key)}（${route.grade}）`);
      }
    }
    return { count, examples };
  };
  const bullBefore = bullRisk(CHECKOUT_FLAGS_OFF);
  const bullAfter = bullRisk(CHECKOUT_FLAGS_V2);
  line('**1-1 L-H1 BULL 始動**: S-BULL へ外れると上がれない BULL 始動ルートのうち、S / A のもの（基準ルートを除く）');
  line();
  line(`- 修正前 ${bullBefore.count} 件（例: ${bullBefore.examples.join('、')}）`);
  line(`- 修正後 ${bullAfter.count} 件${bullAfter.count ? `（例: ${bullAfter.examples.join('、')}。他のルートもすべて外れに弱く、比較で減点できない状態）` : ''}`);
  for (const [r, d, key] of [[100, 2, 'BULL-BULL'], [136, 3, 'BULL-BULL-D18'], [90, 2, 'BULL-D20']] as const) {
    const b = rank(r, d, CHECKOUT_FLAGS_OFF).find((x) => x.key === key);
    const a = rank(r, d, CHECKOUT_FLAGS_V2).find((x) => x.key === key);
    line(`- ${r}（${d} 本）${pretty(key)}: ${b?.grade} → **${a?.grade}**（追加された理由: ${a?.codes.filter((c) => !b?.codes.includes(c)).join(', ') || 'なし'}）`);
  }
  line();

  // 1-2
  const unnecessary = (flags: CheckoutV2Flags) => {
    const states: string[] = [];
    for (const { r, d } of checkoutStates) {
      const standard = rank(r, d, flags).find((route) => route.isStandard);
      if (standard?.codes.includes('UNNECESSARY_TRIPLE')) states.push(`${r}/${d}`);
    }
    return states;
  };
  const un1 = unnecessary(CHECKOUT_FLAGS_OFF);
  const un2 = unnecessary(CHECKOUT_FLAGS_V2);
  line('**1-2 L-H2 UNNECESSARY_TRIPLE**: 基準ルートに「トリプルを使わずに上がれるルートがあります」が付く状態');
  line();
  line(`- 修正前 ${un1.length} 状態、修正後 ${un2.length} 状態${un2.length ? `（${un2.join('、')}）` : ''}`);
  {
    const b = rank(80, 2, CHECKOUT_FLAGS_OFF).find((x) => x.key === 'T20-D10');
    const a = rank(80, 2, CHECKOUT_FLAGS_V2).find((x) => x.key === 'T20-D10');
    line(`- 80（2 本）T20 → D10: 理由 ${b?.codes.includes('UNNECESSARY_TRIPLE') ? 'UNNECESSARY_TRIPLE あり' : 'なし'} → ${a?.codes.includes('UNNECESSARY_TRIPLE') ? 'あり' : '**なし**'}`);
  }
  line();

  // 1-4 MY ROUTE
  const settings = MY_ROUTE_SETTINGS;
  line('**1-4 L-M1 MY ROUTE**: MY ROUTE の最上位が「通常評価で C」になる状態の数（2〜170 × 1〜3 本）');
  line();
  line('| 得意ダブル | 修正前 | 修正後 | 修正後にダブル→ダブル / 繋ぎのシングルが最上位 |');
  line('| --- | ---: | ---: | ---: |');
  let minBefore = Infinity;
  let maxBefore = 0;
  for (const preferred of settings) {
    let before = 0;
    let after = 0;
    let banned = 0;
    for (const { r, d } of checkoutStates) {
      const v1 = myRouteTopTrial(r, d, preferred, CHECKOUT_FLAGS_OFF, false);
      const v2 = myRouteTopTrial(r, d, preferred, CHECKOUT_FLAGS_V2, true);
      if (v1?.normalGrade === 'C') before += 1;
      if (v2?.normalGrade === 'C') after += 1;
      if (v2 && (v2.mine.codes.includes('NON_FINAL_DOUBLE') || v2.mine.codes.includes('SPENDS_EXTRA_DART'))) banned += 1;
    }
    minBefore = Math.min(minBefore, before);
    maxBefore = Math.max(maxBefore, before);
    line(`| ${preferred.join(' / ')} | ${before} | ${after} | ${banned} |`);
  }
  line();
  for (const [r, d, preferred] of [[81, 3, ['D16', 'D20']], [80, 2, ['D20']], [72, 2, ['D20']]] as const) {
    const v1 = myRouteTopTrial(r, d, preferred, CHECKOUT_FLAGS_OFF, false);
    const v2 = myRouteTopTrial(r, d, preferred, CHECKOUT_FLAGS_V2, true);
    line(`- ${r}（${d} 本・得意 ${preferred.join(' / ')}）: ${v1 ? `${pretty(v1.mine.key)}（通常 ${v1.normalGrade}）` : '—'} → **${v2 ? `${pretty(v2.mine.key)}（通常 ${v2.normalGrade}）` : '—'}**`);
  }
  {
    const b = rank(81, 3, CHECKOUT_FLAGS_OFF).find((x) => x.key === 'S1-T16-D16');
    const a = rank(81, 3, CHECKOUT_FLAGS_V2).find((x) => x.key === 'S1-T16-D16');
    line(`- 81（3 本）S1 → T16 → D16 の通常評価: ${b?.grade}（${b?.codes.join(', ')}） → ${a?.grade}（${a?.codes.join(', ')}）`);
  }
  let spends = 0;
  let spendsHigh = 0;
  const spendsExamples: string[] = [];
  for (const { r, d } of checkoutStates) {
    for (const route of rank(r, d, CHECKOUT_FLAGS_V2)) {
      if (!route.codes.includes('SPENDS_EXTRA_DART')) continue;
      spends += 1;
      if ((route.darts[0].baseNumber ?? 0) >= 10) {
        spendsHigh += 1;
        if (spendsExamples.length < 4) spendsExamples.push(`${r}/${d} 本 ${pretty(route.key)}`);
      }
    }
  }
  line(`- SPENDS_EXTRA_DART が付くルート: ${spends} 件（うち 1 投目が S10〜S20 のもの ${spendsHigh} 件。例: ${spendsExamples.join('、')}）`);
  line();

  // 1-5
  line('**1-5 残り 2 本の 51〜70**');
  line();
  line('| 残り | 修正前の第 1 候補（2 本） | 修正後の第 1 候補（2 本） | 旧基準ルートの修正後の推奨度 | 3 本の第 1 候補（変化なしが前提） |');
  line('| ---: | --- | --- | :---: | --- |');
  for (let r = 51; r <= 70; r += 1) {
    const before = rank(r, 2, CHECKOUT_FLAGS_OFF);
    const after = rank(r, 2, CHECKOUT_FLAGS_V2);
    const old = after.find((route) => route.key === before[0].key);
    const three1 = rank(r, 3, CHECKOUT_FLAGS_OFF)[0];
    const three2 = rank(r, 3, CHECKOUT_FLAGS_V2)[0];
    line(`| ${r} | ${gradeLabel(before[0])} | ${gradeLabel(after[0])} | ${old?.grade ?? '—'} | ${three1.key === three2.key ? pretty(three2.key) : `**${pretty(three1.key)} → ${pretty(three2.key)}**`} |`);
  }
  line();

  // 1-10
  line('**1-10 外れてちょうど上がる**');
  line();
  for (const [r, d, key] of [[40, 2, 'D5-D15'], [40, 2, 'S20-D10'], [32, 2, 'D8-D8']] as const) {
    const b = rank(r, d, CHECKOUT_FLAGS_OFF).find((x) => x.key === key);
    const a = rank(r, d, CHECKOUT_FLAGS_V2).find((x) => x.key === key);
    if (!b || !a) continue;
    line(`- ${r}（${d} 本）${pretty(key)}: ${b.grade}（${b.codes.join(', ')}） → ${a.grade}（${a.codes.join(', ')}）`);
  }
  line();
}

/** 1-7: TRAINING で、基準ルートと同等以上の別解に B / C が付く件数。 */
function trainingPeers(): void {
  const peersOf = (flags: CheckoutV2Flags) => {
    let count = 0;
    const states = new Set<string>();
    const examples: string[] = [];
    for (const { r, d } of checkoutStates) {
      const ranked = rank(r, d, flags);
      const standard = ranked.find((route) => route.isStandard);
      if (!standard || ranked[0].key !== standard.key) continue;
      const allowed = new Set(standard.codes.filter((code) => (DISCOURAGING_REASON_CODES as readonly string[]).includes(code)));
      for (const route of ranked) {
        if (route.isStandard || (route.grade !== 'B' && route.grade !== 'C')) continue;
        if (route.tacticalScore < standard.tacticalScore) continue;
        const own = route.codes.filter((code) => (DISCOURAGING_REASON_CODES as readonly string[]).includes(code) || code === 'SPENDS_EXTRA_DART');
        if (!own.every((code) => allowed.has(code))) continue;
        count += 1;
        states.add(`${r}/${d}`);
        if (examples.length < 8) examples.push(`${r}/${d} 本 ${pretty(route.key)}（${route.grade}）`);
      }
    }
    return { count, states: states.size, examples };
  };
  const before = peersOf(CHECKOUT_FLAGS_OFF);
  const after = peersOf(CHECKOUT_FLAGS_V2);
  line('### 1-4. TRAINING の採点（1-7 L-M3）');
  line();
  line('「基準ルートと戦術スコアが同等以上で、基準ルートに無い非推奨理由を持たない別解」に B / C が付く件数。');
  line('提案: TRAINING の採点ではこの別解を **S（基準と同等）** として扱い、理由コード `PEER_OF_STANDARD`（仮称）を付ける。');
  line('Practice の OTHER ROUTES の推奨度は変えない（範囲は TRAINING の採点のみ）。');
  line();
  line(`- 修正前のランキング: ${before.count} 件 / ${before.states} 状態（例: ${before.examples.join('、')}）`);
  line(`- v2 案のランキング: ${after.count} 件 / ${after.states} 状態（例: ${after.examples.join('、')}）`);
  for (const [r, d, key] of [[41, 2, 'S1-D20'], [50, 2, 'S10-D20'], [80, 2, 'T16-D16']] as const) {
    const b = rank(r, d, CHECKOUT_FLAGS_OFF).find((x) => x.key === key);
    const a = rank(r, d, CHECKOUT_FLAGS_V2).find((x) => x.key === key);
    const standard = rank(r, d, CHECKOUT_FLAGS_V2).find((x) => x.isStandard);
    line(`- ${r}（${d} 本）${pretty(key)}: 戦術スコア ${a?.tacticalScore} / 基準 ${standard ? pretty(standard.key) : '—'} ${standard?.tacticalScore}・推奨度 ${b?.grade} → ランキング上 ${a?.grade}（TRAINING では S 扱いを提案）`);
  }
  line();
}

/** 1-8: C なのに否定理由が無いルート。 */
function cWithoutNegative(): void {
  const count = (flags: CheckoutV2Flags) => {
    let c = 0;
    let all = 0;
    const examples: string[] = [];
    for (const { r, d } of checkoutStates) {
      for (const route of rank(r, d, flags)) {
        if (route.grade !== 'C') continue;
        all += 1;
        if (route.codes.some(isNegativeCode)) continue;
        c += 1;
        if (examples.length < 5) examples.push(`${r}/${d} 本 ${pretty(route.key)}`);
      }
    }
    return { c, all, examples };
  };
  const before = count(CHECKOUT_FLAGS_OFF);
  const after = count(CHECKOUT_FLAGS_V2);
  if (after.c > 0) failures += 1;
  line('### 1-5. C なのに否定理由が無いルート（1-8 L-M2）');
  line();
  line(`- 修正前: C ${before.all} 件のうち ${before.c} 件（例: ${before.examples.join('、')}）`);
  line(`- 修正後: C ${after.all} 件のうち **${after.c} 件**（点差だけで C になったものに \`BELOW_TOP_ROUTE\`（仮称・重み 0・表示のみ）を付ける。推奨度は変えない）`);
  line();
}

/** 1-6: 狙い通り入ったときに、次の推奨が計画の残りと一致しない状態。 */
function planContinuity(): void {
  const mismatches = (flags: CheckoutV2Flags) => {
    const found: string[] = [];
    for (const { r, d } of checkoutStates) {
      if (d < 2) continue;
      const top = rank(r, d, flags)[0];
      if (!top || top.darts.length < 2) continue;
      let left = r;
      for (let step = 1; step < top.darts.length; step += 1) {
        left -= top.darts[step - 1].score;
        const next = rank(left, d - step, flags)[0];
        const planned = routeKey(top.darts.slice(step));
        if (!next || next.key !== planned) {
          found.push(`${r}/${d} 本 ${pretty(top.key)} → ${left}/${d - step} 本は ${next ? pretty(next.key) : '—'}`);
          break;
        }
      }
    }
    return found;
  };
  const before = mismatches(CHECKOUT_FLAGS_OFF);
  const after = mismatches(CHECKOUT_FLAGS_V2);
  line('### 1-6. 狙い通り入っても計画と次の推奨が食い違う状態（1-6 L-M4・CHECKOUT）');
  line();
  line('1-6 の修正は順位ではなく「投げ始めた計画を推奨として続ける」挙動の変更なので、ここに挙がる状態では修正後に計画の残りが推奨になり、下の「次の推奨」は「別例」として表示します。');
  line();
  line(`- 修正前のランキング: ${before.length} 状態`);
  for (const item of before) line(`  - ${item}`);
  line(`- v2 案のランキング: ${after.length} 状態`);
  for (const item of after) line(`  - ${item}`);
  line();
}

// ---------------------------------------------------------------------------
// SETUP
// ---------------------------------------------------------------------------
const setupCache = new Map<string, SetupTrialState>();
function setupState(r: number, d: number, flags: SetupV2Flags): SetupTrialState {
  const key = `${r}/${d}/${JSON.stringify(flags)}`;
  const cached = setupCache.get(key);
  if (cached) return cached;
  const state = rankSetupTrial(r, d, flags);
  setupCache.set(key, state);
  return state;
}
const setupV1 = (r: number, d: number) => setupState(r, d, SETUP_FLAGS_OFF);

export const SETUP_OPTION_A: SetupV2Flags = {
  ...SETUP_FLAGS_OFF,
  lastDartMissBonus: 40,
  mainTargetTieBreak: true,
};
const SETUP_OPTION_B: SetupV2Flags = { ...SETUP_OPTION_A, thinTargetWeight: -12 };
const SETUP_OPTION_C: SetupV2Flags = { ...SETUP_OPTION_A, lastDartNeighbor: 10 };

const usesThinScoring = (darts: readonly Dart[]) =>
  darts.some((dart) => dart.kind === 'double' || dart.id === 'BULL');

function setupSection(): void {
  line('## 2. SETUP（171〜350 × 1〜3 本 = 540 状態）');
  line();
  line('### 2-0. 試算した案');
  line();
  line('| 案 | 内容 |');
  line('| --- | --- |');
  line('| A（主案） | ビジット最後の 1 投について、縦ズレ（T → 同じナンバーの S、D → 同じナンバーの S または盤外、BULL → S-BULL、S → 同じナンバーの T / D）の**すべてでテンパイが残る**なら `SETUP_LAST_DART_MISS_KEEPS_TENPAI` で **+40**。同点は「主目標（T20）が先頭に続く本数が多い順」→ 表記順。 |');
  line('| B（選択肢） | A ＋ `SETUP_THIN_TARGET` を 0 → **−12**（ダブル 1 本あたり。BULL は含めない） |');
  line('| C（参考） | A ＋ 最後の 1 投の横ズレ（全部残る +10 / 1 つも残らない −10） |');
  line();
  line('A-11 / A-18 のふるい（1 投目のシングル落ち耐性）はどの案でもそのまま使います。');
  line('+40 は「192（1 本）で BULL が D16 を上回るのに要る最小値 35.4」と、CHECKOUT の `SINGLE_MISS_SAFE` +45 を目安にした提案値です。');
  line();

  const options: [string, SetupV2Flags][] = [
    ['A', SETUP_OPTION_A],
    ['B', SETUP_OPTION_B],
    ['C', SETUP_OPTION_C],
  ];
  line('### 2-1. 案ごとの影響');
  line();
  line('| 案 | 第 1 候補が変わる状態 | 推奨度が変わるルート（全合法シーケンス） | 第 1 候補がダブル / BULL を含む状態 | 回帰テストの期待値と食い違う件数 |');
  line('| --- | ---: | ---: | ---: | ---: |');
  const v1Thin = countThin(SETUP_FLAGS_OFF);
  line(`| 修正前 | — | — | ${v1Thin} | 0 |`);
  for (const [label, flags] of options) {
    let topChanged = 0;
    let gradeChanged = 0;
    for (let r = 171; r <= 350; r += 1) {
      for (let d = 1; d <= 3; d += 1) {
        const before = setupV1(r, d);
        const after = setupState(r, d, flags);
        if (before.top.key !== after.top.key) topChanged += 1;
        for (let n = 0; n < before.grades.length; n += 1) {
          if (before.grades[n] !== 255 && before.grades[n] !== after.grades[n]) gradeChanged += 1;
        }
      }
    }
    line(`| ${label} | ${topChanged} | ${gradeChanged} | ${countThin(flags)} | ${regressionChecks(flags).filter((c) => !c.ok).length} |`);
  }
  line();
  line(`全合法シーケンスは 1 本 ${setupSequenceCount(1)} / 2 本 ${setupSequenceCount(2)} / 3 本 ${setupSequenceCount(3)} 通り × 各 180 状態（Bust を除く）。`);
  line();

  // 必須の状態
  const must: [number, number][] = [
    [192, 1], [195, 1], [200, 1],
    [182, 1], [183, 1], [184, 1], [185, 1], [186, 1], [187, 1], [188, 1], [189, 1],
    [302, 3], [303, 3], [304, 3], [305, 3], [306, 3], [307, 3], [308, 3], [309, 3],
    [312, 3], [320, 3], [330, 3],
    [192, 2], [195, 2], [200, 2], [200, 3], [312, 2], [320, 2], [330, 2],
  ];
  line('### 2-2. 指定された状態の第 1 候補（残し）');
  line();
  line('182〜189（1 本）は 302〜309 で T20 が 2 本入ったあとの 3 投目（資料 (5) の回帰テスト）。');
  line();
  line('| 残り | 本数 | 修正前 | A | B | C |');
  line('| ---: | ---: | --- | --- | --- | --- |');
  for (const [r, d] of must) {
    const cell = (flags: SetupV2Flags, base?: string) => {
      const top = setupState(r, d, flags).top;
      const text = `${pretty(top.key)}（${top.leave}）`;
      return base !== undefined && top.key !== base ? `**${text}**` : text;
    };
    const base = setupV1(r, d).top.key;
    line(`| ${r} | ${d} | ${cell(SETUP_FLAGS_OFF)} | ${cell(SETUP_OPTION_A, base)} | ${cell(SETUP_OPTION_B, base)} | ${cell(SETUP_OPTION_C, base)} |`);
  }
  line();
  // オーナーの表（192 / 195・1 本）
  line('**オーナー提示の表（1 本）の修正後の推奨度（案 A）**');
  line();
  line('| 残り | 狙い | 入った場合 | 修正前 | 案 A | 外れた場合 |');
  line('| ---: | --- | ---: | :---: | :---: | --- |');
  for (const [r, aims] of [[192, ['D16', 'T20', 'BULL']], [195, ['T19', 'T20', 'BULL']], [200, ['D20', 'T20', 'BULL']]] as const) {
    for (const aim of aims) {
      const g = (flags: SetupV2Flags) => {
        const state = setupState(r, 1, flags);
        const index = setupIndexOf(1, [aim]);
        return ['S', 'A', 'B', 'C'][state.grades[index]] ?? '—';
      };
      const hit = r - ({ D16: 32, T20: 60, BULL: 50, T19: 57, D20: 40 } as Record<string, number>)[aim];
      const miss = aim === 'BULL' ? `S-BULL → ${r - 25}` : aim.startsWith('D') ? `S${aim.slice(1)} → ${r - Number(aim.slice(1))}、盤外 → ${r}` : `S${aim.slice(1)} → ${r - Number(aim.slice(1))}`;
      line(`| ${r} | ${aim === 'BULL' ? 'D-BULL' : aim} | ${hit} | ${g(SETUP_FLAGS_OFF)} | ${g(SETUP_OPTION_A)} | ${miss} |`);
    }
  }
  line();

  // 回帰テスト
  line('### 2-3. 添付資料由来の回帰テストとの関係（302〜309 / 231〜235 / 271〜275 と動画ケース）');
  line();
  line('| テスト（setup.test.ts の期待値） | A | B | C |');
  line('| --- | :---: | :---: | :---: |');
  const a = regressionChecks(SETUP_OPTION_A);
  const b = regressionChecks(SETUP_OPTION_B);
  const c = regressionChecks(SETUP_OPTION_C);
  for (let i = 0; i < a.length; i += 1) {
    const mark = (x: { ok: boolean; got: string }) => (x.ok ? '○' : `× ${x.got}`);
    line(`| ${a[i].label} | ${mark(a[i])} | ${mark(b[i])} | ${mark(c[i])} |`);
  }
  line();
  line('231〜235 / 271〜275 の S-BULL 調整例は「Bust せず、テンパイとして評価される」ことだけをテストしており（A-2）、どの案でもスコアの加減で合法性・残りは変わらないため影響しません。');
  line();

  // 第 1 候補が変わる状態の一覧（A / B）
  for (const [label, flags] of [['A', SETUP_OPTION_A], ['B', SETUP_OPTION_B]] as const) {
    const rows: string[] = [];
    for (let d = 1; d <= 3; d += 1) {
      for (let r = 171; r <= 350; r += 1) {
        const before = setupV1(r, d).top;
        const after = setupState(r, d, flags).top;
        if (before.key === after.key) continue;
        rows.push(`| ${r} | ${d} | ${pretty(before.key)}（${before.leave}） | ${pretty(after.key)}（${after.leave}） |`);
      }
    }
    line(`<details><summary>案 ${label}: 第 1 候補が変わる状態の一覧（${rows.length} 件）</summary>`);
    line();
    line('| 残り | 本数 | 修正前（残し） | 修正後（残し） |');
    line('| ---: | ---: | --- | --- |');
    for (const row of rows) line(row);
    line();
    line('</details>');
    line();
  }

  // 推奨度の遷移（A）
  for (const [label, flags] of [['A', SETUP_OPTION_A], ['B', SETUP_OPTION_B]] as const) {
    const transitions = new Map<string, { count: number; examples: string[] }>();
    for (let d = 1; d <= 3; d += 1) {
      for (let r = 171; r <= 350; r += 1) {
        const before = setupV1(r, d).grades;
        const after = setupState(r, d, flags).grades;
        for (let n = 0; n < before.length; n += 1) {
          if (before[n] === 255 || before[n] === after[n]) continue;
          const key = `${'SABC'[before[n]]} → ${'SABC'[after[n]]}`;
          const entry = transitions.get(key) ?? { count: 0, examples: [] };
          entry.count += 1;
          if (entry.examples.length < 3 && (after[n] <= 1 || before[n] <= 1)) {
            entry.examples.push(`${r}/${d} 本 ${setupRouteText(d, n)}`);
          }
          transitions.set(key, entry);
        }
      }
    }
    line(`**案 ${label} の推奨度の遷移**（全合法シーケンス）`);
    line();
    line('| 遷移 | 件数 | 代表例 |');
    line('| --- | ---: | --- |');
    for (const [key, entry] of [...transitions.entries()].sort((x, y) => y[1].count - x[1].count)) {
      line(`| ${key} | ${entry.count} | ${entry.examples.join(' / ')} |`);
    }
    line();
  }
}

function countThin(flags: SetupV2Flags): number {
  let count = 0;
  for (let r = 171; r <= 350; r += 1) {
    for (let d = 1; d <= 3; d += 1) if (usesThinScoring(setupState(r, d, flags).top.darts)) count += 1;
  }
  return count;
}

function setupIndexOf(d: number, aims: readonly string[]): number {
  for (let n = 0; n < setupSequenceCount(d); n += 1) {
    if (setupRouteText(d, n) === aims.join(' → ')) return n;
  }
  return -1;
}

/** setup.test.ts のうち、第 1 候補に依存する期待値。 */
function regressionChecks(flags: SetupV2Flags): { label: string; ok: boolean; got: string }[] {
  const checks: { label: string; ok: boolean; got: string }[] = [];
  const top = (r: number, d: number) => setupState(r, d, flags).top;
  const thirdDart: [number, string, number][] = [
    [182, 'S18', 164], [183, 'S19', 164], [184, 'S20', 164], [185, 'S18', 167],
    [186, 'S19', 167], [187, 'S20', 167], [188, 'S18', 170], [189, 'S19', 170],
  ];
  for (const [r, id, leave] of thirdDart) {
    const t = top(r, 1);
    checks.push({ label: `${r + 120} の 3 投目（${r} / 1 本）= ${id} → ${leave}`, ok: t.darts[0].id === id && t.leave === leave, got: `${pretty(t.key)}（${t.leave}）` });
  }
  for (const [r, id] of [[302, 'T18'], [303, 'T19'], [305, 'T18'], [306, 'T19'], [308, 'T18'], [309, 'T19'], [299, 'T19']] as const) {
    const t = top(r, 3);
    checks.push({ label: `${r} / 3 本の第一ターゲット = ${id}`, ok: t.darts[0].id === id, got: pretty(t.key) });
  }
  for (const r of [300, 301, 304, 307]) {
    const t = top(r, 3);
    checks.push({ label: `${r} / 3 本は T20 から`, ok: t.darts[0].id === 'T20', got: pretty(t.key) });
  }
  {
    const t = top(279, 3);
    checks.push({ label: '279 / 3 本は T13 始動で 160 残し（A-18 の例）', ok: t.darts[0].id === 'T13' && t.leave === 160, got: `${pretty(t.key)}（${t.leave}）` });
  }
  {
    const t = top(271, 3);
    checks.push({ label: 'V-271-1: 271 は T20 × 3 で 91 残し', ok: t.key === 'T20-T20-T20' && t.leave === 91, got: `${pretty(t.key)}（${t.leave}）` });
  }
  {
    const t = top(231, 3);
    checks.push({ label: 'V-231-1: 231 は T20 → T20 → S20 で 91 残し', ok: t.key === 'T20-T20-S20' && t.leave === 91, got: `${pretty(t.key)}（${t.leave}）` });
  }
  {
    const t = top(246, 2);
    checks.push({ label: 'V-303-3: 246 / 2 本は 19 を続けて 170 残し', ok: t.leave === 170 && t.darts[0].baseNumber === 19, got: `${pretty(t.key)}（${t.leave}）` });
  }
  {
    const t = top(284, 2);
    checks.push({ label: 'V-303-2: 284 / 2 本は T20 → T20 で 164 残し', ok: t.key === 'T20-T20' && t.leave === 164, got: `${pretty(t.key)}（${t.leave}）` });
  }
  {
    const t = top(280, 2);
    checks.push({ label: '299 → S19: 280 / 2 本は T20 → T20 で 160 残し', ok: t.key === 'T20-T20' && t.leave === 160, got: `${pretty(t.key)}（${t.leave}）` });
  }
  return checks;
}

/** 1-6 の SETUP 側。狙い通り入ったときに、次の推奨が計画の残りと一致しない状態。 */
function setupPlanContinuity(): void {
  const nextTopKey = (left: number, dartsLeft: number, flags: SetupV2Flags): string | null => {
    if (left > MAX_CHECKOUT) return setupState(left, dartsLeft, flags).top.key;
    const suggestion = suggestFor(left, dartsLeft);
    const route = suggestion.checkoutRoutes[0] ?? suggestion.nextVisitRoute;
    return route ? route.key : null;
  };
  const count = (flags: SetupV2Flags) => {
    let firstStep = 0;
    let anyStep = 0;
    let withinSetup = 0;
    const examples: string[] = [];
    const setupExamples: string[] = [];
    for (let d = 2; d <= 3; d += 1) {
      for (let r = 171; r <= 350; r += 1) {
        const top = setupState(r, d, flags).top;
        let left = r;
        for (let step = 1; step < top.darts.length; step += 1) {
          left -= top.darts[step - 1].score;
          const next = nextTopKey(left, d - step, flags);
          if (next !== routeKey(top.darts.slice(step))) {
            if (step === 1) firstStep += 1;
            anyStep += 1;
            const text = `${r}/${d} 本 ${pretty(top.key)} → ${left}/${d - step} 本は ${next ? pretty(next) : '—'}`;
            if (left > MAX_CHECKOUT) {
              withinSetup += 1;
              if (setupExamples.length < 6) setupExamples.push(text);
            } else if (examples.length < 4) examples.push(text);
            break;
          }
        }
      }
    }
    return { firstStep, anyStep, withinSetup, examples, setupExamples };
  };
  const before = count(SETUP_FLAGS_OFF);
  const after = count(SETUP_OPTION_A);
  line('### 2-4. 狙い通り入っても計画と次の推奨が食い違う状態（1-6 L-M4・SETUP）');
  line();
  line('ラウンド開始時の第 1 候補を計画とし、狙い通り入るたびに「次の推奨」（171 以上は SETUP、170 以下は NEXT VISIT）と計画の残りを比べた。');
  line();
  line('| | 食い違う状態 | うち 1 投目のあと | うち次の残りが 171 以上（SETUP 同士） | うち次の残りが 170 以下（NEXT VISIT） |');
  line('| --- | ---: | ---: | ---: | ---: |');
  line(`| 修正前 | ${before.anyStep} | ${before.firstStep} | ${before.withinSetup} | ${before.anyStep - before.withinSetup} |`);
  line(`| 案 A | ${after.anyStep} | ${after.firstStep} | ${after.withinSetup} | ${after.anyStep - after.withinSetup} |`);
  line();
  line(`- SETUP 同士の例（修正前）: ${before.setupExamples.join('、')}`);
  line(`- NEXT VISIT へ入る例（修正前）: ${before.examples.join('、')}`);
  line(`- 監査報告の「SETUP 123 状態」とは数え方が一致しません（監査時の定義は不明）。本表は 2 本・3 本の全状態で、途中のどの投で食い違っても 1 状態として数えています。`);
  line();
  line('どちらも、1-6 の実装後は「ラウンド開始時の第 1 候補（計画）」の残りを推奨として続け、ここに挙がる再計算結果は「別例」として出します。');
  line();
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
line('# 戦術 v2 差分表（2026-11-01 オーナー承認・実装済み）');
line();
line(`生成: \`npm run audit:tactics-v2\`（${new Date().toISOString().slice(0, 10)}）。`);
line('提案 Q1〜Q8 はすべて提案どおりに承認され（`docs/APPROVALS.md` v2 / A-27〜A-33）、CHECKOUT は `CHECKOUT_FLAGS_V2`、SETUP は案 A を実装した。');
line('案 B / 案 C の列は、検討の記録として残している（採用していない）。重み・判定は人間が選んだ暫定の方針で、数学的・統計的に正しい値という意味ではない。');
line();
line(`承認した新しい重み: \`SPENDS_EXTRA_DART\` = ${PROPOSED_CHECKOUT_WEIGHTS.SPENDS_EXTRA_DART}、\`BELOW_TOP_ROUTE\` = ${PROPOSED_CHECKOUT_WEIGHTS.BELOW_TOP_ROUTE}（表示のみ）、\`SETUP_LAST_DART_MISS_KEEPS_TENPAI\` = +${SETUP_OPTION_A.lastDartMissBonus}（案 A）。案 B の \`SETUP_THIN_TARGET\` = 0 → −12 は採用していない。`);
line();
verifyReproduction();
checkoutSection();
itemDetails();
trainingPeers();
cWithoutNegative();
planContinuity();
setupSection();
setupPlanContinuity();

const target = resolve('docs/reports/tactics-v2-diff.md');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${out.join('\n')}\n`);
if (process.argv.includes('--stdout')) console.log(out.join('\n'));
console.log(`wrote ${target}（照合・前提の違反 ${failures} 件）`);
if (failures > 0) process.exitCode = 1;
// 型の参照だけ（未使用警告を避ける）
void ids;
void (null as unknown as RouteGrade);
