# Badugi 仕様

## 概要

| 項目 | 内容 |
|---|---|
| ゲームタイプ | Lowball / Draw |
| ホールカード | 4 枚 |
| コミュニティカード | なし |
| ドローフェーズ | 3 回 |
| ベッティング | Fix Limit |
| プレイ人数 | 2〜6 人 |

---

## ステートマシン

2-7 Triple Draw と同一構造。

```
WAITING → DEAL → BETTING_1 → DRAW_1 → BETTING_2 → DRAW_2
                            → BETTING_3 → DRAW_3 → BETTING_4 → SHOWDOWN → COMPLETE
```

---

## Fix Limit ベッティング構造

2-7 Triple Draw と同一（`smallBet=10`, `bigBet=20`, 最大 4 レイズ）。

---

## ハンド評価ルール

### Badugi（有効カード）の定義
4 枚の手札から「スートが全て異なる かつ ランクが全て異なる」カードの最大部分集合。

### A の扱い
**A はローカード**（最弱 = 最良）。ランク: A=1 < 2 < 3 < ... < K=13

### 強さの決定
1. **有効枚数が多いほど強い**: 4-Badugi > 3-Badugi > 2-Badugi > 1-Badugi
2. **同枚数内**: 有効カードのランク降順配列で辞書順比較（低いほど強い）

### 例

```
A♣-2♦-3♥-4♠ → 4-Badugi [4,3,2,A]  ← 最強（最小 4-Badugi）
A♣-4♣-7♥-J♠ → ♣重複 → 3-Badugi: [A,7,J] → score=-3,[11,7,1]
A♣-4♦-4♥-J♠ → 4ランク重複 → 3-Badugi: [A,4,J] → score=-3,[11,4,1]
A♣-A♦-4♣-4♦ → スート/ランク全重複 → 1-Badugi: [A] → score=-1,[1]
```

---

## 有効枚数インジケーター

UI にプレイヤーの Badugi 枚数を `●●●○`（3/4 の場合）で表示。
`adapter.evaluateHand(player.hand).size` から取得。

---

## ドローフェーズ

2-7 Triple Draw と同一 UI。タップ選択 → Draw N ボタン。

---

## CPU ロジック（中級）

### decideCpuAction
- 有効枚数 4: アグレッシブ（ベット/レイズ高頻度）
- 有効枚数 3: 中程度のアグレッション
- 有効枚数 2: ポットオッズ < 30% でコール
- 有効枚数 1: フォールド傾向

### decideCpuDraw
- `bestBadugiHand()` で有効部分集合を正確に計算
- 有効集合に含まれないカードを廃棄
- 高ランクカードを優先廃棄（有効集合内でも最高ランクを交換候補にする）

---

## 設定（`src/games/badugi/config.js`）

```js
{
  gameId: 'badugi',
  bettingStructure: 'fixed-limit',
  smallBet: 10,
  bigBet: 20,
  maxRaisesPerRound: 4,
  bigBlind: 10,
  smallBlind: 5,
  startingBBs: 100,
  numHoleCards: 4,
  hasCommunityCards: false,
  hasDrawPhase: true,
  aceIsLow: true,
}
```
