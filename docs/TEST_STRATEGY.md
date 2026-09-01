# TEST_STRATEGY.md — テスト方針

## 1. 層ごとの責任

| 層 | テスト | 何を守るか |
| --- | --- | --- |
| `domain/` | ユニット | Double Out のルール（Bust・Bogey・合法性） |
| `data/` | ユニット | 一次資料との一致、データ破損の検知 |
| `engine/` | ユニット + 回帰 | 探索の網羅性、評価の一貫性、資料ケースの再現 |
| `components/`, `pages/` | Testing Library | 画面が engine の結果を正しく見せるか |
| アプリ全体 | Playwright | 起動・入力・リカバリー・Undo・Bust・保存・PWA |

## 2. 必ず守るユニットテスト

### CHECKOUT

- ルートの合計が LEFT と一致する（2〜170 × 1〜3 本の全ルート）
- 最終ダートが Double または BULL である（全ルート）
- ダート数が使える本数以下である（全ルート）
- 存在しないセグメント（MISS）を含まない（全ルート）
- Bust するルート（途中で 1 残し・マイナス）を返さない（全ルート）
- Bogey を正しく判定する（計算結果が `data/bogeyNumbers.ts` と一致）

### 固定ケース

`41 / 43 / 46 / 50 / 61 / 99 / 103 / 122 / 160 / 161 / 164 / 167 / 170`
について、基準ルートが存在し、第 1 候補として並ぶこと。

### RECOVERY TRAINING

- RECOVERY の全出題候補について、実投後の残り点・残り本数を独立に再計算する
- 各候補に残り本数以内の合法な Double Out route があり、合計・最終 Double / BULL・
  途中の Bust なしを確認する
- 出題時に保持した正答を実際の TRAINING grader へ渡し、grade・reason・better route が
  得られることを確認する
- `161 → T20 狙い → S20 → 141 / 2 本` を候補に含めず、141 を 2 本で上がれると判定しない
- MISS / Single / Double / Triple / S-BULL / BULL の実投と、Bust・1 残り・
  Single / Triple による 0・D1 finish・BULL finish の境界を固定テストする
- RECOVERY 2,000 問と MIXED 2,000 問を決定的に生成し、解なし・NaN・undefined・
  grader 不一致が 0 件であることを通常の unit suite で確認する
  （10 万問規模は `npm run audit:training` へ分離。§4-1 参照）
- MIXED は空の種別 pool を乱数で選ばず、利用可能な種別だけから要求数を生成する

### SETUP TRAINING（v1.3）

- `226 - 20 - 20 = 186` の算術、`S20 → 166`（ノーテン）、`S19 → 167`（上がれる）
- `302 → S20 → 162`（ノーテン）、`302 → S18 → 164`、`305 → S18 → 167`、`308 → S18 → 170`
- 302〜309 の 8 件すべてで推奨の 3 投目と残りが資料と一致する
- 推奨以外の成立回答（`226 / 186 → S16 → 170`）も `learningCorrect` になる
- 3 投フルで 170 超え・Bogey を残した回答は `ruleValid = true` / `learningCorrect = false`
- 1 投調整の全候補で、推奨解答が「次のラウンドで上がれる残り」を作る
- 9 つの教育カテゴリすべてに候補が存在する

### feedback（v1.3）

- すべての不成立理由（EMPTY / TOO_MANY_DARTS / BUST / NOT_DOUBLE_FINISH /
  TOTAL_MISMATCH / NOT_FINISHED / LEAVES_BOGEY / LEAVE_ABOVE_CHECKOUT_RANGE）で
  推奨解答が空にならない
- CHECKOUT 103 の推奨は `T19 → S6 → D20`
- SETUP 226 の悪い回答に対し、`S19 → 167` と理由を返す
- RECOVERY の不成立回答に対し、現在の残り・本数で成立するルートを返す

### 出題 sampler（v1.3）

- 10 問 / 30 問の quota（SETUP は 8/2・24/6 の形式比、カテゴリ quota、難易度 quota）
- MIXED の種別 quota（4/3/3・10/10/10）と、同じ種別が 3 連続しないこと
- 同じ seed からは同じ並びになること
- anti-repeat（同じ問題は直近 5 問、同じ状況は直近 3 問）
- reviewWeakFirst で、間違えた問題そのものがカテゴリ一致の別問題より先に出ること
- reviewWeakFirst でも同じ問題を連打しないこと
- 狭い出題範囲（SETUP 171〜182）でも 3 投フルの比率を保つこと
- 候補が 1 件しかない設定でも無限ループしないこと
- 無限モードの chunk 境界で直近履歴を引き継ぐこと
- 1 問目は HARD にせず、最後の 2 問のどちらかは HARD

### 学習履歴の移行（v1.3）

- V1 CHECKOUT / RECOVERY / SETUP の移行（上がれる残り・Bogey・170 超え）
- V1 と V2 が混ざった履歴
- 再評価できない記録を正答率へ混ぜず、`migrationSkippedCount` として数えること
- null / `{}` / 不正な grade / 不正な kind / elapsed 欠落 / 未知の version /
  壊れた JSON でも crash しないこと
- 500 件の上限
- 復習対象が SETUP の文脈（problemKey・カテゴリ・開始残り）を保つこと

### Excel 検算（123 件）

`starting LEFT` / `route score total` / `final dart` / `Double Out` /
`specified finishing double` / `segment validity` をアプリ側でも再計算。
Excel の「OK」は信用しません。さらに「—（不成立）」が本当に不成立であることを総当たりで確認します。

## 3. 回帰テスト（添付資料由来）

### 122

- 基準ルートは `T18 → S18 → BULL`
- `T18` を狙って `S18` に落ちると **104**。残り 2 本でチェックアウト可能（`T18 → BULL`）
- `T20` を狙って `S20` に落ちると **102**。残り 2 本ではチェックアウト不能
- この差が `SINGLE_MISS_SAFE` / `SINGLE_MISS_LOSES_CHECKOUT` として理由コードに現れる
- T20 始動は `SAFER_START_EXISTS` が付き、**C ランク**になる

### SETUP 302〜309

3 投目の調整（`302 → 18 → 164`、`305 → 18 → 167`、`308 → 18 → 170` ほか計 8 件）が、
残り 1 本の選択でも 3 本フルの組み立てでも最上位に来ること。
`302` で 3 投目を 20 にすると 162 のノーテンになり、C ランクになること。

### S-BULL 231〜235 / 271〜275

10 件すべてで、ルートが Bust せず、合計・残り・テンパイ成立が資料の記載と一致すること。

### 340 点台 / TON トラップ

資料 (3) の 10 件と資料 (4) の 7 件が、計算結果と全件一致すること。
さらに、計算で求めた TON トラップの全件が資料の 7 件と過不足なく一致すること。

## 3-1. 大量統計監査（`npm run audit:training`）

10 万問規模の監査は通常の unit test に埋め込まない。
`npm run test` は高速な決定論的回帰として保ち、統計監査は専用スクリプトで回す。

各モード 10 万問（30 問 × 3,334 セッション）で次を report する。

Generated / Unique / 直前と同じ問題 / 直近 5 問以内の重複 / 直近 3 問以内の同じ状況 /
同じ問題の最大連続 / 難易度分布 / カテゴリ分布 / 種別分布 / 形式分布 /
不正な出題 / grader 不一致 / NaN / undefined / 条件を緩めた回数 /
SETUP の adjustment・full 比 / ノーテン回避問題数 / 推奨残りの 160・161・164・167・170・その他 /
trivial 率 / RECOVERY の解なし・grader 不一致 / MIXED の同一種別の最大連続。

hard acceptance（満たさなければ exit 1）:

```
直前とまったく同じ問題            : 0
直近 5 問以内の同じ problemKey     : 0
同じ問題の最大連続                : 1
MIXED の同一種別の最大連続        : 2
RECOVERY の解なし / grader 不一致 : 0
NaN / undefined                   : 0
復習対象が 1 件でも 直前と同じ 0・3 連続 0
```

SETUP の推奨残りが 160 になる割合は **hard failure にせず WARNING + 原因分析**とする
（`docs/TRAINING_DESIGN.md` §9）。

## 4. 性能テスト

- SETUP の 171〜350 全件探索が、表の構築を含めて 1 秒以内
- 2 回目以降はキャッシュが効く（50 回で 50ms 以内）

## 5. E2E（Playwright / mobile + desktop の 2 プロジェクト）

アプリ起動 / CHECKOUT 103 表示 / STANDARD 表示 / ルート理由の開閉 / すべて表示 /
リカバリー / Undo / Bust / SETUP / TON 警告 / TRAINING 回答 / 回答確定 /
TRAINING SETUP の 1 投調整（開始残り・ここまでの結果・現在の残り・残り 1 投の表示、
自動確定しないこと、Undo、悪い回答への feedback と推奨解答）/
CHECKOUT・RECOVERY の不成立回答への推奨解答 / MIXED 10 問完走 / 無限モードの継続 /
履歴 V2 と legacy 移行 /
学習履歴保存 / reload 後の復元 / MY ROUTE の永続化 /
PWA（manifest・Service Worker・SPA フォールバック・オフライン表示）/
アクセシビリティ（aria-label・キーボード操作）/ Safe Area（通常ブラウザで余白が変わらないこと）

## 6. テストを書くときの注意

**全件走査で 1 件ごとに `expect` を呼ばないこと。** 数十万回の呼び出しになり、
vitest の既定タイムアウト（5 秒）を超えます。違反を配列へ集め、最後に 1 回だけ
`expect(violations).toEqual([])` してください。失敗時に何件どこで落ちたかも分かります。

## 7. 現在の規模

- ユニット / コンポーネント: **15 ファイル / 442 テスト**
- E2E: **45 テスト × 2 プロジェクト = 90**
- 統計監査: `npm run audit:training`（各モード 10 万問、約 25 秒）
