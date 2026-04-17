# No Limit Hold'em 仕様

## 概要

| 項目 | 内容 |
|---|---|
| ゲームタイプ | No Limit / Hold'em |
| ホールカード | 2 枚 |
| コミュニティカード | あり（5 枚: Flop 3 + Turn 1 + River 1） |
| ドローフェーズ | なし |
| ベッティング | No Limit（最小レイズ制約あり） |
| プレイ人数 | 2〜6 人（1 人 vs CPU 最大 5 体） |

---

## ステートマシン

```
WAITING → PREFLOP → FLOP → TURN → RIVER → SHOWDOWN → COMPLETE
                         ↘ (全員フォールド) → SHOWDOWN → COMPLETE
```

| ステート | 説明 |
|---|---|
| `WAITING` | ゲーム開始待ち |
| `PREFLOP` | ホールカード配布後、最初のベットラウンド |
| `FLOP` | コミュニティカード 3 枚公開 |
| `TURN` | コミュニティカード 4 枚目公開 |
| `RIVER` | コミュニティカード 5 枚目公開 |
| `SHOWDOWN` | 手札開示・勝者決定 |
| `COMPLETE` | ハンド終了（`nextHand()` 待ち） |

---

## ベッティング構造

- **No Limit**: ベット額はチップ残高の範囲内で自由
- 最小レイズ = 直前のレイズ増分以上
- `lastRaiseIncrement` で追跡
- スライダー UI で任意の額を選択可能

---

## ブラインド / アクション順

- PREFLOP: SB → BB → UTG（BB の左） → ... （BB が最後）
- FLOP/TURN/RIVER: ディーラーの左から時計回り
- ヘッズアップ: ディーラー = SB、相手 = BB

---

## ハンド評価

ファイル: `src/games/nlh/evaluator.js`

7 枚（ホール 2 + コミュニティ 5）から最強 5 枚を選択。

| ランク | ハンド名 |
|---|---|
| 9 | Royal Flush |
| 8 | Straight Flush |
| 7 | Four of a Kind |
| 6 | Full House |
| 5 | Flush |
| 4 | Straight |
| 3 | Three of a Kind |
| 2 | Two Pair |
| 1 | Pair |
| 0 | High Card |

---

## CPU ロジック（`src/games/nlh/cpu.js`）

中級レベル。`decideCpuAction(adapter)` を export。

- ポットオッズ計算
- ハンド強度（evaluateHand の rank）に基づくアグレッション
- ポットオッズ > 40%: フォールド傾向
- ポットオッズ < 20%: コール/レイズ傾向
- `crypto.getRandomValues()` でランダム性を付与

---

## 設定（`src/games/nlh/config.js`）

```js
{
  gameId: 'nlh',
  bettingStructure: 'no-limit',
  bigBlind: 10,
  smallBlind: 5,
  startingBBs: 100,   // 1000 chips でスタート
  numHoleCards: 2,
  hasCommunityCards: true,
  hasDrawPhase: false,
}
```
