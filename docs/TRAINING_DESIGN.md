# TRAINING_DESIGN.md — TRAINING の教育設計（v1.3）

## 0. この文書の位置づけ

TRAINING は「答えを覚える場所」ではなく、
**実戦のアレンジ判断を反復して身につける教材**です。

- CHECKOUT: 「どう上がるか」を判断できるようになる
- SETUP: 「最後の 1 投で悪い残りを避け、次のラウンドで上がれる残りへ整える」判断ができるようになる
- RECOVERY: 「外したあとに、残り点と本数から正しく組み直す」判断ができるようになる
- MIXED: この 3 つを実戦のように切り替えられるようになる

**通常 Practice の戦術ロジック（ランキング・基準ルート・重み）は TRAINING のために変更しません。**
TRAINING が持つのは「出題」「採点の概念分離」「feedback」「履歴」だけです。

---

## 1. v1.2 までの問題

SETUP TRAINING は「3 投を合法に投げられたら正解」でした。

全 173 件の SETUP 出題に `S20 → S20 → S20` と答えると、
**173 / 173 がルール上 valid** になります。
しかし、次のラウンドで上がれる残りを作れるのは 53 件だけで、
残り 120 件（69.4%）は Bogey（ノーテン）か 170 超えを残します。

つまり「同じ 20 を打ち続ける」だけで正答率が 100% になり、
**SETUP で最も大事な判断を一度も練習しないまま終われて**しまいました。

---

## 2. ruleValid と learningCorrect

採点を 2 つの概念に分けます（`src/engine/training/grade.ts`）。

| 概念 | 意味 |
| --- | --- |
| `ruleValid` | ルール上その回答が成立するか（合法か） |
| `learningCorrect` | 学習目的として正解か |

- CHECKOUT / RECOVERY: 合法な Double Out が完成すれば両方 true。
  **C ランクのルートでも、数学的に成立していれば `learningCorrect` は true** です
  （推奨度は別軸として表示します）。
- SETUP: 合法に投げ切れても、残りが Bogey / 170 超えなら
  `ruleValid = true` / `learningCorrect = false`。

**主 UI の正答率は `learningCorrect` で数えます。**
`ruleValidRate` は内部指標として保持します。

---

## 3. SETUP の Hybrid 出題

| 形式 | 割合 | 10 問 | 30 問 |
| --- | ---: | ---: | ---: |
| 1 投調整（adjustment） | 80% | 8 | 2 |
| 3 投フル（full route） | 20% | 2 | 6 |

### 3-1. 1 投調整（主教材）

```
SETUP / 残り 1 投

開始:    226
ここまで: S20 → S20   ← 実際に入った結果（読み取り専用）
現在:    186

次のラウンドで上がれる残りにするには、どこを狙いますか？
```

- 先行 2 投は **ユーザーの回答ではなく「実際に入った結果」** です。
  回答欄には入れず、読み取り専用で表示します。
- 回答は盤面から 1 か所だけ選びます。自動確定はせず「回答する」で採点します。

### 3-2. 必須ケース

| 開始 | ここまで | 現在 | 継続（20） | 推奨 | 推奨の残り |
| ---: | --- | ---: | --- | --- | ---: |
| 226 | S20 → S20 | 186 | S20 → 166（ノーテン） | **S19** | 167 |
| 302 | T20 → T20 | 182 | S20 → 162（ノーテン） | **S18** | 164 |
| 303 | T20 → T20 | 183 | — | **S19** | 164 |
| 304 | T20 → T20 | 184 | — | **S20** | 164 |
| 305 | T20 → T20 | 185 | S20 → 165（ノーテン） | **S18** | 167 |
| 306 | T20 → T20 | 186 | S20 → 166（ノーテン） | **S19** | 167 |
| 307 | T20 → T20 | 187 | — | **S20** | 167 |
| 308 | T20 → T20 | 188 | S20 → 168（ノーテン） | **S18** | 170 |
| 309 | T20 → T20 | 189 | S20 → 169（ノーテン） | **S19** | 170 |

推奨解答は **通常 Practice と同じ `rankSetupRoutes` の第 1 候補**です。
TRAINING 用に別のランキングは持ちません。

### 3-3. 推奨以外の正解

推奨解答だけを唯一の正解にはしません。
226 / 186 で `S16 → 170` のように、上がれる残りを作る合法な回答は
すべて `learningCorrect = true` とし、その上で S / A / B / C の二次評価を付けます。

---

## 4. 教育カテゴリ

| 記号 | カテゴリ | 内容 |
| --- | --- | --- |
| A | `setup-bogey-avoid` | 一般的なノーテン回避 |
| B | `setup-adjust-18-19-20` | 18 / 19 / 20 へのずらし |
| C | `setup-digits-0147` | 0・1・4・7（159〜170 帯） |
| D | `setup-302-309` | 302〜309 の 3 投目調整 |
| E | `setup-ton-trap` | 「とりあえず TON」の罠 |
| F | `setup-landing-95-105` | 95〜105 への着地 |
| G | `setup-sbull` | S-BULL 25 での調整 |
| H | `setup-same-number-worse` | 同じ数字を続けると悪化する |
| I | `setup-basics` | 基礎確認 |

出題の優先順は D > E > F > G > C > H > B > A > I。
カテゴリの判定は「具体的なものから順に 1 つだけ」割り当てます。

### quota

| | A | B | C | D | E | F | G | H | I |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 問 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 30 問 | 6 | 4 | 3 | 4 | 4 | 3 | 3 | 2 | 1 |

候補が存在しないカテゴリのぶんは、利用可能なカテゴリへ **決定論的に**再配分します
（infinite retry はしません）。再配分した件数は sampler の report に出ます。

---

## 5. 難易度

### CHECKOUT

```
difficultyPoints = (ルート長 - 1) + トリプル含有 + BULL 含有 + (LEFT >= 100) + (的の切り替え 2 回以上)
EASY 0〜1 / MEDIUM 2〜3 / HARD 4 以上
```

10 問: EASY 2 / MEDIUM 4 / HARD 4（1 投上がりは最大 1）
30 問: EASY 6 / MEDIUM 12 / HARD 12（1 投上がりは最大 3）

### RECOVERY

- EASY: 1 本で上がれる
- MEDIUM: 2 本。BULL もトリプルも必須ではない
- HARD: BULL finish が必須、またはトリプルが必須

10 問: 2 / 5 / 3 、30 問: 6 / 15 / 9

### SETUP

- EASY: 基礎確認（I）。継続の的でもすでに上がれ、ノーテン・170 超えの判断が要らない
- MEDIUM: 18 / 19 / 20 のずらし、Bogey・0/1/4/7 の判断（A / B / C / D / H）
- HARD: TON トラップ、95〜105、S-BULL、3 投フル（E / F / G と全 full）

### trivial（判断が要らない問題）

「継続の的でもすでに上がれる」だけでは trivial にしない。
**継続の的で上がれ、かつノーテン・170 超えの判断が一切要らない**場合だけを trivial とする
（= 基礎確認カテゴリ）。304 のように「20 を続けても 164 で上がれる」問題も、
166 のようなノーテンを選べる以上は判断が要るので trivial ではない。

出題数の上限は 10 問で 2、30 問で 6。
CHECKOUT の 1 投上がりは 10 問で 1、30 問で 3。

**カテゴリ quota を優先**し、難易度が完全一致できない場合は
実際の分布を report に出します（`npm run audit:training`）。

---

## 6. 出題 sampler

`src/engine/training/sampling.ts`。random retry loop は使いません。

1. quota 計算（種別 / カテゴリ / 難易度 / 形式）
2. 各 bucket を seed 付き shuffle（cursor を進めて一巡させる）
3. review bag 生成（復習 bucket は「間違えた問題そのもの」を優先度順に並べる）
4. 直近履歴による除外
5. 候補選択
6. 足りないときだけ決定論的に条件を緩める

### anti-repeat

- 同じ `problemKey` は直近 5 問に出さない
- 同じ状況（開始残り・現在残り）は直近 3 問に出さない
- 直前とまったく同じ問題は、候補が 1 件しかない場合を除いて禁止
- MIXED の同じ種別は最大 2 連続
- HARD は 3 連続させない
- 10 問セッションの 1 問目は EASY か MEDIUM、最後の 2 問のどちらかは HARD

`problemKey` は index を含まない安定キーで、期待解答は含みません。

```
checkout|v2|left=103|darts=3
setup|v2|adjust|start=226|ctx=S20,S20|current=186|darts=1
setup|v2|full|start=265|darts=3
recovery|v2|start=122|intended=T18|actual=S18|current=104|darts=2
```

### 条件を緩める順序

```
trivial 上限 → 難易度 quota → 直近履歴の窓（5,3 → 5,1 → 5,0 → 3,0 → 1,0）
```

出題順の制約は bucket ごとに 1 度だけ外し、
bucket を広げる（= quota を崩す）のは最後の手段です。緩めた回数は report に出ます。

復習枠だけは例外で、難易度 quota と trivial 上限を見ません。
「その問題をもう一度出す」ための枠なので、難易度の合う別問題を先に選ぶと目的を果たせません。
直近履歴の除外（5 問 / 3 問）は復習枠でも外しません。

出題範囲が狭く、3 投フルを出せるカテゴリの枠が足りない場合は、
full を出せないカテゴリの枠を決定論的に譲って 80 / 20 を保ちます
（譲った件数は report の `quotaNormalizedCount` に出ます）。

### MIXED

独立した random ではなく mode bag を使います。

| | CHECKOUT | SETUP | RECOVERY |
| --- | ---: | ---: | ---: |
| 10 問 | 4 | 3 | 3 |
| 30 問 | 10 | 10 | 10 |

### 無限モード

10 問ずつ生成し、**前の chunk の末尾 5 問を次の chunk の直近履歴へ渡します**。
chunk 境界で anti-repeat をリセットしません。

---

## 7. feedback

どの問題でも、回答後に「何を答えればよかったか」が分かること。

表示順:

1. 判定
2. あなたの回答
3. あなたの回答の結果
4. おすすめ回答
5. おすすめ回答の結果
6. 違いの理由
7. 他の成立回答（必要な場合のみ）

**すべての不成立理由（EMPTY / TOO_MANY_DARTS / BUST / NOT_DOUBLE_FINISH /
TOTAL_MISMATCH / NOT_FINISHED / LEAVES_BOGEY / LEAVE_ABOVE_CHECKOUT_RANGE）で
推奨解答を返します。**

```
あなた:  S20 → 残り 166 — ノーテン（3 本あっても上がれません）
おすすめ: S19 → 残り 167 — 次のラウンドで上がれます
理由:    20 を狙うと 166 が残り、3 本あっても上がれません。最後だけ 19 へずらすと 167 が残ります。
```

RECOVERY の推奨は「現在の残り・本数に対する合法な best route」です。
ranking が空のときだけ PR #7 の `expectedRoute` へ落とします
（通常は発生しないことを監査で確認しています）。

---

## 8. 履歴 V2

`TrainingRecord` に `format` / `problemKey` / `difficulty` / `primaryCategory` /
`learningTags` / `startRemaining` / `currentRemaining` / `contextualThrows` /
`ruleValid` / `learningCorrect` / `failureCode` を持たせました。

### V1 からの移行

- V1 CHECKOUT / RECOVERY: `learningCorrect = valid`
- V1 SETUP: 保存済みの `remaining` / `answer` から残りを再計算し、
  上がれる残りなら true、Bogey / 170 超えなら false

### 再評価できない記録

**構造が壊れている、または情報不足で正しく再評価できない記録を
「不正解」として正答率へ混ぜてはいけません。**
そうした記録は統計から除外し、`migrationSkippedCount` として件数だけ残します。
ユーザーが間違えていないのに正答率が下がる設計にはしません。

---

## 9. 160 について

160 は良い残りのひとつです。しかし
**TRAINING は「160 を作るゲーム」ではありません。**

TRAINING の結果表示では、まず

- 次のラウンドで上がれるか
- Bogey か
- 170 超えか

を出します。Premium な残り（170 / 167 / 164 / 161 / 160）は二次情報です。

### 監査での 160 露出

`npm run audit:training` は、推奨解答が作る残りの分布を必ず出します。
**30% を超えても hard failure にはせず、WARNING として原因を分析します。**
「30% を超えた」という理由だけで 160 の問題を人工的に除外してはいけません。

v1.3 時点の測定値（各モード 10 万問）:

```
SETUP  : 160 = 33.9%   MIXED : 160 = 33.3%
```

原因の分析:

- 候補 pool 全体で推奨が 160 になるのは 24.3%。
- カテゴリ別では A（`setup-bogey-avoid`）が 75.0%、C（`setup-digits-0147`）が 63.4%。
- この 2 つは quota が大きい（30 問で 6 + 3 = 9 枠 = 30%）ため、
  セッション全体では約 32% が期待値になる。実測 33.9% はほぼこの期待値どおりで、
  **sampler が 160 を余計に引いているわけではない**。
- 根本の理由は承認済みの戦術方針にあります。`docs/APPROVALS.md` A-7 のとおり、
  160 は BULL を必要とせず D20 で終われるため、170（T20 → T20 → BULL）より上位に
  評価されます。`rankingRules.ts` / `PREMIUM_TENPAI_LEAVES` は
  **Human Approval Required** なので、TRAINING の都合で変更していません。

したがって v1.3 では sampler を調整せず、WARNING と本分析を残しています。
分布を変えたい場合は、カテゴリ quota（本設計 §4）か
承認済みの重み（`docs/APPROVALS.md`）のどちらを見直すかを、人間が決めてください。

---

## 10. 統計監査

10 万問規模の監査は通常の unit test に埋め込まず、専用スクリプトへ分離しています。

```bash
npm run audit:training              # 各モード 10 万問
npm run audit:training -- --per-mode 3000   # 手元で早く回す
```

hard acceptance（満たさなければ exit 1）:

- 直前とまったく同じ問題: 0
- 直近 5 問以内の同じ `problemKey`: 0
- 同じ問題の最大連続: 1
- MIXED の同じ種別の最大連続: 2
- RECOVERY の解なし: 0 / grader 不一致: 0
- NaN: 0 / undefined: 0
- 復習対象が 1 件だけでも、直前と同じ問題 0・3 連続 0

SETUP の 160 割合は hard failure ではなく WARNING + 分析です。
