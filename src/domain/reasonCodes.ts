/**
 * ルート評価の理由コード。
 *
 * 評価理由は手書きの文章ではなくコードとして持ち、
 * 表示用の日本語は data/explanations.ts で解決する。
 * これにより「なぜその評価になったか」をテストできる。
 */
export const CHECKOUT_REASON_CODES = [
  /** 基準ルート（Excel 第1候補）と一致する。 */
  'STANDARD_ROUTE',
  /** 1 本で上がれる（残りがそのままダブル/BULL）。 */
  'FINISH_IN_ONE',
  /** 使うダート数が残り本数より少ない（余裕がある）。 */
  'FEWER_DARTS',
  /** 1 投目をシングルへ外しても、残り本数でチェックアウトチャンスが残る。 */
  'SINGLE_MISS_SAFE',
  /** 1 投目がシングル狙いで、上下（トリプル/ダブル）へズレても上がりが残る。 */
  'SAFE_SINGLE_START',
  /** 1 投目をシングルへ外すと、残り本数でチェックアウトできなくなる。 */
  'SINGLE_MISS_LOSES_CHECKOUT',
  /** 1 投目をシングルへ外すと Bogey Number が残る。 */
  'SINGLE_MISS_LEAVES_BOGEY',
  /** 隣ナンバーへ横ズレしても、残り本数でチェックアウトチャンスが残る。 */
  'NEIGHBOR_SAFE',
  /** 隣ナンバーへ横ズレするとチェックアウトできなくなる。 */
  'NEIGHBOR_RISK',
  /** 上がりが扱いやすいダブル。 */
  'GOOD_DOUBLE',
  /** 上がりが扱いにくいダブル（奇数ダブルなど）。 */
  'WEAK_DOUBLE',
  /** ユーザーが得意ダブルとして登録している。 */
  'USER_DOUBLE_PREFERENCE',
  /** BULL を要求する（狙いが 1 点に集中し、外したときの代替が乏しい）。 */
  'BULL_REQUIRED',
  /** 同じナンバーを続けて狙える。 */
  'TARGET_CONTINUITY',
  /** 狙うナンバーの切り替えが多い。 */
  'EXTRA_TARGET_SWITCH',
  /** 同じ本数でより安全な開始ナンバーが存在する。 */
  'SAFER_START_EXISTS',
  /** 同じ結果に対して不要なトリプルを含む。 */
  'UNNECESSARY_TRIPLE',
  /** 最終ダート以外でダブルを狙っている（細いリングを繋ぎに使っている）。 */
  'NON_FINAL_DOUBLE',
] as const;

export type CheckoutReasonCode = (typeof CHECKOUT_REASON_CODES)[number];

export const SETUP_REASON_CODES = [
  /** 次ラウンドに 3 本チェックアウト可能な残り（テンパイ）を作れる。 */
  'LEAVES_CHECKOUTABLE',
  /** 残りが Bogey Number（ノーテン）になる。 */
  'LEAVES_BOGEY',
  /** 残りが 170 を超え、次ラウンドで上がれない。 */
  'LEAVE_ABOVE_CHECKOUT_RANGE',
  /** 添付資料が重要教材として挙げる好ましい残り（170/167/164/161/160 など）。 */
  'LEAVES_PREMIUM_TENPAI',
  /** 残りが 2 本でも上がれる。 */
  'LEAVES_TWO_DART_CHECKOUT',
  /** 残りの下一桁が 0 / 1 / 4 / 7（159〜170 帯の経験則）。 */
  'LEAVE_LAST_DIGIT_0147',
  /** 残りの基準ルートが BULL を要求する。 */
  'LEAVE_REQUIRES_BULL',
  /** 残りの基準ルートが扱いやすいダブルで終わる。 */
  'LEAVE_GOOD_FINISH_DOUBLE',
  /** 主目標（T20 など）を続けて狙える。 */
  'SETUP_MAIN_TARGET_CONTINUITY',
  /** 3 投目だけで着地を調整している（最大得点より整えることを優先）。 */
  'SETUP_THIRD_DART_ADJUST',
  /** S-BULL（25点）を調整に使っている。 */
  'SETUP_USES_SBULL',
  /** ちょうど 100 点（とりあえず TON）を取ると Bogey になる残り点である。 */
  'SETUP_TON_TRAP',
  /** 取得点が少なすぎて次ラウンドも上がれない領域に留まる。 */
  'SETUP_LOW_SCORE',
] as const;

export type SetupReasonCode = (typeof SETUP_REASON_CODES)[number];

export type ReasonCode = CheckoutReasonCode | SetupReasonCode;

/** 理由の極性（表示の色分けに使う）。 */
export type ReasonPolarity = 'positive' | 'negative' | 'neutral';
