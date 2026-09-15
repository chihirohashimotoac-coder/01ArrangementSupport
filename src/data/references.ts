/**
 * 参考資料・出典（ユーザー向け）。
 *
 * ============================================================
 *  掲載してよいのは、**このリポジトリ・添付資料・PR 履歴から
 *  実際に参照したことを確認できるものだけ**である。
 *  「よく知られた darts のサイト」を後から探して並べてはならない。
 *  確認できないものは載せず、載せないこと自体を明記する。
 * ============================================================
 *
 * 調査範囲（2026-09-15 時点）:
 *   README / AGENTS.md / CLAUDE.md / docs/**  / data/source/**  / src/data/**  /
 *   コードコメント / git log 全件 / merge 済み Pull Request #1〜#13 の説明
 *
 * 調査の結果、**外部 Web サイトを参照した記録は 1 件も見つからなかった**。
 * 本アプリの戦術データは、リポジトリオーナーから提供された添付資料と、
 * その資料についての人間の判断（docs/APPROVALS.md）だけを出どころとしている。
 * この事実は `NO_EXTERNAL_WEB_SOURCES_NOTE` として画面にも出す。
 */

/** その資料が本アプリにとって何であるか。 */
export type ReferenceRole =
  /** アプリが採用している基準データそのもの。 */
  | 'source-of-truth'
  /** 設計・戦術判断のときに参照した資料。 */
  | 'reference'
  /** このリポジトリ内の仕様書・記録。 */
  | 'project-doc';

/** 資料がどこにあるか。 */
export type ReferenceOrigin = 'external' | 'internal';

export interface ReferenceEntry {
  /** 資料名 / サイト名。 */
  readonly title: string;
  /** タップで開ける URL。無ければ null。 */
  readonly url: string | null;
  /** 何を参考にしたか。 */
  readonly what: string;
  /** 本アプリのどの機能・理論に関係するか。 */
  readonly usedFor: string;
  readonly role: ReferenceRole;
  readonly origin: ReferenceOrigin;
  /**
   * 参照時期。リポジトリから読み取れる場合だけ書く（推測しない）。
   * 読み取れないものは null。
   */
  readonly since: string | null;
}

export interface ReferenceSection {
  readonly heading: string;
  /** その分類が何をまとめたものかの 1 行説明。 */
  readonly lead: string;
  readonly entries: readonly ReferenceEntry[];
}

/** 役割バッジの表示名。 */
export const REFERENCE_ROLE_LABEL: Readonly<Record<ReferenceRole, string>> = {
  'source-of-truth': 'Source of Truth',
  reference: 'Reference',
  'project-doc': 'Project Documentation',
};

/** 役割バッジの説明（凡例）。 */
export const REFERENCE_ROLE_NOTE: Readonly<Record<ReferenceRole, string>> = {
  'source-of-truth': 'アプリが採用している基準データそのものです。',
  reference: '設計や戦術判断のときに参考にした資料です。正式なルールではありません。',
  'project-doc': 'このアプリのために書いた仕様書・記録です。',
};

export const REFERENCE_ORIGIN_LABEL: Readonly<Record<ReferenceOrigin, string>> = {
  external: '外部資料',
  internal: 'プロジェクト内部資料',
};

const REPO_URL = 'https://github.com/chihirohashimotoac-coder/01ArrangementSupport';

export const REFERENCE_SECTIONS: readonly ReferenceSection[] = [
  {
    heading: '基準ルートデータ',
    lead: 'CHECKOUT の「基準ルート（Standard Route）」がどこから来ているか。',
    entries: [
      {
        title: 'checkout_table_added_routes_final.xlsx（添付 Excel）',
        url: `${REPO_URL}/blob/main/data/source/checkout_table_added_routes_final.xlsx`,
        what:
          'シート「チェックアウト表」の第1候補。LEFT 41〜170 の 123 件が、そのまま本アプリの基準ルートです。',
        usedFor: 'CHECKOUT の STANDARD（基準ルート）41〜170',
        role: 'source-of-truth',
        origin: 'internal',
        since: '2026-08-31（初回実装 / PR #1 で取り込み・全 123 件を再検算）',
      },
      {
        title: 'LEFT 2〜40 の導出規則（v1 として人間が承認）',
        url: `${REPO_URL}/blob/main/docs/APPROVALS.md`,
        what:
          '上の Excel には 2〜40 の収録がありません。明示した規則で 39 件を導出し、v1 の方針として承認されています。',
        usedFor: 'CHECKOUT の STANDARD（基準ルート）2〜40',
        role: 'source-of-truth',
        origin: 'internal',
        since: '2026-08-31（docs/APPROVALS.md A-4）',
      },
    ],
  },
  {
    heading: 'SETUP・アレンジ理論の資料',
    lead: '171〜350 の組み立て方（テンパイ作り・Bogey 回避）の出どころ。',
    entries: [
      {
        title: '添付資料「01アレンジの整理」',
        url: null,
        what:
          '覚えるべき残り（160 / 161 / 164 / 167 / 170）、Bogey Number、180 のあとの残り、'
          + '「とりあえず TON」の罠、302〜309 の 3 投目調整、S-BULL を使った調整の例。'
          + 'リポジトリオーナーから提供された資料で、記載内容は書き換えず、'
          + '機械検証できるフィクスチャとして保存しています。',
        usedFor: 'SETUP の残り点評価・Bogey 判定・3 投目調整・TRAINING の出題カテゴリ',
        role: 'reference',
        origin: 'internal',
        since: '2026-08-31（初回実装 / PR #1 で全ケースを再検算）',
      },
      {
        title: 'Bogey Number（159 / 162 / 163 / 165 / 166 / 168 / 169）',
        url: `${REPO_URL}/blob/main/src/data/bogeyNumbers.ts`,
        what:
          '資料の一覧と、engine が総当たりで求めた結果が一致することを確認しています。'
          + 'アプリが使うのは計算で確かめられた事実の方です。',
        usedFor: 'CHECKOUT / SETUP のノーテン判定',
        role: 'source-of-truth',
        origin: 'internal',
        since: '2026-08-31',
      },
    ],
  },
  {
    heading: 'ルール・盤面',
    lead: '01（Double Out）のルールと、盤面の描き方。',
    entries: [
      {
        title: 'スティールダーツ 01 / Double Out の一般ルール',
        url: null,
        what:
          '最終ダートはダブルまたは BULL、アウターブル（25）では上がれない、'
          + '残りが 0 未満 / 1 / ダブル以外での 0 は Bust。'
          + 'これらは特定の外部資料からの引用ではなく、競技として広く共有されているルールとして'
          + 'engine に実装し、テストで検証しています。',
        usedFor: 'Bust 判定・Double Out 判定・チェックアウト可否の計算',
        role: 'reference',
        origin: 'external',
        since: null,
      },
      {
        title: 'Darts Calculator（同じ作者の別リポジトリ）',
        url: 'https://github.com/chihirohashimotoac-coder/Darts-Calculator',
        what:
          'SVG ダーツボードの幾何と描画のしくみを参考にしました。'
          + '共通パッケージにはせず、このリポジトリへコピーして独立に管理しています。',
        usedFor: '盤面表示・タップ判定（実戦入力）',
        role: 'reference',
        origin: 'external',
        since: '2026-08-31（初回実装）',
      },
    ],
  },
  {
    heading: 'プロジェクト内資料',
    lead: 'どの判断を誰がいつ決めたかは、すべてリポジトリ内に残しています。',
    entries: [
      {
        title: 'APPROVALS.md — 戦術方針の人間承認記録',
        url: `${REPO_URL}/blob/main/docs/APPROVALS.md`,
        what: '重み・呼称・教材ルールなど、人間が承認した v1 の方針とその日付。',
        usedFor: 'ランキングの重み・基準ルートの呼称・TRAINING の出題設計',
        role: 'project-doc',
        origin: 'internal',
        since: '2026-08-31〜',
      },
      {
        title: 'CHECKOUT_DATA_POLICY.md — 基準ルートデータの扱い',
        url: `${REPO_URL}/blob/main/docs/CHECKOUT_DATA_POLICY.md`,
        what: '何を Source of Truth とするか、どう呼ぶか、どんなときだけ変更してよいか。',
        usedFor: 'CHECKOUT の STANDARD データ',
        role: 'project-doc',
        origin: 'internal',
        since: '2026-08-31〜',
      },
      {
        title: 'SETUP_THEORY.md — SETUP（171〜350）の考え方',
        url: `${REPO_URL}/blob/main/docs/SETUP_THEORY.md`,
        what: '「最大得点ではなく、次の 3 投で上がれる残りを作る」という評価の考え方。',
        usedFor: 'SETUP の残り点評価・第一ターゲットの選び方',
        role: 'project-doc',
        origin: 'internal',
        since: '2026-08-31〜',
      },
      {
        title: 'ARRANGE_RULES.md — 評価ルールと重み',
        url: `${REPO_URL}/blob/main/docs/ARRANGE_RULES.md`,
        what: 'どの観点を見るか、その観点をどれだけ重視するか。',
        usedFor: 'CHECKOUT / SETUP の推奨度（S / A / B / C）',
        role: 'project-doc',
        origin: 'internal',
        since: '2026-08-31〜',
      },
      {
        title: 'TRAINING_DESIGN.md — TRAINING の教育設計',
        url: `${REPO_URL}/blob/main/docs/TRAINING_DESIGN.md`,
        what: '出題形式・カテゴリ配分・採点の考え方と、その検証方法。',
        usedFor: 'TRAINING',
        role: 'project-doc',
        origin: 'internal',
        since: '2026-09-02〜',
      },
      {
        title: 'DATA_CONFLICTS.md — 資料と計算が食い違った記録',
        url: `${REPO_URL}/blob/main/docs/DATA_CONFLICTS.md`,
        what: '資料の記載をどう扱うか迷った点と、その結論。資料そのものは書き換えていません。',
        usedFor: 'データの取り扱い方針',
        role: 'project-doc',
        origin: 'internal',
        since: '2026-08-31〜',
      },
      {
        title: 'SPEC.md — アプリ全体の仕様',
        url: `${REPO_URL}/blob/main/docs/SPEC.md`,
        what: '目的・対象範囲・画面・判断の出し方。',
        usedFor: 'アプリ全体',
        role: 'project-doc',
        origin: 'internal',
        since: '2026-08-31〜',
      },
    ],
  },
];

/**
 * 基準ルートの位置づけ。
 * 「PDC 公式ルート」と誤解されないよう、画面にもこの説明を出す。
 * docs/APPROVALS.md A-1 / docs/CHECKOUT_DATA_POLICY.md §2。
 */
export const STANDARD_ROUTE_NOTE = [
  '本アプリの 41〜170 の基準ルート 123 件は、プロジェクト内の Excel '
  + '「checkout_table_added_routes_final.xlsx」を Source of Truth として管理しています。',
  'この Excel の見出しには「PDC頻出ルート」とありますが、'
  + 'PDC が公式に定めたルート表であることを示す一次資料は確認できていません。'
  + 'そのため本アプリでは、公式に認定されたルートとしては扱わず、'
  + '「基準ルート（Standard Route）」と呼んでいます。',
  'Excel のデータ自体は変更していません。取り込み時・CI・アプリのテストの 3 か所で、'
  + '合計が残り点と一致するか、最終ダートがダブルかを毎回計算し直しています。',
] as const;

/**
 * 外部 Web サイトの参照履歴が無いことの明示（本プロンプト 14 節）。
 * 「参考にしたことにする」ための後付けを防ぐために、画面へも書く。
 */
export const NO_EXTERNAL_WEB_SOURCES_NOTE =
  'リポジトリ・添付資料・変更履歴を調べたかぎり、アレンジ理論やルート表について'
  + '外部の Web サイトを参照した記録はありませんでした。'
  + '実際に参照したことを確認できないものは、このページに載せていません。';
