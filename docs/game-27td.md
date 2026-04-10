# 2-7 Triple Draw 仕様

## 概要

| 項目 | 内容 |
|---|---|
| ゲームタイプ | Lowball / Draw |
| ホールカード | 5 枚 |
| コミュニティカード | なし |
| ドローフェーズ | 3 回 |
| ベッティング | Fix Limit |
| プレイ人数 | 2〜6 人 |

---

## ステートマシン

```
WAITING → DEAL → BETTING_1 → DRAW_1 → BETTING_2 → DRAW_2
                            → BETTING_3 → DRAW_3 → BETTING_4 → SHOWDOWN → COMPLETE
```

いずれかの BETTING ステートで全員フォールドの場合:
```
BETTING_N → SHOWDOWN → COMPLETE
```

---

## Fix Limit ベッティング構造

| ラウンド | ベット額 | 最大レイズ |
|---|---|---|
| BETTING_1 | smallBet = 10 | 4 回 |
| BETTING_2 | smallBet = 10 | 4 回 |
| BETTING_3 | bigBet = 20 | 4 回 |
| BETTING_4 | bigBet = 20 | 4 回 |

アクション: `fold / check / call / bet / raise` (スライダーなし)

---

## ハンド評価ルール

**目標**: 最も弱い（低い）ハンドを作る。

### A の扱い
**A はハイカード**（最強 = 不利）。ランク順: `2 < 3 < ... < K < A`

### バスト（強い役 = 負け扱い）
- ペア・トリップス・フォーカインド
- ストレート
- フラッシュ

バストハンドのスコアは `[999]`（最弱扱い）。

### 正常ローハンドの比較
降順ランク配列で辞書順比較。値が小さいほど強い。

```
7-5-4-3-2 → [7,5,4,3,2]  ← 最強
8-5-4-3-2 → [8,5,4,3,2]  ← 2番手
A-K-Q-J-9 → [14,13,12,11,9] ← 非常に弱い
A♠A♥Q♦J♣9♦ → [999]  ← バスト（ペア）
```

---

## ドローフェーズ

1. 捨てるカードをタップ/クリックで選択（`selectedForDraw` に保存）
2. 「Draw N」ボタンを押して確定 → `confirmDraw()` 呼び出し
3. 0 枚選択 = スタンドパット（1 枚も交換しない）
4. ドロー回数カウンター: 画面に `1/3`, `2/3`, `3/3` 表示

---

## CPU ロジック（中級）

### decideCpuAction
- ポットオッズ計算
- バストなし かつ トップカード ≤ 7 → アグレッシブ（ベット/レイズ）
- トップカード ≤ 9 → ポットオッズ次第でコール
- バスト → フォールド傾向

### decideCpuDraw
廃棄優先度:
1. 8 以上のカード（A=14 含む）
2. ペアの重複カード（1 枚残す）
3. フラッシュの重複スーツ（最高ランクを廃棄）
4. ストレートの端カード（最高ランクを廃棄）
5. 廃棄が 4 枚以上になる場合: ランクの低い 2 枚を保持

---

## 設定（`src/games/27td/config.js`）

```js
{
  gameId: '27td',
  bettingStructure: 'fixed-limit',
  smallBet: 10,
  bigBet: 20,
  maxRaisesPerRound: 4,
  bigBlind: 10,
  smallBlind: 5,
  startingBBs: 100,
  numHoleCards: 5,
  hasCommunityCards: false,
  hasDrawPhase: true,
  aceIsLow: false,
}
```
