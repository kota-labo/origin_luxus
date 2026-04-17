// Pot Limit Omaha (PLO) — CPU AI
// CLAUDE.md準拠: Math.random() 禁止、crypto.getRandomValues() 使用
//
// 戦略:
//   - プリフロップ: Omaha 4枚ハンド強度 (ペア / ダブルスート / コネクター / ハイカード)
//       強 → レイズ (2.5〜3BB オープン, pot リレイズ)
//       中 → コール寄り, ポジションで時々レイズ
//       弱 → フォールド (BB defense 例外あり)
//   - ポストフロップ: evaluateHiOmaha による役ランクベース
//       SET+/TWO_PAIR → バリューベット/レイズ
//       TOP_PAIR → コール中心
//       ドロー (フラッシュ/ストレート) → セミブラフ or コール
//       弱 → チェック/フォールド
//   - Pot Limit: 全てのベット/レイズ額を adapter.getPotLimitMaxAmount() でクランプ

import { Action } from './logic.js';
import { evaluateHiOmaha } from '../flo8/evaluator.js';

// ══════════════════════════════════════════════
// §0  乱数
// ══════════════════════════════════════════════
function rng01() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x100000000;
}

// ══════════════════════════════════════════════
// §1  Pot Limit クランプヘルパー
// ══════════════════════════════════════════════

/**
 * 希望する raise-above-call 額を Pot Limit 上限でクランプする。
 * @param {PLOGame} adapter
 * @param {Player} player
 * @param {number} desiredAmount - 希望する amount (raise above call)
 * @returns {number} クランプ後の amount
 */
function clampRaise(adapter, player, desiredAmount) {
  const maxPL = adapter.getPotLimitMaxAmount(player.id, true);
  return Math.min(Math.max(1, Math.floor(desiredAmount)), maxPL);
}

/**
 * 希望する bet 額を Pot Limit 上限でクランプする。
 */
function clampBet(adapter, desiredAmount) {
  const maxPL = adapter.getPotLimitMaxAmount(0, false);   // playerId 任意 (bet は共通)
  return Math.min(Math.max(adapter.bigBlind, Math.floor(desiredAmount)), maxPL);
}

// ══════════════════════════════════════════════
// §2  プリフロップ: 4枚ハンド強度評価 (FLO8 CPU と同等)
// ══════════════════════════════════════════════

function preflopStrength(hand) {
  if (!hand || hand.length !== 4) return 0.2;

  const ranks = hand.map(c => c.value);
  const suits = hand.map(c => c.suit);
  const rankCount = {}; ranks.forEach(r => rankCount[r] = (rankCount[r] || 0) + 1);
  const suitCount = {}; suits.forEach(s => suitCount[s] = (suitCount[s] || 0) + 1);

  let score = 0.08;

  // ペア評価
  const pairedRanks = Object.entries(rankCount).filter(([, c]) => c >= 2);
  if (pairedRanks.length >= 1) {
    const maxPair = Math.max(...pairedRanks.map(([v]) => parseInt(v, 10)));
    score += 0.22;
    if (maxPair >= 10) score += 0.15;                // ハイペア (JJ+)
    if (pairedRanks.length >= 2) score += 0.12;       // ダブルペア (aabb)
  }

  // ハイカード
  const maxR = Math.max(...ranks);
  if (maxR >= 12) score += 0.10;        // A あり
  else if (maxR >= 10) score += 0.07;   // J 以上

  // スート構造
  const suitVals = Object.values(suitCount);
  const doubleSuited = suitVals.filter(c => c >= 2).length >= 2;
  const singleSuited = suitVals.some(c => c >= 2);
  if (doubleSuited)      score += 0.20;   // ダブルスート
  else if (singleSuited) score += 0.08;

  // コネクター度
  const uniqueR = [...new Set(ranks)].sort((a, b) => a - b);
  if (uniqueR.length === 4) {
    const spread = uniqueR[3] - uniqueR[0];
    if (spread <= 4) score += 0.18;       // タイトコネクター (JT98 等)
    else if (spread <= 6) score += 0.08;
  }

  return Math.min(1.0, score);
}

// ══════════════════════════════════════════════
// §3  ポストフロップ: Omaha Hi 役ランク → 強度スコア
// ══════════════════════════════════════════════

// HandRank 0-9 → 強度 [0.20 .. 1.0]
const HI_RANK_SCORE = [0.20, 0.40, 0.58, 0.72, 0.82, 0.88, 0.93, 0.97, 0.99, 1.0];

function postflopStrength(adapter, playerId) {
  const p = adapter.players[playerId];
  if (!p || p.hand.length !== 4) return 0.2;
  const board = adapter.communityCards;
  if (board.length < 3) return preflopStrength(p.hand);

  try {
    const hi = evaluateHiOmaha(p.hand, board);
    if (!hi) return 0.2;
    return HI_RANK_SCORE[hi.rank] ?? 0.25;
  } catch (e) {
    return 0.2;
  }
}

// ══════════════════════════════════════════════
// §4  ベット決定
// ══════════════════════════════════════════════

export function decideCpuAction(adapter) {
  const p = adapter.getCurrentPlayer();
  if (!p) return { action: Action.CHECK, amount: 0 };

  const valid = adapter.getValidActions(p);
  if (valid.length === 0) return { action: Action.CHECK, amount: 0 };
  if (valid.length === 1) return { action: valid[0], amount: 0 };

  const state = adapter.state;
  const isPreflop = state === 'PREFLOP';
  const strength = isPreflop
    ? preflopStrength(p.hand)
    : postflopStrength(adapter, p.id);

  const toCall  = adapter.currentBet - p.currentBet;
  const potOdds = toCall > 0 ? toCall / (adapter.pot + toCall) : 0;
  const r       = rng01();
  const bb      = adapter.bigBlind;
  const pot     = adapter.pot;

  // ── チェック可能 (先手) ──
  if (toCall === 0) {
    // 超強 (ナッツ級): ポット 75-100% バリューベット
    if (strength > 0.85 && valid.includes(Action.BET) && r < 0.80) {
      const desired = pot * (r < 0.5 ? 0.75 : 1.0);
      return { action: Action.BET, amount: clampBet(adapter, desired) };
    }
    // 強 (TOP_PAIR+/TWO_PAIR+): ポット 50-66%
    if (strength > 0.65 && valid.includes(Action.BET) && r < 0.70) {
      return { action: Action.BET, amount: clampBet(adapter, pot * 0.6) };
    }
    // 中: 混合ベット 30%
    if (strength > 0.45 && valid.includes(Action.BET) && r < 0.30) {
      return { action: Action.BET, amount: clampBet(adapter, pot * 0.5) };
    }
    // プリフロップでオープンレイズ
    if (isPreflop && strength > 0.50 && valid.includes(Action.RAISE) && r < 0.55) {
      // オープン: 2.5〜3BB
      const openTo = bb * (r < 0.5 ? 2.5 : 3.0);
      const desired = openTo - adapter.currentBet;
      return { action: Action.RAISE, amount: clampRaise(adapter, p, desired) };
    }
    // ブラフ (低頻度)
    if (strength > 0.25 && valid.includes(Action.BET) && r < 0.10) {
      return { action: Action.BET, amount: clampBet(adapter, pot * 0.5) };
    }
    return { action: Action.CHECK, amount: 0 };
  }

  // ── 面している (コール / レイズ / フォールド) ──

  // 超強ナッツ: 高頻度レイズ
  if (strength > 0.90) {
    if (valid.includes(Action.RAISE) && r < 0.70) {
      // ポットレイズ
      const desired = pot + toCall;  // = potLimitMaxRaiseAmount
      return { action: Action.RAISE, amount: clampRaise(adapter, p, desired) };
    }
    return valid.includes(Action.CALL) ? { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
  }

  // 強 (TOP_PAIR/SET クラス)
  if (strength > 0.70) {
    if (valid.includes(Action.RAISE) && r < 0.35) {
      // 75% ポットレイズ
      const desired = (pot + toCall) * 0.75;
      return { action: Action.RAISE, amount: clampRaise(adapter, p, desired) };
    }
    return valid.includes(Action.CALL) ? { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
  }

  // 中 (ドロー含む)
  if (strength > 0.45) {
    if (potOdds < 0.30 && valid.includes(Action.CALL)) return { action: Action.CALL, amount: 0 };
    // セミブラフレイズ (低頻度)
    if (valid.includes(Action.RAISE) && r < 0.08) {
      const desired = (pot + toCall) * 0.6;
      return { action: Action.RAISE, amount: clampRaise(adapter, p, desired) };
    }
    return r < 0.55 && valid.includes(Action.CALL)
      ? { action: Action.CALL, amount: 0 }
      : { action: Action.FOLD, amount: 0 };
  }

  // 弱〜中
  if (strength > 0.25) {
    if (potOdds < 0.22 && valid.includes(Action.CALL) && r < 0.45) {
      return { action: Action.CALL, amount: 0 };
    }
    return { action: Action.FOLD, amount: 0 };
  }

  // 弱: 基本フォールド、稀にブラフキャッチ
  if (potOdds < 0.15 && valid.includes(Action.CALL) && r < 0.20) {
    return { action: Action.CALL, amount: 0 };
  }
  return { action: Action.FOLD, amount: 0 };
}
