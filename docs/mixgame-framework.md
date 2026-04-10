# Luxus マルチゲームフレームワーク仕様

## GameAdapter インターフェース

すべてのゲームクラス（`NLHGame`, `TDGame`, `BadugiGame`）が実装すべきプロパティとメソッド。
`ui.js` はこのインターフェースのみを通じてゲームに触れる。

### ライフサイクル

| メソッド | 説明 |
|---|---|
| `startHand()` | `WAITING` → ゲーム開始（カード配布・ブラインド投稿） |
| `nextHand()` | `COMPLETE` → `WAITING`（ディーラーボタン進行） |

### アクション

| メソッド | 説明 |
|---|---|
| `getValidActions(playerId)` | 有効なアクション文字列の配列を返す |
| `performAction(playerId, action, amount)` | ゲーム状態を更新。不正なら例外 |

アクション文字列: `'fold' \| 'check' \| 'call' \| 'bet' \| 'raise' \| 'all_in'`

### ドローゲーム専用（NLH はスタブ）

| メソッド | 説明 |
|---|---|
| `selectCardsForDraw(playerId, indices)` | 廃棄カードのインデックスを選択 |
| `confirmDraw(playerId)` | 実際に引き直し、次のプレイヤーへ進む |

### 読み取り専用プロパティ

| プロパティ | 型 | 説明 |
|---|---|---|
| `state` | `string` | 現在のゲームステート |
| `players` | `Player[]` | 全プレイヤー |
| `pot` | `number` | ポット（整数 chips） |
| `currentBet` | `number` | 現ラウンドの最高ベット額 |
| `currentPlayerIndex` | `number` | 現在のアクションプレイヤー（-1 = なし） |
| `dealerIndex` | `number` | ディーラーボタン位置 |
| `actionLog` | `string[]` | アクション履歴 |
| `lastWinners` | `Player[]` | 前ハンドの勝者 |
| `lastPot` | `number` | 前ハンドのポット |
| `communityCards` | `Card[]` | コミュニティカード（ドローゲームは常に `[]`） |
| `drawRound` | `number` | 現在のドロー回数 1〜3（NLH は 0） |

### ヘルパーメソッド

| メソッド | 説明 |
|---|---|
| `getCurrentPlayer()` | `players[currentPlayerIndex]` を返す |
| `getSBIndex()` | SB プレイヤーインデックス |
| `getBBIndex()` | BB プレイヤーインデックス |

### NLH 専用プロパティ

| プロパティ | 説明 |
|---|---|
| `bigBlind` | BB 額 |
| `lastRaiseIncrement` | 最小レイズ増分（スライダー計算用） |

---

## Player オブジェクト

```js
{
  id:             number,   // 0 始まりの席番号
  name:           string,
  chips:          number,   // 現在チップ（整数）
  hand:           Card[],   // ホールカード
  folded:         boolean,
  currentBet:     number,   // 現ラウンドのベット額
  totalBet:       number,   // このハンドの総ベット額
  isAllIn:        boolean,
  hasActed:       boolean,
  handResult:     object | null,  // evaluateHand() の結果
  // ドローゲーム専用
  selectedForDraw: number[],  // 廃棄予定カードのインデックス
  hasDrawn:       boolean,
  drawCount:      number,     // 最後のドローで引いた枚数
}
```

---

## config オブジェクト

ゲームごとの `config.js` が `export default` する設定オブジェクト。

| プロパティ | 型 | 必須 | 説明 |
|---|---|---|---|
| `gameId` | `string` | ✅ | ゲーム識別子 |
| `displayName` | `string` | ✅ | 表示名 |
| `hasCommunityCards` | `boolean` | ✅ | コミュニティカードあり/なし |
| `hasDrawPhase` | `boolean` | ✅ | ドローフェーズあり/なし |
| `numHoleCards` | `number` | ✅ | ホールカード枚数 |
| `bettingStructure` | `string` | ✅ | `'no-limit'` or `'fixed-limit'` |
| `bigBlind` | `number` | ✅ | BB 額 |
| `smallBlind` | `number` | ✅ | SB 額 |
| `startingBBs` | `number` | ✅ | 開始チップ（BB 換算） |
| `smallBet` | `number` | FL のみ | Fix Limit 前半ベット額 |
| `bigBet` | `number` | FL のみ | Fix Limit 後半ベット額 |
| `maxRaisesPerRound` | `number` | FL のみ | 1 ラウンドの最大レイズ数 |

---

## 新しいゲームを追加する手順

1. `src/games/{id}/config.js` — config オブジェクトを作成
2. `src/games/{id}/evaluator.js` — `evaluateHand()` / `determineWinners()` を実装
3. `src/games/{id}/logic.js` — `NLHGame` か `DrawGame` を継承してクラスを作成
4. `src/games/{id}/cpu.js` — `decideCpuAction` / `decideCpuDraw`（ドローゲーム）を export
5. `main.js` の `GAME_REGISTRY` にエントリを追加
6. `style.css` に必要なスタイルを追記
7. `index.html` にゲーム選択タイルが自動生成される（JS が動的生成）
