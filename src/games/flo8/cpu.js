// Fixed Limit Omaha Hi/Lo 8-or-Better — CPU AI
// CLAUDE.md準拠: Math.random() 禁止、crypto.getRandomValues() 使用
//
// Hi / Lo 両面を評価する総合強度ベース:
//   §A プリフロップ — 4枚ハンドの構造評価 (ペア/ダブルスート/コネクター + Lo可能性)
//   §B ポストフロップ — Omaha 2+3 評価に基づく Hi/Lo 強度
//   §C ベット決定 — Fixed Limit 向け decision tree (スクープ候補は積極的)

import { Action } from './logic.js';
import { evaluateHiOmaha, evaluateLo8Omaha, lowValue } from './evaluator.js';

// ══════════════════════════════════════════════
// §0  乱数
// ══════════════════════════════════════════════

function rng01() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x100000000;
}

// ══════════════════════════════════════════════
// §A  プリフロップ 4枚ハンド強度評価
// ══════════════════════════════════════════════

/**
 * プリフロップ強度 (0.0〜1.0)
 *   Hi要素: ペア / ハイカード / スート構造 (ダブル/シングル) / コネクター
 *   Lo要素: 8以下カード数 / A2/A3/A4 ナッツロースタート
 *   スクープ候補: Hi+Lo 両方強ければ加点 (ダブルサブルド A2xx 等)
 */
function preflopStrength(hand) {
  if (!hand || hand.length !== 4) return 0.2;

  const ranks = hand.map(c => c.value);
  const suits = hand.map(c => c.suit);
  const rankCount = {}; ranks.forEach(r => rankCount[r] = (rankCount[r] || 0) + 1);
  const suitCount = {}; suits.forEach(s => suitCount[s] = (suitCount[s] || 0) + 1);

  // ── Hi 強度 ──
  let hi = 0.05;
  // ペア (= count >= 2 のランク)
  const pairedRanks = Object.entries(rankCount).filter(([, c]) => c >= 2);
  if (pairedRanks.length >= 1) {
    const maxPair = Math.max(...pairedRanks.map(([v]) => parseInt(v, 10)));
    hi += 0.22;
    if (maxPair >= 10) hi += 0.12;           // ハイペア (JJ+)
    if (pairedRanks.length >= 2) hi += 0.10;  // ダブルペア (aabb)
  }
  // ハイカード
  const maxR = Math.max(...ranks);
  if (maxR >= 12) hi += 0.10;       // Aあり
  else if (maxR >= 10) hi += 0.07;  // J以上
  // スート構造
  const suitVals = Object.values(suitCount);
  const doubleSuited = suitVals.filter(c => c >= 2).length >= 2;
  const singleSuited = suitVals.some(c => c >= 2);
  if (doubleSuited)      hi += 0.18;   // ダブルスート (フラッシュ組み合わせが複数)
  else if (singleSuited) hi += 0.08;
  // コネクター度 (ユニークランクのスパン)
  const uniqueR = [...new Set(ranks)].sort((a, b) => a - b);
  if (uniqueR.length === 4) {
    const spread = uniqueR[3] - uniqueR[0];
    if (spread <= 4) hi += 0.18;       // タイトコネクター
    else if (spread <= 6) hi += 0.08;  // ルースコネクター
  }

  // ── Lo 強度 ──
  const lowCardCount = ranks.filter(v => v <= 6 || v === 12).length;  // 8以下 (A=12含む)
  const hasA = ranks.includes(12);
  const has2 = ranks.includes(0);
  const has3 = ranks.includes(1);
  const has4 = ranks.includes(2);

  let lo = 0;
  if (lowCardCount === 4)      lo = 0.62;
  else if (lowCardCount === 3) lo = 0.40;
  else if (lowCardCount === 2) lo = 0.20;
  // ナッツロースタート
  if (hasA && has2)      lo += 0.18;  // A2 = ホイール可能性
  else if (hasA && has3) lo += 0.12;  // A3
  else if (hasA && has4) lo += 0.08;  // A4
  else if (hasA)         lo += 0.06;  // A + 他Lo
  if (has2 && has3)      lo += 0.04;  // 23 ナッツプロテクト

  lo = Math.min(0.95, lo);

  // ── スクープ候補補正 ──
  // Hi と Lo の両方が強い (ダブルサブルド A2xx, AA23 等) は最強のスタート
  const both = Math.min(hi, lo);
  return Math.min(1.0, Math.max(hi, lo) + both * 0.35);
}

// ══════════════════════════════════════════════
// §B  ポストフロップ強度評価 (Omaha 2+3)
// ══════════════════════════════════════════════

// Hi rank (0=HIGH_CARD ... 9=ROYAL_FLUSH) → 強度スコア
const HI_RANK_SCORE = [0.20, 0.40, 0.58, 0.70, 0.80, 0.86, 0.92, 0.96, 0.99, 1.0];

function postflopStrength(adapter, playerId) {
  const p = adapter.players[playerId];
  if (!p || !p.hand || p.hand.length !== 4) return 0.2;
  const board = adapter.communityCards;
  if (board.length < 3) return preflopStrength(p.hand);

  // ── Hi 強度 (役ランクベース) ──
  let hiScore = 0.15;
  try {
    const hi = evaluateHiOmaha(p.hand, board);
    if (hi) hiScore = HI_RANK_SCORE[hi.rank] ?? 0.2;
  } catch (e) { /* ignore */ }

  // ── Lo 強度 (成立/ドローで分類) ──
  let loScore = 0;
  try {
    const lo = evaluateLo8Omaha(p.hand, board);
    if (lo) {
      const highLo = lo.kickers[0];  // 1=A(ホイール判定)、5=5(wheel)、8=8-low
      if      (highLo === 5) loScore = 0.95;  // ホイール (A-5)
      else if (highLo === 6) loScore = 0.82;  // 6-Low
      else if (highLo === 7) loScore = 0.65;  // 7-Low
      else                   loScore = 0.45;  // 8-Low
    } else {
      // Lo ドロー判定: 手札から2枚 + ボード既存の低カード合計でリバー成立余地
      loScore = loDrawStrength(p.hand, board);
    }
  } catch (e) { /* ignore */ }

  // ── スクープ候補補正 ──
  const both = Math.min(hiScore, loScore);
  return Math.min(1.0, Math.max(hiScore, loScore) + both * 0.25);
}

/**
 * Lo ドロー強度: Lo 不成立時、手札/ボードの 8以下カード数からリバーでの成立確率を概算
 *   手札≤8 カード数 × ボード≤8 カード数 と残り残ストリート数で段階評価
 */
function loDrawStrength(hand, board) {
  const handLows  = hand.filter(c => lowValue(c) <= 8).length;
  const boardLows = board.filter(c => lowValue(c) <= 8).length;
  const streetsLeft = 5 - board.length;  // フロップ=2, ターン=1, リバー=0

  if (streetsLeft === 0) return 0;  // リバー到達済みで Lo 不成立 → 以後成立不可
  if (handLows < 2) return 0;       // 手札から2枚必須 (Omaha ルール)
  if (boardLows < 2 && streetsLeft < 1) return 0;  // ボードが不足かつ追加カードなし

  // 簡易スコア: handLows=2,boardLows=2 & ターン前 → 0.22、手札4枚low + ボード3low なら 0.40
  let draw = 0.08;
  if (handLows >= 3) draw += 0.08;
  if (handLows >= 4) draw += 0.06;
  if (boardLows >= 3) draw += 0.10;
  if (streetsLeft >= 2) draw += 0.08;  // フロップ: 2枚追加チャンス
  return Math.min(0.40, draw);
}

// ══════════════════════════════════════════════
// §C  ベット決定 (Fixed Limit)
// ══════════════════════════════════════════════

/**
 * CPU のアクションを決定する。
 * @param {FLO8Game} adapter
 * @returns {{ action: string, amount: number }}
 */
export function decideCpuAction(adapter) {
  const p = adapter.getCurrentPlayer();
  if (!p) return { action: Action.CHECK, amount: 0 };

  const valid = adapter.getValidActions(p);
  if (valid.length === 0) return { action: Action.CHECK, amount: 0 };

  const state = adapter.state;
  const isPreflop = state === 'PREFLOP';
  const strength = isPreflop
    ? preflopStrength(p.hand)
    : postflopStrength(adapter, p.id);

  const toCall  = adapter.currentBet - p.currentBet;
  const potOdds = toCall > 0 ? toCall / (adapter.pot + toCall) : 0;
  const r       = rng01();

  // ── チェック可能 (主導権あり) ──
  if (toCall === 0) {
    // 強 → ベット (高頻度)
    if (strength > 0.70 && valid.includes(Action.BET) && r < 0.80) {
      return { action: Action.BET, amount: 0 };
    }
    // 中〜強 → 混合ベット
    if (strength > 0.50 && valid.includes(Action.BET) && r < 0.45) {
      return { action: Action.BET, amount: 0 };
    }
    // プリフロップで強いスクープ候補 → 積極的にレイズ
    if (isPreflop && strength > 0.55 && valid.includes(Action.BET) && r < 0.55) {
      return { action: Action.BET, amount: 0 };
    }
    // ブラフ (ドライボードでの低頻度)
    if (strength > 0.25 && valid.includes(Action.BET) && r < 0.12) {
      return { action: Action.BET, amount: 0 };
    }
    return { action: Action.CHECK, amount: 0 };
  }

  // ── 面している (コール/レイズ/フォールド) ──

  // 超強 (ナッツ級) → レイズ積極
  if (strength > 0.85) {
    if (valid.includes(Action.RAISE) && r < 0.75) return { action: Action.RAISE, amount: 0 };
    return valid.includes(Action.CALL) ? { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
  }

  // 強 (スクープ候補 / ナッツ Hi or Lo)
  if (strength > 0.65) {
    if (valid.includes(Action.RAISE) && r < 0.40) return { action: Action.RAISE, amount: 0 };
    return valid.includes(Action.CALL) ? { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
  }

  // 中 (一方のみ強 / ドローあり)
  if (strength > 0.40) {
    // ポットオッズ良 → コール
    if (potOdds < 0.30 && valid.includes(Action.CALL)) return { action: Action.CALL, amount: 0 };
    // 中でも稀にセミブラフレイズ
    if (valid.includes(Action.RAISE) && r < 0.08) return { action: Action.RAISE, amount: 0 };
    return r < 0.55 && valid.includes(Action.CALL)
      ? { action: Action.CALL, amount: 0 }
      : { action: Action.FOLD, amount: 0 };
  }

  // 弱〜中 (ドロー or 安いコール)
  if (strength > 0.22) {
    if (potOdds < 0.22 && valid.includes(Action.CALL) && r < 0.45) {
      return { action: Action.CALL, amount: 0 };
    }
    return { action: Action.FOLD, amount: 0 };
  }

  // 弱 (ブラフキャッチのみ)
  if (strength > 0.10 && potOdds < 0.15 && valid.includes(Action.CALL) && r < 0.25) {
    return { action: Action.CALL, amount: 0 };
  }
  return { action: Action.FOLD, amount: 0 };
}
