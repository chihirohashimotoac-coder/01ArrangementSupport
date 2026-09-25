/**
 * SIMULATION の GAME REVIEW（1 投の狙いの判定）の全数監査。
 *
 *   npm run audit:review
 *
 * 残り 2〜350 × 残り 1〜3 本 × 盤面の全ターゲット（THROWABLE_DARTS）を
 * `reviewThrow` にかけ、次の観点で判定の穴を数える。通常の `npm run test` には
 * 代表ケースと高速な全件検査だけを置き、この全走査はここへ分離している。
 *
 *   A. 計算できる事実（A: 狙い通り / B: シングル落ち後にテンパイへ進めるか）で
 *      言い切れるのに NOT_EVALUATED のまま
 *   B. GOOD なのに、狙い通り・シングル落ちの両方で上位互換の的がある
 *   C. Bogey を避けられる（テンパイを保てる）的があるのに GOOD
 *   D. トリプル等が先に要る残しと、シングル → ダブルの残しが同列 GOOD
 *      （上位互換が成り立つ組だけを数える。トレードオフの組は数えない）
 *
 * あわせて、振り返りの**自己矛盾**を数える（v1.4.4）。
 *
 *   矛盾 1. 「もっと良い狙いあり」なのに、説明文で同じ 1 投目を「おすすめ」している
 *   矛盾 2. 否定的な判定（見直す / ボギー）なのに、おすすめの 1 投目が狙いと同じ
 *   矛盾 3. 否定的な判定の説明文が、狙いと同じ 1 投目から始まるルートを勧めている
 *   矛盾 4. 推奨度 B / C で否定的に判定したが、別の 1 投目を 1 つも示せない
 *
 * おすすめの 1 投目が狙いと同じでも、振り返り独自の比較（A-21 / A-22 の上位互換など）で
 * 説明文が**別の 1 投目**を示している判定は、分類して件数だけ出す（矛盾には数えない）。
 *
 * A〜D（ただし B は残り 1 本のみ）と矛盾 1〜4 に 1 件でも該当すると終了コード 1 を返す。
 * 残り 2 本以上で推奨度 S / A が付いた狙いは、承認済みの SETUP ランキングの判断なので
 * 参考値として件数だけ出す（レビュー層では上書きしない）。
 */
import { MAX_CHECKOUT, MAX_SETUP_REMAINING, isBogey } from '../src/domain/checkoutRules';
import { THROWABLE_DARTS, type Dart } from '../src/domain/dart';
import { suggestFor } from '../src/engine/recovery/suggest';
import type { ThrowRecord } from '../src/engine/simulation/game';
import { analyzeLastDartSetup, type LastDartOption } from '../src/engine/simulation/lastDartSetup';
import { dominatesLeavePair, nextVisitLeaveProfileOf } from '../src/engine/simulation/leaveProfile';
import {
  THROW_VERDICTS,
  reviewThrow,
  type ThrowVerdict,
} from '../src/engine/simulation/review';
import { analyzeSetupRecovery } from '../src/engine/simulation/setupRecovery';
import { displayTargetId } from '../src/engine/simulation/notation';
import type { RouteGrade } from '../src/data/rankingRules';

function record(leftBefore: number, dart: Dart, dartsLeft: number): ThrowRecord {
  const dartNumber = 4 - dartsLeft;
  return {
    round: 1,
    dartNumber,
    dartIndex: dartNumber,
    leftBefore,
    intendedSegmentId: `segment-${dart.id.toLowerCase()}`,
    intendedDartId: dart.id,
    intendedPoint: { x: 0, y: 0 },
    actualPoint: { x: 0, y: 0 },
    actualDartId: dart.id,
    score: 0,
    leftAfter: leftBefore,
    bust: false,
    bustReason: null,
    checkout: false,
    drawsBefore: 0,
  };
}

function pairOf(option: LastDartOption) {
  return {
    hit: nextVisitLeaveProfileOf(option.leaveOnHit),
    miss: nextVisitLeaveProfileOf(option.leaveOnSingleMiss ?? 0),
  };
}

const NEGATIVE: ReadonlySet<ThrowVerdict> = new Set([
  'BETTER_OPTION_AVAILABLE',
  'ARRANGEMENT_MISTAKE',
  'SETUP_MISTAKE',
  'BOGEY_CREATED',
]);
const GRADE_ORDER: Readonly<Record<RouteGrade, number>> = { S: 3, A: 2, B: 1, C: 0 };

type Contradiction = '1' | '2' | '3' | '4';
const contradictions: Record<Contradiction, string[]> = { '1': [], '2': [], '3': [], '4': [] };
/** おすすめの 1 投目は狙いと同じだが、説明文は別の 1 投目を示している判定（分類のみ）。 */
const classifiedSameFirstDart = new Map<string, string[]>();
/** 推奨度では上位が無く、承認済みの提案順だけが別の 1 投目を示す判定（分類のみ）。 */
const orderOnlyAlternatives: string[] = [];

const counts = new Map<number, Record<ThrowVerdict, number>>();
const findings: Record<'A' | 'B' | 'C' | 'D', string[]> = { A: [], B: [], C: [], D: [] };
const engineGradedUnsafe: string[] = [];
let states = 0;

for (let left = 2; left <= MAX_SETUP_REMAINING; left += 1) {
  for (let dartsLeft = 1; dartsLeft <= 3; dartsLeft += 1) {
    const perDarts =
      counts.get(dartsLeft) ??
      (Object.fromEntries(THROW_VERDICTS.map((verdict) => [verdict, 0])) as Record<ThrowVerdict, number>);
    counts.set(dartsLeft, perDarts);

    const verdicts = new Map<string, ThrowVerdict>();
    // 振り返りが推奨度を読む候補一覧（review.ts の contextOf と同じ選び方）。
    const suggestion = suggestFor(left, dartsLeft, { maxRoutes: 1000 });
    const candidateRoutes: ReadonlyArray<{ darts: readonly Dart[]; grade: RouteGrade }> =
      suggestion.checkoutRoutes.length > 0
        ? suggestion.checkoutRoutes
        : suggestion.nextVisitProposals.length > 0
          ? suggestion.nextVisitProposals.map((proposal) => proposal.route)
          : suggestion.setupRoutes;
    for (const dart of THROWABLE_DARTS) {
      states += 1;
      const review = reviewThrow(record(left, dart, dartsLeft));
      perDarts[review.verdict] += 1;
      verdicts.set(dart.id, review.verdict);

      // 矛盾 1〜4: 振り返りの自己矛盾。
      if (NEGATIVE.has(review.verdict)) {
        const tag = `${left}/${dartsLeft} ${dart.id} ${review.verdict}（おすすめ ${review.recommendedRouteText}）`;
        const sameFirstDart = review.recommendedDartId === dart.id;
        const recommendsInNote =
          review.recommendedRouteText !== null &&
          review.noteJa.includes(`おすすめは ${review.recommendedRouteText}`);
        if (sameFirstDart) {
          if (review.verdict !== 'BETTER_OPTION_AVAILABLE') contradictions['2'].push(tag);
          else if (recommendsInNote) contradictions['1'].push(tag);
          else {
            const key = review.reason?.code ?? `推奨度 ${review.grade ?? '-'}（A-20 / A-21 の残り 1 投）`;
            classifiedSameFirstDart.set(key, [...(classifiedSameFirstDart.get(key) ?? []), tag]);
          }
        }
        const firstOfRecommended = review.recommendedRouteText?.split(' → ')[0] ?? null;
        if (recommendsInNote && firstOfRecommended === displayTargetId(dart.id)) {
          contradictions['3'].push(tag);
        }
        if (review.grade === 'B' || review.grade === 'C') {
          const own = GRADE_ORDER[review.grade];
          const higher = candidateRoutes.some(
            (route) => route.darts[0].id !== dart.id && GRADE_ORDER[route.grade] > own,
          );
          if (!higher) {
            if (sameFirstDart || review.recommendedDartId === null) contradictions['4'].push(tag);
            else orderOnlyAlternatives.push(tag);
          }
        }
      }

      // A / 参考: SETUP 帯で残り 2 本以上。
      if (left > MAX_CHECKOUT && dartsLeft >= 2 && dart.baseNumber !== null) {
        const recovery = analyzeSetupRecovery(left, dart, dartsLeft);
        const facts = recovery.intended;
        const decidable =
          (!facts.hitCanReachTenpai && recovery.hitAlternatives.length > 0) ||
          (facts.hitCanReachTenpai &&
            !facts.singleMissCanReachTenpai &&
            recovery.safeAlternatives.length > 0);
        if (decidable && review.verdict === 'NOT_EVALUATED') {
          findings.A.push(`${left}/${dartsLeft} ${dart.id}`);
        }
        if (
          review.verdict === 'GOOD_DECISION' &&
          facts.hitCanReachTenpai &&
          !facts.singleMissCanReachTenpai &&
          recovery.safeAlternatives.length > 0
        ) {
          engineGradedUnsafe.push(`${left}/${dartsLeft} ${dart.id}（推奨度 ${review.grade}）`);
        }
      }
    }

    // B / C / D: ビジット最後の 1 本で「次のラウンドへ残す」場面。
    if (dartsLeft !== 1 || left > MAX_SETUP_REMAINING) continue;
    if (suggestFor(left, 1).checkoutRoutes.length > 0) continue;
    const analysis = analyzeLastDartSetup(left);
    const candidates = analysis.tenpaiTargets.filter(
      (option) => option.leaveOnSingleMiss !== null && option.dart.kind !== 'double',
    );
    for (const option of candidates) {
      if (verdicts.get(option.dartId) !== 'GOOD_DECISION') continue;
      const own = pairOf(option);
      const by = candidates.find(
        (other) => other !== option && dominatesLeavePair(pairOf(other), own),
      );
      if (by !== undefined) findings.B.push(`${left}/1 ${option.dartId} ← ${by.dartId}`);
      if (
        !option.singleMissTenpai &&
        candidates.some((other) => other.singleMissTenpai)
      ) {
        findings.C.push(`${left}/1 ${option.dartId}（シングル落ち ${option.leaveOnSingleMiss}）`);
      }
      if (own.hit.kind === 'TWO_DART_OTHER' && by !== undefined && pairOf(by).hit.rank < own.hit.rank) {
        findings.D.push(`${left}/1 ${option.dartId}（${option.leaveOnHit}）← ${by.dartId}（${by.leaveOnHit}）`);
      }
    }
    for (const dart of THROWABLE_DARTS) {
      const option = analysis.optionFor(dart.id);
      if (option === null || verdicts.get(dart.id) !== 'GOOD_DECISION') continue;
      if (isBogey(option.leaveOnHit) && analysis.hasTenpaiTargets) {
        findings.C.push(`${left}/1 ${dart.id}（狙い通り ${option.leaveOnHit} が Bogey）`);
      }
    }
  }
}

console.log(`検査した状態数: ${states}（残り 2〜${MAX_SETUP_REMAINING} × 残り 1〜3 本 × ${THROWABLE_DARTS.length} ターゲット）`);
for (const [dartsLeft, perDarts] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  残り ${dartsLeft} 本: ${THROW_VERDICTS.map((verdict) => `${verdict}=${perDarts[verdict]}`).join(' ')}`);
}

const labels: Record<keyof typeof findings, string> = {
  A: '計算で言い切れるのに NOT_EVALUATED',
  B: 'GOOD なのに上位互換の的がある（残り 1 本）',
  C: 'Bogey / テンパイ喪失を避けられるのに GOOD（残り 1 本）',
  D: '先にトリプル等が要る残しが、シングル → ダブルの残しと同列 GOOD（残り 1 本）',
};
let failures = 0;
for (const key of ['A', 'B', 'C', 'D'] as const) {
  const list = findings[key];
  failures += list.length;
  console.log(`${list.length === 0 ? '  ok  ' : '  NG  '} ${key}. ${labels[key]}: ${list.length} 件`);
  for (const item of list.slice(0, 10)) console.log(`         ${item}`);
}
console.log(
  `  参考 SETUP 残り 2 本以上で、推奨度 S / A だがシングル落ちでテンパイを外し、` +
    `安全な的が他にある狙い: ${engineGradedUnsafe.length} 件（承認済みランキングの判断なので上書きしない）`,
);
for (const item of engineGradedUnsafe.slice(0, 10)) console.log(`         ${item}`);

const contradictionLabels: Record<Contradiction, string> = {
  '1': '「もっと良い狙いあり」なのに、説明文で同じ 1 投目をおすすめしている',
  '2': '否定的な判定（見直す / ボギー）なのに、おすすめの 1 投目が狙いと同じ',
  '3': '否定的な判定の説明文が、狙いと同じ 1 投目から始まるルートを勧めている',
  '4': '推奨度 B / C で否定的に判定したが、別の 1 投目を示せない',
};
for (const key of ['1', '2', '3', '4'] as const) {
  const list = contradictions[key];
  failures += list.length;
  console.log(`${list.length === 0 ? '  ok  ' : '  NG  '} 矛盾 ${key}. ${contradictionLabels[key]}: ${list.length} 件`);
  for (const item of list.slice(0, 10)) console.log(`         ${item}`);
}
const classifiedTotal = [...classifiedSameFirstDart.values()].reduce((sum, list) => sum + list.length, 0);
console.log(
  `  分類 「もっと良い狙いあり」でおすすめの 1 投目が狙いと同じだが、説明文は別の 1 投目を示す: ` +
    `${classifiedTotal} 件（アプリの第 1 候補と振り返り独自の比較の食い違い。画面では代案に出さない）`,
);
for (const [key, list] of classifiedSameFirstDart) {
  console.log(`         ${key}: ${list.length} 件（例: ${list.slice(0, 3).join(' / ')}）`);
}
console.log(
  `  分類 推奨度では上位が無く、承認済みの提案順だけが別の 1 投目を示す: ${orderOnlyAlternatives.length} 件`,
);
for (const item of orderOnlyAlternatives.slice(0, 10)) console.log(`         ${item}`);

if (failures > 0) process.exitCode = 1;
