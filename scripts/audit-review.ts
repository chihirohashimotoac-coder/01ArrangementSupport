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
 *   E. CHECKOUT で、狙いから始まる上がり方がおすすめルートと戦術評価で同等以上
 *      （基準ルート加点を除く戦術スコアがおすすめ以上・おすすめに無い非推奨理由なし）
 *      なのに否定的に判定している。逆に、その条件を満たさないのに
 *      `CHECKOUT_PEER_OF_RECOMMENDED` で GOOD にしている（v1.4.5。合法なだけで GOOD にしない）
 *   F. NEXT VISIT の**全提案**を走査し（得意ダブル設定なし・D20・D16・D18・D16/D20/D8）、
 *      第 1 案以外の提案の 1 投目が、第 1 案に明確な上位互換を取られていないのに否定されている。
 *      逆に、上位互換を取られているのに `NEXT_VISIT_PROPOSAL_NOT_DOMINATED` で GOOD にしている
 *      （v1.4.6。提案だから GOOD、にはしない）。ビジット最後の 1 投は件数だけ出す（範囲外）。
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
 * A〜F（ただし B は残り 1 本のみ）と矛盾 1〜4 に 1 件でも該当すると終了コード 1 を返す。
 * 残り 2 本以上で推奨度 S / A が付いた狙いは、承認済みの SETUP ランキングの判断なので
 * 参考値として件数だけ出す（レビュー層では上書きしない）。
 */
import { MAX_CHECKOUT, MAX_SETUP_REMAINING, isBogey } from '../src/domain/checkoutRules';
import { THROWABLE_DARTS, findDart, type Dart } from '../src/domain/dart';
import {
  buildNextVisitCandidates,
  nextVisitTierOf,
  type NextVisitProposal,
} from '../src/engine/recovery/nextVisitSelection';
import { evaluateLeave } from '../src/engine/setup/leaveQuality';
import { difficultyOf, targetKeyOf } from '../src/engine/setup/sequences';
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
import { DISCOURAGING_REASON_CODES, type RouteGrade } from '../src/data/rankingRules';
import type { RankedCheckoutRoute } from '../src/engine/ranking/checkoutRanking';

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

/** 非推奨の理由コード（`DISCOURAGING_REASON_CODES`）だけを取り出す。 */
function discouragingOf(route: RankedCheckoutRoute): Set<string> {
  const codes = DISCOURAGING_REASON_CODES as readonly string[];
  return new Set(route.reasons.map((reason) => reason.code as string).filter((code) => codes.includes(code)));
}

/**
 * E の独立計算: 狙いから始まる上がり方に、おすすめ（一覧の先頭）と比べて
 * 戦術スコアが同じか上で、おすすめに無い非推奨理由を持たないものがあるか。
 */
function hasCheckoutPeer(routes: readonly RankedCheckoutRoute[], dartId: string): boolean {
  const top = routes[0];
  if (top === undefined || top.darts[0].id === dartId) return false;
  const allowed = discouragingOf(top);
  return routes.some(
    (route) =>
      route.darts[0].id === dartId &&
      route.tacticalScore >= top.tacticalScore &&
      [...discouragingOf(route)].every((code) => allowed.has(code)),
  );
}

type Contradiction = '1' | '2' | '3' | '4';
const contradictions: Record<Contradiction, string[]> = { '1': [], '2': [], '3': [], '4': [] };
/** おすすめの 1 投目は狙いと同じだが、説明文は別の 1 投目を示している判定（分類のみ）。 */
const classifiedSameFirstDart = new Map<string, string[]>();
/** 推奨度では上位が無く、承認済みの提案順だけが別の 1 投目を示す判定（分類のみ）。 */
const orderOnlyAlternatives: string[] = [];

const counts = new Map<number, Record<ThrowVerdict, number>>();
const findings: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F', string[]> = {
  A: [],
  B: [],
  C: [],
  D: [],
  E: [],
  F: [],
};
/** `CHECKOUT_PEER_OF_RECOMMENDED` で GOOD になった狙い（参考。件数と例だけ出す）。 */
const checkoutPeers: string[] = [];
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

      // E: CHECKOUT で、おすすめと戦術評価で同等以上の上がり方がある 1 投目。
      if (suggestion.checkoutRoutes.length > 0) {
        const peer = hasCheckoutPeer(suggestion.checkoutRoutes, dart.id);
        const markedPeer = review.reason?.code === 'CHECKOUT_PEER_OF_RECOMMENDED';
        if (markedPeer) checkoutPeers.push(`${left}/${dartsLeft} ${dart.id}（推奨度 ${review.grade}）`);
        if (peer && NEGATIVE.has(review.verdict)) {
          findings.E.push(`${left}/${dartsLeft} ${dart.id} ${review.verdict}（同等以上なのに否定）`);
        }
        if (markedPeer && (!peer || review.verdict !== 'GOOD_DECISION')) {
          findings.E.push(`${left}/${dartsLeft} ${dart.id} ${review.verdict}（条件を満たさないのに同等扱い）`);
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

// F: NEXT VISIT の全提案（v1.4.6）。review.ts とは独立に 6 観点を計算し直す。
const TIERS = ['A', 'B', 'C', 'D', 'E'];
const tierRank = (leave: number) => {
  const tier = nextVisitTierOf(leave);
  return tier === null ? TIERS.length : TIERS.indexOf(tier);
};
function facetsOf(proposal: NextVisitProposal, left: number, dartsLeft: number, preferred: readonly string[]) {
  const darts = proposal.route.darts;
  const leave = proposal.route.leave;
  const first = darts[0];
  let miss = -1;
  if (first.kind !== 'single' && first.baseNumber !== null) {
    const after = left - findDart(`S${first.baseNumber}`)!.score;
    if (after < 2) miss = TIERS.length;
    else if (dartsLeft === 1) miss = tierRank(after);
    else {
      const next = buildNextVisitCandidates(after, dartsLeft - 1);
      miss = next.length === 0 ? TIERS.length : Math.min(...next.map((item) => TIERS.indexOf(item.tier)));
    }
  }
  const finish = leave % 2 === 0 && leave >= 2 && leave <= 40 ? `D${leave / 2}` : null;
  const preference = finish === null ? -1 : preferred.indexOf(finish);
  return [
    tierRank(leave),
    -evaluateLeave(leave).score,
    darts.reduce((sum, dart) => sum + difficultyOf(dart), 0),
    miss,
    darts.slice(1).filter((dart, index) => targetKeyOf(dart) !== targetKeyOf(darts[index])).length,
    preference < 0 ? Number.MAX_SAFE_INTEGER : preference,
  ];
}
const proposalScan = new Map<string, number>();
const lastDartProposals: string[] = [];
for (const preferred of [[], ['D20'], ['D16'], ['D18'], ['D16', 'D20', 'D8']]) {
  const tag = preferred.length === 0 ? '設定なし' : preferred.join('/');
  for (let left = 2; left <= MAX_CHECKOUT; left += 1) {
    for (let dartsLeft = 1; dartsLeft <= 3; dartsLeft += 1) {
      const suggestion = suggestFor(left, dartsLeft, { fallbackPreferredDoubles: preferred, maxRoutes: 1000 });
      if (suggestion.checkoutRoutes.length > 0) continue;
      const primary = suggestion.nextVisitProposals[0];
      if (primary === undefined) continue;
      const own = facetsOf(primary, left, dartsLeft, preferred);
      for (const proposal of suggestion.nextVisitProposals) {
        const dart = proposal.route.darts[0];
        const review = reviewThrow(record(left, dart, dartsLeft), { preferredDoubles: preferred });
        const key = `${proposal === primary ? '第 1 案' : proposal.kind} ${review.verdict}`;
        proposalScan.set(key, (proposalScan.get(key) ?? 0) + 1);
        if (proposal === primary || dart.id === primary.route.darts[0].id) continue;
        const item = `${tag} ${left}/${dartsLeft} ${dart.id}（${proposal.kind}: ${proposal.route.routeText}）${review.verdict}`;
        if (dartsLeft === 1) {
          if (NEGATIVE.has(review.verdict)) lastDartProposals.push(item);
          continue;
        }
        const facets = facetsOf(proposal, left, dartsLeft, preferred);
        const better = facets.some((value, index) => value < own[index]);
        const worse = facets.some((value, index) => value > own[index]);
        const dominated = !better && worse;
        const marked = review.reason?.code === 'NEXT_VISIT_PROPOSAL_NOT_DOMINATED';
        if (!dominated && NEGATIVE.has(review.verdict)) findings.F.push(`${item}（上位互換なしなのに否定）`);
        if (dominated && marked) findings.F.push(`${item}（上位互換ありなのに同等扱い）`);
      }
    }
  }
}
console.log(
  `  参考 NEXT VISIT の全提案の 1 投目の判定（5 通りの得意ダブル設定の合計）: ` +
    [...proposalScan.entries()].map(([key, count]) => `${key}=${count}`).join(' / '),
);
console.log(
  `  参考 ビジット最後の 1 投で、第 1 案以外の提案の 1 投目が否定される: ${lastDartProposals.length} 件` +
    `（最後の 1 投と得意ダブルの競合。この監査の範囲外）`,
);
for (const item of lastDartProposals.slice(0, 10)) console.log(`         ${item}`);

const labels: Record<keyof typeof findings, string> = {
  A: '計算で言い切れるのに NOT_EVALUATED',
  B: 'GOOD なのに上位互換の的がある（残り 1 本）',
  C: 'Bogey / テンパイ喪失を避けられるのに GOOD（残り 1 本）',
  D: '先にトリプル等が要る残しが、シングル → ダブルの残しと同列 GOOD（残り 1 本）',
  E: 'CHECKOUT で、おすすめと戦術評価で同等以上の上がり方がある 1 投目の判定が条件と食い違う',
  F: 'NEXT VISIT の第 1 案以外の提案の 1 投目の判定が、第 1 案との上位互換の有無と食い違う',
};
let failures = 0;
for (const key of ['A', 'B', 'C', 'D', 'E', 'F'] as const) {
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
console.log(
  `  参考 CHECKOUT で推奨度 B / C だが、おすすめと戦術評価で同等以上のため GOOD にした狙い: ` +
    `${checkoutPeers.length} 件（例: ${checkoutPeers.slice(0, 5).join(' / ')}）`,
);

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
