// Fixed Limit Omaha Hi/Lo 8-or-Better (FLO8) — ゲームエンジン
// CLAUDE.md準拠: チップは小数1桁まで (0.1単位)、状態遷移は厳密管理
// GameAdapter インターフェース準拠
//
// NLHGame をベースに以下を変更:
//   1. 4枚ホールカード配布 (config.numHoleCards)
//   2. Fixed Limit ベッティング (_roundBetSize / maxRaisesPerRound)
//   3. Hi/Lo 8-or-Better 分割 showdown (Stud 8 パターン)

import { createDeck, shuffleDeck } from '../../core/card.js';
import {
  evaluateHiOmaha,
  evaluateLo8Omaha,
  determineWinnersHiLo,
} from './evaluator.js';

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

export class FLO8Game {
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
      hiResult:   null,
      loResult:   null,
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
    this.raiseCount         = 0;         // ← Fixed Limit: 1ラウンドあたりのベット+レイズ回数
    this.actionLog          = [];
    this.lastWinners        = [];
    this.lastHiWinners      = [];
    this.lastLoWinners      = [];
    this.lastHiAmount       = 0;
    this.lastLoAmount       = 0;
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

  // 状態遷移
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
    this.raiseCount         = 0;
    this.actionLog          = [];
    this.lastWinners        = [];
    this.lastHiWinners      = [];
    this.lastLoWinners      = [];
    this.lastHiAmount       = 0;
    this.lastLoAmount       = 0;
    this.lastPot            = 0;

    for (const p of this.players) {
      p.hand       = [];
      p.folded     = false;
      p.currentBet = 0;
      p.totalBet   = 0;
      p.isAllIn    = false;
      p.hasActed   = false;
      p.handResult = null;
      p.hiResult   = null;
      p.loResult   = null;
    }

    // バストしたプレイヤーをフォールド扱い
    for (const p of this.players) {
      if (p.chips <= 0) p.folded = true;
    }

    // SB/BB インデックスをハンド開始時に確定
    this.sbIndex = this.getSBIndex();
    this.bbIndex = this.getBBIndex();

    this.deck = shuffleDeck(createDeck());

    // Omaha: config.numHoleCards 枚 (= 4) を配布
    const nHole = this.config.numHoleCards || 4;
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
      // chips ≤ toCall でもコール可 (オールインコール)
      actions.push(Action.CALL);
    }

    if (underCap) {
      if (toCall === 0 && player.chips >= betSize) {
        actions.push(Action.BET);
      } else if (toCall > 0 && player.chips >= toCall + betSize) {
        actions.push(Action.RAISE);
      }
    }

    // ALL_IN フォールバック: チップが call+raise 相当未満でも残チップ全投入できる場合
    if (player.chips > toCall) {
      actions.push(Action.ALL_IN);
    }

    return actions;
  }

  // ══════════════════════════════════════════════
  // Fixed Limit: performAction (amount は無視、betSize 固定)
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
        const label = callAmt < toCall ? `calls ${this._bb(callAmt)} BB (all-in)` : `calls  ${this._bb(callAmt)} BB`;
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
      this.lastWinners   = [winner];
      this.lastHiWinners = [winner];
      this.lastLoWinners = [];
      this.lastHiAmount  = this.pot;
      this.lastLoAmount  = 0;
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
    this.raiseCount         = 0;       // ← 新ストリートでリセット

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
  // Showdown — Hi/Lo 分割
  // ══════════════════════════════════════════════
  goToShowdown() {
    this.transition(GameState.SHOWDOWN);

    const contenders = this.activeInHandPlayers;
    if (contenders.length === 0) {
      this.pot = 0;
      this.transition(GameState.COMPLETE);
      return;
    }

    for (const p of contenders) {
      p.hiResult   = evaluateHiOmaha(p.hand, this.communityCards);
      p.loResult   = evaluateLo8Omaha(p.hand, this.communityCards);  // null = Lo 不成立
      p.handResult = p.hiResult;  // UI 既存参照 (hname 等) との互換
    }

    const { hiWinners, loWinners } = determineWinnersHiLo(contenders);

    this.lastPot       = this.pot;
    this.lastHiWinners = hiWinners;
    this.lastLoWinners = loWinners;
    this.lastWinners   = [...new Set([...hiWinners, ...loWinners])];

    if (hiWinners.length === 0) {
      // 評価異常 — ポットを失わないよう安全に終了
      this.pot = 0;
      this.transition(GameState.COMPLETE);
      return;
    }

    if (loWinners.length === 0) {
      // Lo 不成立 → Hi 総取り
      this.lastHiAmount = this.pot;
      this.lastLoAmount = 0;
      this._awardPart(this.pot, hiWinners);
      this._logHiOnly(hiWinners, this.pot);
    } else {
      // 50/50 分割、奇数チップは Hi 側 (仕様: 51/50)
      const loHalf = Math.floor(this.pot / 2);
      const hiHalf = this.pot - loHalf;
      this.lastHiAmount = hiHalf;
      this.lastLoAmount = loHalf;
      this._awardPart(hiHalf, hiWinners);
      this._awardPart(loHalf, loWinners);
      this._logHiLo(hiWinners, loWinners, hiHalf, loHalf);
    }

    this.pot = 0;
    this.transition(GameState.COMPLETE);
  }

  /** 指定額を勝者配列で均等分配 (remainder は先頭から1チップずつ) */
  _awardPart(amount, winners) {
    if (winners.length === 0 || amount <= 0) return;
    const share = Math.floor(amount / winners.length);
    let rem     = amount - share * winners.length;
    for (const w of winners) {
      let add = share;
      if (rem > 0) { add++; rem--; }
      w.chips += add;
    }
  }

  _logHiOnly(hiWinners, amount) {
    const handName = hiWinners[0].hiResult?.name ?? '';
    if (hiWinners.length === 1) {
      this.addLog(`${hiWinners[0].name}  wins  ${this._bb(amount)} BB  with  ${handName}  (Hi only — no qualifying Lo)`);
    } else {
      // Hi タイ分割: 総額ではなく1人あたりを表示
      const names  = hiWinners.map(w => w.name).join(' & ');
      const perWin = Math.floor(amount / hiWinners.length);
      this.addLog(`Split Hi — ${names}  +${this._bb(perWin)} BB each (×${hiWinners.length})  (${handName}, no qualifying Lo)`);
    }
  }

  _logHiLo(hiW, loW, hiAmt, loAmt) {
    if (hiW.length === 1 && loW.length === 1 && hiW[0].id === loW[0].id) {
      const w = hiW[0];
      this.addLog(`${w.name}  scoops  ${this._bb(hiAmt + loAmt)} BB  (Hi: ${w.hiResult.name}  /  Lo: ${w.loResult.name})`);
      return;
    }
    // 1人あたりの獲得額 (タイなら 1/4 pot = クォーター)
    const hiPer = Math.floor(hiAmt / hiW.length);
    const loPer = Math.floor(loAmt / loW.length);
    const hiNames = hiW.map(w => w.name).join(' & ');
    const loNames = loW.map(w => w.name).join(' & ');
    const hiHand  = hiW[0].hiResult?.name ?? '';
    const loHand  = loW[0].loResult?.name ?? '';
    const hiSuf   = hiW.length > 1 ? ` each (×${hiW.length})` : '';
    const loSuf   = loW.length > 1 ? ` each (×${loW.length})` : '';
    this.addLog(`Hi: ${hiNames} (${hiHand}) +${this._bb(hiPer)} BB${hiSuf}  /  Lo: ${loNames} (${loHand}) +${this._bb(loPer)} BB${loSuf}`);
  }

  nextHand() {
    this.transition(GameState.WAITING);
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.sbIndex = undefined;
    this.bbIndex = undefined;
  }

  /** UI用: 現在の Hi 役をリアルタイム評価 (フロップ以降) */
  evaluateCurrentHand(playerId) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.hand || p.hand.length !== 4) return null;
    if (this.communityCards.length < 3) return null;
    try { return evaluateHiOmaha(p.hand, this.communityCards); } catch(e) { return null; }
  }

  /** UI用: 現在の Lo 役をリアルタイム評価。不成立なら null */
  evaluateCurrentLo(playerId) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.hand || p.hand.length !== 4) return null;
    if (this.communityCards.length < 3) return null;
    try { return evaluateLo8Omaha(p.hand, this.communityCards); } catch(e) { return null; }
  }

  // ── GameAdapter ヘルパー ──
  getCurrentPlayer() {
    if (this.currentPlayerIndex < 0) return null;
    return this.players[this.currentPlayerIndex];
  }

  // ドローゲーム専用メソッドのスタブ
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
