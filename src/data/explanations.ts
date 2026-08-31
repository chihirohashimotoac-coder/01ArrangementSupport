/**
 * 理由コード → 日本語表示の解決。
 *
 * ============================================================
 *  HUMAN APPROVAL REQUIRED（curated explanation の追加・変更）
 * ============================================================
 *
 * 表示文は 2 系統ある。
 *  1) engine の計算結果から機械的に組み立てる説明（このファイルのテンプレート）
 *  2) 特に重要なスコアに人間が書き下ろす説明（CURATED_CHECKOUT_EXPLANATIONS）
 */
import type {
  CheckoutReasonCode,
  ReasonPolarity,
  SetupReasonCode,
} from '../domain/reasonCodes';

/** 説明テンプレートへ渡す文脈。engine が計算した値だけを入れる。 */
export interface ReasonContext {
  readonly remaining: number;
  readonly dartsAvailable: number;
  /** ルート表記（例: "T19 → S6 → D20"）。 */
  readonly routeText: string;
  readonly firstDartId: string;
  readonly finishDartId: string;
  /** 縦ズレ（トリプル/ダブル → シングル）の着弾セグメント。 */
  readonly missDartId: string | null;
  /** 縦ズレ後の残り点。 */
  readonly missLeave: number | null;
  /** 縦ズレ後に残る本数。 */
  readonly dartsAfterMiss: number;
  /** 縦ズレ後のリカバリー例（例: "T18 → BULL"）。 */
  readonly missRecoveryText: string | null;
  /** 横ズレの説明（例: "S10 なら 36 残りで D18"）。 */
  readonly neighborNotes: readonly string[];
  /** 縦ズレ（同じナンバーの別リング）の説明。 */
  readonly verticalNotes: readonly string[];
  /** ダブルの扱いやすさの根拠文。 */
  readonly doubleReason: string | null;
  /** MY ROUTE の得意ダブル順位（1 始まり）。 */
  readonly userPreferenceRank: number | null;
  /** 狙うナンバーの切り替え回数。 */
  readonly switchCount: number;
  /** 続けて狙えるナンバー（TARGET_CONTINUITY 用）。 */
  readonly continuityTargetId: string | null;
}

export interface RenderedReason {
  readonly summary: string;
  readonly detail: string | null;
}

interface ReasonTemplate {
  readonly polarity: ReasonPolarity;
  /** 一覧で並べるときの短いラベル。 */
  readonly label: string;
  readonly render: (ctx: ReasonContext) => RenderedReason;
}

const CHECKOUT_TEMPLATES: Record<CheckoutReasonCode, ReasonTemplate> = {
  STANDARD_ROUTE: {
    polarity: 'positive',
    label: '基準ルート',
    render: (ctx) => ({
      summary: 'このアプリの基準ルートです。',
      detail: `${ctx.remaining} からは ${ctx.routeText} を最初に覚えるルートとしています。`,
    }),
  },
  FINISH_IN_ONE: {
    polarity: 'positive',
    label: '1本で上がれる',
    render: (ctx) => ({
      summary: `${ctx.finishDartId} 1本で上がれます。`,
      detail: `残り ${ctx.remaining} はそのまま ${ctx.finishDartId} なので、外しても本数を残せます。`,
    }),
  },
  FEWER_DARTS: {
    polarity: 'positive',
    label: '本数に余裕',
    render: (ctx) => ({
      summary: `残り ${ctx.dartsAvailable} 本に対して ${ctx.routeText.split('→').length} 本で上がれます。`,
      detail: '本数に余裕があるぶん、1本外しても組み立て直せます。',
    }),
  },
  SINGLE_MISS_SAFE: {
    polarity: 'positive',
    label: 'シングルへ外しても残る',
    render: (ctx) => ({
      summary: `${ctx.firstDartId} を狙って ${ctx.missDartId} に落ちても ${ctx.missLeave} が残ります。`,
      detail:
        ctx.missRecoveryText === null
          ? `残り ${ctx.dartsAfterMiss} 本でチェックアウトチャンスが残ります。`
          : `残り ${ctx.dartsAfterMiss} 本で ${ctx.missRecoveryText} のチェックアウトチャンスが残ります。`,
    }),
  },
  SAFE_SINGLE_START: {
    polarity: 'positive',
    label: 'シングル狙いで安定',
    render: (ctx) => ({
      summary: `1 投目は ${ctx.firstDartId} 狙いなので、トリプルから落ちる失点差がありません。`,
      detail:
        ctx.verticalNotes.length > 0
          ? `上下へズレた場合: ${ctx.verticalNotes.join('／')}`
          : '太いシングル面を狙えるぶん、実戦で安定します。',
    }),
  },
  SINGLE_MISS_LOSES_CHECKOUT: {
    polarity: 'negative',
    label: 'シングルへ外すと上がれない',
    render: (ctx) => ({
      summary: `${ctx.firstDartId} を狙って ${ctx.missDartId} に落ちると ${ctx.missLeave} となります。`,
      detail: `残り ${ctx.dartsAfterMiss} 本ではチェックアウトできません。`,
    }),
  },
  SINGLE_MISS_LEAVES_BOGEY: {
    polarity: 'negative',
    label: 'シングルへ外すとノーテン',
    render: (ctx) => ({
      summary: `${ctx.missDartId} に落ちると ${ctx.missLeave} 残りとなり、ノーテン（Bogey）になります。`,
      detail: 'この帯は 3 本あっても上がれないため、次ラウンドの組み立てからやり直しになります。',
    }),
  },
  NEIGHBOR_SAFE: {
    polarity: 'positive',
    label: '横ズレに強い',
    render: (ctx) => ({
      summary: '隣のナンバーへ横ズレしても上がりが残ります。',
      detail: ctx.neighborNotes.length > 0 ? ctx.neighborNotes.join('／') : null,
    }),
  },
  NEIGHBOR_RISK: {
    polarity: 'negative',
    label: '横ズレに弱い',
    render: (ctx) => ({
      summary: '隣のナンバーへ横ズレすると上がりを失います。',
      detail: ctx.neighborNotes.length > 0 ? ctx.neighborNotes.join('／') : null,
    }),
  },
  GOOD_DOUBLE: {
    polarity: 'positive',
    label: '扱いやすいダブル',
    render: (ctx) => ({
      summary: `${ctx.finishDartId} 上がりです。`,
      detail: ctx.doubleReason,
    }),
  },
  WEAK_DOUBLE: {
    polarity: 'negative',
    label: '扱いにくいダブル',
    render: (ctx) => ({
      summary: `${ctx.finishDartId} 上がりです。`,
      detail: ctx.doubleReason,
    }),
  },
  USER_DOUBLE_PREFERENCE: {
    polarity: 'positive',
    label: '得意ダブル',
    render: (ctx) => ({
      summary: `得意ダブル第 ${ctx.userPreferenceRank} 位の ${ctx.finishDartId} で上がれます。`,
      detail: 'MY ROUTE の設定を反映した並びです（基準ルートの並びは変わりません）。',
    }),
  },
  BULL_REQUIRED: {
    polarity: 'negative',
    label: 'BULLが必要',
    render: () => ({
      summary: 'BULL を要求するルートです。',
      detail: 'BULL は的が小さく、外したときの代替が乏しくなります。',
    }),
  },
  TARGET_CONTINUITY: {
    polarity: 'positive',
    label: '同じ的を続けて狙える',
    render: (ctx) => ({
      summary:
        ctx.continuityTargetId === null
          ? '同じナンバーを続けて狙えます。'
          : `${ctx.continuityTargetId} を続けて狙えます。`,
      detail: '狙いを変えないぶん、リズムを崩しにくくなります。',
    }),
  },
  EXTRA_TARGET_SWITCH: {
    polarity: 'negative',
    label: '狙いの切り替えが多い',
    render: (ctx) => ({
      summary: `狙うナンバーを ${ctx.switchCount} 回切り替えます。`,
      detail: '毎投ねらいが変わるため、実戦では精度が落ちやすくなります。',
    }),
  },
  SAFER_START_EXISTS: {
    polarity: 'negative',
    label: 'より安全な開始がある',
    render: () => ({
      summary: '同じ本数で、外しても上がりが残る開始ナンバーが他にあります。',
      detail: '「OTHER ROUTES」から、シングルへ落ちても上がりが残るルートを比べてみてください。',
    }),
  },
  UNNECESSARY_TRIPLE: {
    polarity: 'negative',
    label: '不要なトリプル',
    render: () => ({
      summary: '同じ本数で、トリプルを使わずに上がれるルートがあります。',
      detail: 'あえて難しいトリプルを足す必要はありません。',
    }),
  },
  NON_FINAL_DOUBLE: {
    polarity: 'negative',
    label: '繋ぎでダブルを狙う',
    render: () => ({
      summary: '上がり以外のダートでダブルリングを狙っています。',
      detail:
        'ダブルリングは細く、繋ぎの的としては割に合いません。大きなシングル面かトリプルで刻む方が安定します。',
    }),
  },
};

const SETUP_TEMPLATES: Record<SetupReasonCode, ReasonTemplate> = {
  LEAVES_CHECKOUTABLE: {
    polarity: 'positive',
    label: 'テンパイ',
    render: (ctx) => ({
      summary: `次ラウンドに ${ctx.remaining} を残し、3 本でのチェックアウトが可能です。`,
      detail: ctx.missRecoveryText === null ? null : `例: ${ctx.missRecoveryText}`,
    }),
  },
  LEAVES_BOGEY: {
    polarity: 'negative',
    label: 'ノーテン',
    render: (ctx) => ({
      summary: `${ctx.remaining} 残りはノーテン（Bogey）です。`,
      detail: '3 本あっても上がれないため、次ラウンドは得点を刻み直すことになります。',
    }),
  },
  LEAVE_ABOVE_CHECKOUT_RANGE: {
    polarity: 'negative',
    label: '170超え',
    render: (ctx) => ({
      summary: `${ctx.remaining} 残りは 170 を超えており、次ラウンドでは上がれません。`,
      detail: null,
    }),
  },
  LEAVES_PREMIUM_TENPAI: {
    polarity: 'positive',
    label: '重要な好残り',
    render: (ctx) => ({
      summary: `${ctx.remaining} は狙って作りたい残りです。`,
      detail: '170 / 167 / 164 / 161 / 160 は「乗せる」対象として覚える価値があります。',
    }),
  },
  LEAVES_TWO_DART_CHECKOUT: {
    polarity: 'positive',
    label: '2本でも上がれる',
    render: (ctx) => ({
      summary: `${ctx.remaining} 残りは 2 本でも上がれます。`,
      detail: '1 本外しても上がりが残るぶん、次ラウンドの成功率が上がります。',
    }),
  },
  LEAVE_LAST_DIGIT_0147: {
    polarity: 'positive',
    label: '0・1・4・7',
    render: (ctx) => ({
      summary: `${ctx.remaining} は下一桁が 0 / 1 / 4 / 7 です。`,
      detail:
        '159〜170 の帯では、下一桁が 0・1・4・7 のときだけ 3 本で上がれます（この帯に限った経験則です）。',
    }),
  },
  LEAVE_REQUIRES_BULL: {
    polarity: 'negative',
    label: '上がりにBULLが要る',
    render: (ctx) => ({
      summary: `${ctx.remaining} 残りは基準ルートが BULL を要求します。`,
      detail: null,
    }),
  },
  LEAVE_GOOD_FINISH_DOUBLE: {
    polarity: 'positive',
    label: '良いダブルで終われる',
    render: (ctx) => ({
      summary: `${ctx.remaining} 残りは扱いやすいダブルで終われます。`,
      detail: ctx.doubleReason,
    }),
  },
  SETUP_MAIN_TARGET_CONTINUITY: {
    polarity: 'positive',
    label: '主目標を継続',
    render: (ctx) => ({
      summary:
        ctx.continuityTargetId === null
          ? '主目標を続けて狙えます。'
          : `${ctx.continuityTargetId} を続けて狙えます。`,
      detail: null,
    }),
  },
  SETUP_THIRD_DART_ADJUST: {
    polarity: 'positive',
    label: '3投目で整える',
    render: (ctx) => ({
      summary: `3 投目の ${ctx.finishDartId} で着地を整えています。`,
      detail: '最大得点を取り続けるのではなく、次ラウンドで上がりやすい数字を優先します。',
    }),
  },
  SETUP_USES_SBULL: {
    polarity: 'neutral',
    label: 'S-BULLで調整',
    render: () => ({
      summary: 'S-BULL（25点）を調整に使っています。',
      detail: 'トリプルを使わなくても、S-BULL で着地を整えられます。',
    }),
  },
  SETUP_TON_TRAP: {
    polarity: 'negative',
    label: 'とりあえずTONの罠',
    render: (ctx) => ({
      summary: `ちょうど 100 点を取ると ${ctx.remaining} 残りとなり、ノーテンになります。`,
      detail: '100 点ではなく 95〜105 点前後へ着地をずらす発想が要ります。',
    }),
  },
  SETUP_LOW_SCORE: {
    polarity: 'negative',
    label: '取得点が少なすぎる',
    render: () => ({
      summary: '取得点が少なく、次ラウンドも上がれない領域に留まります。',
      detail: null,
    }),
  },
};

export function renderCheckoutReason(
  code: CheckoutReasonCode,
  ctx: ReasonContext,
): RenderedReason & { polarity: ReasonPolarity; label: string } {
  const template = CHECKOUT_TEMPLATES[code];
  return { ...template.render(ctx), polarity: template.polarity, label: template.label };
}

export function renderSetupReason(
  code: SetupReasonCode,
  ctx: ReasonContext,
): RenderedReason & { polarity: ReasonPolarity; label: string } {
  const template = SETUP_TEMPLATES[code];
  return { ...template.render(ctx), polarity: template.polarity, label: template.label };
}

/**
 * 特に重要なスコアへ人間が書き下ろす説明。
 * engine が生成する説明の「上」に、要約として表示する。
 */
export const CURATED_CHECKOUT_EXPLANATIONS: Readonly<Record<number, string>> = {
  103: 'T19 で 46 を残し、S6 で 40（D20）へ整えます。1 投目を S19 へ落としても 84 が残り、残り 2 本での上がりが消えません。',
  122: 'T18 始動が基準です。S18 へ落ちても 104 が残り、残り 2 本で T18 → BULL の上がりが残ります。T20 始動は S20 へ落ちると 102 となり、残り 2 本では上がれません。',
  46: 'S6 → D20 が基準です。隣の S10 へ横ズレしても 36 残りで D18 が残るため、盤面のズレに強い入り方です。',
  170: '3 本での最大チェックアウトです。T20 → T20 → BULL 以外の組み立てはありません。',
  167: 'T20 → T19 → BULL。167 は 3 本で上がれる数字なので、セットアップで積極的に「乗せる」価値があります。',
  164: 'T20 → T18 → BULL。162 / 163 がノーテンであるぶん、164 へ着地させる意識が効きます。',
  161: 'T20 → T17 → BULL。160 と並んで、340 点台から 180 を出したときに残したい数字です。',
  160: 'T20 → T20 → D20。BULL を使わずに上がれるため、161 / 164 / 167 より組み立てが素直です。',
};

/** SETUP 側の書き下ろし説明（残り点をキーにする）。 */
export const CURATED_SETUP_EXPLANATIONS: Readonly<Record<number, string>> = {
  269: '100 点を取ると 169 でノーテンになります。19 + 20 × 4 = 99 のように 99 点へ着地させると 170 残りになります。',
  302: 'T20 が 2 本入った時点で 182 残り。3 投目を S20 にすると 162 でノーテンになるため、S18 へ振って 164 を残します。',
  305: 'T20 が 2 本入った時点で 185 残り。3 投目を S18 にすると 167 が残ります。',
  231: 'トリプルを使わなくても、20 + 19 + S-BULL = 64 で 167 残りへ整えられます。',
  271: 'T19 + S19 + S-BULL = 101 で 170 残り。1 本目に 60 が入った後、18・19・20・S-BULL で 170 へ乗せる考え方です。',
};
