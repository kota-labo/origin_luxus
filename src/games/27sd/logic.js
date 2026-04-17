// No Limit 2-7 Single Draw (NL27SD) — ゲームエンジン
// CLAUDE.md準拠: チップは小数1桁まで (0.1単位)、状態遷移は厳密管理
// GameAdapter インターフェース準拠
//
// 構造:
//   - DrawGame のドロー機構 (selectCardsForDraw / confirmDraw / _startDrawPhase) を移植
//   - NLH の No Limit ベッティング (amount 駆動 BET/RAISE, minRaise 管理) を移植
//   - ステートマシンは 1 ドロー版に簡略化: BETTING_1 → DRAW_1 → BETTING_2 → SHOWDOWN
//   - 評価器は 2-7 Triple Draw のローボール判定をそのまま流用

import { createDeck, shuffleDeck } from '../../core/card.js';
import { evaluate27td, determineWinners27td } from '../27td/evaluator.js';

export const GameState = {
  WAITING:   'WAITING',
  DEAL:      'DEAL',
  BETTING_1: 'BETTING_1',   // predraw
  DRAW_1:    'DRAW_1',       // 単一ドロー
  BETTING_2: 'BETTING_2',   // postdraw
  SHOWDOWN:  'SHOWDOWN',
  COMPLETE:  'COMPLETE',
};

const VALID_TRANSITIONS = {
  WAITING:   ['DEAL'],
  DEAL:      ['BETTING_1'],
  BETTING_1: ['DRAW_1', 'SHOWDOWN'],  // 全員フォールドで SHOWDOWN 直行
  DRAW_1:    ['BETTING_2'],
  BETTING_2: ['SHOWDOWN'],
  SHOWDOWN:  ['COMPLETE'],
  COMPLETE:  ['WAITING'],
};

export const Action = {
  FOLD:   'fold',
  CHECK:  'check',
  CALL:   'call',
  BET:    'bet',
  RAISE:  'raise',
  ALL_IN: 'all_in',
};

export class SDGame {
  constructor(playerNames, config) {
    this.config     = config;
    this.smallBlind = config.smallBlind;
    this.bigBlind   = config.bigBlind;

    const startingChips = (config.startingBBs || 100) * config.bigBlind;

    this.players = playerNames.map((name, i) => ({
      id:              i,
      name,
      chips:           startingChips,
      hand:            [],
      selectedForDraw: [],
      folded:          false,
      currentBet:      0,
      totalBet:        0,
      isAllIn:         false,
      hasActed:        false,
      hasDrawn:        false,
      hasDeclared:     false,
      drawCount:       0,
      handResult:      null,
    }));

    this.dealerIndex        = 0;
    this.state              = GameState.WAITING;
    this.deck               = [];
    this.communityCards     = [];   // 常に [] (GameAdapter 準拠)
    this.pot                = 0;
    this.currentBet         = 0;
    this.currentPlayerIndex = -1;
    this.lastRaiserIndex    = -1;
    this.lastRaiseIncrement = this.bigBlind;
    this.drawRound          = 0;
    this.actionLog          = [];
    this.lastWinners        = [];
    this.lastPot            = 0;
  }

  // DrawGame との互換用 (UI 側が adapter._roundBetSize を参照するケース)
  get _roundBetSize() { return this.bigBlind; }

  get activePlayers()        { return this.players.filter(p => !p.folded && p.chips > 0); }
  get activeInHandPlayers()  { return this.players.filter(p => !p.folded); }

  transition(newState) {
    const valid = VALID_TRANSITIONS[this.state];
    if (!valid?.includes(newState)) {
      throw new Error(`不正な状態遷移: ${this.state} → ${newState}`);
    }
    this.state = newState;
  }

  _forceComplete() {
    this.state = GameState.SHOWDOWN;
    this.state = GameState.COMPLETE;
  }

  // ── ライフサイクル ──
  startHand() {
    this.transition(GameState.DEAL);

    this.pot                = 0;
    this.currentBet         = 0;
    this.lastRaiseIncrement = this.bigBlind;
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
      p.hasDeclared     = false;
      p.drawCount       = 0;
      p.handResult      = null;
    }

    for (const p of this.players) {
      if (p.chips <= 0) p.folded = true;
    }

    // カード配布 (5 枚)
    this.deck = shuffleDeck(createDeck());
    const n = this.config.numHoleCards;
    for (const p of this.activePlayers) {
      p.hand = [];
      for (let i = 0; i < n; i++) p.hand.push(this.deck.pop());
    }

    // SB/BB インデックス確定
    this.sbIndex = this.getSBIndex();
    this.bbIndex = this.getBBIndex();

    this._postBlinds();
    this.transition(GameState.BETTING_1);

    // BETTING_1 の最初のアクションプレイヤー = BB の左
    const bbIdx = this.getBBIndex();
    this.currentPlayerIndex = this._firstActiveAfter(bbIdx);
    this.lastRaiserIndex    = bbIdx;

    this._log(`-- Deal --`);
  }

  nextHand() {
    this.transition(GameState.WAITING);
    this.sbIndex = undefined;
    this.bbIndex = undefined;
    const n = this.players.length;
    let next = (this.dealerIndex + 1) % n;
    for (let i = 0; i < n; i++) {
      if (this.players[next].chips > 0) { this.dealerIndex = next; return; }
      next = (next + 1) % n;
    }
  }

  // ── ブラインド ──
  _postBlinds() {
    const sbIdx = this.getSBIndex();
    const bbIdx = this.getBBIndex();
    const sb    = this.players[sbIdx];
    const bb    = this.players[bbIdx];

    const sbAmt = Math.min(this.smallBlind, sb.chips);
    const bbAmt = Math.min(this.bigBlind,   bb.chips);

    this._placeBet(sb, sbAmt);
    this._placeBet(bb, bbAmt);

    this.currentBet         = bbAmt;
    this.lastRaiseIncrement = this.bigBlind;

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

  // ── SB/BB インデックス ──
  getSBIndex() {
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
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (startIdx + i) % n;
      if (!this.players[idx].folded) return idx;
    }
    return -1;
  }

  getCurrentPlayer() {
    if (this.currentPlayerIndex < 0) return null;
    return this.players[this.currentPlayerIndex];
  }

  // ══════════════════════════════════════════════
  // No Limit ベッティング (NLH から移植)
  // ══════════════════════════════════════════════
  getValidActions(playerOrId) {
    const player = (typeof playerOrId === 'number') ? this.players[playerOrId] : playerOrId;
    if (!player || player.folded || player.isAllIn || player.chips <= 0) return [];
    if (this.state.startsWith('DRAW_')) return [];  // ドロー中は betting 不可

    const actions = [Action.FOLD];
    const toCall  = this.currentBet - player.currentBet;

    if (toCall === 0) {
      actions.push(Action.CHECK);
    } else {
      actions.push(Action.CALL);   // chips < toCall でもオールインコール可
    }

    if (player.chips > toCall) {
      actions.push(toCall === 0 ? Action.BET : Action.RAISE);
      actions.push(Action.ALL_IN);
    }
    return actions;
  }

  performAction(playerId, action, amount = 0) {
    if (playerId !== this.currentPlayerIndex) {
      throw new Error('このプレイヤーのターンではありません');
    }
    const player       = this.players[playerId];
    const validActions = this.getValidActions(playerId);
    if (!validActions.includes(action)) {
      throw new Error(`無効なアクション: ${action}`);
    }

    amount = Number.isFinite(amount) ? Math.floor(Math.max(0, amount)) : 0;
    const toCall = this.currentBet - player.currentBet;

    switch (action) {
      case Action.FOLD:
        player.folded = true;
        this._log(`${player.name}  folds`);
        break;

      case Action.CHECK:
        this._log(`${player.name}  checks`);
        break;

      case Action.CALL: {
        const callAmt = Math.min(toCall, player.chips);
        this._placeBet(player, callAmt);
        const label = callAmt < toCall
          ? `calls ${this._bb(callAmt)} BB (all-in)`
          : `calls  ${this._bb(callAmt)} BB`;
        this._log(`${player.name}  ${label}`);
        break;
      }

      case Action.BET: {
        const betAmount = Math.max(this.bigBlind, Math.floor(amount));
        this._placeBet(player, betAmount);
        this.lastRaiseIncrement = player.currentBet;
        this.currentBet         = player.currentBet;
        this.lastRaiserIndex    = playerId;
        this._resetHasActed(playerId);
        this._log(`${player.name}  bets  ${this._bb(betAmount)} BB`);
        break;
      }

      case Action.RAISE: {
        const prevTableBet  = this.currentBet;
        const minRaiseChips = (prevTableBet + this.lastRaiseIncrement) - player.currentBet;
        const raiseTotal    = Math.max(minRaiseChips, Math.floor(amount) + toCall);
        this._placeBet(player, raiseTotal);
        this.lastRaiseIncrement = player.currentBet - prevTableBet;
        this.currentBet         = player.currentBet;
        this.lastRaiserIndex    = playerId;
        this._resetHasActed(playerId);
        this._log(`${player.name}  raises to  ${this._bb(player.currentBet)} BB`);
        break;
      }

      case Action.ALL_IN: {
        const allInAmount = player.chips;
        this._placeBet(player, allInAmount);
        if (player.currentBet > this.currentBet) {
          this.currentBet      = player.currentBet;
          this.lastRaiserIndex = playerId;
          this._resetHasActed(playerId);
        }
        this._log(`${player.name}  ALL IN  ${this._bb(allInAmount)} BB`);
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
      this._forceComplete();
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

  // ══════════════════════════════════════════════
  // ベッティングラウンド進行 — 1 ドロー版簡略ステートマシン
  // ══════════════════════════════════════════════
  _advanceBettingRound() {
    // ラウンドリセット
    for (const p of this.players) {
      p.currentBet = 0;
      p.hasActed   = false;
    }
    this.currentBet         = 0;
    this.lastRaiseIncrement = this.bigBlind;

    // BETTING_1 → DRAW_1 / BETTING_2 → SHOWDOWN
    const NEXT = {
      [GameState.BETTING_1]: GameState.DRAW_1,
      [GameState.BETTING_2]: GameState.SHOWDOWN,
    };
    const next = NEXT[this.state];
    this.transition(next);

    if (next === GameState.SHOWDOWN) {
      this._runShowdown();
    } else {
      this._startDrawPhase();
    }
  }

  // ══════════════════════════════════════════════
  // ドローフェーズ (DrawGame から移植、単一ドロー)
  // ══════════════════════════════════════════════
  _startDrawPhase() {
    this.drawRound = 1;
    this._log(`-- Draw 1 --`);

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

  // 宣言フェーズ: カード交換なしで捨て牌を宣言
  declareDrawOnly(playerId, indices) {
    const player = this.players[playerId];
    if (!player || player.folded || player.hasDeclared) return;
    player.selectedForDraw = this._sanitizeIndices(indices, player.hand.length);
    player.drawCount  = player.selectedForDraw.length;
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
    // 全員宣言済 → 実行フェーズ先頭プレイヤーに戻す
    this.currentPlayerIndex = this._firstInHandAfter(this.dealerIndex);
  }

  get allDeclared() {
    return this.activeInHandPlayers.every(p => p.hasDeclared);
  }

  confirmDraw(playerId) {
    if (!this.state.startsWith('DRAW_')) return;
    const player = this.players[playerId];
    if (!player || player.folded || player.hasDrawn) return;

    const indices  = player.selectedForDraw || [];
    const numCards = this.config.numHoleCards;

    const kept      = player.hand.filter((_, i) => !indices.includes(i));
    const numToDraw = numCards - kept.length;
    player.drawCount = numToDraw;

    for (let i = 0; i < numToDraw; i++) {
      if (this.deck.length > 0) {
        const newCard = this.deck.pop();
        newCard.isNew    = true;
        newCard.newIndex = i;
        kept.push(newCard);
      }
    }

    player.hand            = kept;
    player.selectedForDraw = [];
    player.hasDrawn        = true;
    player.handResult      = null;  // 評価キャッシュクリア

    const label = numToDraw === 0 ? 'stands pat' : `draws ${numToDraw}`;
    this._log(`${player.name}  ${label}`);

    this._advanceDrawPlayer();
  }

  _advanceDrawPlayer() {
    const n = this.players.length;
    let next = (this.currentPlayerIndex + 1) % n;
    let attempts = 0;

    while (attempts < n) {
      const p = this.players[next];
      if (!p.folded && !p.hasDrawn) {
        this.currentPlayerIndex = next;
        return;
      }
      next = (next + 1) % n;
      attempts++;
    }

    // 全員ドロー完了 → BETTING_2 へ
    this.currentPlayerIndex = -1;
    this._afterDrawPhase();
  }

  _afterDrawPhase() {
    this.transition(GameState.BETTING_2);

    for (const p of this.players) {
      p.currentBet = 0;
      p.hasActed   = false;
    }
    this.currentBet         = 0;
    this.lastRaiseIncrement = this.bigBlind;

    this.currentPlayerIndex = this._firstActiveAfter(this.dealerIndex);
    this._log(`-- Betting 2 --`);
  }

  // ══════════════════════════════════════════════
  // ショーダウン — 2-7 ローボール単一勝者判定
  // ══════════════════════════════════════════════
  _runShowdown() {
    const contenders = this.activeInHandPlayers;
    for (const p of contenders) {
      p.handResult = evaluate27td(p.hand);
    }

    const winners = determineWinners27td(contenders);
    if (winners.length === 0) {
      this.pot = 0;
      this.transition(GameState.COMPLETE);
      return;
    }

    this.lastPot     = this.pot;
    this.lastWinners = winners;

    const share   = Math.floor(this.pot / winners.length);
    let remainder = this.pot - share * winners.length;

    for (const w of winners) {
      let winAmt = share;
      if (remainder > 0) { winAmt++; remainder--; }
      w.chips += winAmt;
    }

    if (winners.length === 1) {
      this._log(`${winners[0].name}  wins  ${this._bb(this.pot)} BB  with  ${winners[0].handResult.name}`);
    } else {
      this._log(`Split pot — ${winners.map(w => w.name).join(' & ')}  (${winners[0].handResult.name})`);
    }

    this.pot = 0;
    this.transition(GameState.COMPLETE);
  }

  evaluateCurrentHand(playerId) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.hand || p.hand.length !== this.config.numHoleCards) return null;
    try { return evaluate27td(p.hand); } catch(e) { return null; }
  }

  // ── 入力サニタイズ ──
  _sanitizeIndices(indices, handLen) {
    if (!Array.isArray(indices)) return [];
    const seen = new Set();
    return indices.filter(i =>
      Number.isInteger(i) && i >= 0 && i < handLen && !seen.has(i) && seen.add(i)
    );
  }

  // ── ユーティリティ ──
  _bb(chips) {
    const v = chips / this.bigBlind;
    if (Number.isInteger(v)) return `${v}`;
    const s1 = v.toFixed(1);
    if (parseFloat(s1) === v) return s1;
    return parseFloat(v.toFixed(2)).toString();
  }

  addLog(msg) { this.actionLog.push(msg); }
  _log(msg)   { this.actionLog.push(msg); }
}
