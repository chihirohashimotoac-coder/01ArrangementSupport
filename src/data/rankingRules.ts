/**
 * ルート評価の重みと戦術方針データ。
 *
 * ============================================================
 *  HUMAN APPROVAL REQUIRED
 *  このファイルの数値・分類の変更は「戦術方針の変更」に当たる。
 *  AI が「こちらの方が合理的だから」という理由で書き換えてはならない。
 *  変更提案は docs/DATA_CONFLICTS.md へ PROPOSED CHANGE として記録する。
 * ============================================================
 *
 * 重みはすべて加点方式で、合計値が大きいほど推奨度が高い。
 * 絶対値そのものに意味はなく、相対的な大小関係だけを設計している。
 */
import type { CheckoutReasonCode, SetupReasonCode } from '../domain/reasonCodes';

/** チェックアウトルート評価の重み。 */
export const CHECKOUT_REASON_WEIGHTS: Readonly<Record<CheckoutReasonCode, number>> = {
  // 基準ルートは「まずこれを覚える」対象なので、単独で最上位へ来る強さを持たせる。
  STANDARD_ROUTE: 120,

  FINISH_IN_ONE: 40,
  FEWER_DARTS: 30,

  // 外したときに上がりが残るかどうかが、このアプリで最も重視する観点。
  SINGLE_MISS_SAFE: 45,
  // シングル狙いは的が太く、上下へズレても失点差が小さい。
  // トリプル狙いで「外しても大丈夫」と同等に評価する。
  SAFE_SINGLE_START: 45,
  SINGLE_MISS_LOSES_CHECKOUT: -50,
  SINGLE_MISS_LEAVES_BOGEY: -25,

  NEIGHBOR_SAFE: 18,
  NEIGHBOR_RISK: -18,

  GOOD_DOUBLE: 22,
  WEAK_DOUBLE: -20,
  USER_DOUBLE_PREFERENCE: 0, // MY ROUTE 側で順位に応じた値を動的に加算する。

  BULL_REQUIRED: -14,
  TARGET_CONTINUITY: 12,
  EXTRA_TARGET_SWITCH: -6,
  SAFER_START_EXISTS: -22,
  UNNECESSARY_TRIPLE: -16,

  // 繋ぎのダートをダブルリングへ置くのは、細い的を無駄に増やす選択になる。
  // 実戦では大きなシングル面か、得点効率の高いトリプルを繋ぎに使う。
  NON_FINAL_DOUBLE: -38,
};

/** ダート数そのものへのペナルティ（本数が増えるほど不利）。 */
export const DART_COUNT_PENALTY = 24;

/**
 * トリプル 1 本あたりのペナルティ。
 * トリプルは盤面で最も狭い的なので、同じ結果ならトリプルの本数が少ない方を上に置く。
 * 170 のように全ルートがトリプル 2 本を要求する場合は一律に効くため、順位は変わらない。
 */
export const TRIPLE_COUNT_PENALTY = 12;

/**
 * MY ROUTE における得意ダブルの加点。
 * 配列の添字が順位（0 = 第1希望）で、登録数がこれより多い場合は末尾値を使う。
 */
export const USER_DOUBLE_PREFERENCE_BONUS: readonly number[] = [70, 55, 42, 32, 24, 18, 12, 8];

/** ダブルの扱いやすさ分類。 */
export type DoubleQualityTier = 'excellent' | 'good' | 'fair' | 'awkward';

export interface DoubleQuality {
  readonly tier: DoubleQualityTier;
  /** 分類の根拠（表示にも使う）。 */
  readonly reasonJa: string;
}

/**
 * ダブルごとの扱いやすさ。
 *
 * 基本方針:
 *  - 偶数ダブルは、外してシングルへ落ちても残りが偶数のまま次のダブルへ繋がる。
 *  - D16 は 16 → 8 → 4 → 2 → 1 と 2 分割が続くため、外したあとの立て直しが最も楽。
 *  - 奇数ダブルは、シングルへ落ちると残りが奇数になり組み立て直しが要る。
 */
export const DOUBLE_QUALITY: Readonly<Record<string, DoubleQuality>> = {
  D20: { tier: 'excellent', reasonJa: '外して S20 でも 20 が残り、そのまま D10 へ繋がります' },
  D16: { tier: 'excellent', reasonJa: '16 → 8 → 4 → 2 と half が続き、外しても立て直しやすいダブルです' },
  D8: { tier: 'good', reasonJa: '8 → 4 → 2 と half が続きます' },
  D4: { tier: 'good', reasonJa: '4 → 2 → 1 と half が続きます' },
  D10: { tier: 'good', reasonJa: '外して S10 でも 10 が残り、D5 へ繋がります' },
  D12: { tier: 'good', reasonJa: '12 → 6 → 3 と繋がる扱いやすい偶数ダブルです' },
  D18: { tier: 'good', reasonJa: '外して S18 でも 18 が残り、D9 へ繋がります' },
  D2: { tier: 'fair', reasonJa: '2 → 1 と繋がりますが、後がありません' },
  D6: { tier: 'fair', reasonJa: '6 → 3 と繋がる偶数ダブルです' },
  D14: { tier: 'fair', reasonJa: '14 → 7 と繋がる偶数ダブルです' },
  D1: { tier: 'fair', reasonJa: '最小のダブルで、外すと 1 残しの Bust に直結します' },
  D3: { tier: 'awkward', reasonJa: '奇数ダブルのため、外すと残りが奇数になり組み立て直しが要ります' },
  D5: { tier: 'awkward', reasonJa: '奇数ダブルのため、外すと残りが奇数になり組み立て直しが要ります' },
  D7: { tier: 'awkward', reasonJa: '奇数ダブルのため、外すと残りが奇数になり組み立て直しが要ります' },
  D9: { tier: 'awkward', reasonJa: '奇数ダブルのため、外すと残りが奇数になり組み立て直しが要ります' },
  D11: { tier: 'awkward', reasonJa: '奇数ダブルのため、外すと残りが奇数になり組み立て直しが要ります' },
  D13: { tier: 'awkward', reasonJa: '奇数ダブルのため、外すと残りが奇数になり組み立て直しが要ります' },
  D15: { tier: 'awkward', reasonJa: '奇数ダブルのため、外すと残りが奇数になり組み立て直しが要ります' },
  D17: { tier: 'awkward', reasonJa: '奇数ダブルのため、外すと残りが奇数になり組み立て直しが要ります' },
  D19: { tier: 'awkward', reasonJa: '奇数ダブルのため、外すと残りが奇数になり組み立て直しが要ります' },
  BULL: { tier: 'fair', reasonJa: 'BULL 上がりは合法ですが、外したときの代替が乏しくなります' },
};

/** GOOD_DOUBLE / WEAK_DOUBLE を付与する境界。 */
export const GOOD_DOUBLE_TIERS: readonly DoubleQualityTier[] = ['excellent', 'good'];
export const WEAK_DOUBLE_TIERS: readonly DoubleQualityTier[] = ['awkward'];

// ---------------------------------------------------------------------------
// SETUP（171〜350）側の重み
// ---------------------------------------------------------------------------

export const SETUP_REASON_WEIGHTS: Readonly<Record<SetupReasonCode, number>> = {
  // 「上がれる残りを作れているか」が SETUP の合否そのもの。
  LEAVES_CHECKOUTABLE: 100,
  LEAVES_BOGEY: -140,
  LEAVE_ABOVE_CHECKOUT_RANGE: -60,

  LEAVES_PREMIUM_TENPAI: 30,
  LEAVES_TWO_DART_CHECKOUT: 26,
  LEAVE_LAST_DIGIT_0147: 6,
  LEAVE_REQUIRES_BULL: -8,
  LEAVE_GOOD_FINISH_DOUBLE: 10,

  SETUP_MAIN_TARGET_CONTINUITY: 16,
  SETUP_THIRD_DART_ADJUST: 10,
  SETUP_USES_SBULL: 4,
  SETUP_TON_TRAP: -30,
  SETUP_LOW_SCORE: -18,
  // 得点・調整のためにダブルリングを狙うのは、細い的をわざわざ選ぶことになる。
  SETUP_THIN_TARGET: 0, // 難易度モデル（SEGMENT_DIFFICULTY）へ統合したため 0。表示のみに使う。
};

/**
 * SETUP における取得点 1 点あたりの加点。
 *
 * 「最大得点を取るゲームではない」ため、残りの質（LEAVES_* の重み）より
 * 十分に小さくしてある。同じ質の残りを作れるなら、点を多く取る方を選ぶ、
 * という位置づけの重み。
 */
export const SETUP_POINTS_WEIGHT = 0.7;

/**
 * SETUP で「その的を狙うことの難しさ」。
 *
 * 確率モデルではなく、盤面上の面積と実戦感覚から人間が決めた順序データ。
 *  0: シングル      — 盤面で最も広く、外しても同じウェッジ内に収まりやすい
 *  2: トリプル       — 狭いが、得点効率のために狙う価値がある
 *  3: アウターブル   — ダブルリング同様に細い輪。調整には使えるが、無料ではない
 *  3: ダブル         — さらに細く、刻みの的としては割に合わない
 *  4: インナーブル   — 盤面で最小。SETUP の得点手段としては選ばない
 */
export const SEGMENT_DIFFICULTY: Readonly<Record<string, number>> = {
  single: 0,
  triple: 2,
  double: 3,
  'outer-bull': 3,
  'inner-bull': 4,
};

/** SEGMENT_DIFFICULTY 1 単位あたりのペナルティ。 */
export const SETUP_DIFFICULTY_WEIGHT = 12;

/**
 * 「重要教材」として扱う好ましい残り。
 * 添付資料「01アレンジの整理」(2)(8) に対応する。
 *
 * 単純な数値順（170 > 167 > 164 > 161 > 160）で並べないという方針のため、
 * ここでは順位を持たせず「教材として重要である」という同一の印だけを付ける。
 * 実際の順位は、この印を含む複数の評価軸の合計で決まる。
 */
export const PREMIUM_TENPAI_LEAVES: readonly number[] = [170, 167, 164, 161, 160];

/** SETUP で「主目標」として続けて狙うナンバー（既定値。設定で変更可能）。 */
export const DEFAULT_SETUP_MAIN_TARGET = 'T20';

/**
 * SETUP で 1 投あたりの取得点がこれ未満なら SETUP_LOW_SCORE を付ける。
 * 「1 ビジットを丸ごと無駄にした」ことを示す指標なので、
 * 3 本すべてを投げる場面でだけ評価する（リカバリー中の 1〜2 本には付けない）。
 */
export const SETUP_LOW_SCORE_THRESHOLD = 20;

/** 添付資料 (4) の「とりあえず TON」。ちょうどこの点を取る危険を評価する。 */
export const TON_SCORE = 100;

// ---------------------------------------------------------------------------
// TRAINING の採点しきい値
// ---------------------------------------------------------------------------

/**
 * 回答ルートの推奨度ランク。
 * 「数学的に成立するルートを単純に不正解にしない」ため、最低でも C は付く。
 *
 * best（そのお題での最高スコア）との差で判定する。
 */
export const GRADE_THRESHOLDS = {
  /** 基準推奨・非常に良い。最高評価と同点のルート。 */
  S: 0,
  /** 非常に良い代替。最高評価との差がこの値以内。 */
  A: 25,
  /** 十分実用的。 */
  B: 60,
} as const;

export type RouteGrade = 'S' | 'A' | 'B' | 'C';

/**
 * 「非推奨」と判断する理由コード。
 *
 * これらが付いたルートは、同じ欠点を持たない選択肢が存在する場合、
 * スコア差にかかわらず C（成立するが戦術的に非推奨）とする。
 * C には必ず非推奨理由を表示する、という仕様（25 節）と 1 対 1 に対応する。
 */
export const DISCOURAGING_REASON_CODES = [
  'SINGLE_MISS_LOSES_CHECKOUT',
  'SINGLE_MISS_LEAVES_BOGEY',
  'NEIGHBOR_RISK',
  'SAFER_START_EXISTS',
  'UNNECESSARY_TRIPLE',
  'NON_FINAL_DOUBLE',
] as const;
