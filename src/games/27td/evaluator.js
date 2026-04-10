// 2-7 Triple Draw ハンド評価器
//
// card.value (0〜12): 0='2', 1='3', …, 5='7', 6='8', …, 11='K', 12='A'
// 2-7 ローボール: score の辞書順が小さいほど強い（良い手）
//
// カテゴリ (score[0])  ← 小さいほど良い
//   0: ノーペア（最強 — 7-5-4-3-2 が全体ナッツ）
//   1: ワンペア
//   2: ツーペア
//   3: スリーカード
//   4: ストレート
//   5: フラッシュ
//   6: フルハウス
//   7: フォーカード
//   8: ストレートフラッシュ（ロイヤル含む — 最弱）
//
// タイブレーカー: カード value が低いほど良い（= 低い数字ほど有利）
// A(12) は 2-7 では最弱カード扱い。

const RANK_BY_VALUE = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];

/**
 * 5 枚の 2-7 ハンドを評価する。
 * @param {Card[]} cards
 * @returns {{ score: number[], name: string }}
 *   score: 辞書順が小さいほど強い
 */
export function evaluate27td(cards) {
  if (!cards || cards.length !== 5) {
    return { score: [999], name: '(invalid)' };
  }

  const values = cards.map(c => c.value).sort((a, b) => a - b); // 昇順
  const suits  = cards.map(c => c.suit);

  // ── 役判定 ─────────────────────────────────────────────────

  const isFlush    = suits.every(s => s === suits[0]);
  const isStraight = _isStraight(values);

  // 枚数カウント: { value(number) → count }
  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const countArr = Object.entries(counts)
    .map(([v, c]) => ({ val: Number(v), cnt: c }))
    .sort((a, b) => b.cnt - a.cnt || b.val - a.val); // 多い枚数 → 高い値 の順

  const maxCnt = countArr[0].cnt;

  // 降順 values（タイブレーカー用）
  const desc = [...values].sort((a, b) => b - a);

  // ── SF / ロイヤルフラッシュ（カテゴリ 8 = 最弱）───────────────
  if (isStraight && isFlush) {
    const isRoyal = values[4] === 12 && values[3] === 11; // A-K-Q-J-T
    return {
      score: [8, ...desc],
      name:  isRoyal ? 'Royal Flush' : 'Straight Flush',
    };
  }

  // ── フォーカード（カテゴリ 7）────────────────────────────────
  if (maxCnt === 4) {
    const quadVal   = countArr[0].val;
    const kickerVal = countArr[1].val;
    return { score: [7, quadVal, kickerVal], name: 'Four of a Kind' };
  }

  // ── フルハウス（カテゴリ 6）─────────────────────────────────
  if (maxCnt === 3 && countArr[1]?.cnt === 2) {
    const tripsVal = countArr[0].val;
    const pairVal  = countArr[1].val;
    return { score: [6, tripsVal, pairVal], name: 'Full House' };
  }

  // ── フラッシュ（カテゴリ 5）─────────────────────────────────
  if (isFlush) {
    return { score: [5, ...desc], name: 'Flush' };
  }

  // ── ストレート（カテゴリ 4）─────────────────────────────────
  if (isStraight) {
    return { score: [4, ...desc], name: 'Straight' };
  }

  // ── スリーカード（カテゴリ 3）────────────────────────────────
  if (maxCnt === 3) {
    const tripsVal = countArr[0].val;
    const kickers  = desc.filter(v => v !== tripsVal);
    return { score: [3, tripsVal, ...kickers], name: 'Three of a Kind' };
  }

  // ── ツーペア（カテゴリ 2）────────────────────────────────────
  if (maxCnt === 2 && countArr[1]?.cnt === 2) {
    // 高いペア → 低いペア → キッカー（すべて低いほど良い）
    const pairs  = countArr.filter(e => e.cnt === 2).map(e => e.val).sort((a, b) => b - a);
    const kicker = countArr.find(e => e.cnt === 1).val;
    return { score: [2, ...pairs, kicker], name: 'Two Pair' };
  }

  // ── ワンペア（カテゴリ 1）────────────────────────────────────
  if (maxCnt === 2) {
    const pairVal = countArr[0].val;
    const kickers = desc.filter(v => v !== pairVal); // ペア以外を降順
    return { score: [1, pairVal, ...kickers], name: 'Pair' };
  }

  // ── ノーペア / ロー（カテゴリ 0 = 最強）──────────────────────
  return {
    score: [0, ...desc],
    name:  _lowHandName(desc),
  };
}

/**
 * 複数プレイヤーの中から勝者を決定する。
 * @param {object[]} players - handResult を持つプレイヤー配列
 * @returns {object[]} 勝者（スプリット対応）
 */
export function determineWinners27td(players) {
  if (players.length === 0) return [];

  let best = null;
  for (const p of players) {
    if (!p.handResult) continue;
    if (best === null || _compareScore(p.handResult.score, best) < 0) {
      best = p.handResult.score;
    }
  }

  return players.filter(p => p.handResult && _compareScore(p.handResult.score, best) === 0);
}

// ── 内部ユーティリティ ──────────────────────────────────────────

function _isStraight(sortedValues) {
  for (let i = 0; i < sortedValues.length - 1; i++) {
    if (sortedValues[i + 1] - sortedValues[i] !== 1) return false;
  }
  return true;
}

/** score 辞書順比較。負 → a が強い、正 → b が強い、0 → 同等 */
function _compareScore(a, b) {
  // 無効ハンドは常に最弱
  if (a[0] === 999 && b[0] === 999) return 0;
  if (a[0] === 999) return  1;
  if (b[0] === 999) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function _lowHandName(descValues) {
  return descValues.map(v => RANK_BY_VALUE[v] ?? v).join('-') + ' low';
}
