// 2-7 Triple Draw CPU ロジック（中級レベル）
// decideCpuAction: ベッティングラウンド用
// decideCpuDraw:   ドローラウンド用
// CLAUDE.md準拠: crypto.getRandomValues() 使用
//
// card.value (0〜12): 0='2', 1='3', ..., 5='7', 6='8', 7='9', 8='T', 9='J', 10='Q', 11='K', 12='A'

import { evaluate27td } from './evaluator.js';

/**
 * ベッティングラウンドの CPU アクションを決定する。
 * @param {object} adapter - GameAdapter 準拠のゲームインスタンス
 * @returns {{ action: string, amount: number }}
 */
export function decideCpuAction(adapter) {
  const player    = adapter.getCurrentPlayer();
  const validActs = adapter.getValidActions(player);
  const pot       = adapter.pot;
  const toCall    = adapter.currentBet - player.currentBet;
  const betSize   = adapter._roundBetSize;

  const result   = evaluate27td(player.hand);
  // score[0] はカテゴリ: 0=ノーペア(最強), 1=ペア, 2=ツーペア, …
  const cat      = result.score[0];
  const isNoPair = cat === 0;
  // ノーペアのみ強さを評価（score[1] が最高カードの value）
  const topValue = isNoPair ? result.score[1] : 99;

  // 強いローハンド: ノーペアかつ最高カードが '7'(value=5) 以下
  const isStrong = isNoPair && topValue <= 5;
  // まあまあ: ノーペアかつ最高カードが '9'(value=7) 以下
  const isMedium = isNoPair && topValue <= 7;

  const potOdds = pot > 0 ? toCall / (pot + toCall) : 0;
  const r       = _rand();

  if (validActs.includes('check')) {
    if (isStrong && r < 0.70 && validActs.includes('bet')) return { action: 'bet',   amount: betSize };
    if (isMedium && r < 0.25 && validActs.includes('bet')) return { action: 'bet',   amount: betSize };
    return { action: 'check', amount: 0 };
  }

  if (toCall > 0) {
    if (isStrong) {
      if (validActs.includes('raise') && r < 0.35) return { action: 'raise', amount: betSize };
      if (validActs.includes('call'))               return { action: 'call',  amount: 0 };
    }
    if (isMedium && potOdds < 0.35) {
      if (validActs.includes('call')) return { action: 'call', amount: 0 };
    }
    if (isNoPair && potOdds < 0.25) {
      if (validActs.includes('call')) return { action: 'call', amount: 0 };
    }
    if (validActs.includes('fold')) return { action: 'fold', amount: 0 };
  }

  if (validActs.includes('check')) return { action: 'check', amount: 0 };
  if (validActs.includes('call'))  return { action: 'call',  amount: 0 };
  return { action: validActs[0], amount: 0 };
}

/**
 * ドローラウンドの廃棄インデックスを決定する。
 * @param {object} adapter
 * @returns {number[]} 廃棄するカードのインデックス配列
 */
export function decideCpuDraw(adapter) {
  const player = adapter.getCurrentPlayer();
  return _calcDiscardIndices(player.hand);
}

// ── 廃棄計算 ────────────────────────────────────────────────

/**
 * 廃棄すべきカードのインデックスを返す。
 * 優先度:
 *   1. value >= 6 のカード ('8' 以上、A=12 含む)
 *   2. 重複 value のカード（ペア）
 *   3. 全同スーツ（フラッシュ）→ 最高 value を廃棄
 *   4. ストレート（連続）→ 最高 value を廃棄
 *   5. 廃棄が 4 枚以上 → value の低い 2 枚を保持
 */
function _calcDiscardIndices(hand) {
  // ① 高カード (value >= 6 = '8' 以上) を廃棄候補に
  const highIdx = hand
    .map((c, i) => (c.value >= 6 ? i : -1))
    .filter(i => i !== -1);

  // ② ペア検出
  const valMap = {};
  hand.forEach((c, i) => {
    if (!valMap[c.value]) valMap[c.value] = [];
    valMap[c.value].push(i);
  });
  const pairIdx = [];
  for (const indices of Object.values(valMap)) {
    if (indices.length >= 2) pairIdx.push(...indices.slice(1)); // 1枚残して残り廃棄
  }

  // ③ フラッシュ（5枚同スーツ）→ 最高 value を廃棄
  const suitMap = {};
  hand.forEach((c, i) => {
    if (!suitMap[c.suit]) suitMap[c.suit] = [];
    suitMap[c.suit].push(i);
  });
  const flushIdx = [];
  for (const indices of Object.values(suitMap)) {
    if (indices.length === 5) {
      const sorted = [...indices].sort((a, b) => hand[b].value - hand[a].value);
      flushIdx.push(sorted[0]); // 最高 value を廃棄
    }
  }

  // ④ ストレート（5枚連続）→ 最高 value を廃棄
  const byValue = hand.map((c, i) => ({ value: c.value, idx: i })).sort((a, b) => a.value - b.value);
  const isStraight = byValue.every((x, i) => i === 0 || x.value - byValue[i - 1].value === 1);
  const straightIdx = isStraight ? [byValue[4].idx] : [];

  // 候補を重複なしで結合
  const candidates = [...new Set([...highIdx, ...pairIdx, ...flushIdx, ...straightIdx])];

  // ⑤ 4 枚以上の廃棄は過剰: value の低い 2 枚を保持して残り廃棄
  if (candidates.length >= 4) {
    const keepIdx = new Set(byValue.slice(0, 2).map(x => x.idx));
    return hand.map((_, i) => i).filter(i => !keepIdx.has(i));
  }

  return candidates;
}

// ── crypto.getRandomValues ───────────────────────────────────
function _rand() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0xFFFFFFFF;
}
