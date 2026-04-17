// Fixed Limit Hold'em (FLH) — CPU AI
// CLAUDE.md準拠: Math.random()禁止、crypto.getRandomValues()使用
//
// 方針: NLH CPU を流用し、Fixed Limit 向けに後処理調整:
//   1. amount パラメータを常に 0 に正規化 (FLH logic は _roundBetSize 固定額を適用)
//   2. FOLD → CALL アップグレード (+15%) — Limit はコール安価
//   3. 強ハンド (rank >= SET or TWO_PAIR) のバリューレイズ率を +30% / +20% 底上げ → 目標 95% / 55%
//   4. ドンクベット禁止 / チェックレイズ 7-8% は NLH CPU 内の既存ロジックを自動継承

import { decideCpuAction as nlhDecide } from '../nlh/cpu.js';
import { Action } from './logic.js';

// ══════════════════════════════════════════════
// 乱数
// ══════════════════════════════════════════════
function rng01() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x100000000;
}

// ══════════════════════════════════════════════
// HandRank 定数 (NLH 評価器と同一値)
//   0=HIGH_CARD, 1=ONE_PAIR, 2=TWO_PAIR, 3=THREE_OF_A_KIND,
//   4=STRAIGHT, 5=FLUSH, 6=FULL_HOUSE, 7=FOUR_OF_A_KIND,
//   8=STRAIGHT_FLUSH, 9=ROYAL_FLUSH
// ══════════════════════════════════════════════

/**
 * CPU のアクションを決定する (FLH 向け後処理)。
 * @param {FLHGame} adapter
 * @returns {{ action: string, amount: number }}
 */
export function decideCpuAction(adapter) {
  // 1. NLH CPU に判断を委譲
  const base = nlhDecide(adapter);
  let action = base.action;

  const p = adapter.getCurrentPlayer();
  if (!p) return { action: Action.CHECK, amount: 0 };
  const valid = adapter.getValidActions(p);

  // 2. Fixed Limit 調整: FOLD → CALL 15% アップグレード (コール頻度底上げ)
  if (action === Action.FOLD && valid.includes(Action.CALL) && rng01() < 0.15) {
    action = Action.CALL;
  }

  // 3. 強ハンドのバリューレイズ率底上げ (NLH の baseline より高い Limit 目標)
  //    ショーダウン可能 (5 枚以上) かつ CALL を選んだ場合のみ判定
  if (action === Action.CALL && valid.includes(Action.RAISE)) {
    const result = adapter.evaluateCurrentHand ? adapter.evaluateCurrentHand(p.id) : null;
    if (result && typeof result.rank === 'number') {
      const rank = result.rank;
      // rank >= 3 (セット/トリップス以上): NLH baseline 65% → 目標 95% → +30% で補正
      // rank >= 6 (フルハウス以上):        NLH baseline 90% → 目標 95% → +5% で補正
      // rank === 2 (ツーペア):              NLH baseline 35% → 目標 55% → +20% で補正
      if (rank >= 6) {
        if (rng01() < 0.05) action = Action.RAISE;
      } else if (rank >= 3) {
        if (rng01() < 0.30) action = Action.RAISE;
      } else if (rank === 2) {
        if (rng01() < 0.20) action = Action.RAISE;
      }
    }
  }

  // 4. action が無効化されていたら安全フォールバック
  if (!valid.includes(action)) {
    if (valid.includes(Action.CHECK))      action = Action.CHECK;
    else if (valid.includes(Action.CALL))  action = Action.CALL;
    else                                    action = Action.FOLD;
  }

  // Fixed Limit: performAction が amount を無視するため常に 0 を返す
  return { action, amount: 0 };
}
