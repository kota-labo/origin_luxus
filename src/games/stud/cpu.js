// Seven Card Stud High — CPU AI
// CLAUDE.md準拠: Math.random()は使用禁止、crypto.getRandomValues()を使用
// decideCpuAction(adapter) → { action, amount } を返す純粋関数

import { StudAction } from './logic.js';
import { evaluateVisibleHand } from './evaluator.js';

/**
 * CPUのアクションを決定する（中級レベル）
 * @param {StudGame} adapter - GameAdapter準拠のゲームインスタンス
 * @returns {{ action: string, amount: number }}
 */
export function decideCpuAction(adapter) {
  const p = adapter.getCurrentPlayer();
  if (!p) return { action: StudAction.CHECK, amount: 0 };

  const valid = adapter.getValidActions(p);
  if (valid.length === 0) return { action: StudAction.CHECK, amount: 0 };

  const toCall  = adapter.currentBet - p.currentBet;
  const potOdds = toCall > 0 ? toCall / (adapter.pot + toCall) : 0;

  const rng = new Uint32Array(1);
  crypto.getRandomValues(rng);
  const rand = rng[0] / 0x100000000;

  // ハンド強度の簡易評価
  const handStrength = _assessHandStrength(p, adapter);

  // ストリート別: 4th/5th ではボード強度重視、6th/7th ではハンド強度重視
  const street = adapter.state;
  const isEarlyStreet = (street === 'FOURTH_STREET' || street === 'FIFTH_STREET');
  const effectiveStrength = isEarlyStreet
    ? _blendWithBoardStrength(p, handStrength)
    : handStrength;

  // Bring-in 選択（最弱ドアカードプレイヤー）→ CPU は 100% BRING_IN を選択
  if (valid.includes(StudAction.BRING_IN)) {
    return { action: StudAction.BRING_IN, amount: 0 };
  }

  // Complete アクションが可能な場合（Third Street bring-in 後）
  if (valid.includes(StudAction.COMPLETE) && !valid.includes(StudAction.BET) && !valid.includes(StudAction.RAISE)) {
    // bring-in 後の Complete/Call/Fold 判断
    if (handStrength > 0.6 && rand < 0.7) {
      return { action: StudAction.COMPLETE, amount: 0 };
    }
    if (handStrength > 0.3 && rand < 0.4) {
      return { action: StudAction.COMPLETE, amount: 0 };
    }
    // 弱いハンドはコール or フォールド
    if (toCall > 0) {
      return rand < 0.6
        ? { action: StudAction.CALL, amount: 0 }
        : { action: StudAction.FOLD, amount: 0 };
    }
    return { action: StudAction.CALL, amount: 0 };
  }

  let action = StudAction.FOLD;
  let amount = 0;

  if (toCall === 0) {
    // チェック可能 — 4th/5th ではボードが強いとベット頻度UP
    if (effectiveStrength > 0.6 && rand < 0.6 && valid.includes(StudAction.BET)) {
      action = StudAction.BET;
    } else if (effectiveStrength > 0.35 && rand < 0.35 && valid.includes(StudAction.BET)) {
      action = StudAction.BET;
    } else {
      action = StudAction.CHECK;
    }
  } else {
    // コール必要
    if (effectiveStrength > 0.6) {
      // 強いハンド: レイズ or コール
      if (rand < 0.4 && valid.includes(StudAction.RAISE)) {
        action = StudAction.RAISE;
      } else if (valid.includes(StudAction.CALL)) {
        action = StudAction.CALL;
      } else {
        action = StudAction.FOLD;
      }
    } else if (effectiveStrength > 0.3) {
      // 中程度: ポットオッズ次第
      if (potOdds < 0.35 && valid.includes(StudAction.CALL)) {
        action = rand < 0.75 ? StudAction.CALL : StudAction.FOLD;
      } else {
        action = rand < 0.45 ? StudAction.CALL : StudAction.FOLD;
      }
    } else {
      // 弱い: 基本フォールド
      action = rand < 0.2 && valid.includes(StudAction.CALL) ? StudAction.CALL : StudAction.FOLD;
    }
  }

  // フォールバック: 無効アクション
  if (!valid.includes(action)) {
    action = valid.includes(StudAction.CHECK) ? StudAction.CHECK
           : valid.includes(StudAction.CALL)  ? StudAction.CALL
           : StudAction.FOLD;
    amount = 0;
  }

  return { action, amount };
}

/**
 * 4th/5th Street用: ボード（faceUpカード）の強さをブレンド
 * ドアカードが強い場合、ベット頻度が上がる
 */
function _blendWithBoardStrength(player, baseStrength) {
  const visCards = player.hand.filter(c => c.faceUp);
  if (visCards.length === 0) return baseStrength;

  // ボード上のペア・高カード検出
  const values = visCards.map(c => c.value);
  const rankCount = {};
  for (const v of values) { rankCount[v] = (rankCount[v] || 0) + 1; }
  const maxCount = Math.max(...Object.values(rankCount));
  const highCard = Math.max(...values);

  let boardStrength = 0.25;
  if (maxCount >= 2) boardStrength += 0.3;  // ボード上ペア
  if (maxCount >= 3) boardStrength += 0.25; // ボード上トリップス
  if (highCard >= 14) boardStrength += 0.15; // A visible
  else if (highCard >= 12) boardStrength += 0.1;  // K/Q visible
  else if (highCard >= 10) boardStrength += 0.05;  // J/10 visible

  // フラッシュドロー: 同スート3枚以上
  const suitCount = {};
  for (const c of visCards) { suitCount[c.suit] = (suitCount[c.suit] || 0) + 1; }
  const maxSuit = Math.max(...Object.values(suitCount));
  if (maxSuit >= 3) boardStrength += 0.12;

  boardStrength = Math.min(1.0, boardStrength);
  // ボード強度55%、ハンド強度45%のブレンド
  return 0.55 * boardStrength + 0.45 * baseStrength;
}

/**
 * ハンド強度の簡易評価 (0.0〜1.0)
 * 可視カード + ダウンカードの組み合わせで判断
 */
function _assessHandStrength(player, adapter) {
  const hand = player.hand;
  if (!hand || hand.length === 0) return 0.3;

  // ダウンカード + アップカード
  const allCards = hand;
  const values = allCards.map(c => c.value);

  // ペア以上の検出
  const rankCount = {};
  for (const v of values) {
    rankCount[v] = (rankCount[v] || 0) + 1;
  }
  const maxCount = Math.max(...Object.values(rankCount));
  const highCard = Math.max(...values);

  let strength = 0.2; // ベースライン

  // ペア
  if (maxCount >= 2) strength += 0.25;
  // トリップス
  if (maxCount >= 3) strength += 0.2;
  // フォーカインド
  if (maxCount >= 4) strength += 0.2;

  // ハイカードボーナス
  if (highCard >= 10) strength += 0.1; // J以上
  if (highCard >= 12) strength += 0.05; // K以上

  // フラッシュドロー（3枚以上同スート）
  const suitCount = {};
  for (const c of allCards) {
    suitCount[c.suit] = (suitCount[c.suit] || 0) + 1;
  }
  const maxSuit = Math.max(...Object.values(suitCount));
  if (maxSuit >= 3) strength += 0.1;
  if (maxSuit >= 4) strength += 0.15;

  // ストリートのステージが進むほどドローの可能性が低下
  if (allCards.length >= 6 && maxCount === 1 && maxSuit < 4) {
    strength -= 0.1;
  }

  // 5枚以上で評価可能なら正確な役判定
  if (allCards.length >= 5) {
    try {
      const result = adapter.evaluateCurrentHand(player.id);
      if (result) {
        // ランクベースの補正
        if (result.rank >= 4) strength = Math.max(strength, 0.85); // ストレート以上
        if (result.rank >= 6) strength = Math.max(strength, 0.95); // フルハウス以上
      }
    } catch(e) { /* 評価エラーは無視 */ }
  }

  return Math.min(1.0, Math.max(0.0, strength));
}
