// Fixed Limit Hold'em (FLH) — ゲームエンジン
// CLAUDE.md準拠: チップは小数1桁まで (0.1単位)、状態遷移は厳密管理
// GameAdapter インターフェース準拠
//
// NLHGame をベースに以下を変更:
//   1. Fixed Limit ベッティング (_roundBetSize / maxRaisesPerRound)
//   2. 2枚ホールカード + 通常 showdown (NLH 評価器を直接流用)

import { createDeck, shuffleDeck } from '../../core/card.js';
import { evaluateHand, determineWinners } from '../nlh/evaluator.js';

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

export class FLHGame {
  constructor(playerNames, config) {
    this.config     = config;
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
      handResult: null,
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
    this.raiseCount         = 0;         // Fixed Limit: 1ラウンドあたりのベット+レイズ回数
    this.actionLog          = [];
    this.lastWinners        = [];
    this.lastPot            = 0;
  }

  // ══════════════════════════════════════════════
  // Fixed Limit 現ラウンドベット額
  //   PREFLOP/FLOP → smallBet (1BB)
  //   TURN/RIVER   → bigBet   (2BB)
  // ══════════════════════════════════════════════
  get _roundBetSize() {
    return (this.state === GameState.TURN || this.state === GameState.RIVER)
      ? this.config.bigBet
      : this.config.smallBet;
  }

  transition(newState) {
    if (!VALID_TRANSITIONS[this.state]?.includes(newState)) {
      throw new Error(`不正な状態遷移: ${this.state} → ${newState}`);
    }
    this.state = newState;
  }

  startHand() {
    this.transition(GameState.PREFLOP);

    this.communityCards     = [];
    this.pot                = 0;
    this.currentBet         = 0;
    this.lastRaiseIncrement = this.bigBlind;
    this.raiseCount         = 0;
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
      p.handResult = null;
    }

    for (const p of this.players) {
      if (p.chips <= 0) p.folded = true;
    }

    this.sbIndex = this.getSBIndex();
    this.bbIndex = this.getBBIndex();

    this.deck = shuffleDeck(createDeck());

    // 2 枚ホールカード配布 (config.numHoleCards = 2)
    const nHole = this.config.numHoleCards || 2;
    for (const p of this.activePlayers) {
      p.hand = [];
      for (let i = 0; i < nHole; i++) p.hand.push(this.deck.pop());
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
    this.raiseCount         = 1;          // BB を最初のベットとして計上

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

  // ══════════════════════════════════════════════
  // Fixed Limit: getValidActions
  // ══════════════════════════════════════════════
  getValidActions(player) {
    if (!player || player.folded || player.isAllIn) return [];

    const actions  = [Action.FOLD];
    const toCall   = this.currentBet - player.currentBet;
    const betSize  = this._roundBetSize;
    const underCap = this.raiseCount < this.config.maxRaisesPerRound;

    if (toCall === 0) {
      actions.push(Action.CHECK);
    } else {
      actions.push(Action.CALL);
    }

    if (underCap) {
      if (toCall === 0 && player.chips >= betSize) {
        actions.push(Action.BET);
      } else if (toCall > 0 && player.chips >= toCall + betSize) {
        actions.push(Action.RAISE);
      }
    }

    // ALL_IN フォールバック (チップが call+raise に満たない場合)
    if (player.chips > toCall) {
      actions.push(Action.ALL_IN);
    }

    return actions;
  }

  // ══════════════════════════════════════════════
  // Fixed Limit: performAction (amount 引数は無視、betSize 固定)
  // ══════════════════════════════════════════════
  performAction(playerIndex, action, _amount = 0) {
    const player = this.players[playerIndex];
    if (playerIndex !== this.currentPlayerIndex) {
      throw new Error('このプレイヤーのターンではありません');
    }

    const validActions = this.getValidActions(player);
    if (!validActions.includes(action)) {
      throw new Error(`無効なアクション: ${action}`);
    }

    const toCall  = this.currentBet - player.currentBet;
    const betSize = this._roundBetSize;

    switch (action) {
      case Action.FOLD:
        player.folded = true;
        this.addLog(`${player.name}  folds`);
        break;

      case Action.CHECK:
        this.addLog(`${player.name}  checks`);
        break;

      case Action.CALL: {
        const callAmt = Math.min(toCall, player.chips);
        this.placeBet(player, callAmt);
        const label = callAmt < toCall
          ? `calls ${this._bb(callAmt)} BB (all-in)`
          : `calls  ${this._bb(callAmt)} BB`;
        this.addLog(`${player.name}  ${label}`);
        break;
      }

      case Action.BET: {
        this.placeBet(player, betSize);
        this.currentBet         = player.currentBet;
        this.lastRaiseIncrement = betSize;
        this.lastRaiserIndex    = playerIndex;
        this.raiseCount++;
        this.resetHasActed(playerIndex);
        this.addLog(`${player.name}  bets  ${this._bb(betSize)} BB`);
        break;
      }

      case Action.RAISE: {
        const raiseAmt = toCall + betSize;
        this.placeBet(player, raiseAmt);
        this.currentBet         = player.currentBet;
        this.lastRaiseIncrement = betSize;
        this.lastRaiserIndex    = playerIndex;
        this.raiseCount++;
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
          this.raiseCount++;
          this.resetHasActed(playerIndex);
        }
        this.addLog(`${player.name}  ALL IN  ${this._bb(player.totalBet)} BB`);
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
    this.raiseCount         = 0;   // 新ストリートでリセット

    switch (this.state) {
      case GameState.PREFLOP:
        this.transition(GameState.FLOP);
        this.deck.pop();
        this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
        this.addLog(`-- FLOP  ${this.communityCards.map(c => c.display).join(' ')} --`);
        break;

      case GameState.FLOP:
        this.transition(GameState.TURN);
        this.deck.pop();
        this.communityCards.push(this.deck.pop());
        this.addLog(`-- TURN  ${this.communityCards.slice(-1)[0].display} --`);
        break;

      case GameState.TURN:
        this.transition(GameState.RIVER);
        this.deck.pop();
        this.communityCards.push(this.deck.pop());
        this.addLog(`-- RIVER  ${this.communityCards.slice(-1)[0].display} --`);
        break;

      case GameState.RIVER:
        this.goToShowdown();
        return;
    }

    this.currentPlayerIndex = this.firstActiveAfter(this.dealerIndex);
  }

  // ══════════════════════════════════════════════
  // Showdown — 通常の単一勝者 (NLH と完全同一ロジック)
  // ══════════════════════════════════════════════
  goToShowdown() {
    this.transition(GameState.SHOWDOWN);

    const contenders = this.activeInHandPlayers;
    for (const p of contenders) {
      p.handResult = evaluateHand([...p.hand, ...this.communityCards]);
    }

    const winners = determineWinners(contenders);
    if (winners.length === 0) {
      this.pot = 0;
      this.transition(GameState.COMPLETE);
      return;
    }
    this.lastPot = this.pot;
    this.lastWinners = winners;
    const share = Math.floor(this.pot / winners.length);
    let remainder = this.pot - share * winners.length;

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
    this.sbIndex = undefined;
    this.bbIndex = undefined;
  }

  /** UI用: 現在の役をリアルタイム評価 (FLOP 以降 / 5枚以上) */
  evaluateCurrentHand(playerId) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.hand || p.hand.length === 0) return null;
    const allCards = [...p.hand, ...this.communityCards];
    if (allCards.length < 5) return null;
    return evaluateHand(allCards);
  }

  // ── GameAdapter ヘルパー ──
  getCurrentPlayer() {
    if (this.currentPlayerIndex < 0) return null;
    return this.players[this.currentPlayerIndex];
  }

  // ドローゲーム専用スタブ
  selectCardsForDraw() { /* no-op */ }
  confirmDraw()        { /* no-op */ }

  _bb(chips) {
    const v = chips / this.bigBlind;
    if (Number.isInteger(v)) return `${v}`;
    const s1 = v.toFixed(1);
    if (parseFloat(s1) === v) return s1;
    return parseFloat(v.toFixed(2)).toString();
  }

  addLog(message) {
    this.actionLog.push(message);
  }
}
