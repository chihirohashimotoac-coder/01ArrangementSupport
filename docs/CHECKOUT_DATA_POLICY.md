# CHECKOUT_DATA_POLICY.md — 基準ルートデータの扱い

## 1. 何を Source of Truth とするか

| 残り点 | 出典 | `source` | `reviewStatus` |
| --- | --- | --- | --- |
| 41〜170 | 添付 Excel `checkout_table_added_routes_final.xlsx` の第1候補 | `excel-first-candidate` | `source-of-truth` |
| 2〜40 | 明示ルールによる導出（Excel に収録なし） | `derived-rule-v1` | `pending-human-review` |

一次資料は `data/source/checkout_table_added_routes_final.xlsx` に置き、**変更しません**。

## 2. 呼び方（DATA CONFLICT #1）

Excel の見出しには「Steel Darts Checkout Table｜**PDC頻出ルート** + D20 / D16 / D14 / D12 終わり候補」
とありますが、PDC が公式に定めたルート表であることを示す一次資料を確認できていません。

したがってアプリ内・ドキュメント内では、

- ✅ 基準ルート / Standard Route / 推奨ルート
- ❌ PDC 公式ルート

と表記します。

## 3. 変更してよい場合

Excel 第1候補は**原則変更禁止**です。変更を検討してよいのは次の場合だけです。

- 算術的に不成立（合計が LEFT と一致しない）
- Double Out として不成立（最終ダートがダブル / BULL でない）
- 存在しないセグメントを含む
- 明確なデータ破損
- 明白な入力ミス

**この場合も勝手に修正せず、`docs/DATA_CONFLICTS.md` へ報告してください。**

## 4. 取り込みと検算

```bash
npm run import:checkout            # 検算して src/data/standardCheckoutRoutes.generated.ts を再生成
npm run import:checkout -- --check # 検算だけ（CI で実行）
```

`scripts/import-checkout-excel.mjs` が全 123 行について次を再計算します。
Excel の「検算」欄が OK であることは**信用しません**。

1. ルートの合計 = LEFT
2. 最終ダートがダブルまたは BULL（BULL は Double 25 として合法な finish）
3. ダート数が 3 本以下
4. 途中でマイナス・1 残しにならない（Bust しない）
5. すべてのセグメントが盤面に存在する（S1-20 / D1-20 / T1-20 / SB / BULL）
6. 第2〜第5候補は、指定されたダブル（D20 / D16 / D14 / D12）で終わる
7. 「第1候補と同一」の行は、実際に第1候補がそのダブル終わりである

不一致が 1 件でもあれば、スクリプトは一覧を出力して**終了コード 1 で失敗**します。
データは自動修正しません。

さらにアプリ側のユニットテスト（`src/data/standardCheckoutRoutes.test.ts`）でも同じ検算を
独立に行い、加えて「—（3本以内で不成立）」と書かれた候補が本当に総当たりで作れないことも確認します。

### 現時点の検算結果

- 読み込み行数: **123 件**（LEFT 41〜170）
- 41〜170 のうち表に存在しない LEFT: **159 / 162 / 163 / 165 / 166 / 168 / 169**
  — いずれも 3 本でチェックアウトできない Bogey Number であり、欠落は正しい
- Excel の「検算」欄が OK 以外の行: **0 件**
- 再計算で見つかった不一致: **0 件**

## 5. 2〜40 の導出ルール（レビュー対象）

Excel に収録がないため、アルゴリズムが暗黙の「好み」を持たないよう、
採用ルールを次の 2 つだけに限定しています（`src/data/lowStandardRoutes.ts`）。

**R1. LEFT が偶数（2〜40）**
→ 1 本で上がる。`D(LEFT / 2)`。

**R2. LEFT が奇数（3〜39）**
→ シングル 1 本で「立て直しやすいダブル」を作ってから上がる。
立て直しやすさは **32 → 16 → 8 → 4 → 2** の順（2 分割が続く順）とし、
シングルで到達できる（差が 1〜20）**最大のもの**を選ぶ。

導出結果（奇数）:

```
 3: S1 + D1      17: S1 + D8      31: S15 + D8
 5: S1 + D2      19: S3 + D8      33: S1 + D16
 7: S3 + D2      21: S5 + D8      35: S3 + D16
 9: S1 + D4      23: S7 + D8      37: S5 + D16
11: S3 + D4      25: S9 + D8      39: S7 + D16
13: S5 + D4      27: S11 + D8
15: S7 + D4      29: S13 + D8
```

このルールは、41〜170 の Excel 第1候補が D16 / D20 を多用する傾向とは**独立に**定義しています。
両者の整合性は人間が確認してください。

`reviewStatus: 'pending-human-review'` は、人間のレビューが済むまで外しません。
UI の「設定」画面にもレビュー待ち件数を表示しています。

## 6. 生成ファイルの扱い

`src/data/standardCheckoutRoutes.generated.ts` は**手編集禁止**です。
CI では、生成し直した結果が commit 済みの内容と一致するかも検証します。
