# UI ガイドライン

> **ブランド前提**: Luxu's は「Minimal × Intellectual × Luxury」の3軸で定義される。
> UI判断に迷ったときは `docs/brand.md` を参照すること。
> アニメーションは最小限・滑らか、情報は必要な分だけ静かに表示、余白と統一感を重視する。

## 基本原則

- **ゲーム非依存**: `ui.js` は `config` と `GameAdapter` のみを参照。ゲーム固有コードを書かない。
- **XSS 対策**: 動的文字列は必ず `esc()` を通してから `innerHTML` に挿入。
- **グローバル変数禁止**: HTML の `onclick` から呼ぶ関数は `window.xxx` に明示的に公開する。
- **モバイルファースト**: ≤500px でも崩れないレイアウト。

---

## config による UI 分岐

### コミュニティカードエリア

```js
if (!config.hasCommunityCards) {
  document.getElementById('community-cards').classList.add('hidden');
  return;
}
```

### ホールカード枚数

```js
// バック表示（CPU プレイヤー）
const backs = '<span class="card hole bk"></span>'.repeat(config.numHoleCards);
```

### ベッティング構造

```js
if (config.bettingStructure === 'fixed-limit') {
  renderFixedLimitActions(el, adapter, validActions);
} else {
  renderNoLimitActions(el, adapter, validActions);
}
```

Fix Limit ではスライダーなし、固定額ボタンのみ。

### ドローフェーズ

```js
if (config.hasDrawPhase && adapter.state.startsWith('DRAW_')) {
  renderDrawPhaseActions(el);
  return;
}
```

---

## ドロー UI の操作フロー

```
1. adapter.state.startsWith('DRAW_') かつ currentPlayer.id === 0（人間プレイヤー）
2. renderDrawPhaseActions() でカード選択 UI を表示
3. カードをタップ → card.classList.toggle('draw-selected')
4. selectedForDraw を更新: adapter.selectCardsForDraw(0, indices)
5. 「Draw N」ボタン押下 → adapter.confirmDraw(0)
6. adapter 内部で次のプレイヤーへ進む
7. 次が CPU なら cpuDrawTurn() を呼ぶ
```

---

## CSS クラス一覧（追加分）

| クラス | 説明 |
|---|---|
| `.game-card` | タイトル画面のゲーム選択タイル |
| `.game-card.selected` | 選択中タイル |
| `.game-type-badge` | ゲームタイプバッジ（例: "Fix Limit / Draw"） |
| `.draw-zone` | ドロー UI ラッパー |
| `.draw-cards-row` | ドロー選択カード行 |
| `.card.draw-selected` | 廃棄選択中カード（ハイライト） |
| `.draw-btn` | Draw N / Stand Pat ボタン |
| `.badugi-indicator` | Badugi 有効枚数インジケーター行 |
| `.badugi-dot` | ● / ○ の各ドット |
| `.badugi-dot.active` | 有効カード（塗りつぶし） |
| `.fl-bet-btn` | Fix Limit 固定額ボタン |

---

## テーマシステム

`data-theme` 属性（`html` 要素）で CSS 変数を切り替え。

利用可能テーマ: `midnight` / `crimson` / `galaxy` / `obsidian` / `luxus`

背景デザイン: `data-bg` 属性で `default` / `stars` / `glow` / `velvet` / `nebula` を切り替え。

カードデザイン: `data-card` 属性で `blue` / `four-color` / `neon` / `minimal` / `luxus` / `red` を切り替え。

---

## ストリート / ドロー表示

`#street-display` 要素に現在のステートを表示。

| ステート | 表示テキスト |
|---|---|
| `WAITING` | `WAITING` |
| `PREFLOP` | `PRE FLOP` |
| `FLOP` | `FLOP` |
| `TURN` | `TURN` |
| `RIVER` | `RIVER` |
| `BETTING_1` | `BETTING 1` |
| `DRAW_1` | `Draw 1 / 3` |
| `DRAW_2` | `Draw 2 / 3` |
| `DRAW_3` | `Draw 3 / 3` |
| `SHOWDOWN` | `SHOWDOWN` |
| `COMPLETE` | `COMPLETE` |
