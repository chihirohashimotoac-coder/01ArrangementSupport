# CLAUDE.md — Claude Code 固有の作業ルール

まず `AGENTS.md` を読んでください。ここには Claude Code に固有の事項だけを書きます。

---

## 1. 担当範囲

Claude Code はこのリポジトリの**主実装担当**です。

- アーキテクチャの決定と大規模な機能実装
- アレンジエンジン（checkout / setup / recovery / ranking / training）
- データモデルと Excel 取り込みパイプライン
- UI・PWA・CI/CD・テスト構造・ドキュメント
- 大規模リファクタ

小さな文言修正や CSS の微調整だけを目的とした PR は、Codex 側の担当です。

---

## 2. 実装するときの順序

大きな一括変更で品質を落とさないこと。次の順で進めます。

1. 仕様を読む（`docs/`）
2. 変更対象のテストを先に確認する（既存の期待値を壊していないか）
3. engine → data → UI の順に変更する（UI から書き始めない）
4. `npm run verify` を通す
5. 内部的に意味のある単位で小さく commit する

## 3. 変更してよい場所・いけない場所

| 対象 | Claude Code の扱い |
| --- | --- |
| `src/engine/**` | 自由に実装・リファクタしてよい |
| `src/components/**`, `src/pages/**` | 自由に実装してよい |
| `src/domain/**` | ルールの実装。仕様変更を伴う場合は docs も同時に更新する |
| `src/data/rankingRules.ts` | **重みの変更は Human Approval Required** |
| `src/data/bogeyNumbers.ts` | **Human Approval Required**（計算結果との一致をテストが担保） |
| `src/data/standardCheckoutRoutes.generated.ts` | **手編集禁止**（`npm run import:checkout` で再生成） |
| `src/data/lowStandardRoutes.ts` | v1 承認済み。導出ルールの変更は **Human Approval Required** |
| `src/data/setupReferenceCases.ts` | 添付資料の記録。**書き換えず、矛盾は報告する** |
| `data/source/*.xlsx` | 一次資料。**変更禁止** |

## 3-1. 承認済みの戦術方針

`docs/APPROVALS.md` に、人間が承認した v1 の戦術方針（呼称・2〜40 の導出規則・
SEGMENT_DIFFICULTY・SETUP の重み・GRADE_THRESHOLDS など）が記録されています。

- 承認済み = **人間が選んだ暫定の方針**であって、「絶対に正しい値」ではありません。
- ドキュメントや説明文で、これらを「数学的・統計的に正しい」と表現しないこと。
- v1 から変更したい場合は、値を変えずに提案だけを書き、承認を得てください。

## 4. データに矛盾を見つけたとき

勝手に直さないこと。次の手順を守ります。

1. 何と何が矛盾しているかを、再現できる形（テストまたはスクリプト）で示す
2. `docs/DATA_CONFLICTS.md` へ `DATA CONFLICT` として追記する
3. 直したい場合は `PROPOSED CHANGE` として案を書く（実際には変更しない）
4. PR 説明にも同じ内容を書く

## 5. テストの書き方

- 数万回の `expect` を回さない。全件走査は違反だけを配列へ集め、最後に 1 回 assert する
  （そうしないと vitest の既定タイムアウト 5 秒を超える）。
- engine の変更では、必ず添付資料由来の回帰テスト（122 / 302〜309 / 231〜235 / 271〜275）が
  通ることを確認する。
- ランキングの重みを触ったら、`基準ルートが 2〜170 すべてで第 1 候補になる` テストが
  通ることを必ず確認する。

## 6. コミットメッセージ

日本語で、何をなぜ変えたかを書きます。モデル名は書きません。
