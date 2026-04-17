// Razz (A-5 Lowball) — CPU AI
// CLAUDE.md準拠: Math.random()は使用禁止、crypto.getRandomValues()を使用
// decideCpuAction(adapter) → { action, amount } を返す純粋関数
// Razzではローハンドが強い: A=最強(最弱カード)、ペア=弱い、ストレート/フラッシュ無視

import { StudAction } from './logic.js';
import { evaluateVisibleLow } from './evaluator.js';

/**
 * CPUのアクションを決定する（中級レベル — Razz Lowball 特化）
 * @param {RazzGame} adapter - GameAdapter準拠のゲームインスタンス
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

  // ハンド強度の簡易評価（Razz用: ローハンド特化）
  const handStrength = _assessRazzStrength(p, adapter);

  // ストリート別: 早期はボード（可視カード）のロウ強度を重視
  const street = adapter.state;
  const isEarlyStreet = (street === 'FOURTH_STREET' || street === 'FIFTH_STREET');
  const effectiveStrength = isEarlyStreet
    ? _blendWithVisibleLow(p, handStrength)
    : handStrength;

  // Bring-in 選択 → CPU は 100% BRING_IN を選択
  if (valid.includes(StudAction.BRING_IN)) {
    return { action: StudAction.BRING_IN, amount: 0 };
  }

  // Complete アクションが可能な場合（Third Street bring-in 後）
  if (valid.includes(StudAction.COMPLETE) && !valid.includes(StudAction.BET) && !valid.includes(StudAction.RAISE)) {
    // Razz: 良いローハンド（低いカード3枚）→ Complete
    if (handStrength > 0.65 && rand < 0.75) {
      return { action: StudAction.COMPLETE, amount: 0 };
    }
    if (handStrength > 0.35 && rand < 0.45) {
      return { action: StudAction.COMPLETE, amount: 0 };
    }
    // 弱いハンドはコール or フォールド
    if (toCall > 0) {
      return rand < 0.55
        ? { action: StudAction.CALL, amount: 0 }
        : { action: StudAction.FOLD, amount: 0 };
    }
    return { action: StudAction.CALL, amount: 0 };
  }

  let action = StudAction.FOLD;
  let amount = 0;

  if (toCall === 0) {
    // チェック可能
    if (effectiveStrength > 0.6 && rand < 0.55 && valid.includes(StudAction.BET)) {
      action = StudAction.BET;
    } else if (effectiveStrength > 0.35 && rand < 0.30 && valid.includes(StudAction.BET)) {
      action = StudAction.BET;
    } else {
      action = StudAction.CHECK;
    }
  } else {
    // コール必要
    if (effectiveStrength > 0.6) {
      // 強いローハンド: レイズ or コール
      if (rand < 0.35 && valid.includes(StudAction.RAISE)) {
        action = StudAction.RAISE;
      } else if (valid.includes(StudAction.CALL)) {
        action = StudAction.CALL;
      } else {
        action = StudAction.FOLD;
      }
    } else if (effectiveStrength > 0.3) {
      // 中程度: ポットオッズ次第
      if (potOdds < 0.35 && valid.includes(StudAction.CALL)) {
        action = rand < 0.70 ? StudAction.CALL : StudAction.FOLD;
      } else {
        action = rand < 0.40 ? StudAction.CALL : StudAction.FOLD;
      }
    } else {
      // 弱い（ペアだらけ、ハイカード多い）: 基本フォールド
      action = rand < 0.15 && valid.includes(StudAction.CALL) ? StudAction.CALL : StudAction.FOLD;
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

// ── Razz 用ロウバリュー変換 ──
// card.js: 2=0, 3=1, ..., K=11, A=12
// Razz low: A=1, 2=2, 3=3, ..., K=13
function _lowValue(card) {
  return card.value === 12 ? 1 : card.value + 2;
}

/**
 * Razz 用ハンド強度評価 (0.0〜1.0)
 * 低いカードが多いほど強い、ペアは弱い
 */
function _assessRazzStrength(player, adapter) {
  const hand = player.hand;
  if (!hand || hand.length === 0) return 0.3;

  const lowVals = hand.map(_lowValue);

  // ペア検出
  const rankCount = {};
  for (const v of lowVals) {
    rankCount[v] = (rankCount[v] || 0) + 1;
  }
  const maxCount = Math.max(...Object.values(rankCount));
  const numPairs = Object.values(rankCount).filter(c => c >= 2).length;

  let strength = 0.5; // ベースライン（Razz はノーペアが基本強い）

  // ペアペナルティ
  if (maxCount >= 2) strength -= 0.20;
  if (maxCount >= 3) strength -= 0.20;
  if (numPairs >= 2) strength -= 0.15;

  // ローカード（A〜5）の枚数ボーナス
  const lowCount = lowVals.filter(v => v <= 5).length;
  strength += lowCount * 0.08;

  // ミッドカード（6〜8）
  const midCount = lowVals.filter(v => v >= 6 && v <= 8).length;
  strength += midCount * 0.03;

  // ハイカード（9〜K）ペナルティ
  const highCount = lowVals.filter(v => v >= 9).length;
  strength -= highCount * 0.06;

  // 最高カードの影響（低いほど良い）
  const maxLow = Math.max(...lowVals);
  if (maxLow <= 5) strength += 0.10;       // 5-low 圏内
  else if (maxLow <= 7) strength += 0.05;  // 7-low 圏内
  else if (maxLow <= 8) strength += 0.02;  // 8-low 圏内
  else if (maxLow >= 11) strength -= 0.08; // J+ ハイ = 弱い

  // 5枚以上で正確なロウハンド評価
  if (hand.length >= 5) {
    try {
      const result = adapter.evaluateCurrentHand(player.id);
      if (result) {
        // category 0 = ノーペア（最強カテゴリ）
        if (result.category === 0) {
          const highKicker = result.kickers[0]; // 降順の最大値
          if (highKicker <= 5) strength = Math.max(strength, 0.95);       // Wheel 圏内
          else if (highKicker <= 7) strength = Math.max(strength, 0.80);  // 7-low
          else if (highKicker <= 8) strength = Math.max(strength, 0.65);  // 8-low
          else if (highKicker <= 9) strength = Math.max(strength, 0.50);  // 9-low
          else strength = Math.max(strength, 0.35);                       // 10+ low
        }
        // ペア以上は低強度のまま
      }
    } catch(e) { /* 評価エラーは無視 */ }
  }

  return Math.min(1.0, Math.max(0.0, strength));
}

/**
 * 4th/5th Street用: 可視カードのロウ強度をブレンド
 * 良いロウ可視カード → ベット頻度UP
 */
function _blendWithVisibleLow(player, baseStrength) {
  const visCards = player.hand.filter(c => c.faceUp);
  if (visCards.length === 0) return baseStrength;

  const lowVals = visCards.map(_lowValue);

  // ペア検出
  const rankCount = {};
  for (const v of lowVals) { rankCount[v] = (rankCount[v] || 0) + 1; }
  const maxCount = Math.max(...Object.values(rankCount));

  let boardStrength = 0.5;

  // ペアがボード上に見えている → 弱い（Razz ではペナルティ）
  if (maxCount >= 2) boardStrength -= 0.25;
  if (maxCount >= 3) boardStrength -= 0.20;

  // ローカードボーナス
  const lowCount = lowVals.filter(v => v <= 5).length;
  boardStrength += lowCount * 0.12;

  // ハイカードペナルティ
  const highCount = lowVals.filter(v => v >= 9).length;
  boardStrength -= highCount * 0.10;

  // 最高可視カード
  const maxVis = Math.max(...lowVals);
  if (maxVis <= 5) boardStrength += 0.15;
  else if (maxVis <= 8) boardStrength += 0.08;

  boardStrength = Math.min(1.0, Math.max(0.0, boardStrength));

  // ボード強度50%、ハンド強度50%のブレンド
  return 0.50 * boardStrength + 0.50 * baseStrength;
}
