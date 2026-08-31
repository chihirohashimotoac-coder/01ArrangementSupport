# AGENTS.md — このリポジトリで作業する AI への指示

このリポジトリは複数の PC から、Claude Code と Codex の両方を使って開発します。
**GitHub リポジトリを唯一の Source of Truth** とし、ローカル環境は作業コピーとして扱います。

---

## 0. 作業を始める前に必ず読む

1. `docs/SPEC.md` — アプリ全体の仕様
2. `docs/ARRANGE_RULES.md` — 戦術評価のルールと重み
3. `docs/CHECKOUT_DATA_POLICY.md` — 基準ルートデータの扱い（**最重要**）
4. `docs/APPROVALS.md` — どの戦術方針が人間承認済みか（**最重要**）
5. `docs/SETUP_THEORY.md` — SETUP（171〜350）の考え方
6. `docs/TEST_STRATEGY.md` — テストの方針

読まずに実装を始めないこと。

---

## 1. Git 運用

- **作業前に最新の `main` を取得する**（`git fetch origin main`）。
- **`main` への直接 push は禁止**。必ず feature branch → Pull Request。
- **1 タスク 1 branch**。branch 名は `claude/<内容>` または `codex/<内容>`。
- **他の AI の作業 branch を勝手に編集しない**。Claude Code と Codex が同一 feature branch を同時編集する運用は禁止。
- **PR 必須**。CI がすべて成功していない PR はレビュー対象にしない。
- **自動 merge は行わない**。最終 merge には人間の確認が必要。

---

## 2. 絶対にしてはいけないこと

### 2-1. 既存リポジトリへの変更

- `chihirohashimotoac-coder/Darts-Calculator` は **READ ONLY**。
  commit も PR も作らない。SVG ダーツボードや geometry は、
  このリポジトリへコピーして独立管理している（共通パッケージ化はしない）。
- `n02` など他の既存アプリも変更しない。

### 2-2. 戦術データの独断変更（Human Approval Required）

次の変更には**人間の承認が必要**です。AI が「こちらのルートの方が合理的なので変えました」
という判断で書き換えてはいけません。

- 基準ルート（`src/data/standardCheckoutRoutes.generated.ts`、`src/data/lowStandardRoutes.ts`）
- Bogey Number の定義（`src/data/bogeyNumbers.ts`）
- ランキングの思想・重み（`src/data/rankingRules.ts`）
- 良いセットアップ残りの定義（`PREMIUM_TENPAI_LEAVES` など）
- 書き下ろし説明（`CURATED_*_EXPLANATIONS`）
- 添付資料由来のフィクスチャ（`src/data/setupReferenceCases.ts`）

変更が必要に見える場合は、**変更せずに** `docs/DATA_CONFLICTS.md` か PR 説明へ
`QUESTION` / `DATA CONFLICT` / `PROPOSED CHANGE` として記録してください。

現在の値のうち、どれが人間の承認を受けた「v1 の戦術方針」かは
**`docs/APPROVALS.md`** に記録されています。
承認済みであることは「その値が絶対に正しい」という意味ではなく、
**「人間が選んだ暫定の方針である」**という意味です。
v1 から変更したい場合は、あらためて承認を得て `docs/APPROVALS.md` へ v2 として追記してください。

### 2-3. 生成物の手編集

`src/data/standardCheckoutRoutes.generated.ts` は自動生成ファイルです。
直接編集せず、`npm run import:checkout` で再生成してください。

---

## 3. 役割分担

### Claude Code（主実装）

アーキテクチャ／大規模機能実装／アレンジエンジン／データモデル／SETUP エンジン／
Recovery エンジン／UI／PWA／CI・CD／テスト構造／ドキュメント／大規模リファクタ

### Codex（レビューと小規模修正）

独立レビュー／バグ探索／仕様照合／テスト追加／軽微な CSS 修正／文言修正／
明確な小規模バグ修正／小規模リファクタ

---

## 4. 品質ゲート

PR を出す前に、ローカルで次をすべて通してください。

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

`npm run verify` で lint / typecheck / test / build をまとめて実行できます。

GitHub Actions では lint / typecheck / Excel 再検算 / unit test / build / E2E が必須チェックです。

---

## 5. 設計の原則

- **生成 AI を runtime の判断に使わない。** アレンジ判断は決定論的・再現可能・
  テスト可能・オフライン動作可能な rule based engine であること。
- **責務を分離する。** `UI` / `domain` / `data` / `engine` / `storage` を混ぜない。
  戦術データを React コンポーネントへ直書きしない。
- **理由はコードで持つ。** 評価理由は reason code として構造化し、表示用の日本語は
  `src/data/explanations.ts` で解決する。手書きの文章だけで管理しない。
- **秘密情報を commit しない。** 公開リポジトリ前提。API key・トークンの類は不要な構成にしてある。
