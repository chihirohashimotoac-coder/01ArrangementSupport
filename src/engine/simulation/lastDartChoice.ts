/** 最後の1本の実戦選択。レビューと実戦表示が同じ数値比較を使う。 */
import { MAX_CHECKOUT } from '../../domain/checkoutRules';
import type { NextVisitProposal } from '../recovery/nextVisitSelection';
import {
  analyzeLastDartSetup,
  recommendedLastDartTargets,
  type LastDartOption,
  type LastDartSetupAnalysis,
} from './lastDartSetup';
import { dominatesLeavePair, nextVisitLeaveProfileOf, type LeaveProfile } from './leaveProfile';

export interface LeavePair {
  readonly hit: LeaveProfile;
  readonly miss: LeaveProfile;
}

export function leavePairOf(option: LastDartOption): LeavePair | null {
  if (option.leaveOnSingleMiss === null) return null;
  return {
    hit: nextVisitLeaveProfileOf(option.leaveOnHit),
    miss: nextVisitLeaveProfileOf(option.leaveOnSingleMiss),
  };
}

export function sameNumberTripleUpgradeOf(
  analysis: LastDartSetupAnalysis,
  option: LastDartOption,
  left: number,
): LastDartOption | null {
  if (left <= MAX_CHECKOUT || option.dart.kind !== 'single' || !option.hitTenpai) return null;
  const number = option.dart.baseNumber;
  if (number === null) return null;
  const triple = analysis.optionFor(`T${number}`);
  return triple !== null && triple.hitTenpai && triple.singleMissTenpai &&
    triple.leaveOnSingleMiss === option.leaveOnHit ? triple : null;
}

export interface LastDartTradeOffScope {
  readonly proposals: readonly NextVisitProposal[];
  readonly preferredDoubles: readonly string[];
}

export function directDoubleIdOf(leave: number): string | null {
  return nextVisitLeaveProfileOf(leave).kind === 'DIRECT_DOUBLE' ? `D${leave / 2}` : null;
}

export function isLastDartDoubleTradeOff(params: {
  readonly intendedDartId: string;
  readonly intendedHitLeave: number;
  readonly alternativeHitLeave: number;
  readonly proposalFirstDartIds: readonly string[];
  readonly preferredDoubles: readonly string[];
}): boolean {
  if (!params.proposalFirstDartIds.includes(params.intendedDartId)) return false;
  const own = directDoubleIdOf(params.intendedHitLeave);
  const other = directDoubleIdOf(params.alternativeHitLeave);
  if (own === null || other === null || own === other) return false;
  const ownRank = params.preferredDoubles.indexOf(own);
  const otherRank = params.preferredDoubles.indexOf(other);
  if (otherRank < 0) return true;
  return ownRank >= 0 && ownRank < otherRank;
}

function baseDominatingLastDartOptionsOf(
  analysis: LastDartSetupAnalysis,
  option: LastDartOption,
): readonly LastDartOption[] {
  const own = leavePairOf(option);
  if (own === null) return [];
  const pairs = new Map<string, LeavePair>();
  for (const candidate of analysis.tenpaiTargets) {
    if (candidate.dartId === option.dartId || candidate.dart.kind === 'double') continue;
    const pair = leavePairOf(candidate);
    if (pair !== null && dominatesLeavePair(pair, own)) pairs.set(candidate.dartId, pair);
  }
  const kindOrder = (item: LastDartOption) => (item.dart.kind === 'triple' ? 0 : 1);
  return analysis.tenpaiTargets
    .filter((candidate) => pairs.has(candidate.dartId))
    .sort((a, b) => {
      const pa = pairs.get(a.dartId)!;
      const pb = pairs.get(b.dartId)!;
      return pa.hit.rank - pb.hit.rank || pa.miss.rank - pb.miss.rank ||
        kindOrder(a) - kindOrder(b) || b.dart.score - a.dart.score ||
        a.dartId.localeCompare(b.dartId);
    });
}

export function lastDartDominanceOf(
  analysis: LastDartSetupAnalysis,
  option: LastDartOption,
  tradeOff: LastDartTradeOffScope,
): { readonly dominating: readonly LastDartOption[]; readonly tradeOffs: readonly LastDartOption[] } {
  const all = baseDominatingLastDartOptionsOf(analysis, option);
  const proposalFirstDartIds = tradeOff.proposals.map((proposal) => proposal.route.darts[0]?.id ?? '');
  const isTradeOff = (candidate: LastDartOption) => isLastDartDoubleTradeOff({
    intendedDartId: option.dartId,
    intendedHitLeave: option.leaveOnHit,
    alternativeHitLeave: candidate.leaveOnHit,
    proposalFirstDartIds,
    preferredDoubles: tradeOff.preferredDoubles,
  });
  return {
    dominating: all.filter((candidate) => !isTradeOff(candidate)),
    tradeOffs: all.filter(isTradeOff),
  };
}

export function dominatingLastDartOptionsOf(
  analysis: LastDartSetupAnalysis,
  option: LastDartOption,
  tradeOff: LastDartTradeOffScope,
): readonly LastDartOption[] {
  return lastDartDominanceOf(analysis, option, tradeOff).dominating;
}

/** 基準例がレビューで減点される場面だけ、実戦で先に示す的を返す。 */
export function practicalLastDartChoice(
  left: number,
  baselineDartId: string | null,
  scope: LastDartTradeOffScope,
  protectedDartId: string | null = null,
): LastDartOption | null {
  if (baselineDartId === null) return null;
  const analysis = analyzeLastDartSetup(left);
  if (!analysis.hasTenpaiTargets) return null;
  const baseline = analysis.optionFor(baselineDartId);
  if (baseline === null || baseline.dart.kind === 'double' || baseline.leaveOnSingleMiss === null) return null;

  const acceptable = (option: LastDartOption) =>
    option.hitTenpai &&
    (option.singleMissTenpai || analysis.safeTargets.length === 0) &&
    sameNumberTripleUpgradeOf(analysis, option, left) === null &&
    (option.dartId === protectedDartId ||
      dominatingLastDartOptionsOf(analysis, option, scope).length === 0);
  if (acceptable(baseline)) return null;

  const tripleUpgrade = sameNumberTripleUpgradeOf(analysis, baseline, left);
  if (tripleUpgrade !== null && acceptable(tripleUpgrade)) return tripleUpgrade;

  const dominators = dominatingLastDartOptionsOf(analysis, baseline, scope);
  const candidates = [
    ...dominators,
    ...recommendedLastDartTargets(analysis, Number.POSITIVE_INFINITY),
  ];
  return candidates.find((candidate) => acceptable(candidate)) ?? null;
}
