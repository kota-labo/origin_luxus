# Luxus Poker Platform — アーキテクチャ概要

## 設計思想

「ゲームロジックだけ差し替えられる」マルチゲームポーカープラットフォーム。
UI は一切ゲームを知らず、**GameAdapter インターフェース**を通じてのみゲームと対話する。

---

## ディレクトリ構成

```
Luxus/
├── index.html              タイトル画面 + ゲーム画面
├── main.js                 エントリポイント: ゲーム選択 → 動的インポート → UI起動
├── style.css               全スタイル（テーマ・カード・ドローUI 含む）
├── vite.config.js
├── package.json
├── src/
│   ├── core/
│   │   └── card.js         デッキ生成・シャッフル（crypto.getRandomValues）
│   ├── ui/
│   │   ├── ui.js           ゲーム非依存 UI レンダラー（initUI 関数）
│   │   └── components.js   cardHtml / esc / bb など純粋 DOM ヘルパー
│   ├── games/
│   │   ├── shared/
│   │   │   └── drawGame.js DrawGame 基底クラス
│   │   ├── nlh/            No Limit Hold'em
│   │   ├── 27td/           2-7 Triple Draw
│   │   └── badugi/         Badugi
│   ├── modes/
│   │   └── singleplayer.js CPU 対戦モード起動
│   └── state/
│       └── store.js        軽量リアクティブストア
└── docs/                   本ドキュメント群
```

---

## データフロー

```
index.html
  └─ main.js (ES module)
        │  DOMContentLoaded → buildGameSelector() / wirePlayerCountButtons()
        │  PLAY ボタン → launchGame()
        │
        ├─ 動的 import: games/{id}/logic.js    → LogicClass
        ├─ 動的 import: games/{id}/cpu.js      → decideCpuAction / decideCpuDraw
        └─ 動的 import: games/{id}/config.js   → config
              │
              └─ new LogicClass(names, config)  → gameAdapter
                    │
                    └─ startSingleplayer(gameAdapter, config, cpuFns, callbacks)
                          │
                          └─ initUI(gameAdapter, config, decideCpu, opts)
                                │
                                ├─ renderPlayers()     ← adapter.players
                                ├─ renderCommunityCards() ← config.hasCommunityCards
                                ├─ renderActions()     ← adapter.getValidActions()
                                ├─ performAction()     ← adapter.performAction()
                                └─ cpuTurn() / cpuDrawTurn()
```

---

## 依存関係の方向

```
index.html ──► main.js
main.js    ──► games/*/logic.js  (動的)
main.js    ──► games/*/cpu.js    (動的)
main.js    ──► games/*/config.js (動的)
main.js    ──► modes/singleplayer.js
ui.js      ──► ui/components.js
games/27td/logic.js   ──► games/shared/drawGame.js
games/badugi/logic.js ──► games/shared/drawGame.js
games/shared/drawGame.js ──► core/card.js
games/nlh/logic.js    ──► core/card.js
games/nlh/logic.js    ──► games/nlh/evaluator.js
```

循環依存なし。

---

## 制約（CLAUDE.md より）

| 制約 | 理由 |
|---|---|
| `Math.random()` 禁止 | `crypto.getRandomValues()` のみ使用 |
| チップは小数1桁まで可 | 最小単位 = 0.1 BB 相当。内部計算後は `Math.round(x * 10) / 10` で丸める。表示は `toFixed(1)` を基本、整数なら小数点なしで描画 |
| XSS 対策: `esc()` | 動的文字列を `innerHTML` に挿入する前に必ず通す |
| グローバル変数禁止 | モジュール間通信はすべて import/export |
| CSP: `default-src 'none'` | index.html にメタタグを維持 |
