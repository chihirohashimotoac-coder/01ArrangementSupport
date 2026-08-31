# data/source — 一次資料

ここに置くファイルは**一次資料**です。**変更しないでください。**

| ファイル | 内容 |
| --- | --- |
| `checkout_table_added_routes_final.xlsx` | チェックアウト表（LEFT 41〜170 の 123 件）。シート「チェックアウト表」の第1候補を基準ルートとして取り込む。 |

## 取り込み

```bash
npm run import:checkout            # 検算して src/data/standardCheckoutRoutes.generated.ts を再生成
npm run import:checkout -- --check # 検算だけ（CI で実行）
```

取り込み時に不一致が 1 件でもあれば、スクリプトは一覧を出力して失敗します。
**データは自動修正しません。** 詳細は `docs/CHECKOUT_DATA_POLICY.md`。

## 表記規則（シート「検算メモ」より）

```
T = Treble / D = Double / 25 = Outer Bull / Bull = Inner Bull
数字のみ = Single
「—」= 3本以内では成立しない
「第1候補と同一」= 第1候補がそのままその Double 終わりに該当する
```
