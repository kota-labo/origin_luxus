// Fixed Limit Omaha Hi/Lo 8-or-Better — ハンド評価エンジン
//
// Omaha 必須ルール: **手札から必ず 2枚 + ボードから必ず 3枚** で 5枚構成
//   → 4C2 × 5C3 = 6 × 10 = 60 通りの組み合わせを列挙して最強を決定
//
// Hi: 通常のポーカー役 (NLH 評価器の 5枚判定を流用)
// Lo: A-5 ローボール + 8-or-Better 制約 (ストレート/フラッシュ無視)
//
// CLAUDE.md準拠: チップは小数1桁まで (0.1単位)

import {
  evaluateHand as nlhEvaluateHand,
  compareResults as compareHi,
} from '../nlh/evaluator.js';

// ══════════════════════════════════════════════
// §0  汎用組み合わせ列挙
// ══════════════════════════════════════════════

/** 配列 arr から k 個を選ぶ組み合わせを全列挙する */
function combinations(arr, k) {
  const results = [];
  function combine(start, combo) {
    if (combo.length === k) { results.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }
  combine(0, []);
  return results;
}

// ══════════════════════════════════════════════
// §1  Hi 評価 (Omaha: 手札2 + ボード3)
// ══════════════════════════════════════════════

/**
 * Omaha Hi 評価 — 手札から2枚 + ボードから3枚の 60 通りから最強を選ぶ。
 * @param {Card[]} hand  - 4枚のホールカード
 * @param {Card[]} board - 3〜5枚のコミュニティカード (FLOP以降)
 * @returns {{ rank, kickers, name, bestCards } | null}
 */
export function evaluateHiOmaha(hand, board) {
  if (!hand || hand.length !== 4 || !board || board.length < 3) return null;
  const handCombos  = combinations(hand, 2);   // 6 通り
  const boardCombos = combinations(board, 3);  // 10 通り (board=3なら1通り)
  let best = null;
  for (const hc of handCombos) {
    for (const bc of boardCombos) {
      const five = [...hc, ...bc];
      const result = nlhEvaluateHand(five);
      if (!best || compareHi(result, best) > 0) best = result;
    }
  }
  return best;
}

// ══════════════════════════════════════════════
// §2  Lo 評価 (Omaha 8-or-Better: 手札2 + ボード3)
// ══════════════════════════════════════════════

// card.value: 2=0, 3=1, ..., 8=6, 9=7, T=8, J=9, Q=10, K=11, A=12
// Lo value: A→1, 2→2, ..., 8→8  (9以上 = value ≥ 7 は失格)
function lowValue(card) {
  return card.value === 12 ? 1 : card.value + 2;
}

/**
 * 5枚ロー評価 (8-or-Better)
 *   - 全カード ≤8 (lowValue ≤ 8)
 *   - ランク重複なし
 *   - ストレート/フラッシュは無視 (5枚揃えば常に適格)
 */
function evaluate5Low8(cards) {
  const lvs = cards.map(lowValue);
  for (const v of lvs) {
    if (v > 8) return { qualifies: false };
  }
  if (new Set(lvs).size !== 5) return { qualifies: false };
  return { qualifies: true, kickers: [...lvs].sort((a, b) => b - a) };
}

/**
 * Lo kickers を降順で辞書順比較。小さい方が強い。
 * @returns 負: a強 / 正: b強 / 0: 同点
 */
function compareLoKickers(a, b) {
  for (let i = 0; i < 5; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Omaha Lo 評価 — 手札2 + ボード3 の 60通りから最強の Lo を選ぶ。
 * 不成立なら null。
 * @returns {{ kickers, bestCards, name } | null}
 */
export function evaluateLo8Omaha(hand, board) {
  if (!hand || hand.length !== 4 || !board || board.length < 3) return null;

  // 最適化: ボードに ≤8 のユニークランクが 3枚以上ないなら Lo 成立不可
  const boardLows = board.filter(c => lowValue(c) <= 8);
  const boardLowRanks = new Set(boardLows.map(c => c.value));
  if (boardLowRanks.size < 3) return null;

  const handCombos  = combinations(hand, 2);
  const boardCombos = combinations(board, 3);
  let best = null;
  for (const hc of handCombos) {
    // 手札側に ≤8 が 2枚ないなら早期スキップ
    if (lowValue(hc[0]) > 8 || lowValue(hc[1]) > 8) continue;
    for (const bc of boardCombos) {
      const five = [...hc, ...bc];
      const r = evaluate5Low8(five);
      if (!r.qualifies) continue;
      if (!best || compareLoKickers(r.kickers, best.kickers) < 0) {
        best = { kickers: r.kickers, bestCards: five };
      }
    }
  }
  if (!best) return null;
  return { ...best, name: loName(best.kickers) };
}

/**
 * Lo 役名生成
 *   A-2-3-4-5 (kickers = [5,4,3,2,1]) → "Wheel (A-5)"
 *   最高カードによる表記 → "7-Low (7-5-4-3-2)" など
 */
function loName(kickers) {
  const labels = kickers.map(lv => lv === 1 ? 'A' : String(lv));
  if (kickers[0] === 5 && kickers[1] === 4 && kickers[2] === 3 && kickers[3] === 2 && kickers[4] === 1) {
    return 'Wheel (A-5)';
  }
  return `${labels[0]}-Low (${labels.join('-')})`;
}

// ══════════════════════════════════════════════
// §3  Hi/Lo 勝者決定
// ══════════════════════════════════════════════

/**
 * Hi 勝者と Lo 勝者を別々に決定する。
 * @param {Player[]} players - 事前に p.hiResult / p.loResult を設定済み
 * @returns {{ hiWinners: Player[], loWinners: Player[] }}
 */
export function determineWinnersHiLo(players) {
  if (!players || players.length === 0) {
    return { hiWinners: [], loWinners: [] };
  }

  // ── Hi 勝者特定 ──
  let hiWinners = [];
  let bestHi = null;
  for (const p of players) {
    if (!p.hiResult) continue;
    if (!bestHi) { bestHi = p.hiResult; hiWinners = [p]; continue; }
    const cmp = compareHi(p.hiResult, bestHi);
    if (cmp > 0)      { bestHi = p.hiResult; hiWinners = [p]; }
    else if (cmp === 0) hiWinners.push(p);
  }

  // ── Lo 勝者特定 (qualifies のみ) ──
  let loWinners = [];
  let bestLo = null;
  for (const p of players) {
    if (!p.loResult) continue;
    if (!bestLo) { bestLo = p.loResult; loWinners = [p]; continue; }
    const cmp = compareLoKickers(p.loResult.kickers, bestLo.kickers);
    if (cmp < 0)      { bestLo = p.loResult; loWinners = [p]; }
    else if (cmp === 0) loWinners.push(p);
  }

  return { hiWinners, loWinners };
}

// ══════════════════════════════════════════════
// §4  CPU 用ヘルパー (Lo ドロー検出)
// ══════════════════════════════════════════════

/** 手札 + ボードから、成立し得る Lo の「適格カード数」をカウント (CPU のドロー評価用) */
export function countLowCards(cards) {
  return cards.filter(c => lowValue(c) <= 8).length;
}

/** Lo 評価用の lowValue マッピング (CPU 側で参照) */
export { lowValue };
