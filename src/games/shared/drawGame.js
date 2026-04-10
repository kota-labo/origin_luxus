// DrawGame 共通基底クラス
// 2-7 Triple Draw / Badugi など、ドロー系ゲームの共通ロジックを担当。
// ステートマシン遷移・Fix Limit ベッティング・ドロー処理・ブラインド投稿を実装。
// サブクラスは evaluateHand() / determineWinners() のみ実装すればよい。
// CLAUDE.md準拠: チップは整数、crypto.getRandomValues() 使用、XSS対策不要（純ロジック）

import { createDeck, shuffleDeck } from '../../core/card.js';

export const DrawGameState = {
  WAITING:   'WAITING',
  DEAL:      'DEAL',
  BETTING_1: 'BETTING_1',
  DRAW_1:    'DRAW_1',
  BETTING_2: 'BETTING_2',
  DRAW_2:    'DRAW_2',
  BETTING_3: 'BETTING_3',
  DRAW_3:    'DRAW_3',
  BETTING_4: 'BETTING_4',
  SHOWDOWN:  'SHOWDOWN',
  COMPLETE:  'COMPLETE',
};

const VALID_TRANSITIONS = {
  WAITING:   ['DEAL'],
  DEAL:      ['BETTING_1'],
  BETTING_1: ['DRAW_1',    'SHOWDOWN'],
  DRAW_1:    ['BETTING_2'],
  BETTING_2: ['DRAW_2',    'SHOWDOWN'],
  DRAW_2:    ['BETTING_3'],
  BETTING_3: ['DRAW_3',    'SHOWDOWN'],
  DRAW_3:    ['BETTING_4'],
  BETTING_4: ['SHOWDOWN'],
  SHOWDOWN:  ['COMPLETE'],
  COMPLETE:  ['WAITING'],
};

export const DrawAction = {
  FOLD:   'fold',
  CHECK:  'check',
  CALL:   'call',
  BET:    'bet',
  RAISE:  'raise',
  ALL_IN: 'all_in',
};

export class DrawGame {
  constructor(playerNames, config) {
    this.config     = config;
    this.smallBlind = config.smallBlind;
    this.bigBlind   = config.bigBlind;

    const startingChips = (config.startingBBs || 100) * config.bigBlind;

    this.players = playerNames.map((name, i) => ({
      id:             i,
      name,
      chips:          startingChips,
      hand:           [],
      selectedForDraw: [],
      folded:         false,
      currentBet:     0,
      totalBet:       0,
      isAllIn:        false,
      hasActed:       false,
      hasDrawn:       false,
      hasDeclared:    false,
      drawCount:      0,
      handResult:     null,
    }));

    this.dealerIndex        = 0;
    this.state              = DrawGameState.WAITING;
    this.deck               = [];
    this.communityCards     = [];   // 常に [] — GameAdapter 準拠
    this.pot                = 0;
    this.currentBet         = 0;
    this.currentPlayerIndex = -1;
    this.raiseCount         = 0;   // 現ラウンドのベット/レイズ累計
    this.drawRound          = 0;   // 1〜3
    this.actionLog          = [];
    this.lastWinners        = [];
    this.lastPot            = 0;
    this.lastRaiseIncrement = config.bigBlind; // NLH互換プロパティ（UI参照用）
  }

  // ── 現ラウンドの固定ベット額 ──────────────────────────────
  get _roundBetSize() {
    return (['BETTING_3', 'BETTING_4'].includes(this.state))
      ? this.config.bigBet
      : this.config.smallBet;
  }

  // ── プレイヤーフィルタ ──────────────────────────────────
  get activePlayers() {
    return this.players.filter(p => !p.folded && p.chips > 0);
  }

  get activeInHandPlayers() {
    return this.players.filter(p => !p.folded);
  }

  // ── 状態遷移 ────────────────────────────────────────────
  transition(newState) {
    const valid = VALID_TRANSITIONS[this.state];
    if (!valid?.includes(newState)) {
      throw new Error(`不正な状態遷移: ${this.state} → ${newState}`);
    }
    this.state = newState;
  }

  // ── ライフサイクル ───────────────────────────────────────
  startHand() {
    this.transition(DrawGameState.DEAL);

    this.pot                = 0;
    this.currentBet         = 0;
    this.raiseCount         = 0;
    this.drawRound          = 0;
    this.actionLog          = [];
    this.lastWinners        = [];
    this.lastPot            = 0;

    for (const p of this.players) {
      p.hand            = [];
      p.selectedForDraw = [];
      p.folded          = false;
      p.currentBet      = 0;
      p.totalBet        = 0;
      p.isAllIn         = false;
      p.hasActed        = false;
      p.hasDrawn        = false;
      p.drawCount       = 0;
      p.handResult      = null;
    }

    // チップ切れはフォールド扱い
    for (const p of this.players) {
      if (p.chips <= 0) p.folded = true;
    }

    // カード配布
    this.deck = shuffleDeck(createDeck());
    const n = this.config.numHoleCards;
    for (const p of this.activePlayers) {
      p.hand = [];
      for (let i = 0; i < n; i++) p.hand.push(this.deck.pop());
    }

    // SB/BB インデックスをハンド開始時に確定（フォールドで動的変化しないよう固定）
    this.sbIndex = this.getSBIndex();
    this.bbIndex = this.getBBIndex();

    this._postBlinds();
    this.transition(DrawGameState.BETTING_1);

    // BETTING_1 の最初のアクションプレイヤー（BB の左）
    const bbIdx = this.getBBIndex();
    this.currentPlayerIndex = this._firstActiveAfter(bbIdx);

    this._log(`── Deal ──`);
  }

  nextHand() {
    this.transition(DrawGameState.WAITING);
    this.sbIndex = undefined;  // 次ハンドで再計算
    this.bbIndex = undefined;
    // バストしたプレイヤーを飛ばしてディーラーボタン進行
    const n = this.players.length;
    let next = (this.dealerIndex + 1) % n;
    for (let i = 0; i < n; i++) {
      if (this.players[next].chips > 0) { this.dealerIndex = next; return; }
      next = (next + 1) % n;
    }
  }

  // ── ブラインド ────────────────────────────────────────────
  _postBlinds() {
    const sbIdx = this.getSBIndex();
    const bbIdx = this.getBBIndex();
    const sb    = this.players[sbIdx];
    const bb    = this.players[bbIdx];

    const sbAmt = Math.min(this.smallBlind, sb.chips);
    const bbAmt = Math.min(this.bigBlind,   bb.chips);

    this._placeBet(sb, sbAmt);
    this._placeBet(bb, bbAmt);

    this.currentBet = bbAmt;
    this.raiseCount = 1; // BB を最初のベットとして計上

    this._log(`${sb.name}  posts SB  ${this._bb(sbAmt)} BB`);
    this._log(`${bb.name}  posts BB  ${this._bb(bbAmt)} BB`);
  }

  _placeBet(player, amount) {
    const actual = Math.min(amount, player.chips);
    player.chips      -= actual;
    player.currentBet += actual;
    player.totalBet   += actual;
    this.pot          += actual;
    if (player.chips === 0) player.isAllIn = true;
    return actual;
  }

  // ── SB / BB インデックス ────────────────────────────────
  getSBIndex() {
    // ハンド開始後は固定値を返す（フォールドによる動的変化を防ぐ）
    if (this.sbIndex !== undefined) return this.sbIndex;
    const active = this.players.filter(p => p.chips > 0);
    if (active.length <= 2) return this._firstActiveFrom(this.dealerIndex);
    return this._firstActiveFrom((this.dealerIndex + 1) % this.players.length);
  }

  getBBIndex() {
    if (this.bbIndex !== undefined) return this.bbIndex;
    return this._firstActiveFrom((this.getSBIndex() + 1) % this.players.length);
  }

  _firstActiveFrom(startIdx) {
    const n = this.players.length;
    for (let i = 0; i < n; i++) {
      const idx = (startIdx + i) % n;
      if (this.players[idx].chips > 0) return idx;
    }
    return startIdx;
  }

  _firstActiveAfter(startIdx) {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (startIdx + i) % n;
      const p   = this.players[idx];
      if (!p.folded && !p.isAllIn && p.chips > 0) return idx;
    }
    return -1;
  }

  _firstInHandAfter(startIdx) {
    // フォールドしていないプレイヤー（オールイン含む）
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (startIdx + i) % n;
      if (!this.players[idx].folded) return idx;
    }
    return -1;
  }

  // ── GameAdapter ヘルパー ─────────────────────────────────
  getCurrentPlayer() {
    if (this.currentPlayerIndex < 0) return null;
    return this.players[this.currentPlayerIndex];
  }

  // ── アクション ────────────────────────────────────────────
  // playerOrId: プレイヤーオブジェクト または 数値ID を受け付ける（UI/CPU 共用）
  getValidActions(playerOrId) {
    const player = (typeof playerOrId === 'number') ? this.players[playerOrId] : playerOrId;
    if (!player || player.folded || player.isAllIn || player.chips <= 0) return [];
    if (this.state.startsWith('DRAW_')) return []; // ドロー中は betting アクション不可

    const actions  = [DrawAction.FOLD];
    const toCall   = this.currentBet - player.currentBet;
    const betSize  = this._roundBetSize;
    const underCap = this.raiseCount < this.config.maxRaisesPerRound;

    if (toCall === 0) {
      actions.push(DrawAction.CHECK);
    } else if (player.chips >= toCall) {
      actions.push(DrawAction.CALL);
    }

    if (underCap) {
      if (toCall === 0 && player.chips >= betSize) {
        actions.push(DrawAction.BET);
      } else if (toCall > 0 && player.chips >= toCall + betSize) {
        actions.push(DrawAction.RAISE);
      }
    }

    actions.push(DrawAction.ALL_IN); // チップ不足時のフォールバック
    return actions;
  }

  performAction(playerId, action, _amount = 0) {
    if (playerId !== this.currentPlayerIndex) {
      throw new Error('このプレイヤーのターンではありません');
    }
    const player       = this.players[playerId];
    const validActions = this.getValidActions(playerId);
    if (!validActions.includes(action)) {
      throw new Error(`無効なアクション: ${action}`);
    }

    const toCall  = this.currentBet - player.currentBet;
    const betSize = this._roundBetSize;

    switch (action) {
      case DrawAction.FOLD:
        player.folded = true;
        this._log(`${player.name}  folds`);
        break;

      case DrawAction.CHECK:
        this._log(`${player.name}  checks`);
        break;

      case DrawAction.CALL:
        this._placeBet(player, toCall);
        this._log(`${player.name}  calls  ${this._bb(toCall)} BB`);
        break;

      case DrawAction.BET:
        this._placeBet(player, betSize);
        this.currentBet = player.currentBet;
        this.raiseCount++;
        this._resetHasActed(playerId);
        this._log(`${player.name}  bets  ${this._bb(betSize)} BB`);
        break;

      case DrawAction.RAISE: {
        const raiseAmt = toCall + betSize;
        this._placeBet(player, raiseAmt);
        this.currentBet = player.currentBet;
        this.raiseCount++;
        this._resetHasActed(playerId);
        this._log(`${player.name}  raises to  ${this._bb(player.currentBet)} BB`);
        break;
      }

      case DrawAction.ALL_IN: {
        const allIn = player.chips;
        this._placeBet(player, allIn);
        if (player.currentBet > this.currentBet) {
          this.currentBet = player.currentBet;
          this.raiseCount++;
          this._resetHasActed(playerId);
        }
        this._log(`${player.name}  ALL IN  ${this._bb(player.totalBet)} BB`);
        break;
      }
    }

    player.hasActed = true;

    if (this._checkHandEnd()) return;
    this._advanceToNextPlayer();
    if (this._isBettingRoundComplete()) this._advanceBettingRound();
  }

  _resetHasActed(exceptId) {
    for (const p of this.players) {
      if (p.id !== exceptId && !p.folded && !p.isAllIn) {
        p.hasActed = false;
      }
    }
  }

  _checkHandEnd() {
    const remaining = this.activeInHandPlayers;
    if (remaining.length === 1) {
      const winner     = remaining[0];
      this.lastPot     = this.pot;
      this.lastWinners = [winner];
      winner.chips    += this.pot;
      this._log(`${winner.name}  wins  ${this._bb(this.pot)} BB  (all others fold)`);
      this.pot = 0;
      // 中間ステートを飛ばして強制遷移
      this.state = DrawGameState.SHOWDOWN;
      this.state = DrawGameState.COMPLETE;
      return true;
    }
    return false;
  }

  _advanceToNextPlayer() {
    const n = this.players.length;
    let next     = (this.currentPlayerIndex + 1) % n;
    let attempts = 0;
    while (attempts < n) {
      const p = this.players[next];
      if (!p.folded && !p.isAllIn && p.chips > 0) {
        this.currentPlayerIndex = next;
        return;
      }
      next = (next + 1) % n;
      attempts++;
    }
    this.currentPlayerIndex = -1;
  }

  _isBettingRoundComplete() {
    const eligible = this.players.filter(p => !p.folded && !p.isAllIn);
    if (eligible.length === 0) return true;
    return eligible.every(p => p.hasActed && p.currentBet === this.currentBet);
  }

  _advanceBettingRound() {
    // ラウンド共通リセット
    for (const p of this.players) {
      p.currentBet = 0;
      p.hasActed   = false;
    }
    this.currentBet = 0;
    this.raiseCount = 0;

    const NEXT_STATE = {
      BETTING_1: DrawGameState.DRAW_1,
      BETTING_2: DrawGameState.DRAW_2,
      BETTING_3: DrawGameState.DRAW_3,
      BETTING_4: DrawGameState.SHOWDOWN,
    };

    const next = NEXT_STATE[this.state];
    this.transition(next);

    if (next === DrawGameState.SHOWDOWN) {
      this._runShowdown();
    } else {
      this._startDrawPhase();
    }
  }

  // ── ドローフェーズ ────────────────────────────────────────
  _startDrawPhase() {
    this.drawRound = parseInt(this.state.slice(-1), 10); // DRAW_2 → 2
    this._log(`── Draw ${this.drawRound} ──`);

    for (const p of this.activeInHandPlayers) {
      p.hasDrawn        = false;
      p.hasDeclared     = false;
      p.selectedForDraw = [];
      p.drawCount       = 0;
    }

    this.currentPlayerIndex = this._firstInHandAfter(this.dealerIndex);
  }

  selectCardsForDraw(playerId, indices) {
    const player = this.players[playerId];
    if (!player || player.folded) return;
    player.selectedForDraw = this._sanitizeIndices(indices, player.hand.length);
  }

  // 宣言フェーズ: カード交換なしで捨て牌を宣言し、次のプレイヤーへ進む
  declareDrawOnly(playerId, indices) {
    const player = this.players[playerId];
    if (!player || player.folded || player.hasDeclared) return;
    player.selectedForDraw = this._sanitizeIndices(indices, player.hand.length);
    player.drawCount = player.selectedForDraw.length; // 捨て枚数 = ドロー枚数
    player.hasDeclared = true;
    const label = player.drawCount === 0 ? 'stands pat' : `will draw ${player.drawCount}`;
    this._log(`${player.name}  ${label}`);
    this._advanceDeclarePlayer();
  }

  _advanceDeclarePlayer() {
    const n = this.players.length;
    let next = (this.currentPlayerIndex + 1) % n;
    let attempts = 0;
    while (attempts < n) {
      const p = this.players[next];
      if (!p.folded && !p.hasDeclared) {
        this.currentPlayerIndex = next;
        return;
      }
      next = (next + 1) % n;
      attempts++;
    }
    // 全員宣言完了 → 実行フェーズの先頭プレイヤーに戻す
    this.currentPlayerIndex = this._firstInHandAfter(this.dealerIndex);
  }

  get allDeclared() {
    return this.activeInHandPlayers.every(p => p.hasDeclared);
  }

  confirmDraw(playerId) {
    if (!this.state.startsWith('DRAW_')) return; // ドローフェーズ以外は無効
    const player = this.players[playerId];
    if (!player || player.folded || player.hasDrawn) return;

    const indices  = player.selectedForDraw || [];
    const numCards = this.config.numHoleCards;

    // 残すカード
    const kept     = player.hand.filter((_, i) => !indices.includes(i));
    const numToDraw = numCards - kept.length;
    player.drawCount = numToDraw;

    // 新しいカードを引く（isNew フラグでアニメーション制御）
    for (let i = 0; i < numToDraw; i++) {
      if (this.deck.length > 0) {
        const newCard = this.deck.pop();
        newCard.isNew      = true;
        newCard.newIndex   = i;  // スタガー遅延計算用
        kept.push(newCard);
      }
    }

    player.hand           = kept;
    player.selectedForDraw = [];
    player.hasDrawn       = true;
    player.handResult     = null; // 評価キャッシュをクリア

    const label = numToDraw === 0 ? 'stands pat' : `draws ${numToDraw}`;
    this._log(`${player.name}  ${label}`);

    this._advanceDrawPlayer();
  }

  _advanceDrawPlayer() {
    const n        = this.players.length;
    let next       = (this.currentPlayerIndex + 1) % n;
    let attempts   = 0;

    while (attempts < n) {
      const p = this.players[next];
      if (!p.folded && !p.hasDrawn) {
        this.currentPlayerIndex = next;
        return;
      }
      next = (next + 1) % n;
      attempts++;
    }

    // 全員がドローを完了 → 次のベッティングラウンドへ
    this.currentPlayerIndex = -1;
    this._afterDrawPhase();
  }

  _afterDrawPhase() {
    const NEXT_BETTING = {
      DRAW_1: DrawGameState.BETTING_2,
      DRAW_2: DrawGameState.BETTING_3,
      DRAW_3: DrawGameState.BETTING_4,
    };

    const next = NEXT_BETTING[this.state];
    this.transition(next);

    // ラウンドリセット
    for (const p of this.players) {
      p.currentBet = 0;
      p.hasActed   = false;
    }
    this.currentBet = 0;
    this.raiseCount = 0;

    // 次のアクション開始: ディーラーの左
    this.currentPlayerIndex = this._firstActiveAfter(this.dealerIndex);
    this._log(`── Betting ${next.slice(-1)} ──`);
  }

  // ── ショーダウン ──────────────────────────────────────────
  _runShowdown() {
    const contenders = this.activeInHandPlayers;

    for (const p of contenders) {
      p.handResult = this.evaluateHand(p.hand);
    }

    const winners = this.determineWinners(contenders);
    // 勝者なし（evaluateHand 異常）の場合はポットを失わないよう安全に終了
    if (winners.length === 0) {
      this.pot = 0;
      this.transition(DrawGameState.COMPLETE);
      return;
    }

    this.lastPot     = this.pot;
    this.lastWinners = winners;

    const share     = Math.floor(this.pot / winners.length);
    let   remainder = this.pot - share * winners.length;

    for (const w of winners) {
      let winAmt = share;
      if (remainder > 0) { winAmt++; remainder--; }
      w.chips += winAmt;
    }

    if (winners.length === 1) {
      this._log(`${winners[0].name}  wins  ${this._bb(this.pot)} BB`);
    } else {
      this._log(`Split pot — ${winners.map(w => w.name).join(' & ')}`);
    }

    this.pot = 0;
    this.transition(DrawGameState.COMPLETE);
  }

  // ── 入力サニタイズ ────────────────────────────────────────
  // 廃棄インデックス配列を検証: 整数・範囲内・重複なし のみ通す
  _sanitizeIndices(indices, handLen) {
    if (!Array.isArray(indices)) return [];
    const seen = new Set();
    return indices.filter(i =>
      Number.isInteger(i) && i >= 0 && i < handLen && !seen.has(i) && seen.add(i)
    );
  }

  // ── サブクラス必須オーバーライド ──────────────────────────
  // eslint-disable-next-line no-unused-vars
  evaluateHand(_cards) {
    throw new Error(`${this.config.gameId}: evaluateHand() が未実装`);
  }

  // eslint-disable-next-line no-unused-vars
  determineWinners(_players) {
    throw new Error(`${this.config.gameId}: determineWinners() が未実装`);
  }

  // ── ユーティリティ ────────────────────────────────────────
  // 公開ログメソッド（UI が adapter.addLog() で呼び出す）
  addLog(msg) {
    this.actionLog.push(msg);
  }

  _bb(chips) {
    const v = chips / this.bigBlind;
    return Number.isInteger(v) ? `${v}` : v.toFixed(1);
  }

  _log(msg) {
    this.actionLog.push(msg);
  }
}
