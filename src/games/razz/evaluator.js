// Razz (A-5 Lowball) — ハンド評価エンジン
// A はローカード（最強 = 最も低い）
// ストレート・フラッシュは無視（役にならない）
// ペア以上は弱いハンド（カテゴリペナルティ）
// 最強ハンド: A-2-3-4-5 (Wheel)
// CLAUDE.md準拠: チップは小数1桁まで (0.1単位)

// ── ローバリュー変換 ──
// card.js: 2=0, 3=1, ..., K=11, A=12
// Razz low: A=1, 2=2, 3=3, ..., K=13
function lowValue(card) {
  return card.value === 12 ? 1 : card.value + 2;
}

// ── 5枚の組み合わせを全て生成（7C5 = 21通り）──
function getCombinations(cards, k) {
  const results = [];
  function combine(start, combo) {
    if (combo.length === k) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < cards.length; i++) {
      combo.push(cards[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }
  combine(0, []);
  return results;
}

// ── Razz カテゴリ（低いほど強い）──
const RazzCategory = {
  NO_PAIR:          0,  // 最強カテゴリ
  ONE_PAIR:         1,
  TWO_PAIR:         2,
  THREE_OF_A_KIND:  3,
  FULL_HOUSE:       4,
  FOUR_OF_A_KIND:   5,  // 最弱カテゴリ
};

// ── 5枚のロウハンドを評価 ──
// Returns: { category, kickers: number[] }
// category: 低いほど良い
// kickers: 降順ソート（高いカードから比較、低いほど良い）
function evaluate5Low(cards) {
  const lowVals = cards.map(lowValue);

  // ランクごとの枚数カウント
  const rankCount = {};
  for (const v of lowVals) {
    rankCount[v] = (rankCount[v] || 0) + 1;
  }
  const counts = Object.entries(rankCount)
    .map(([v, cnt]) => ({ value: parseInt(v, 10), count: cnt }))
    .sort((a, b) => b.count - a.count || a.value - b.value); // 枚数降順、同数なら値昇順

  let category;
  let kickers;

  if (counts[0].count === 4) {
    // フォーカインド
    category = RazzCategory.FOUR_OF_A_KIND;
    kickers = [counts[0].value, counts[1].value];
  } else if (counts[0].count === 3 && counts.length >= 2 && counts[1].count === 2) {
    // フルハウス
    category = RazzCategory.FULL_HOUSE;
    kickers = [counts[0].value, counts[1].value];
  } else if (counts[0].count === 3) {
    // スリーオブアカインド
    category = RazzCategory.THREE_OF_A_KIND;
    const tripVal = counts[0].value;
    const rest = counts.filter(c => c.count === 1).map(c => c.value).sort((a, b) => b - a);
    kickers = [tripVal, ...rest];
  } else if (counts[0].count === 2 && counts.length >= 2 && counts[1].count === 2) {
    // ツーペア
    category = RazzCategory.TWO_PAIR;
    const pairs = counts.filter(c => c.count === 2).map(c => c.value).sort((a, b) => b - a);
    const kickerVal = counts.find(c => c.count === 1)?.value ?? 0;
    kickers = [...pairs, kickerVal];
  } else if (counts[0].count === 2) {
    // ワンペア
    category = RazzCategory.ONE_PAIR;
    const pairVal = counts[0].value;
    const rest = counts.filter(c => c.count === 1).map(c => c.value).sort((a, b) => b - a);
    kickers = [pairVal, ...rest];
  } else {
    // ノーペア（ベスト）
    category = RazzCategory.NO_PAIR;
    kickers = lowVals.sort((a, b) => b - a); // 降順（高いカードから比較）
  }

  return { category, kickers };
}

// ── 2つの Razz 評価結果を比較 ──
// 返値: 正=aが強い（良いロウ）、負=bが強い、0=同等
function compareRazzResults(a, b) {
  // カテゴリが低いほど強い
  if (a.category !== b.category) return b.category - a.category;
  // 同カテゴリ: キッカー比較（低いほど強い）
  for (let i = 0; i < Math.min(a.kickers.length, b.kickers.length); i++) {
    if (a.kickers[i] !== b.kickers[i]) return b.kickers[i] - a.kickers[i];
  }
  return 0;
}

// ── ハンド名を生成 ──
const RANK_DISPLAY = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K' };

function razzHandName(result) {
  const { category, kickers } = result;
  switch (category) {
    case RazzCategory.NO_PAIR: {
      // Wheel check: A-2-3-4-5
      if (kickers[0] === 5 && kickers[1] === 4 && kickers[2] === 3 && kickers[3] === 2 && kickers[4] === 1) {
        return 'Wheel (A-5)';
      }
      const high = RANK_DISPLAY[kickers[0]] || kickers[0];
      return `${high}-Low`;
    }
    case RazzCategory.ONE_PAIR: {
      const pairRank = RANK_DISPLAY[kickers[0]] || kickers[0];
      return `Pair of ${pairRank}s`;
    }
    case RazzCategory.TWO_PAIR: {
      const hi = RANK_DISPLAY[kickers[0]] || kickers[0];
      const lo = RANK_DISPLAY[kickers[1]] || kickers[1];
      return `Two Pair ${hi}s & ${lo}s`;
    }
    case RazzCategory.THREE_OF_A_KIND: {
      const tripRank = RANK_DISPLAY[kickers[0]] || kickers[0];
      return `Trips ${tripRank}s`;
    }
    case RazzCategory.FULL_HOUSE: {
      const tripRank = RANK_DISPLAY[kickers[0]] || kickers[0];
      const pairRank = RANK_DISPLAY[kickers[1]] || kickers[1];
      return `Full House ${tripRank}s/${pairRank}s`;
    }
    case RazzCategory.FOUR_OF_A_KIND: {
      const quadRank = RANK_DISPLAY[kickers[0]] || kickers[0];
      return `Quads ${quadRank}s`;
    }
    default:
      return 'Unknown';
  }
}

// ── 7枚から最良の5枚ローハンドを評価 ──
export function evaluateHand(cards) {
  const combos = getCombinations(cards, 5);
  let best = null;
  let bestCards = null;

  for (const combo of combos) {
    const result = evaluate5Low(combo);
    if (!best || compareRazzResults(result, best) > 0) {
      best = result;
      bestCards = combo;
    }
  }

  return {
    ...best,
    rank: best.category,      // UI互換用
    name: razzHandName(best),
    bestCards,
  };
}

// ── 複数プレイヤーの勝者を決定（最良ローハンド=勝者）──
export function determineWinners(players) {
  let bestResult = null;
  let winners = [];

  for (const player of players) {
    if (!player.handResult) continue;
    const cmp = bestResult ? compareRazzResults(player.handResult, bestResult) : 1;
    if (cmp > 0) {
      bestResult = player.handResult;
      winners = [player];
    } else if (cmp === 0) {
      winners.push(player);
    }
  }

  return winners;
}

// ── 可視カード評価（アクション順決定用）──

const SUIT_ORDER = { spades: 3, hearts: 2, diamonds: 1, clubs: 0 };

/**
 * Third Street 用: 最も悪いアップカード（最高ランク + 最高スート）= bring-in 対象
 * Razz では「最も高い」ドアカードが bring-in を支払う
 * 同ランクならスート最強（spade）がbring-in
 * @param {Player[]} activePlayers
 * @returns {number} bring-in プレイヤーの ID
 */
export function findBringInPlayer(activePlayers) {
  let highestLow = -1;
  let highestSuit = -1;
  let bringInId = -1;

  for (const p of activePlayers) {
    const upCards = p.hand.filter(c => c.faceUp);
    if (upCards.length === 0) continue;
    const up = upCards[0]; // Third Street では1枚のアップカード
    const lv = lowValue(up);  // A=1, 2=2, ..., K=13
    const suitVal = SUIT_ORDER[up.suit] ?? 0;
    // 最も高いロウバリュー（K=13が最悪）= bring-in
    // 同ランクなら最も高いスート（spade=3が最悪）
    if (lv > highestLow || (lv === highestLow && suitVal > highestSuit)) {
      highestLow = lv;
      highestSuit = suitVal;
      bringInId = p.id;
    }
  }
  return bringInId;
}

/**
 * Fourth Street+: 最も良いロウ可視ハンドのプレイヤーがアクション開始
 * A-5 Lowball ルールでアップカードを評価（ストレート/フラッシュ無視）
 * @param {Player[]} activePlayers
 * @returns {number} 最良ロウ可視ハンドのプレイヤー ID
 */
export function findStrongestVisibleHand(activePlayers) {
  let bestEval = null;
  let bestSuit = Infinity;  // タイブレーク: スート最弱（club=0）が有利
  let bestId = -1;

  for (const p of activePlayers) {
    const visCards = p.hand.filter(c => c.faceUp);
    if (visCards.length === 0) continue;

    const eval_ = evaluateVisibleLow(visCards);

    if (!bestEval) {
      bestEval = eval_;
      bestSuit = eval_.suitTiebreak;
      bestId = p.id;
      continue;
    }

    const cmp = compareRazzResults(eval_, bestEval);
    if (cmp > 0 || (cmp === 0 && eval_.suitTiebreak < bestSuit)) {
      bestEval = eval_;
      bestSuit = eval_.suitTiebreak;
      bestId = p.id;
    }
  }
  return bestId;
}

/**
 * 可視カード（1〜4枚）のロウ強度を評価
 * ストレート/フラッシュは無視、ペアは弱い扱い
 */
export function evaluateVisibleLow(visibleCards) {
  if (!visibleCards || visibleCards.length === 0) {
    return { category: RazzCategory.FOUR_OF_A_KIND, kickers: [13], suitTiebreak: 3 };
  }

  const lowVals = visibleCards.map(lowValue);

  // ランクごとの枚数カウント
  const rankCount = {};
  for (const v of lowVals) {
    rankCount[v] = (rankCount[v] || 0) + 1;
  }
  const counts = Object.entries(rankCount)
    .map(([v, cnt]) => ({ value: parseInt(v, 10), count: cnt }))
    .sort((a, b) => b.count - a.count || a.value - b.value);

  let category;
  if (counts[0].count >= 4) category = RazzCategory.FOUR_OF_A_KIND;
  else if (counts[0].count === 3 && counts.length >= 2 && counts[1].count >= 2) category = RazzCategory.FULL_HOUSE;
  else if (counts[0].count === 3) category = RazzCategory.THREE_OF_A_KIND;
  else if (counts[0].count === 2 && counts.length >= 2 && counts[1].count === 2) category = RazzCategory.TWO_PAIR;
  else if (counts[0].count === 2) category = RazzCategory.ONE_PAIR;
  else category = RazzCategory.NO_PAIR;

  const kickers = lowVals.sort((a, b) => b - a);

  // タイブレーク: 最高カードのスート（低いほど有利 = club が最良）
  const sorted = [...visibleCards].sort((a, b) => lowValue(b) - lowValue(a));
  const topSuit = SUIT_ORDER[sorted[0].suit] ?? 0;

  return { category, kickers, suitTiebreak: topSuit };
}

// ── NLH互換 export ──
export function compareResults(a, b) {
  return compareRazzResults(a, b);
}
