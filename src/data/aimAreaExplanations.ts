/**
 * 「盤面の狙い方」の表示文。
 *
 * 判定（Bust か・何が残るか）はすべて `engine/aimArea` が計算する。
 * ここでは、その結果を日本語へ置き換えるだけで、残り点やダブルを書き込まない。
 *
 * 言い方の約束:
 *   - 「プロが使う」「高確率」「最適」とは書かない（確率のデータを持っていない）。
 *   - エリアはシングル帯の話であり、トリプル・ダブル帯まで安全とは書かない。
 *   - ワイヤー上の一点を「最適な狙い」とは書かない。
 */
import type { BustReason } from '../domain/checkoutRules';
import type { AimAreaAnalysis, AimLanding, AimLandingKind } from '../engine/aimArea/aimArea';
import { DOUBLE_QUALITY } from './rankingRules';

/** 着弾の結果に付ける短いラベル。 */
export const AIM_LANDING_KIND_LABEL_JA: Readonly<Record<AimLandingKind, string>> = {
  bust: 'BUST',
  checkout: '上がり',
  'finish-next-dart': '次の1本',
  'finish-in-two': 'あと2本',
  'next-visit': '今回は不可',
  bogey: 'ノーテン',
  'above-range': '170超え',
};

const BUST_REASON_SHORT_JA: Readonly<Record<BustReason, string>> = {
  NOT_DOUBLE_FINISH: '0 点ちょうどでも最後がダブルではないため',
  BELOW_ZERO: '点数を超えるため',
  LEFT_ONE: '残り 1 になるため',
};

function joinNumbers(numbers: readonly number[]): string {
  return numbers.join('・');
}

/** 見出し。例「6・10 のシングル」「17・3・19・7 のシングル」（盤面の順）。 */
export function aimAreaTitleJa(analysis: AimAreaAnalysis): string {
  return `${joinNumbers(analysis.orderedNumbers)} のシングル`;
}

/**
 * たたんだ状態でも見せる注意。エリアの中に Bust する的が無ければ null。
 * 例「注意：T16 に入ると BUST（0 点ちょうどでも最後がダブルではないため）」。
 */
export function aimAreaCautionJa(analysis: AimAreaAnalysis): string | null {
  const busts = analysis.landings.filter(
    (landing) => landing.role !== 'outside' && landing.kind === 'bust',
  );
  if (busts.length === 0) return null;
  const ids = busts.map((landing) => landing.dart.id).join('・');
  if (busts.length === 1 && busts[0].bustReason) {
    return `注意：${ids} に入ると BUST（${BUST_REASON_SHORT_JA[busts[0].bustReason]}）`;
  }
  return `注意：${ids} に入ると BUST`;
}

/** 1 つの着弾の結果（矢印の右側）。 */
export function aimLandingOutcomeJa(landing: AimLanding): string {
  switch (landing.kind) {
    case 'bust':
      if (landing.bustReason === 'NOT_DOUBLE_FINISH') {
        return '0 点ちょうど。最後がダブルではないので BUST';
      }
      if (landing.bustReason === 'LEFT_ONE') return '残り 1 で BUST';
      // 例: 39 で T19（57 点）→ 18 点超える。負の数のまま見せると「−18 点を取る」と読めてしまう。
      return `残り点を ${-landing.difference} 点超えるので BUST`;
    case 'checkout':
      return '上がり';
    case 'finish-next-dart':
      return `残り ${landing.leave} → 次の 1 本で ${landing.finishDartId}`;
    case 'finish-in-two':
      return landing.exampleRouteIds
        ? `残り ${landing.leave} → あと 2 本（例 ${landing.exampleRouteIds.join(' → ')}）`
        : `残り ${landing.leave} → あと 2 本で上がれる`;
    case 'next-visit':
      return landing.dartsAfter === 0
        ? `残り ${landing.leave}（このビジットはここまで）`
        : `残り ${landing.leave} → 残り ${landing.dartsAfter} 本では上がれない（次ラウンド向け）`;
    case 'bogey':
      return `残り ${landing.leave}（ノーテン）`;
    case 'above-range':
      return `残り ${landing.leave}（170 超え）`;
  }
}

/** 本文の最初の 1 文。 */
export function aimAreaLeadJa(analysis: AimAreaAnalysis): string {
  if (!analysis.canFinishThisVisit) {
    return '残り 1 本では、このエリアへ投げても今回の 3 投では上がれません。次のラウンドへの残しは NEXT VISIT を見てください。';
  }
  const area = joinNumbers(analysis.orderedNumbers);
  if (analysis.areaSinglesFinishNextDart) {
    return `${area} は盤面で隣り合っています。どのシングルに入っても、次の 1 本でダブルが残ります。1 つのナンバーではなく、隣り合う ${area} を一まとまりの的として見る考え方です。`;
  }
  return `${area} は盤面で隣り合っています。入った場所ごとの結果は次のとおりです。`;
}

/** 本文の補足。すべて計算結果から組み立てる。残り 2 本以上のときだけ使う。 */
export function aimAreaNotesJa(analysis: AimAreaAnalysis): string[] {
  if (!analysis.canFinishThisVisit) return [];
  const notes: string[] = [
    '狙うのはシングル帯（内側・外側）です。トリプル・ダブルの帯まで安全という意味ではなく、ワイヤー上の一点が最適という意味でもありません。',
  ];

  /*
   * 奇数ダブルなど、扱いにくいダブル（既存の DOUBLE_QUALITY で awkward）が残る着弾。
   * エリア内のナンバーはすべて同じ基準で並べ、主従は付けない。
   */
  const awkward = analysis.landings.filter(
    (landing) =>
      landing.role === 'area' &&
      landing.kind === 'finish-next-dart' &&
      landing.finishDartId !== null &&
      DOUBLE_QUALITY[landing.finishDartId]?.tier === 'awkward',
  );
  if (awkward.length > 0) {
    const pairs = awkward.map((landing) => `${landing.dart.id} → ${landing.finishDartId}`).join('、');
    notes.push(`どれも上がりは残りますが、${pairs} は奇数ダブルが残ります。`);
  }

  // エリアの外: 「隣り合う 2 つに入れば安全」は、全方向のズレに安全という意味ではない。
  const outsideMiss = analysis.landings.filter(
    (landing) => landing.role === 'outside' && landing.kind !== 'finish-next-dart',
  );
  if (outsideMiss.length > 0) {
    notes.push(
      `エリアの外の ${outsideMiss.map((landing) => landing.dart.id).join(' / ')} へ外れると、次の 1 本では上がれません。`,
    );
  }

  notes.push(
    '横方向にブレやすい人ほど、隣り合うナンバーを一まとまりに見る価値が上がりえます。狙った 1 つのシングルへ入れられる人は、基準ルートどおりで十分です。得意なダブルによっても選び方は変わります。',
  );
  return notes;
}

/** 着弾一覧のグループ見出し。 */
export const AIM_LANDING_GROUP_LABEL_JA = {
  area: 'エリアのナンバー',
  outside: 'エリアのすぐ外',
} as const;
