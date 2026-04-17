// Seven Card Stud Hi/Lo 8-or-Better — ゲームエンジン
// Fixed Limit Stud: Ante → Third Street(bring-in) → Fourth〜Seventh Street → Showdown
// GameAdapter インターフェース準拠
// CLAUDE.md準拠: チップは小数1桁まで (0.1単位)、crypto.getRandomValues() は card.js 側で使用
//
// 進行・アクション・ベット構造は Stud-Hi と同一。
// 差分は _runShowdown() のみ: Hi/Lo 勝者を決定し、ポットを分割。

import { createDeck, shuffleDeck } from '../../core/card.js';
import {
  evaluateHi,
  evaluateLo8,
  determineWinnersHiLo,
  findBringInPlayer,
  findStrongestVisibleHand,
} from './evaluator.js';

export const StudState = {
  WAITING:        'WAITING',
  ANTE:           'ANTE',
  THIRD_STREET:   'THIRD_STREET',
  FOURTH_STREET:  'FOURTH_STREET',
  FIFTH_STREET:   'FIFTH_STREET',
  SIXTH_STREET:   'SIXTH_STREET',
  SEVENTH_STREET: 'SEVENTH_STREET',
  SHOWDOWN:       'SHOWDOWN',
  COMPLETE:       'COMPLETE',
};

const VALID_TRANSITIONS = {
  WAITING:        ['ANTE'],
  ANTE:           ['THIRD_STREET'],
  THIRD_STREET:   ['FOURTH_STREET',  'SHOWDOWN'],
  FOURTH_STREET:  ['FIFTH_STREET',   'SHOWDOWN'],
  FIFTH_STREET:   ['SIXTH_STREET',   'SHOWDOWN'],
  SIXTH_STREET:   ['SEVENTH_STREET', 'SHOWDOWN'],
  SEVENTH_STREET: ['SHOWDOWN'],
  SHOWDOWN:       ['COMPLETE'],
  COMPLETE:       ['WAITING'],
};

export const StudAction = {
  FOLD:     'fold',
  CHECK:    'check',
  CALL:     'call',
  BET:      'bet',
  RAISE:    'raise',
  ALL_IN:   'all_in',
  BRING_IN: 'bring_in',
  COMPLETE: 'complete',
};

export const STREET_LABELS = {
  THIRD_STREET:   '3rd Street',
  FOURTH_STREET:  '4th Street',
  FIFTH_STREET:   '5th Street',
  SIXTH_STREET:   '6th Street',
  SEVENTH_STREET: '7th Street',
};

// 4枚用の部分 Hi 評価 (ストレート/フラッシュは 5枚必要なので無視、ペア系のみ検出)
function _partialHiEval(cards) {
  const counts = {};
  for (const c of cards) counts[c.value] = (counts[c.value] || 0) + 1;
  const cs = Object.values(counts).sort((a, b) => b - a);
  let name;
  if (cs[0] >= 4)                          name = 'フォーオブアカインド';
  else if (cs[0] === 3 && cs[1] === 2)     name = 'フルハウス';
  else if (cs[0] === 3)                    name = 'スリーオブアカインド';
  else if (cs[0] === 2 && cs[1] === 2)     name = 'ツーペア';
  else if (cs[0] === 2)                    name = 'ワンペア';
  else                                      name = 'ハイカード';
  return { name, partial: true };
}

export class Stud8Game {
  constructor(playerNames, config) {
    this.config     = config;
    this.smallBlind = config.smallBlind || 5;
    this.bigBlind   = config.bigBlind;
    this.ante       = config.ante;
    this.bringIn    = config.bringIn;

    const startingChips = (config.startingBBs || 100) * config.bigBlind;

    this.players = playerNames.map((name, i) => ({
      id:          i,
      name,
      chips:       startingChips,
      hand:        [],
      folded:      false,
      currentBet:  0,
      totalBet:    0,
      isAllIn:     false,
      hasActed:    false,
      handResult:  null,
      hiResult:    null,
      loResult:    null,
    }));

    this.dealerIndex        = 0;
    this.state              = StudState.WAITING;
    this.deck               = [];
    this.communityCards     = [];
    this.pot                = 0;
    this.currentBet         = 0;
    this.currentPlayerIndex = -1;
    this.raiseCount         = 0;
    this.actionLog          = [];
    this.lastWinners        = [];
    this.lastHiWinners      = [];
    this.lastLoWinners      = [];
    this.lastHiAmount       = 0;
    this.lastLoAmount       = 0;
    this.lastPot            = 0;
    this.lastRaiseIncrement = config.bigBlind;

    // Stud 固有
    this.bringInPlayerId    = -1;
    this.bringInPosted      = false;
    this.completeDone       = false;
    this.streetLeaderId     = -1;
  }

  // ── 現ラウンドの固定ベット額 ──
  get _roundBetSize() {
    if (this.state === StudState.FIFTH_STREET ||
        this.state === StudState.SIXTH_STREET ||
        this.state === StudState.SEVENTH_STREET) {
      return this.config.bigBet;
    }
    return this.config.smallBet;
  }

  // ── プレイヤーフィルタ ──
  get activePlayers()        { return this.players.filter(p => !p.folded && p.chips > 0); }
  get activeInHandPlayers()  { return this.players.filter(p => !p.folded); }

  // ── 状態遷移 ──
  transition(newState) {
    const valid = VALID_TRANSITIONS[this.state];
    if (!valid?.includes(newState)) {
      throw new Error(`不正な状態遷移: ${this.state} → ${newState}`);
    }
    this.state = newState;
  }

  _forceComplete() {
    this.state = StudState.SHOWDOWN;
    this.state = StudState.COMPLETE;
  }

  // ── ライフサイクル ──
  startHand() {
    this.transition(StudState.ANTE);

    this.pot                = 0;
    this.currentBet         = 0;
    this.raiseCount         = 0;
    this.actionLog          = [];
    this.lastWinners        = [];
    this.lastHiWinners      = [];
    this.lastLoWinners      = [];
    this.lastHiAmount       = 0;
    this.lastLoAmount       = 0;
    this.lastPot            = 0;
    this.bringInPlayerId    = -1;
    this.bringInPosted      = false;
    this.completeDone       = false;
    this.streetLeaderId     = -1;

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

    for (const p of this.players) {
      if (p.chips <= 0) p.folded = true;
    }

    this.deck = shuffleDeck(createDeck());

    this._postAntes();

    // Third Street: 2枚ダウン + 1枚アップ
    for (const p of this.activeInHandPlayers) {
      const c1 = this.deck.pop(); c1.faceUp = false;
      const c2 = this.deck.pop(); c2.faceUp = false;
      const c3 = this.deck.pop(); c3.faceUp = true; c3.isNew = true; c3.newIndex = 0;
      p.hand = [c1, c2, c3];
    }

    this.transition(StudState.THIRD_STREET);

    const active = this.activeInHandPlayers;
    this.bringInPlayerId = findBringInPlayer(active);
    if (this.bringInPlayerId < 0) this.bringInPlayerId = active[0]?.id ?? 0;

    this.bringInPosted = false;
    this.completeDone = false;
    this.raiseCount = 0;
    this.currentPlayerIndex = this.bringInPlayerId;

    this._log(`-- 3rd Street --`);
  }

  nextHand() {
    this.transition(StudState.WAITING);
    const n = this.players.length;
    let next = (this.dealerIndex + 1) % n;
    for (let i = 0; i < n; i++) {
      if (this.players[next].chips > 0) { this.dealerIndex = next; return; }
      next = (next + 1) % n;
    }
  }

  _postAntes() {
    for (const p of this.activeInHandPlayers) {
      const amt = Math.min(this.ante, p.chips);
      this._placeBet(p, amt);
      this._log(`${p.name}  posts Ante  ${this._bb(amt)} BB`);
    }
    for (const p of this.players) {
      p.currentBet = 0;
    }
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

  // ── アクション ──
  getValidActions(playerOrId) {
    const player = (typeof playerOrId === 'number') ? this.players[playerOrId] : playerOrId;
    if (!player || player.folded || player.isAllIn || player.chips <= 0) return [];

    const actions = [];
    const toCall = this.currentBet - player.currentBet;
    const betSize = this._roundBetSize;
    const underCap = this.raiseCount < this.config.maxRaisesPerRound;

    if (this.state === StudState.THIRD_STREET && !this.bringInPosted) {
      actions.push(StudAction.BRING_IN);
      if (player.chips > this.bringIn) {
        actions.push(StudAction.COMPLETE);
      }
      return actions;
    }

    if (this.state === StudState.THIRD_STREET && this.bringInPosted && !this.completeDone) {
      actions.push(StudAction.FOLD);
      if (toCall > 0) actions.push(StudAction.CALL);
      else            actions.push(StudAction.CHECK);
      if (underCap && player.chips > toCall) actions.push(StudAction.COMPLETE);
      actions.push(StudAction.ALL_IN);
      return actions;
    }

    actions.push(StudAction.FOLD);
    if (toCall === 0) actions.push(StudAction.CHECK);
    else              actions.push(StudAction.CALL);

    if (underCap) {
      if (toCall === 0 && player.chips >= betSize)           actions.push(StudAction.BET);
      else if (toCall > 0 && player.chips >= toCall + betSize) actions.push(StudAction.RAISE);
    }

    actions.push(StudAction.ALL_IN);
    return actions;
  }

  performAction(playerId, action, _amount = 0) {
    if (playerId !== this.currentPlayerIndex) {
      throw new Error('このプレイヤーのターンではありません');
    }
    const player = this.players[playerId];
    const validActions = this.getValidActions(playerId);
    if (!validActions.includes(action)) {
      throw new Error(`無効なアクション: ${action} (valid: ${validActions.join(',')})`);
    }

    const toCall = this.currentBet - player.currentBet;
    const betSize = this._roundBetSize;

    switch (action) {
      case StudAction.BRING_IN: {
        const amt = Math.min(this.bringIn, player.chips);
        this._placeBet(player, amt);
        this.currentBet = amt;
        this.bringInPosted = true;
        this.completeDone = false;
        this.raiseCount = 0;
        this._log(`${player.name}  brings in  ${this._bb(amt)} BB`);
        player.hasActed = true;
        if (this._checkHandEnd()) return;
        this.currentPlayerIndex = this._firstActiveAfter(this.bringInPlayerId);
        if (this.currentPlayerIndex < 0) this.currentPlayerIndex = this.bringInPlayerId;
        if (this._isBettingRoundComplete()) this._advanceStreet();
        return;
      }

      case StudAction.FOLD:
        player.folded = true;
        this._log(`${player.name}  folds`);
        break;

      case StudAction.CHECK:
        this._log(`${player.name}  checks`);
        break;

      case StudAction.CALL: {
        const callAmt = Math.min(toCall, player.chips);
        this._placeBet(player, callAmt);
        const label = callAmt < toCall ? `calls ${this._bb(callAmt)} BB (all-in)` : `calls  ${this._bb(callAmt)} BB`;
        this._log(`${player.name}  ${label}`);
        break;
      }

      case StudAction.BET:
        this._placeBet(player, betSize);
        this.currentBet = player.currentBet;
        this.raiseCount++;
        this._resetHasActed(playerId);
        this._log(`${player.name}  bets  ${this._bb(betSize)} BB`);
        break;

      case StudAction.RAISE: {
        const raiseAmt = toCall + betSize;
        this._placeBet(player, raiseAmt);
        this.currentBet = player.currentBet;
        this.raiseCount++;
        this._resetHasActed(playerId);
        this._log(`${player.name}  raises to  ${this._bb(player.currentBet)} BB`);
        break;
      }

      case StudAction.COMPLETE: {
        if (!this.bringInPosted) {
          this._placeBet(player, betSize);
          this.currentBet = player.currentBet;
          this.bringInPosted = true;
          this.completeDone = true;
          this.raiseCount = 1;
          this._resetHasActed(playerId);
          this._log(`${player.name}  completes to  ${this._bb(player.currentBet)} BB`);
          player.hasActed = true;
          if (this._checkHandEnd()) return;
          this.currentPlayerIndex = this._firstActiveAfter(this.bringInPlayerId);
          if (this.currentPlayerIndex < 0) this.currentPlayerIndex = this.bringInPlayerId;
          if (this._isBettingRoundComplete()) this._advanceStreet();
          return;
        }
        const completeTotal = betSize;
        const toComplete = completeTotal - player.currentBet;
        this._placeBet(player, Math.max(0, toComplete));
        this.currentBet = player.currentBet;
        this.completeDone = true;
        this.raiseCount = 1;
        this._resetHasActed(playerId);
        this._log(`${player.name}  completes to  ${this._bb(player.currentBet)} BB`);
        break;
      }

      case StudAction.ALL_IN: {
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
    if (this._isBettingRoundComplete()) this._advanceStreet();
  }

  _resetHasActed(exceptId) {
    for (const p of this.players) {
      if (p.id !== exceptId && !p.folded && !p.isAllIn) p.hasActed = false;
    }
  }

  _checkHandEnd() {
    const remaining = this.activeInHandPlayers;
    if (remaining.length === 1) {
      const winner = remaining[0];
      this.lastPot = this.pot;
      this.lastWinners   = [winner];
      this.lastHiWinners = [winner];
      this.lastLoWinners = [];  // 全員フォールド時は Lo 不成立扱い
      this.lastHiAmount  = this.pot;
      this.lastLoAmount  = 0;
      winner.chips += this.pot;
      this._log(`${winner.name}  wins  ${this._bb(this.pot)} BB  (all others fold)`);
      this.pot = 0;
      this._forceComplete();
      return true;
    }
    return false;
  }

  _advanceToNextPlayer() {
    const n = this.players.length;
    let next = (this.currentPlayerIndex + 1) % n;
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

  _advanceStreet() {
    for (const p of this.players) {
      p.currentBet = 0;
      p.hasActed = false;
    }
    this.currentBet = 0;
    this.raiseCount = 0;
    this.bringInPosted = false;
    this.completeDone = false;

    const NEXT = {
      THIRD_STREET:   StudState.FOURTH_STREET,
      FOURTH_STREET:  StudState.FIFTH_STREET,
      FIFTH_STREET:   StudState.SIXTH_STREET,
      SIXTH_STREET:   StudState.SEVENTH_STREET,
      SEVENTH_STREET: StudState.SHOWDOWN,
    };

    const nextState = NEXT[this.state];
    if (!nextState) return;

    const canAct = this.players.filter(p => !p.folded && !p.isAllIn && p.chips > 0);
    if (canAct.length <= 1 && this.activeInHandPlayers.length >= 2) {
      this._dealRemainingCards(nextState);
      return;
    }

    this.transition(nextState);

    if (nextState === StudState.SHOWDOWN) {
      this._runShowdown();
      return;
    }

    this._dealStreetCard(nextState);

    const active = this.activeInHandPlayers;
    this.streetLeaderId = findStrongestVisibleHand(active);
    this.currentPlayerIndex = this.streetLeaderId >= 0 ? this.streetLeaderId : active[0]?.id ?? 0;

    const label = STREET_LABELS[nextState] || nextState;
    this._log(`-- ${label} --`);
  }

  _dealStreetCard(streetState) {
    const active = this.activeInHandPlayers;
    const isSeventh = streetState === StudState.SEVENTH_STREET;
    for (const p of active) {
      if (this.deck.length === 0) break;
      const c = this.deck.pop();
      c.faceUp = !isSeventh;
      c.isNew = true;
      c.newIndex = 0;
      p.hand.push(c);
    }
  }

  _dealRemainingCards(fromState) {
    const STREET_ORDER = [
      StudState.FOURTH_STREET,
      StudState.FIFTH_STREET,
      StudState.SIXTH_STREET,
      StudState.SEVENTH_STREET,
    ];

    const startIdx = STREET_ORDER.indexOf(fromState);
    if (startIdx < 0) {
      this.transition(StudState.SHOWDOWN);
      this._runShowdown();
      return;
    }

    for (let i = startIdx; i < STREET_ORDER.length; i++) {
      const st = STREET_ORDER[i];
      this.state = st;
      this._dealStreetCard(st);
    }

    this.state = StudState.SEVENTH_STREET;
    this.transition(StudState.SHOWDOWN);
    this._runShowdown();
  }

  // ══════════════════════════════════════════════
  // ショーダウン — Stud 8 固有: Hi/Lo ポット分割
  // ══════════════════════════════════════════════
  _runShowdown() {
    const contenders = this.activeInHandPlayers;
    if (contenders.length === 0) {
      this.pot = 0;
      this.transition(StudState.COMPLETE);
      return;
    }

    // Hi/Lo 両方を評価
    for (const p of contenders) {
      p.hiResult   = evaluateHi(p.hand);
      p.loResult   = evaluateLo8(p.hand);   // null = Lo 不成立
      p.handResult = p.hiResult;            // 既存 UI 互換 (win-hand-name 等)
    }

    const { hiWinners, loWinners } = determineWinnersHiLo(contenders);

    this.lastPot       = this.pot;
    this.lastHiWinners = hiWinners;
    this.lastLoWinners = loWinners;
    // 既存UI互換: Hi ∪ Lo の和集合
    this.lastWinners   = [...new Set([...hiWinners, ...loWinners])];

    if (hiWinners.length === 0) {
      // 評価異常 — ポットを失わないよう安全に終了
      this.pot = 0;
      this.transition(StudState.COMPLETE);
      return;
    }

    if (loWinners.length === 0) {
      // Lo 不成立 → Hi 総取り
      this.lastHiAmount = this.pot;
      this.lastLoAmount = 0;
      this._awardPart(this.pot, hiWinners);
      this._logHiOnly(hiWinners, this.pot);
    } else {
      // 50/50 分割、奇数チップは Hi 側が取る (仕様: 51/50)
      const loHalf = Math.floor(this.pot / 2);
      const hiHalf = this.pot - loHalf;
      this.lastHiAmount = hiHalf;
      this.lastLoAmount = loHalf;
      this._awardPart(hiHalf, hiWinners);
      this._awardPart(loHalf, loWinners);
      this._logHiLo(hiWinners, loWinners, hiHalf, loHalf);
    }

    this.pot = 0;
    this.transition(StudState.COMPLETE);
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
      this._log(`${hiWinners[0].name}  wins  ${this._bb(amount)} BB  with  ${handName}  (Hi only — no qualifying Lo)`);
    } else {
      // Hi タイ分割: 総額ではなく1人あたりを表示
      const names   = hiWinners.map(w => w.name).join(' & ');
      const perWin  = Math.floor(amount / hiWinners.length);
      this._log(`Split Hi — ${names}  +${this._bb(perWin)} BB each (×${hiWinners.length})  (${handName}, no qualifying Lo)`);
    }
  }

  _logHiLo(hiW, loW, hiAmt, loAmt) {
    // スクープ判定: Hi も Lo も単独かつ同一プレイヤー
    if (hiW.length === 1 && loW.length === 1 && hiW[0].id === loW[0].id) {
      const w = hiW[0];
      this._log(`${w.name}  scoops  ${this._bb(hiAmt + loAmt)} BB  (Hi: ${w.hiResult.name}  /  Lo: ${w.loResult.name})`);
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
    this._log(`Hi: ${hiNames} (${hiHand}) +${this._bb(hiPer)} BB${hiSuf}  /  Lo: ${loNames} (${loHand}) +${this._bb(loPer)} BB${loSuf}`);
  }

  // ── GameAdapter ヘルパー ──
  getCurrentPlayer() {
    if (this.currentPlayerIndex < 0) return null;
    return this.players[this.currentPlayerIndex];
  }

  getSBIndex() { return -1; }
  getBBIndex() { return -1; }

  selectCardsForDraw() { /* Stud: no-op */ }
  confirmDraw()        { /* Stud: no-op */ }

  /** UI用: 現在の Hi 役をリアルタイム評価
   *  4枚 (4th Street): ペア/トリップス/カルテットのみ判定 (ストレート/フラッシュは無視)
   *  5枚以上: 完全評価
   */
  evaluateCurrentHand(playerId) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.hand || p.hand.length < 4) return null;
    if (p.hand.length >= 5) {
      try { return evaluateHi(p.hand); } catch(e) { return null; }
    }
    return _partialHiEval(p.hand);
  }

  /** UI用: 現在の Lo (8-or-Better) 役をリアルタイム評価。成立しなければ null */
  evaluateCurrentLo(playerId) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.hand || p.hand.length < 5) return null;
    try { return evaluateLo8(p.hand); } catch(e) { return null; }
  }

  _bb(chips) {
    const v = chips / this.bigBlind;
    if (Number.isInteger(v)) return `${v}`;
    const s1 = v.toFixed(1);
    if (parseFloat(s1) === v) return s1;
    return parseFloat(v.toFixed(2)).toString();
  }

  _log(msg)   { this.actionLog.push(msg); }
  addLog(msg) { this.actionLog.push(msg); }

  _firstActiveAfter(startIdx) {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (startIdx + i) % n;
      const p = this.players[idx];
      if (!p.folded && !p.isAllIn && p.chips > 0) return idx;
    }
    return -1;
  }

  _firstActiveFrom(startIdx) {
    const n = this.players.length;
    for (let i = 0; i < n; i++) {
      const idx = (startIdx + i) % n;
      if (this.players[idx].chips > 0) return idx;
    }
    return startIdx;
  }
}
