// Badugi ハンド評価器
//
// card.value (0〜12): 0='2', 1='3', ..., 11='K', 12='A'
//
// Badugi ランク変換（aceIsLow=true）:
//   A(12) → badugiVal=0 (最強), 2(0)→1, 3(1)→2, ..., K(11)→12 (最弱)
//
// ルール:
//   - 4 枚から「スート全異なる かつ ランク全異なる」最大部分集合を選ぶ
//   - 有効枚数が多いほど強い
//   - 同枚数内: Badugi値の降順配列を辞書順比較（低いほど強い）
//   - 最強: A♣-2♦-3♥-4♠ → badugiVals [0,1,2,3]

/** card.value → Badugi 内部値（A=0 最強、2=1、...、K=12 最弱） */
function _bv(value) {
  return value === 12 ? 0 : value + 1;
}

const RANK_BY_BV = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];

/**
 * 4 枚の Badugi ハンドを評価する。
 * @param {Card[]} cards - 4 枚のカード
 * @returns {{ score: number[], size: number, name: string }}
 *   score[0] = -size（多い方が score が小さい＝強い）
 *   score[1..] = 有効カードの bv 降順（低いほど強い）
 */
export function evaluateBadugi(cards) {
  if (!cards || cards.length !== 4) {
    return { score: [999], size: 0, name: '(invalid)' };
  }

  const best = bestBadugiHand(cards);
  const score = [-best.size, ...best.bvs]; // 辞書順で小さい = 強い

  return {
    score,
    size: best.size,
    name: _badugiName(best.size, best.bvs),
  };
}

/**
 * 4 枚から最強の有効部分集合を求める。
 * 2^4 = 16 通りの全部分集合を列挙して最良を返す。
 * @param {Card[]} cards
 * @returns {{ size: number, bvs: number[] }}  bvs は降順 Badugi 値
 */
export function bestBadugiHand(cards) {
  let bestSize = 0;
  let bestBvs  = [];

  for (let mask = 1; mask < 16; mask++) {
    const subset = [];
    for (let i = 0; i < 4; i++) {
      if (mask & (1 << i)) subset.push(cards[i]);
    }

    if (!_isValidSubset(subset)) continue;

    const bvs = subset.map(c => _bv(c.value)).sort((a, b) => b - a); // 降順

    if (subset.length > bestSize) {
      bestSize = subset.length;
      bestBvs  = bvs;
    } else if (subset.length === bestSize && _compareBvs(bvs, bestBvs) < 0) {
      bestBvs = bvs;
    }
  }

  return { size: bestSize, bvs: bestBvs };
}

/** 部分集合がスート・Badugi値ともに全て異なるか確認 */
function _isValidSubset(cards) {
  const suits = new Set(cards.map(c => c.suit));
  const bvs   = new Set(cards.map(c => _bv(c.value)));
  return suits.size === cards.length && bvs.size === cards.length;
}

/** Badugi 値配列の辞書順比較（降順配列として）。負 → a が強い */
function _compareBvs(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * 複数プレイヤーの勝者を決定する。
 * @param {object[]} players - handResult を持つプレイヤー配列
 * @returns {object[]} 勝者
 */
export function determineWinnersBadugi(players) {
  if (players.length === 0) return [];

  let bestScore = null;
  for (const p of players) {
    if (!p.handResult) continue;
    if (bestScore === null || _compareScore(p.handResult.score, bestScore) < 0) {
      bestScore = p.handResult.score;
    }
  }

  return players.filter(p => p.handResult && _compareScore(p.handResult.score, bestScore) === 0);
}

function _compareScore(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function _badugiName(size, descBvs) {
  const ranks = descBvs.map(bv => RANK_BY_BV[bv] ?? bv).join('-');
  return `${size}-card Badugi (${ranks})`;
}
