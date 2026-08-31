# 01 Arrangement Support

スティールダーツ 01 ゲーム（Double Out）の**アレンジ判断**を学ぶための Web アプリ / PWA です。

単なるチェックアウト早見表ではありません。

- なぜそのナンバーを狙うのか
- 狙いを外した場合にどうリカバリーするのか
- 171 点以上から、次ラウンドの良いテンパイをどう作るのか
- それらをどう反復学習するのか

までを扱います。**答えを覚えるアプリではなく、01 アレンジの「判断規則」を身につけるアプリ**です。

公開先: https://chihirohashimotoac-coder.github.io/01ArrangementSupport/

---

## 3 つのモード

| モード | 対象 | やること |
| --- | --- | --- |
| **CHECKOUT** | 残り 2〜170 | 基準ルート・MY ROUTE・理由・その他の合法ルートを表示。1 投ごとに追従。 |
| **SETUP** | 残り 171〜350 | 次ラウンドに良いテンパイを残す組み立てを提案。ノーテン（Bogey）を避ける。 |
| **TRAINING** | — | CHECKOUT / SETUP / RECOVERY / MIXED の反復練習と、成績の記録。 |

### 特徴

- **理由が出る。** 「T18 を狙って S18 に落ちても 104 が残るため、残り 2 本で T18 → BULL の
  チェックアウトチャンスが残ります」のように、engine の計算結果から説明を組み立てます。
- **1 投ごとに追従する。** 実際に刺さった場所をタップすると、残り点と残り本数から候補を再計算します。
  Bust 判定と Undo があります。
- **成立するルートを不正解にしない。** TRAINING では推奨度 S / A / B / C を付け、
  C（成立するが戦術的に非推奨）には必ず非推奨理由を表示します。
- **完全オフライン。** ログイン・バックエンド・外部 DB・生成 AI API を一切使いません。
  判断はすべて決定論的な rule based engine です。

---

## 開発

```bash
npm ci
npm run dev            # 開発サーバー
npm run verify         # lint + typecheck + test + build
npm run test:e2e       # Playwright（先に npm run build が必要）
npm run import:checkout   # 添付 Excel から基準ルートデータを再生成
```

### 技術構成

React 19 / TypeScript (strict) / Vite / vite-plugin-pwa / Vitest / Testing Library /
Playwright / ESLint / GitHub Actions / GitHub Pages。サーバーは使いません。

### ディレクトリ

```
src/
  domain/     盤面配置・得点・ダート・Double Out ルール（UI 非依存の事実）
  data/       戦術データ（基準ルート・Bogey・隣接・重み・説明文）
  engine/     探索と評価（checkout / setup / recovery / ranking / training）
  geometry/   SVG ダーツボードの座標計算
  components/ 表示部品
  pages/      画面
  hooks/      React との接続
  storage/    localStorage（設定・学習履歴）
scripts/      Excel 取り込み・検算、アイコン生成、SPA フォールバック
data/source/  一次資料（添付 Excel）
docs/         仕様書
```

`UI` / `domain` / `data` / `engine` / `storage` の責務を分離しています。
戦術データを React コンポーネントへ直書きしません。

---

## データの出典について

- 残り **41〜170** の基準ルートは、添付 Excel `checkout_table_added_routes_final.xlsx` の
  「第1候補」を取り込んだもの（**123 件**）です。取り込み時と CI で毎回、
  合計・最終ダート・Double Out・途中 Bust・指定ダブル終わりを再計算して検証します。
- 残り **2〜40** は Excel に収録がないため、明示ルールで導出しています
  （`src/data/lowStandardRoutes.ts`、39 件）。2026-08-31 に **v1 の基準ルートとして人間が承認**済みです。
- Excel のヘッダーには「PDC頻出ルート」とありますが、出典の一次資料を確認できていないため、
  アプリ内では **「基準ルート（Standard Route）」** とだけ呼びます（人間承認済み）。
  詳細は `docs/CHECKOUT_DATA_POLICY.md`。

### 戦術方針の位置づけ

ルートの推奨度や残し方の評価に使う重みは、**人間が承認した v1 の戦術方針**です。
「数学的・統計的に絶対正しい値」ではなく、運用しながら見直す前提の暫定値として扱います。
承認の内容と経緯は `docs/APPROVALS.md` に記録しています。

算術・ルール上の正しさ（合計が LEFT と一致する、最終ダートがダブルである、Bogey かどうか）は
engine が計算し、テストで検証している**検証可能な事実**で、上の戦術判断とは区別しています。

---

## AI 開発者向け

このリポジトリは Claude Code と Codex の両方で開発します。
作業前に **`AGENTS.md`** と **`CLAUDE.md`** を必ず読んでください。

- `main` への直接 push は禁止（PR 必須、自動 merge しない）
- 戦術データの変更には Human Approval が必要
- 既存の `Darts-Calculator` リポジトリは READ ONLY

---

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| `docs/SPEC.md` | アプリ全体の仕様 |
| `docs/ARRANGE_RULES.md` | 評価ルールと重み、理由コード |
| `docs/CHECKOUT_DATA_POLICY.md` | 基準ルートデータの扱いと検算 |
| `docs/SETUP_THEORY.md` | 171〜350 の考え方（0・1・4・7、TON の罠、S-BULL） |
| `docs/UI_SPEC.md` | 画面仕様 |
| `docs/TEST_STRATEGY.md` | テスト方針 |
| `docs/DATA_CONFLICTS.md` | 資料と計算結果の食い違い・確認事項 |
| `docs/APPROVALS.md` | 戦術方針の人間承認記録（v1） |
