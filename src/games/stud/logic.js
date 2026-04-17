// Seven Card Stud High — ゲームエンジン
// Fixed Limit Stud: Ante → Third Street(bring-in) → Fourth〜Seventh Street → Showdown
// GameAdapter インターフェース準拠
// CLAUDE.md準拠: チップは小数1桁まで (0.1単位)、crypto.getRandomValues() は card.js 側で使用

import { createDeck, shuffleDeck } from '../../core/card.js';
import { evaluateHand, determineWinners, findBringInPlayer, findStrongestVisibleHand } from './evaluator.js';

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
  BRING_IN: 'bring_in',   // Third Street 強制ベット
  COMPLETE: 'complete',   // Bring-in → Small Bet に引き上げ
};

// ストリート名ラベル（UI表示用）
export const STREET_LABELS = {
  THIRD_STREET:   '3rd Street',
  FOURTH_STREET:  '4th Street',
  FIFTH_STREET:   '5th Street',
  SIXTH_STREET:   '6th Street',
  SEVENTH_STREET: '7th Street',
};

export class StudGame {
  constructor(playerNames, config) {
    this.config     = config;
    this.smallBlind = config.smallBlind || 5;  // GameAdapter互換
    this.bigBlind   = config.bigBlind;
    this.ante       = config.ante;
    this.bringIn    = config.bringIn;

    const startingChips = (config.startingBBs || 100) * config.bigBlind;

    this.players = playerNames.map((name, i) => ({
      id:          i,
      name,
      chips:       startingChips,
      hand:        [],       // Card[] with faceUp: boolean
      folded:      false,
      currentBet:  0,
      totalBet:    0,
      isAllIn:     false,
      hasActed:    false,
      handResult:  null,
    }));

    this.dealerIndex        = 0;
    this.state              = StudState.WAITING;
    this.deck               = [];
    this.communityCards     = [];  // 常に [] — GameAdapter準拠
    this.pot                = 0;
    this.currentBet         = 0;
    this.currentPlayerIndex = -1;
    this.raiseCount         = 0;
    this.actionLog          = [];
    this.lastWinners        = [];
    this.lastPot            = 0;
    this.lastRaiseIncrement = config.bigBlind; // NLH互換

    // Stud 固有
    this.bringInPlayerId    = -1;   // bring-in を払うプレイヤー
    this.bringInPosted      = false; // bring-in 投稿済みフラグ
    this.completeDone       = false; // complete 実行済みフラグ
    this.streetLeaderId     = -1;   // 各ストリートの先行プレイヤー
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
  get activePlayers() {
    return this.players.filter(p => !p.folded && p.chips > 0);
  }

  get activeInHandPlayers() {
    return this.players.filter(p => !p.folded);
  }

  // ── 状態遷移 ──
  transition(newState) {
    const valid = VALID_TRANSITIONS[this.state];
    if (!valid?.includes(newState)) {
      throw new Error(`不正な状態遷移: ${this.state} → ${newState}`);
    }
    this.state = newState;
  }

  /** 全員フォールド時など中間ステートを飛ばして即座に完了する安全な強制遷移 */
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
    }

    // バスト済みプレイヤーをフォールド扱い
    for (const p of this.players) {
      if (p.chips <= 0) p.folded = true;
    }

    // デッキ & カード配布
    this.deck = shuffleDeck(createDeck());

    // アンテ投稿
    this._postAntes();

    // Third Street: 2枚ダウン + 1枚アップ（ドアカード）
    for (const p of this.activeInHandPlayers) {
      const c1 = this.deck.pop(); c1.faceUp = false;
      const c2 = this.deck.pop(); c2.faceUp = false;
      const c3 = this.deck.pop(); c3.faceUp = true; c3.isNew = true; c3.newIndex = 0;
      p.hand = [c1, c2, c3];
    }

    this.transition(StudState.THIRD_STREET);

    // Bring-in プレイヤー特定（最弱ドアカード）
    const active = this.activeInHandPlayers;
    this.bringInPlayerId = findBringInPlayer(active);
    if (this.bringInPlayerId < 0) this.bringInPlayerId = active[0]?.id ?? 0;

    // Bring-in はプレイヤーアクションとして実行（自動投稿しない）
    this.bringInPosted = false;
    this.completeDone = false;
    this.raiseCount = 0;
    this.currentPlayerIndex = this.bringInPlayerId;

    this._log(`-- 3rd Street --`);
  }

  nextHand() {
    this.transition(StudState.WAITING);
    // ディーラーボタン進行（バスト済みスキップ）
    const n = this.players.length;
    let next = (this.dealerIndex + 1) % n;
    for (let i = 0; i < n; i++) {
      if (this.players[next].chips > 0) { this.dealerIndex = next; return; }
      next = (next + 1) % n;
    }
  }

  // ── アンテ ──
  _postAntes() {
    for (const p of this.activeInHandPlayers) {
      const amt = Math.min(this.ante, p.chips);
      this._placeBet(p, amt);
      this._log(`${p.name}  posts Ante  ${this._bb(amt)} BB`);
    }
    // アンテはベットラウンドのベットには含めない
    for (const p of this.players) {
      p.currentBet = 0;
    }
  }

  // ── Bring-in ──
  _postBringIn() {
    const p = this.players[this.bringInPlayerId];
    if (!p || p.folded) return;

    const amt = Math.min(this.bringIn, p.chips);
    this._placeBet(p, amt);
    this.currentBet = amt;
    this.bringInPosted = true;
    this.completeDone = false;
    this.raiseCount = 0; // bring-in はベットカウントに含めない

    this._log(`${p.name}  brings in  ${this._bb(amt)} BB`);

    // Bring-in の左隣から行動開始
    this.currentPlayerIndex = this._firstActiveAfter(this.bringInPlayerId);
    if (this.currentPlayerIndex < 0) {
      this.currentPlayerIndex = this.bringInPlayerId;
    }
  }

  // ── ベット ──
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

    // Third Street: Bring-in 未投稿 → 最弱ドアカードプレイヤーが BRING_IN or COMPLETE を選択
    if (this.state === StudState.THIRD_STREET && !this.bringInPosted) {
      actions.push(StudAction.BRING_IN);
      if (player.chips > this.bringIn) {
        actions.push(StudAction.COMPLETE);
      }
      return actions;
    }

    // Third Street: Bring-in 投稿済み、Complete 未実行 → 他プレイヤーは fold/call/complete
    if (this.state === StudState.THIRD_STREET && this.bringInPosted && !this.completeDone) {
      actions.push(StudAction.FOLD);

      if (toCall > 0) {
        actions.push(StudAction.CALL);
      } else {
        actions.push(StudAction.CHECK);
      }

      // Complete: bring-in → small bet に引き上げ
      if (underCap && player.chips > toCall) {
        actions.push(StudAction.COMPLETE);
      }

      actions.push(StudAction.ALL_IN);
      return actions;
    }

    // 通常のベッティング
    actions.push(StudAction.FOLD);

    if (toCall === 0) {
      actions.push(StudAction.CHECK);
    } else {
      actions.push(StudAction.CALL);
    }

    if (underCap) {
      if (toCall === 0 && player.chips >= betSize) {
        actions.push(StudAction.BET);
      } else if (toCall > 0 && player.chips >= toCall + betSize) {
        actions.push(StudAction.RAISE);
      }
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
        // Bring-in: 最弱ドアカードプレイヤーの強制ベット
        const amt = Math.min(this.bringIn, player.chips);
        this._placeBet(player, amt);
        this.currentBet = amt;
        this.bringInPosted = true;
        this.completeDone = false;
        this.raiseCount = 0;
        this._log(`${player.name}  brings in  ${this._bb(amt)} BB`);
        // Bring-in の左隣から行動開始
        player.hasActed = true;
        if (this._checkHandEnd()) return;
        this.currentPlayerIndex = this._firstActiveAfter(this.bringInPlayerId);
        if (this.currentPlayerIndex < 0) this.currentPlayerIndex = this.bringInPlayerId;
        if (this._isBettingRoundComplete()) this._advanceStreet();
        return; // 通常の hasActed/advance をスキップ（上で処理済み）
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
        // Complete: Bring-in → Small Bet に引き上げ
        // bring-in プレイヤー自身が初手で Complete を選んだ場合も対応
        if (!this.bringInPosted) {
          // 初手 Complete（bring-in 代わり）
          this._placeBet(player, betSize);
          this.currentBet = player.currentBet;
          this.bringInPosted = true;
          this.completeDone = true;
          this.raiseCount = 1;
          this._resetHasActed(playerId);
          this._log(`${player.name}  completes to  ${this._bb(player.currentBet)} BB`);
          // Bring-in の左隣から行動開始
          player.hasActed = true;
          if (this._checkHandEnd()) return;
          this.currentPlayerIndex = this._firstActiveAfter(this.bringInPlayerId);
          if (this.currentPlayerIndex < 0) this.currentPlayerIndex = this.bringInPlayerId;
          if (this._isBettingRoundComplete()) this._advanceStreet();
          return;
        }
        // 通常の Complete（他プレイヤーが bring-in → small bet に引き上げ）
        const completeTotal = betSize; // small bet
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
      if (p.id !== exceptId && !p.folded && !p.isAllIn) {
        p.hasActed = false;
      }
    }
  }

  _checkHandEnd() {
    const remaining = this.activeInHandPlayers;
    if (remaining.length === 1) {
      const winner = remaining[0];
      this.lastPot = this.pot;
      this.lastWinners = [winner];
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

  // ── ストリート進行 ──
  _advanceStreet() {
    // ベッティングラウンドリセット
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

    // 全員オールイン（アクション可能なプレイヤーがいない）→ 残りカードを配って直接ショーダウン
    const canAct = this.players.filter(p => !p.folded && !p.isAllIn && p.chips > 0);
    if (canAct.length <= 1 && this.activeInHandPlayers.length >= 2) {
      // 残りストリートのカードを全て配る
      this._dealRemainingCards(nextState);
      return;
    }

    this.transition(nextState);

    if (nextState === StudState.SHOWDOWN) {
      this._runShowdown();
      return;
    }

    // カード配布
    this._dealStreetCard(nextState);

    // 行動順決定: Fourth Street+ は最強可視ハンドのプレイヤーから
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
      c.faceUp = !isSeventh; // 7th Street は裏向き
      c.isNew = true;
      c.newIndex = 0;
      p.hand.push(c);
    }
  }

  // オールインランアウト: 残りストリートのカードを一括配布してショーダウン
  _dealRemainingCards(fromState) {
    const STREET_ORDER = [
      StudState.FOURTH_STREET,
      StudState.FIFTH_STREET,
      StudState.SIXTH_STREET,
      StudState.SEVENTH_STREET,
    ];

    const startIdx = STREET_ORDER.indexOf(fromState);
    if (startIdx < 0) {
      // すでに SHOWDOWN 行き
      this.transition(StudState.SHOWDOWN);
      this._runShowdown();
      return;
    }

    for (let i = startIdx; i < STREET_ORDER.length; i++) {
      const st = STREET_ORDER[i];
      this.state = st; // 中間遷移（表示用）
      this._dealStreetCard(st);
    }

    this.state = StudState.SEVENTH_STREET; // 最終ストリート状態を設定
    this.transition(StudState.SHOWDOWN);
    this._runShowdown();
  }

  // ── ショーダウン ──
  _runShowdown() {
    const contenders = this.activeInHandPlayers;

    for (const p of contenders) {
      p.handResult = evaluateHand(p.hand);
    }

    const winners = determineWinners(contenders);
    if (winners.length === 0) {
      this.pot = 0;
      this.transition(StudState.COMPLETE);
      return;
    }

    this.lastPot = this.pot;
    this.lastWinners = winners;

    const share = Math.floor(this.pot / winners.length);
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
    this.transition(StudState.COMPLETE);
  }

  // ── GameAdapter ヘルパー ──
  getCurrentPlayer() {
    if (this.currentPlayerIndex < 0) return null;
    return this.players[this.currentPlayerIndex];
  }

  getSBIndex() { return -1; } // Stud はブラインドなし
  getBBIndex() { return -1; }

  // ドローゲーム専用スタブ
  selectCardsForDraw() { /* Stud: no-op */ }
  confirmDraw()        { /* Stud: no-op */ }

  /** UI用: 現在の役をリアルタイム評価 */
  evaluateCurrentHand(playerId) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.hand || p.hand.length < 5) return null;
    try { return evaluateHand(p.hand); } catch(e) { return null; }
  }

  _bb(chips) {
    const v = chips / this.bigBlind;
    if (Number.isInteger(v)) return `${v}`;
    const s1 = v.toFixed(1);
    if (parseFloat(s1) === v) return s1;
    return parseFloat(v.toFixed(2)).toString();
  }

  _log(msg) { this.actionLog.push(msg); }
  addLog(msg) { this.actionLog.push(msg); }

  // ── 内部ヘルパー ──
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
