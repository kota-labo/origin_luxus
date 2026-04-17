// Seven Card Stud High — ハンド評価エンジン
// NLH evaluator をラップ（7枚 → best 5 は同一ロジック）
// + 可視カードのみでポーカーハンドを評価する visibleHandEval を追加
// CLAUDE.md準拠: チップは整数

import { evaluateHand as nlhEvaluateHand, determineWinners as nlhDetermineWinners, compareResults } from '../nlh/evaluator.js';

/**
 * 7枚のカードから最強の5枚を評価
 * NLH evaluator をそのまま流用
 */
export function evaluateHand(cards) {
  return nlhEvaluateHand(cards);
}

/**
 * 複数プレイヤーの勝者を決定
 */
export function determineWinners(players) {
  return nlhDetermineWinners(players);
}

// ── 可視カード評価（アクション順決定用） ──

const SUIT_ORDER = { 's': 3, 'h': 2, 'd': 1, 'c': 0 }; // spade > heart > diamond > club

/**
 * 可視カード（1〜4枚）からポーカーハンド的な強さを評価
 * Third Street: 最低ランクのアップカード（同ランクならスート最弱）→ bring-in
 * Fourth Street+: 可視カードの最強ポーカーハンドで行動順決定
 *
 * @param {Card[]} visibleCards - faceUp === true のカード群
 * @returns {{ score: number[], suitTiebreak: number }}
 *   score: [category, ...kickers] 辞書式比較用
 *   suitTiebreak: 最高カードのスートオーダー（同スコア時の最終タイブレーク）
 */
export function evaluateVisibleHand(visibleCards) {
  if (!visibleCards || visibleCards.length === 0) {
    return { score: [0], suitTiebreak: 0 };
  }

  const sorted = [...visibleCards].sort((a, b) => b.value - a.value || SUIT_ORDER[b.suit] - SUIT_ORDER[a.suit]);

  if (visibleCards.length === 1) {
    const c = sorted[0];
    return {
      score: [0, c.value],
      suitTiebreak: SUIT_ORDER[c.suit] || 0,
    };
  }

  // 2〜4枚: ペア/トリップス/フォーカインド/ツーペアを検出
  const rankCount = {};
  for (const c of sorted) {
    rankCount[c.value] = (rankCount[c.value] || 0) + 1;
  }
  const counts = Object.entries(rankCount)
    .map(([v, cnt]) => ({ value: parseInt(v, 10), count: cnt }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  let category = 0; // 0=ハイカード
  if (counts[0].count === 4) category = 7;       // フォーカインド
  else if (counts[0].count === 3) category = 3;   // トリップス
  else if (counts[0].count === 2 && counts.length >= 2 && counts[1].count === 2) category = 2; // ツーペア
  else if (counts[0].count === 2) category = 1;   // ワンペア

  const kickers = counts.map(c => c.value);
  const topCard = sorted[0];

  return {
    score: [category, ...kickers],
    suitTiebreak: SUIT_ORDER[topCard.suit] || 0,
  };
}

/**
 * Third Street 用: 最低ランクのアップカードを持つプレイヤーを特定
 * 同ランクの場合はスートが最も弱い（club < diamond < heart < spade）方が bring-in
 * @param {Player[]} activePlayers - フォールドしていないプレイヤー
 * @returns {number} bring-in プレイヤーの ID
 */
export function findBringInPlayer(activePlayers) {
  let lowestRank = Infinity;
  let lowestSuit = Infinity;
  let bringInId = -1;

  for (const p of activePlayers) {
    const upCards = p.hand.filter(c => c.faceUp);
    if (upCards.length === 0) continue;
    const up = upCards[0]; // Third Street では1枚のアップカード
    const suitVal = SUIT_ORDER[up.suit] ?? 0;
    if (up.value < lowestRank || (up.value === lowestRank && suitVal < lowestSuit)) {
      lowestRank = up.value;
      lowestSuit = suitVal;
      bringInId = p.id;
    }
  }
  return bringInId;
}

/**
 * Fourth Street+: 可視カードが最も強いプレイヤーを特定（行動順決定用）
 * @param {Player[]} activePlayers
 * @returns {number} 最強可視ハンドのプレイヤー ID
 */
export function findStrongestVisibleHand(activePlayers) {
  let bestScore = null;
  let bestSuit = -1;
  let bestId = -1;

  for (const p of activePlayers) {
    const visCards = p.hand.filter(c => c.faceUp);
    const eval_ = evaluateVisibleHand(visCards);

    if (!bestScore || compareScoreArrays(eval_.score, bestScore) > 0 ||
        (compareScoreArrays(eval_.score, bestScore) === 0 && eval_.suitTiebreak > bestSuit)) {
      bestScore = eval_.score;
      bestSuit = eval_.suitTiebreak;
      bestId = p.id;
    }
  }
  return bestId;
}

function compareScoreArrays(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

export { compareResults };
