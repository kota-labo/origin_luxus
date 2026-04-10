// NLH ゲームエンジン — 有限ステートマシンでゲーム状態を管理
// CLAUDE.md準拠: チップは整数、状態遷移は厳密管理
// GameAdapter インターフェース準拠

import { createDeck, shuffleDeck } from '../../core/card.js';
import { evaluateHand, determineWinners } from './evaluator.js';

export const GameState = {
  WAITING:  'WAITING',
  PREFLOP:  'PREFLOP',
  FLOP:     'FLOP',
  TURN:     'TURN',
  RIVER:    'RIVER',
  SHOWDOWN: 'SHOWDOWN',
  COMPLETE: 'COMPLETE',
};

const VALID_TRANSITIONS = {
  [GameState.WAITING]:  [GameState.PREFLOP],
  [GameState.PREFLOP]:  [GameState.FLOP, GameState.SHOWDOWN],
  [GameState.FLOP]:     [GameState.TURN, GameState.SHOWDOWN],
  [GameState.TURN]:     [GameState.RIVER, GameState.SHOWDOWN],
  [GameState.RIVER]:    [GameState.SHOWDOWN],
  [GameState.SHOWDOWN]: [GameState.COMPLETE],
  [GameState.COMPLETE]: [GameState.WAITING],
};

export const Action = {
  FOLD:   'fold',
  CHECK:  'check',
  CALL:   'call',
  BET:    'bet',
  RAISE:  'raise',
  ALL_IN: 'all_in',
};

export class NLHGame {
  constructor(playerNames, config) {
    this.smallBlind = config.smallBlind;
    this.bigBlind   = config.bigBlind;
    const startingChips = (config.startingBBs || 100) * config.bigBlind;
    this.players = playerNames.map((name, i) => ({
      id: i,
      name,
      chips: startingChips,
      hand: [],
      folded: false,
      currentBet: 0,
      totalBet: 0,
      isAllIn: false,
      hasActed: false,
    }));
    this.dealerIndex        = 0;
    this.state              = GameState.WAITING;
    this.deck               = [];
    this.communityCards     = [];
    this.pot                = 0;
    this.currentBet         = 0;
    this.currentPlayerIndex = 0;
    this.lastRaiserIndex    = -1;
    this.lastRaiseIncrement = this.bigBlind;
    this.actionLog          = [];
    this.lastWinners        = [];
    this.lastPot            = 0;
  }

  // 状態遷移（不正な遷移は例外）
  transition(newState) {
    if (!VALID_TRANSITIONS[this.state]?.includes(newState)) {
      throw new Error(`不正な状態遷移: ${this.state} → ${newState}`);
    }
    this.state = newState;
  }

  // 新しいハンドを開始
  startHand() {
    this.transition(GameState.PREFLOP);

    this.communityCards     = [];
    this.pot                = 0;
    this.currentBet         = 0;
    this.lastRaiseIncrement = this.bigBlind;
    this.actionLog          = [];
    this.lastWinners        = [];
    this.lastPot            = 0;

    for (const p of this.players) {
      p.hand       = [];
      p.folded     = false;
      p.currentBet = 0;
      p.totalBet   = 0;
      p.isAllIn    = false;
      p.hasActed   = false;
    }

    // バストしたプレイヤーをフォールド扱い
    for (const p of this.players) {
      if (p.chips <= 0) p.folded = true;
    }

    // SB/BB インデックスをハンド開始時に確定（フォールドで動的変化しないよう固定）
    this.sbIndex = this.getSBIndex();
    this.bbIndex = this.getBBIndex();

    this.deck = shuffleDeck(createDeck());

    for (const p of this.activePlayers) {
      p.hand = [this.deck.pop(), this.deck.pop()];
    }

    this.postBlinds();
  }

  get activePlayers() {
    return this.players.filter(p => !p.folded && p.chips > 0);
  }

  get activeInHandPlayers() {
    return this.players.filter(p => !p.folded);
  }

  firstActiveFrom(startIdx) {
    const n = this.players.length;
    for (let i = 0; i < n; i++) {
      const idx = (startIdx + i) % n;
      if (this.players[idx].chips > 0) return idx;
    }
    return startIdx;
  }

  firstActiveAfter(startIdx) {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (startIdx + i) % n;
      const p = this.players[idx];
      if (!p.folded && !p.isAllIn && p.chips > 0) return idx;
    }
    return -1;
  }

  getSBIndex() {
    // ハンド開始後は固定値を返す（フォールドによる動的変化を防ぐ）
    if (this.sbIndex !== undefined) return this.sbIndex;
    const active = this.players.filter(p => p.chips > 0);
    if (active.length <= 2) return this.firstActiveFrom(this.dealerIndex);
    return this.firstActiveFrom((this.dealerIndex + 1) % this.players.length);
  }

  getBBIndex() {
    if (this.bbIndex !== undefined) return this.bbIndex;
    const sbIdx = this.getSBIndex();
    return this.firstActiveFrom((sbIdx + 1) % this.players.length);
  }

  postBlinds() {
    const sbIdx    = this.getSBIndex();
    const bbIdx    = this.getBBIndex();
    const sbPlayer = this.players[sbIdx];
    const bbPlayer = this.players[bbIdx];

    const sbAmount = Math.min(this.smallBlind, sbPlayer.chips);
    const bbAmount = Math.min(this.bigBlind,   bbPlayer.chips);

    this.placeBet(sbPlayer, sbAmount);
    this.placeBet(bbPlayer, bbAmount);

    this.currentBet         = bbAmount;
    this.lastRaiseIncrement = this.bigBlind;

    this.currentPlayerIndex = this.firstActiveAfter(bbIdx);
    this.lastRaiserIndex    = bbIdx;

    this.addLog(`${sbPlayer.name}  posts SB  ${this._bb(sbAmount)} BB`);
    this.addLog(`${bbPlayer.name}  posts BB  ${this._bb(bbAmount)} BB`);
  }

  placeBet(player, amount) {
    const actual = Math.min(amount, player.chips);
    player.chips      -= actual;
    player.currentBet += actual;
    player.totalBet   += actual;
    this.pot          += actual;
    if (player.chips === 0) player.isAllIn = true;
    return actual;
  }

  getValidActions(player) {
    if (player.folded || player.isAllIn) return [];

    const actions = [Action.FOLD];
    const toCall  = this.currentBet - player.currentBet;

    if (toCall === 0) {
      actions.push(Action.CHECK);
    } else {
      // chips ≤ toCall でもコール可（オールインコールになる）
      actions.push(Action.CALL);
    }

    if (player.chips > toCall) {
      actions.push(toCall === 0 ? Action.BET : Action.RAISE);
      // ALL_IN はコール額より多く出せるとき（レイズ相当）のみ追加
      actions.push(Action.ALL_IN);
    }
    return actions;
  }

  performAction(playerIndex, action, amount = 0) {
    const player = this.players[playerIndex];
    if (playerIndex !== this.currentPlayerIndex) {
      throw new Error('このプレイヤーのターンではありません');
    }

    const validActions = this.getValidActions(player);
    if (!validActions.includes(action)) {
      throw new Error(`無効なアクション: ${action}`);
    }

    amount = Number.isFinite(amount) ? Math.floor(Math.max(0, amount)) : 0;
    const toCall = this.currentBet - player.currentBet;

    switch (action) {
      case Action.FOLD:
        player.folded = true;
        this.addLog(`${player.name}  folds`);
        break;

      case Action.CHECK:
        this.addLog(`${player.name}  checks`);
        break;

      case Action.CALL:
        this.placeBet(player, toCall);
        this.addLog(`${player.name}  calls  ${this._bb(toCall)} BB`);
        break;

      case Action.BET: {
        const betAmount = Math.max(this.bigBlind, Math.floor(amount));
        this.placeBet(player, betAmount);
        this.lastRaiseIncrement = player.currentBet;
        this.currentBet         = player.currentBet;
        this.lastRaiserIndex    = playerIndex;
        this.resetHasActed(playerIndex);
        this.addLog(`${player.name}  bets  ${this._bb(betAmount)} BB`);
        break;
      }

      case Action.RAISE: {
        const prevTableBet  = this.currentBet;
        const minRaiseChips = (prevTableBet + this.lastRaiseIncrement) - player.currentBet;
        const raiseTotal    = Math.max(minRaiseChips, Math.floor(amount) + toCall);
        this.placeBet(player, raiseTotal);
        this.lastRaiseIncrement = player.currentBet - prevTableBet;
        this.currentBet         = player.currentBet;
        this.lastRaiserIndex    = playerIndex;
        this.resetHasActed(playerIndex);
        this.addLog(`${player.name}  raises to  ${this._bb(player.currentBet)} BB`);
        break;
      }

      case Action.ALL_IN: {
        const allInAmount = player.chips;
        this.placeBet(player, allInAmount);
        if (player.currentBet > this.currentBet) {
          this.currentBet      = player.currentBet;
          this.lastRaiserIndex = playerIndex;
          this.resetHasActed(playerIndex);
        }
        this.addLog(`${player.name}  ALL IN  ${this._bb(allInAmount)} BB`);
        break;
      }
    }

    player.hasActed = true;

    if (this.checkHandEnd()) return;
    this.advanceToNextPlayer();
    if (this.isBettingRoundComplete()) this.advanceStreet();
  }

  resetHasActed(exceptIndex) {
    for (const p of this.players) {
      if (p.id !== exceptIndex && !p.folded && !p.isAllIn) {
        p.hasActed = false;
      }
    }
  }

  checkHandEnd() {
    const remaining = this.activeInHandPlayers;
    if (remaining.length === 1) {
      const winner    = remaining[0];
      this.lastPot    = this.pot;
      this.lastWinners = [winner];
      winner.chips   += this.pot;
      this.addLog(`${winner.name}  wins  ${this._bb(this.pot)} BB  (all others fold)`);
      this.pot = 0;
      this.transition(GameState.SHOWDOWN);
      this.transition(GameState.COMPLETE);
      return true;
    }
    return false;
  }

  advanceToNextPlayer() {
    let next     = (this.currentPlayerIndex + 1) % this.players.length;
    let attempts = 0;
    while (attempts < this.players.length) {
      const p = this.players[next];
      if (!p.folded && !p.isAllIn && p.chips > 0) {
        this.currentPlayerIndex = next;
        return;
      }
      next = (next + 1) % this.players.length;
      attempts++;
    }
    this.currentPlayerIndex = -1;
  }

  isBettingRoundComplete() {
    const eligible = this.players.filter(p => !p.folded && !p.isAllIn);
    if (eligible.length === 0) return true;
    return eligible.every(p => p.hasActed && p.currentBet === this.currentBet);
  }

  advanceStreet() {
    for (const p of this.players) {
      p.currentBet = 0;
      p.hasActed   = false;
    }
    this.currentBet         = 0;
    this.lastRaiseIncrement = this.bigBlind;

    switch (this.state) {
      case GameState.PREFLOP:
        this.transition(GameState.FLOP);
        this.deck.pop();
        this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
        this.addLog(`── FLOP  ${this.communityCards.map(c => c.display).join(' ')} ──`);
        break;

      case GameState.FLOP:
        this.transition(GameState.TURN);
        this.deck.pop();
        this.communityCards.push(this.deck.pop());
        this.addLog(`── TURN  ${this.communityCards.slice(-1)[0].display} ──`);
        break;

      case GameState.TURN:
        this.transition(GameState.RIVER);
        this.deck.pop();
        this.communityCards.push(this.deck.pop());
        this.addLog(`── RIVER  ${this.communityCards.slice(-1)[0].display} ──`);
        break;

      case GameState.RIVER:
        this.goToShowdown();
        return;
    }

    this.currentPlayerIndex = this.firstActiveAfter(this.dealerIndex);
  }

  goToShowdown() {
    this.transition(GameState.SHOWDOWN);

    const contenders = this.activeInHandPlayers;
    for (const p of contenders) {
      p.handResult = evaluateHand([...p.hand, ...this.communityCards]);
    }

    const winners  = determineWinners(contenders);
    // 勝者なし（evaluateHand 異常）の場合はポットを失わないよう安全に終了
    if (winners.length === 0) {
      this.pot = 0;
      this.transition(GameState.COMPLETE);
      return;
    }
    this.lastPot   = this.pot;
    this.lastWinners = winners;
    const share    = Math.floor(this.pot / winners.length);
    let remainder  = this.pot - share * winners.length;

    for (const w of winners) {
      let winAmount = share;
      if (remainder > 0) { winAmount++; remainder--; }
      w.chips += winAmount;
    }

    if (winners.length === 1) {
      this.addLog(`${winners[0].name}  wins  ${this._bb(this.pot)} BB  with  ${winners[0].handResult.name}`);
    } else {
      this.addLog(`Split pot — ${winners.map(w => w.name).join(' & ')}  (${winners[0].handResult.name})`);
    }

    this.pot = 0;
    this.transition(GameState.COMPLETE);
  }

  nextHand() {
    this.transition(GameState.WAITING);
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.sbIndex = undefined;  // 次ハンドで再計算
    this.bbIndex = undefined;
  }

  // ── GameAdapter ヘルパー ──
  getCurrentPlayer() {
    if (this.currentPlayerIndex < 0) return null;
    return this.players[this.currentPlayerIndex];
  }

  // ドローゲーム専用メソッドのスタブ（NLHでは使用しない）
  selectCardsForDraw() { /* NLH: no-op */ }
  confirmDraw()        { /* NLH: no-op */ }

  _bb(chips) {
    const v = chips / this.bigBlind;
    return Number.isInteger(v) ? `${v}` : v.toFixed(1);
  }

  addLog(message) {
    this.actionLog.push(message);
  }
}
