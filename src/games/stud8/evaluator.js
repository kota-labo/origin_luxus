// Seven Card Stud Hi/Lo 8-or-Better — ハンド評価エンジン
//
// Hi: 通常のポーカー役 (NLH評価器を流用)
// Lo: A-5 ローボール + 8-or-Better 制約
//     - A = 1 (最小)
//     - 5枚全て 8 以下 (9 以上が混ざると不適格)
//     - 重複ランクなし
//     - ストレート/フラッシュは無視 (無関係) → A-2-3-4-5 (Wheel) は最強 Lo
//     - 不適格 → Lo 勝者なし、Hi 総取り
//
// CLAUDE.md準拠: チップは小数1桁まで (0.1単位)

import {
  evaluateHand as nlhEvaluateHand,
  determineWinners as nlhDetermineWinners,
  compareResults as compareHi,
} from '../nlh/evaluator.js';

// ══════════════════════════════════════════════
// §1  Hi 評価 (NLH評価器をそのまま流用)
// ══════════════════════════════════════════════
export function evaluateHi(cards) {
  return nlhEvaluateHand(cards);
}

export function determineHiWinners(players) {
  return nlhDetermineWinners(players);
}

// ══════════════════════════════════════════════
// §2  Lo 評価 (A-5 Lowball + 8-or-Better)
// ══════════════════════════════════════════════

// card.value: 2=0, 3=1, ..., 8=6, 9=7, T=8, J=9, Q=10, K=11, A=12
// Lo value:   A→1, 2→2, ..., 8→8  (9以上は自動的に 9 超え)
function lowValue(card) {
  return card.value === 12 ? 1 : card.value + 2;
}

// 7枚から 5枚の組み合わせを全列挙 (7C5 = 21通り)
function combinations5(cards) {
  const results = [];
  function combine(start, combo) {
    if (combo.length === 5) { results.push([...combo]); return; }
    for (let i = start; i < cards.length; i++) {
      combo.push(cards[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }
  combine(0, []);
  return results;
}

/**
 * 5枚のロー評価 — 8-or-Better 制約付き
 * @returns {{ qualifies: boolean, kickers?: number[] }}
 *   kickers は降順 (辞書順比較で小さい方が強い)
 */
function evaluate5Low8(cards) {
  const lvs = cards.map(lowValue);
  // 1枚でも 9 以上 (lowValue > 8) なら Lo 失格
  for (const v of lvs) {
    if (v > 8) return { qualifies: false };
  }
  // ランク重複なし必須
  if (new Set(lvs).size !== 5) return { qualifies: false };
  // ストレート/フラッシュは無視 — 5枚揃えば常に適格
  return { qualifies: true, kickers: [...lvs].sort((a, b) => b - a) };
}

/**
 * Lo kickers を比較: 降順配列を辞書順で比較、小さい方が強い
 * @returns a が強ければ負、b が強ければ正、同じなら 0
 */
function compareLoKickers(a, b) {
  for (let i = 0; i < 5; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * 7枚から最強の Lo (5枚) を選ぶ。不成立なら null。
 * @returns {{ kickers: number[], bestCards: Card[], name: string } | null}
 */
export function evaluateLo8(cards) {
  if (!cards || cards.length < 5) return null;

  let best = null;
  for (const combo of combinations5(cards)) {
    const r = evaluate5Low8(combo);
    if (!r.qualifies) continue;
    if (!best || compareLoKickers(r.kickers, best.kickers) < 0) {
      best = { kickers: r.kickers, bestCards: combo };
    }
  }
  if (!best) return null;
  return { ...best, name: loName(best.kickers) };
}

/**
 * Lo ハンド名生成
 *   A-2-3-4-5 → "Wheel (A-5)"
 *   最高カード=8 → "8-Low (8-6-4-2-A)" 等
 */
function loName(kickers) {
  // kickers は降順 (最高→最低)
  const labels = kickers.map(lv => lv === 1 ? 'A' : String(lv));
  // ホイール判定: [5,4,3,2,1]
  if (kickers[0] === 5 && kickers[1] === 4 && kickers[2] === 3 && kickers[3] === 2 && kickers[4] === 1) {
    return 'Wheel (A-5)';
  }
  const hi = labels[0];
  return `${hi}-Low (${labels.join('-')})`;
}

// ══════════════════════════════════════════════
// §3  Hi/Lo 勝者決定
// ══════════════════════════════════════════════

/**
 * Hi 勝者と Lo 勝者を別々に決定する。
 * @param {Player[]} players - ショーダウン参加者 (p.hiResult / p.loResult が事前に設定されている)
 * @returns {{ hiWinners: Player[], loWinners: Player[] }}
 *   - hiWinners: 常に 1 名以上 (参加者がいる限り)
 *   - loWinners: Lo 条件を満たす者がいなければ []
 */
export function determineWinnersHiLo(players) {
  if (!players || players.length === 0) {
    return { hiWinners: [], loWinners: [] };
  }

  // ── Hi 勝者特定: compareHi で最強を探す ──
  let hiWinners = [];
  let bestHi = null;
  for (const p of players) {
    if (!p.hiResult) continue;
    if (!bestHi) { bestHi = p.hiResult; hiWinners = [p]; continue; }
    const cmp = compareHi(p.hiResult, bestHi);
    if (cmp > 0)      { bestHi = p.hiResult; hiWinners = [p]; }
    else if (cmp === 0) hiWinners.push(p);
  }

  // ── Lo 勝者特定: qualifies のみで最強を探す ──
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
// §4  Stud 共通ヘルパーの再 export
// ══════════════════════════════════════════════
// bring-in / アクション順決定は Stud-Hi のヘルパーをそのまま流用
export { findBringInPlayer, findStrongestVisibleHand } from '../stud/evaluator.js';
