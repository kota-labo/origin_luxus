// NLH CPU AI
// CLAUDE.md準拠: Math.random()は使用禁止、crypto.getRandomValues()を使用
// decideCpuAction(adapter) → { action, amount } を返す純粋関数

import { Action } from './logic.js';

/**
 * CPUのアクションを決定する
 * @param {NLHGame} adapter - GameAdapter準拠のゲームインスタンス
 * @returns {{ action: string, amount: number }}
 */
export function decideCpuAction(adapter) {
  const p       = adapter.getCurrentPlayer();
  if (!p) return { action: Action.CHECK, amount: 0 };

  const valid   = adapter.getValidActions(p);
  const toCall  = adapter.currentBet - p.currentBet;
  const potOdds = toCall > 0 ? toCall / (adapter.pot + toCall) : 0;

  const rng = new Uint32Array(1);
  crypto.getRandomValues(rng);
  const rand = rng[0] / 0xFFFFFFFF;

  let action = Action.FOLD;
  let amount = 0;

  if (toCall === 0) {
    action = rand < 0.65 ? Action.CHECK
           : rand < 0.88 && valid.includes(Action.BET)
               ? (amount = adapter.bigBlind * (2 + Math.floor(rand * 3)), Action.BET)
           : Action.CHECK;
  } else {
    action = potOdds > 0.4
      ? (rand < 0.55 ? Action.FOLD : Action.CALL)
      : rand < 0.15 && valid.includes(Action.RAISE)
          ? (amount = toCall + adapter.bigBlind * 2, Action.RAISE)
      : rand < 0.78 && valid.includes(Action.CALL)
          ? Action.CALL
      : Action.FOLD;
  }

  // フォールバック: 無効なアクションの場合
  if (!valid.includes(action)) {
    action = valid.includes(Action.CHECK) ? Action.CHECK : Action.FOLD;
    amount = 0;
  }

  return { action, amount };
}
