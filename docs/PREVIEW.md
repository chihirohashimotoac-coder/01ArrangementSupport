# PREVIEW.md — PR ごとのプレビュー配信

PR の内容を、マージ前にブラウザで確認するための仕組みです。
**本番（GitHub Pages）とは完全に別系統**で、本番 deploy にも Pages の設定にも触れません。

---

## 1. なぜ GitHub Pages を使わないか

このリポジトリの本番配信は **GitHub Actions をソース**にした GitHub Pages です
（`.github/workflows/ci-deploy.yml` の `build-pages` → `deploy`）。

- GitHub Pages のソースは 1 リポジトリにつき 1 つだけです。
  `gh-pages` ブランチ配信へ切り替えると、切り替え中に本番が影響を受けます。
- `actions/deploy-pages` の `preview` 入力は **alpha で一般公開されていません**。
- `deploy-pages` は成果物でサイト全体を置き換えるため、PR から実行すると
  次に main が deploy されるまで本番がプレビューに差し替わってしまいます。

そのため、プレビューだけを外部（Cloudflare Pages）へ出す構成にしています。

---

## 2. 仕組み

`.github/workflows/pr-preview.yml` が PR の `opened` / `synchronize` / `reopened` で動きます。

1. `VITE_BASE_PATH=/` でビルドする（プレビューはサブドメインのルートで配信されるため）
2. `wrangler pages deploy dist` で Cloudflare Pages へ配信する
3. PR へプレビュー URL のコメントを 1 件だけ出す（push のたびに同じコメントを更新）

**設定が無いリポジトリでは全ステップを飛ばし、チェックは success のままにします。**
fork からの PR にも Secrets は渡らないので、同じ経路で安全に skip されます。
つまり、下の設定をしなくても CI が落ちることはありません。

---

## 3. 設定手順（1 回だけ）

### 3-1. Cloudflare 側

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) にログインする
2. **Workers & Pages → Create → Pages → Upload assets** で空のプロジェクトを作る
   - プロジェクト名は `01arrangementsupport`（既定値）
   - Git 連携は**不要**です。配信は GitHub Actions から行います
3. **My Profile → API Tokens → Create Token** で
   テンプレート **「Edit Cloudflare Workers」** を選ぶ
   （必要な権限は `Account / Cloudflare Pages / Edit` です）
4. 発行されたトークンと、**Account ID**（Workers & Pages の右側に表示）を控える

### 3-2. GitHub 側

このリポジトリの **Settings → Secrets and variables → Actions** で登録します。

| 種別 | 名前 | 値 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | 3-1 で発行したトークン |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare の Account ID |
| Variable（任意） | `CLOUDFLARE_PAGES_PROJECT` | プロジェクト名。既定は `01arrangementsupport` |

登録後、対象 PR で **Re-run all jobs** すればプレビュー URL がコメントされます。

---

## 4. プレビュー URL の形

```
https://pr-<PR番号>.<プロジェクト名>.pages.dev
```

PR ごとに固定で、push のたびに中身が更新されます。

---

## 5. 注意

- プレビューは**公開 URL** です。未公開にしたい内容は載せないでください。
- Service Worker が登録されるため、同じブラウザで複数のプレビューを見比べるときは
  シークレットウィンドウを使うか、開発者ツールの
  **Application → Service Workers → Unregister** をしてください。
- 本番の URL は変わりません:
  https://chihirohashimotoac-coder.github.io/01ArrangementSupport/
