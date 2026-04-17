// Seven Card Stud Hi/Lo 8-or-Better — CPU AI
// 初期実装: Stud-Hi の CPU をベースに、Lo を狙えるハンド (3枚すべて8以下) への
// 参加率を少し上げる軽量拡張版。
// TODO: Phase 2 — Lo ドロー強度の精密評価、スクープ狙いのアグレッション、
//                 相手の可視ボードから Lo 可能性を推定
//
// CLAUDE.md準拠: Math.random() 使用禁止、crypto.getRandomValues() 使用

import { StudAction } from './logic.js';

/**
 * CPUのアクションを決定する。
 * @param {Stud8Game} adapter
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

  // ハンド強度 — Hi + Lo 両面を考慮
  const handStrength = _assessHandStrengthHiLo(p, adapter);

  // 早期ストリートはボード強度をブレンド
  const street = adapter.state;
  const isEarlyStreet = (street === 'FOURTH_STREET' || street === 'FIFTH_STREET');
  const effectiveStrength = isEarlyStreet
    ? _blendWithBoardStrength(p, handStrength)
    : handStrength;

  // Bring-in: 100% BRING_IN を選択
  if (valid.includes(StudAction.BRING_IN)) {
    return { action: StudAction.BRING_IN, amount: 0 };
  }

  // Third Street の COMPLETE 判断
  if (valid.includes(StudAction.COMPLETE) && !valid.includes(StudAction.BET) && !valid.includes(StudAction.RAISE)) {
    if (handStrength > 0.6 && rand < 0.7) {
      return { action: StudAction.COMPLETE, amount: 0 };
    }
    if (handStrength > 0.3 && rand < 0.4) {
      return { action: StudAction.COMPLETE, amount: 0 };
    }
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
    if (effectiveStrength > 0.6 && rand < 0.6 && valid.includes(StudAction.BET)) {
      action = StudAction.BET;
    } else if (effectiveStrength > 0.35 && rand < 0.35 && valid.includes(StudAction.BET)) {
      action = StudAction.BET;
    } else {
      action = StudAction.CHECK;
    }
  } else {
    if (effectiveStrength > 0.6) {
      if (rand < 0.4 && valid.includes(StudAction.RAISE)) {
        action = StudAction.RAISE;
      } else if (valid.includes(StudAction.CALL)) {
        action = StudAction.CALL;
      } else {
        action = StudAction.FOLD;
      }
    } else if (effectiveStrength > 0.3) {
      if (potOdds < 0.35 && valid.includes(StudAction.CALL)) {
        action = rand < 0.75 ? StudAction.CALL : StudAction.FOLD;
      } else {
        action = rand < 0.45 ? StudAction.CALL : StudAction.FOLD;
      }
    } else {
      action = rand < 0.2 && valid.includes(StudAction.CALL) ? StudAction.CALL : StudAction.FOLD;
    }
  }

  if (!valid.includes(action)) {
    action = valid.includes(StudAction.CHECK) ? StudAction.CHECK
           : valid.includes(StudAction.CALL)  ? StudAction.CALL
           : StudAction.FOLD;
    amount = 0;
  }

  return { action, amount };
}

/**
 * Hi/Lo 双方を考慮したハンド強度評価 (0.0〜1.0)
 *   - Hi 強度 (Stud-Hi と同じロジック)
 *   - Lo 可能性 (8以下のカード枚数) を加点
 *   - 両面可能 (スクープ候補) はさらに加点
 */
function _assessHandStrengthHiLo(player, adapter) {
  const hand = player.hand || [];
  if (hand.length === 0) return 0.3;

  const values = hand.map(c => c.value);
  // card.value: 2=0, 3=1, ..., 8=6, 9=7, T=8, J=9, Q=10, K=11, A=12
  // 8以下のカード: value <= 6 または A(12)
  const lowCount = values.filter(v => v <= 6 || v === 12).length;

  // ── Hi 強度 (Stud-Hi と同等) ──
  const rankCount = {};
  for (const v of values) rankCount[v] = (rankCount[v] || 0) + 1;
  const maxCount = Math.max(...Object.values(rankCount));
  const highCard = Math.max(...values);

  let hi = 0.2;
  if (maxCount >= 2) hi += 0.25;
  if (maxCount >= 3) hi += 0.2;
  if (maxCount >= 4) hi += 0.2;
  if (highCard >= 10) hi += 0.1;
  if (highCard >= 12) hi += 0.05;

  // フラッシュドロー
  const suitCount = {};
  for (const c of hand) suitCount[c.suit] = (suitCount[c.suit] || 0) + 1;
  const maxSuit = Math.max(...Object.values(suitCount));
  if (maxSuit >= 3) hi += 0.1;
  if (maxSuit >= 4) hi += 0.15;

  // 役確定 (5枚以上)
  if (hand.length >= 5) {
    try {
      const r = adapter.evaluateCurrentHand(player.id);
      if (r) {
        if (r.rank >= 4) hi = Math.max(hi, 0.85);
        if (r.rank >= 6) hi = Math.max(hi, 0.95);
      }
    } catch(e) { /* ignore */ }
  }

  // ── Lo 強度評価 ──
  // 手札総数に対する 8以下の割合 × Lo 完成の見込み
  let lo = 0;
  const n = hand.length;
  if (n <= 3) {
    // 3rd Street: 3枚全部8以下ならスタート強い
    if (lowCount === 3) lo = 0.55;       // 3枚low = 有望なLoスタート
    else if (lowCount === 2) lo = 0.25;
    else if (lowCount === 1) lo = 0.05;
  } else if (n === 4) {
    if (lowCount >= 4) lo = 0.60;
    else if (lowCount === 3) lo = 0.35;
    else if (lowCount === 2) lo = 0.10;
  } else if (n === 5) {
    if (lowCount >= 5) lo = 0.70;
    else if (lowCount === 4) lo = 0.40;
    else if (lowCount === 3) lo = 0.15;
  } else if (n === 6) {
    if (lowCount >= 5) lo = 0.65;
    else if (lowCount === 4) lo = 0.25;
  } else {
    // 7枚: Lo 確定チェック (評価器で5枚揃うかは実行コスト高のため簡易判定)
    if (lowCount >= 5) lo = 0.70;
    else if (lowCount === 4) lo = 0.15;
  }

  // Hi + Lo のブレンド — スクープ候補 (両面強い) は加点
  const both = Math.min(hi, lo);
  const combined = Math.max(hi, lo) + both * 0.25;

  return Math.min(1.0, Math.max(0.0, combined));
}

/** 4th/5th Street 用: ボード強度ブレンド (Stud-Hi と同一) */
function _blendWithBoardStrength(player, baseStrength) {
  const visCards = player.hand.filter(c => c.faceUp);
  if (visCards.length === 0) return baseStrength;

  const values = visCards.map(c => c.value);
  const rankCount = {};
  for (const v of values) rankCount[v] = (rankCount[v] || 0) + 1;
  const maxCount = Math.max(...Object.values(rankCount));
  const highCard = Math.max(...values);

  let boardStrength = 0.25;
  if (maxCount >= 2) boardStrength += 0.3;
  if (maxCount >= 3) boardStrength += 0.25;
  if (highCard >= 14) boardStrength += 0.15;
  else if (highCard >= 12) boardStrength += 0.1;
  else if (highCard >= 10) boardStrength += 0.05;

  const suitCount = {};
  for (const c of visCards) suitCount[c.suit] = (suitCount[c.suit] || 0) + 1;
  const maxSuit = Math.max(...Object.values(suitCount));
  if (maxSuit >= 3) boardStrength += 0.12;

  // Lo board 判定: 可視カードが全て 8 以下なら Lo 威嚇度 UP
  const visLowCount = values.filter(v => v <= 6 || v === 12).length;
  if (visLowCount === visCards.length && visCards.length >= 3) {
    boardStrength += 0.08;
  }

  boardStrength = Math.min(1.0, boardStrength);
  return 0.55 * boardStrength + 0.45 * baseStrength;
}
