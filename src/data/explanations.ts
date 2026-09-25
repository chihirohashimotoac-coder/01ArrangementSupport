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
  NextVisitProposalFacet,
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
  /*
   * 判定条件は「隣り合う 2 投が同じ base number か」であって、
   * 主目標（T20）であるかどうかは見ていない。T15 → T15 でも成立する。
   * 表示もその実際の意味（同一ナンバー継続）に合わせる。
   */
  SETUP_TARGET_CONTINUITY: {
    polarity: 'positive',
    label: '同じナンバーを継続',
    render: (ctx) => ({
      summary:
        ctx.continuityTargetId === null
          ? '同じナンバーを続けて狙えます。'
          : `${ctx.continuityTargetId} と、同じナンバーを続けて狙えます。`,
      detail: '狙う的を変えずに投げられるぶん、腕の振りを作り直さずに済みます。',
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
  SETUP_THIN_TARGET: {
    polarity: 'negative',
    label: '細い的を狙っている',
    render: () => ({
      summary: '得点・調整のためにダブルリングを狙っています。',
      detail: 'ダブルリングは細く、刻みの的としては割に合いません。シングルか S-BULL の方が安定します。',
    }),
  },
  SETUP_SINGLE_MISS_TENPAI_SAFE: {
    polarity: 'positive',
    label: 'シングル落ちに強い',
    render: (ctx) => ({
      summary:
        ctx.missDartId === null || ctx.missLeave === null
          ? '1 投目を外してもテンパイへの道が残ります。'
          : `1 投目が ${ctx.missDartId} へ落ちても ${ctx.missLeave} / 残り ${ctx.dartsAfterMiss} 本でテンパイを作れます。`,
      detail: '理想の着弾だけでなく、いちばん起きるミスを通してもテンパイが残る入り方です。',
    }),
  },
  SETUP_SINGLE_MISS_DEAD_END: {
    polarity: 'negative',
    label: 'シングル落ちで詰む',
    render: (ctx) => ({
      summary:
        ctx.missDartId === null || ctx.missLeave === null
          ? '1 投目を外すと、このラウンドではテンパイを作れなくなります。'
          : `1 投目が ${ctx.missDartId} へ落ちると ${ctx.missLeave} が残り、残り ${ctx.dartsAfterMiss} 本ではテンパイを作れません。`,
      detail: '狙いどおり入れば良い残りでも、シングルへ落ちた時点でこのラウンドが終わります。',
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

/** 振り返りの `CHECKOUT_PEER_OF_RECOMMENDED` の説明文へ渡す値（表記は変換済み）。 */
export interface CheckoutPeerContext {
  readonly intendedLabel: string;
  /** 狙いから始まる、おすすめと同等以上の上がり方。 */
  readonly routeText: string;
  /** その場面のおすすめ（CHECKOUT の先頭）。 */
  readonly recommendedText: string;
  readonly grade: string;
  readonly leaveOnHit: number;
  /** 2 投目以降の的（表記済み）。1 投で上がる形なら空。 */
  readonly restLabels: readonly string[];
  /** おすすめと共通の注意点（非推奨の理由の表示名）。 */
  readonly sharedCautionLabels: readonly string[];
}

/** 振り返りの `CHECKOUT_PEER_OF_RECOMMENDED` の説明文（v1.4.5）。 */
export function renderCheckoutPeerJa(ctx: CheckoutPeerContext): string {
  const follow =
    ctx.restLabels.length === 0
      ? `${ctx.intendedLabel} が狙い通りに入れば、この 1 投で上がれます。`
      : `${ctx.intendedLabel} が狙い通りなら残り ${ctx.leaveOnHit} で、` +
        `続けて ${ctx.restLabels.join(' → ')} を狙えば上がれます。`;
  const caution =
    ctx.sharedCautionLabels.length === 0
      ? ''
      : `注意点（${ctx.sharedCautionLabels.join('・')}）はおすすめと共通です。`;
  return (
    `${ctx.routeText} で上がる形は、この場面のおすすめ（${ctx.recommendedText}）と比べて、` +
    `アプリの戦術評価（基準ルートの加点を除く）で劣りません。` +
    `推奨度 ${ctx.grade} は候補の並びの中での相対評価です。` +
    follow +
    caution
  );
}

/**
 * NEXT VISIT の提案につける短い見出し（v1.3.6）。
 *
 * 「なぜこの残しなのか」の長い理由はルートカード側に残す。ここは
 * 盤面直下の狭い場所なので、選び方の違いだけが分かれば十分。
 */
export function nextVisitProposalNoteJa(
  kind: 'leave-quality' | 'preferred-double' | 'alternative',
  finishDoubleId: string | null,
): string {
  if (kind === 'preferred-double') {
    return finishDoubleId === null ? '得意ダブル' : `得意ダブル ${finishDoubleId}`;
  }
  if (kind === 'alternative') return '同じナンバーを続ける';
  return finishDoubleId === null ? '残しの質' : `残しの質（${finishDoubleId}）`;
}

/** NEXT VISIT の提案の種類の、振り返りの説明文での呼び方（v1.4.6）。 */
const NEXT_VISIT_PROPOSAL_KIND_JA: Readonly<
  Record<'leave-quality' | 'preferred-double' | 'alternative', string>
> = {
  'leave-quality': '第 1 案',
  'preferred-double': '得意ダブルを反映した案',
  alternative: '同じナンバーを続ける案',
};

/** 第 1 案と比べた観点ごとの言い方（良いとき / 劣るとき）。 */
const NEXT_VISIT_PROPOSAL_FACET_JA: Readonly<
  Record<NextVisitProposalFacet, { readonly better: string; readonly worse: string }>
> = {
  LEAVE_TIER: {
    better: '次ラウンドで上がりに使う本数が少ない残しを作れます',
    worse: '次ラウンドで上がりに使う本数は第 1 案の方が少なくて済みます',
  },
  LEAVE_QUALITY: {
    better: '残しの質が第 1 案より高いです',
    worse: '残しの質は第 1 案の方が高いです',
  },
  DIFFICULTY: {
    better: 'いま投げる難易度が第 1 案より低いです',
    worse: 'いま投げる難易度は第 1 案の方が低いです',
  },
  SINGLE_MISS: {
    better: '同じナンバーのシングルに落ちたときの立て直しが第 1 案より良いです',
    worse: '同じナンバーのシングルに落ちたときの立て直しは第 1 案の方が良いです',
  },
  SAME_TARGET: {
    better: '的を切り替えずに投げられます',
    worse: '的の切り替えは第 1 案の方が少ないです',
  },
  PREFERRED_DOUBLE: {
    better: '得意ダブルで上がれる残しです',
    worse: '得意ダブルの設定には第 1 案の方が合っています',
  },
};

/** 振り返りの `NEXT_VISIT_PROPOSAL_NOT_DOMINATED` の説明文へ渡す値（表記は変換済み）。 */
export interface NextVisitProposalPeerContext {
  readonly intendedLabel: string;
  readonly proposalKind: 'leave-quality' | 'preferred-double' | 'alternative';
  readonly routeText: string;
  readonly routeLeave: number;
  readonly primaryRouteText: string;
  readonly primaryLeave: number;
  readonly grade: string;
  readonly leaveOnHit: number;
  /** 2 投目以降の的（表記済み）。1 投だけの提案なら空。 */
  readonly restLabels: readonly string[];
  readonly advantages: readonly NextVisitProposalFacet[];
  readonly disadvantages: readonly NextVisitProposalFacet[];
}

/** 振り返りの `NEXT_VISIT_PROPOSAL_NOT_DOMINATED` の説明文（v1.4.6）。 */
export function renderNextVisitProposalPeerJa(ctx: NextVisitProposalPeerContext): string {
  const leave =
    ctx.routeLeave === ctx.primaryLeave
      ? `第 1 案の ${ctx.primaryRouteText} と同じ残り ${ctx.routeLeave} を作れます。`
      : `残り ${ctx.routeLeave} を作れます（第 1 案の ${ctx.primaryRouteText} は残り ${ctx.primaryLeave}）。`;
  const good = ctx.advantages.map((facet) => NEXT_VISIT_PROPOSAL_FACET_JA[facet].better).join('。');
  const bad = ctx.disadvantages.map((facet) => NEXT_VISIT_PROPOSAL_FACET_JA[facet].worse).join('。');
  const merits =
    ctx.advantages.length === 0
      ? '第 1 案と比べて、劣る点はありません。'
      : ctx.disadvantages.length === 0
        ? `第 1 案と比べて劣る点は無く、${good}。`
        : `第 1 案とは一長一短です。${good}。一方で、${bad}。`;
  return (
    `${ctx.intendedLabel} は、この場面の${NEXT_VISIT_PROPOSAL_KIND_JA[ctx.proposalKind]}` +
    `（${ctx.routeText}）の 1 投目です。` +
    leave +
    merits +
    `推奨度 ${ctx.grade} は候補の並びの中での相対評価です。` +
    `${ctx.intendedLabel} が狙い通りなら残り ${ctx.leaveOnHit} で、` +
    (ctx.restLabels.length === 0 ? '' : `続けて ${ctx.restLabels.join(' → ')} を狙います`) +
    `（次の投の狙いは、その投で評価します）。`
  );
}

/** 最後の 1 投の交換条件の説明で、狙い・代案 1 つぶんの値（表記は変換済み）。 */
export interface LastDartTradeOffTarget {
  /** 狙う的（表記済み。例: T15）。 */
  readonly label: string;
  /** 狙い通りの残り（外側のダブルを直接狙える残り）。 */
  readonly hitLeave: number;
  /** 狙い通りのときに残るダブル（表記済み。例: D16）。 */
  readonly hitDoubleLabel: string;
  /** 同じナンバーのシングル（表記済み。例: S15）。 */
  readonly missLabel: string;
  readonly missLeave: number;
  /** シングル落ちの残りからの上がりの例（表記済み。例: T10 → D16）。無ければ null。 */
  readonly missExampleText: string | null;
}

/** 振り返りの `LAST_DART_DOUBLE_TRADE_OFF` の説明文へ渡す値。 */
export interface LastDartTradeOffContext {
  readonly proposalKind: 'leave-quality' | 'preferred-double' | 'alternative';
  readonly intended: LastDartTradeOffTarget;
  /** シングル落ち後は有利だが、狙い通りのときに残るダブルが違う代案（先頭から説明する）。 */
  readonly alternatives: readonly LastDartTradeOffTarget[];
  /** 狙いの命中ダブルの得意ダブル順位（0 始まり）。設定に無ければ null。 */
  readonly intendedPreferenceRank: number | null;
}

/** シングル落ちの残りの言い方（例: 残り 62（例: T10 → D16））。 */
function missLeaveJa(target: LastDartTradeOffTarget): string {
  return target.missExampleText === null
    ? `残り ${target.missLeave}`
    : `残り ${target.missLeave}（例: ${target.missExampleText}）`;
}

/**
 * 振り返りの `LAST_DART_DOUBLE_TRADE_OFF` の説明文（v1.4.7）。
 *
 * ビジット最後の 1 投で、アプリが表示した NEXT VISIT の提案の狙いに対し、
 * シングル落ち後は有利だが狙い通りのときに残るダブルが違う代案があるときの説明。
 * 狙い通り・シングル落ちの両方の交換条件を具体的な残りで書く。
 */
export function renderLastDartDoubleTradeOffJa(ctx: LastDartTradeOffContext): string {
  const own = ctx.intended;
  const [first, ...rest] = ctx.alternatives;
  const preference =
    ctx.intendedPreferenceRank === null
      ? ''
      : `${own.hitDoubleLabel} は得意ダブル第 ${ctx.intendedPreferenceRank + 1} 位です。`;
  const ownMiss =
    own.missLeave === own.hitLeave
      ? ''
      : `同じナンバーの ${own.missLabel} に落ちると${missLeaveJa(own)}です。`;
  const others = rest
    .slice(0, 1)
    .map(
      (item) =>
        `${item.label}（狙い通り ${item.hitLeave} で ${item.hitDoubleLabel}・` +
        `${item.missLabel} でも ${item.missLeave}）も同じ関係です。`,
    )
    .join('');
  return (
    `${own.label} は、この場面の${NEXT_VISIT_PROPOSAL_KIND_JA[ctx.proposalKind]}の狙いです。` +
    `狙い通りなら残り ${own.hitLeave} で、次のビジットは 1 投目から ${own.hitDoubleLabel} を狙えます。` +
    preference +
    ownMiss +
    `${first.label} なら ${first.missLabel} に落ちても${missLeaveJa(first)}で立て直しやすい一方、` +
    `狙い通りに入ると残るのは ${first.hitLeave}（${first.hitDoubleLabel}）です。` +
    others +
    `狙い通りのときに残るダブルと、シングルに落ちたあとの立て直しの交換条件なので、` +
    `どちらを選んでも良い判断です。`
  );
}
