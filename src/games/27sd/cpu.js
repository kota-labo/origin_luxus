// No Limit 2-7 Single Draw (NL27SD) — CPU AI
// CLAUDE.md準拠: Math.random() 禁止、crypto.getRandomValues() 使用
//
// 戦略:
//   - ハンド強度を made (成立済み) + draw (交換期待) 両面で評価
//   - PREDRAW: 強ロー (7-low〜J-low 成立 or 1枚交換 9以下) → レイズ
//              中ロー (Q/K-low 成立 or 2枚交換) → コール中心
//              弱 → フォールド (BB ディフェンス例外あり)
//   - ドロー: 不要高カード + ペア重複を廃棄 (27TD の 1st Draw ロジック流用)
//   - POSTDRAW: 成立ハンドベース評価、ブラフは NLH より高頻度 (15〜20%)
//   - ドンクベット禁止の概念は適用しない (Single Draw では OOP/IP 厳密性が低い)

import { Action } from './logic.js';
import { evaluate27td } from '../27td/evaluator.js';

// ══════════════════════════════════════════════
// §0  暗号論的安全乱数
// ══════════════════════════════════════════════
function rng01() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x100000000;
}
function chance(p) { return rng01() < p; }

// ══════════════════════════════════════════════
// §1  ハンド強度分析
//   evaluate27td: score[0]=category (0=ノーペア最強, 1=ペア, 2=ツーペア...)
//                  score[1..]=降順カード値 (2=0, ..., T=8, J=9, Q=10, K=11, A=12)
// ══════════════════════════════════════════════

/**
 * 5枚手札を分析し、made 強度 + draw 余地の両面を返す。
 */
function analyzeHand(hand) {
  const result = evaluate27td(hand);
  const cat    = result.score[0];
  const isNoPair = cat === 0;
  // 成立ノーペア時の最大カード値 (7=5, 8=6, 9=7, T=8, J=9, Q=10, K=11, A=12)
  const topValue = isNoPair ? result.score[1] : 99;

  // 9 以上 = value >= 7 を「不要カード (high)」扱い
  //   Lo ハンドは 2-8 のみ使い、9/T/J/Q/K/A は交換候補
  const highCards = hand.filter(c => c.value >= 7).length;
  const lowCards  = 5 - highCards;
  const hasPair   = cat >= 1;

  return {
    result, cat, isNoPair, topValue, highCards, lowCards, hasPair,

    // 成立ハンド評価 (5枚で既に出来上がっている)
    isMadeStrong: isNoPair && topValue <= 9,                       // 7-low 〜 J-low
    isMadeMedium: isNoPair && (topValue === 10 || topValue === 11),// Q-low / K-low
    isMadeNuts:   isNoPair && topValue <= 5,                       // 7-low (ナッツ級)

    // ドロー余地評価 (何枚交換で強ローが作れるか)
    isOneCardDraw:   !hasPair && lowCards === 4,  // 4枚 ≤8 + 不要 1枚 (強いドロー)
    isTwoCardDraw:   !hasPair && lowCards === 3,  // 3枚 ≤8 + 不要 2枚
    isThreeCardDraw: lowCards <= 2 || hasPair,     // 3枚以上交換 or ペア系
  };
}

// ══════════════════════════════════════════════
// §2  ドロー枚数決定 (27TD の 1st Draw ロジック)
// ══════════════════════════════════════════════

/**
 * ドローで廃棄するカードのインデックス配列を返す。
 * 27TD の 1st Draw ロジックを踏襲 (Single Draw なので 1 回目相当)。
 */
export function decideCpuDraw(adapter) {
  const player = adapter.getCurrentPlayer();
  if (!player) return [];

  const { topValue, hasPair, lowCards } = analyzeHand(player.hand);

  // ペアあり: 重複解消 + 高カード処分、2〜3枚ドロー
  if (hasPair) {
    const drawN = rng01() < 0.5 ? 2 : 3;
    return pickDiscardIndices(player.hand, drawN);
  }

  // ノーペア時: 成立強度と不要カード数で決定
  let drawN;
  if (topValue <= 5)            drawN = 0;  // 7-low: Pat
  else if (topValue <= 6)       drawN = 0;  // 8-low: 通常 Pat (時々 1 枚改善も可)
  else if (lowCards === 4)      drawN = 1;  // 不要 1 枚 → 1 交換
  else if (lowCards === 3)      drawN = 2;  // 不要 2 枚 → 2 交換
  else                           drawN = 3;  // それ以上 → 3 交換

  return pickDiscardIndices(player.hand, drawN);
}

/**
 * 悪さスコア順に N 枚のインデックスを返す (27TD CPU から流用)。
 * ペア重複を優先、次に高 value を廃棄。
 */
function pickDiscardIndices(hand, n) {
  if (n <= 0) return [];
  if (n >= hand.length) return hand.map((_, i) => i);

  const seen = {};
  const ranked = hand.map((c, i) => {
    seen[c.value] = (seen[c.value] || 0) + 1;
    const dupPenalty = seen[c.value] > 1 ? 100 : 0;
    return { idx: i, badness: dupPenalty + c.value };
  });

  ranked.sort((a, b) => b.badness - a.badness);
  return ranked.slice(0, n).map(x => x.idx);
}

// ══════════════════════════════════════════════
// §3  ベッティング判断 (No Limit)
// ══════════════════════════════════════════════

/**
 * CPU のアクションを決定する。
 * @param {SDGame} adapter
 * @returns {{ action: string, amount: number }}
 */
export function decideCpuAction(adapter) {
  const p = adapter.getCurrentPlayer();
  if (!p) return { action: Action.CHECK, amount: 0 };

  const valid = adapter.getValidActions(p);
  if (valid.length === 0) return { action: Action.CHECK, amount: 0 };
  if (valid.length === 1) return { action: valid[0], amount: 0 };

  const h      = analyzeHand(p.hand);
  const toCall = adapter.currentBet - p.currentBet;
  const pot    = adapter.pot;
  const bb     = adapter.bigBlind;
  const r      = rng01();

  const isPredraw  = adapter.state === 'BETTING_1';
  const isPostdraw = adapter.state === 'BETTING_2';

  // ハンド強度ラベル化
  //   PREDRAW: 成立 or ドロー余地で判定
  //   POSTDRAW: 成立状態のみで判定
  const isStrong = isPostdraw
    ? h.isMadeStrong
    : (h.isMadeStrong || h.isOneCardDraw);
  const isMedium = isPostdraw
    ? h.isMadeMedium
    : (h.isMadeMedium || h.isTwoCardDraw);
  const isWeak = !isStrong && !isMedium;

  // BB ディフェンス判定 (プリドローで BB が OOP、オープンレイズに対する応答)
  const posIsBB     = (p.id === adapter.getBBIndex());
  const facingRaise = toCall > 0 && isPredraw;
  const bbCanDefend = posIsBB && facingRaise && (
    h.isOneCardDraw ||                                      // 4枚 ≤8 → 1枚交換
    (h.isTwoCardDraw && h.lowCards === 3)                    // 3枚 ≤8 で 2枚交換
  );

  // ══════════════════════════════════════════════
  // チェック可能 (先手) — ベット or チェック
  // ══════════════════════════════════════════════
  if (toCall === 0) {
    // 強ロー: 高頻度バリューベット
    if (isStrong && valid.includes(Action.BET) && r < 0.80) {
      const frac = isPostdraw ? 0.85 : 0.66;
      const amt  = Math.max(bb, Math.floor(Math.max(pot * frac, bb * 2.5)));
      return { action: Action.BET, amount: amt };
    }
    // 中ロー: プリドローでは 30% ベット、ポストドローは 20% 薄バリュー
    if (isMedium && valid.includes(Action.BET)) {
      const freq = isPredraw ? 0.30 : 0.20;
      if (r < freq) {
        const amt = Math.max(bb, Math.floor(pot * 0.55));
        return { action: Action.BET, amount: amt };
      }
    }
    // 弱ハンドのブラフ (ポストドロー 15-20% でやや高頻度)
    if (isWeak && isPostdraw && valid.includes(Action.BET) && r < 0.18) {
      const amt = Math.max(bb, Math.floor(pot * 0.6));
      return { action: Action.BET, amount: amt };
    }
    return { action: Action.CHECK, amount: 0 };
  }

  // ══════════════════════════════════════════════
  // 面している (コール / レイズ / フォールド)
  // ══════════════════════════════════════════════
  const potOdds = toCall / (pot + toCall);

  if (isStrong) {
    // ナッツ級 (7-low) は 55% でレイズ
    if (h.isMadeNuts && valid.includes(Action.RAISE) && r < 0.55) {
      const desired = Math.max(adapter.currentBet * 2.5, adapter.currentBet + Math.floor(pot * 0.75));
      return { action: Action.RAISE, amount: Math.floor(desired - adapter.currentBet) };
    }
    // 強ドロー/成立 8-9-10-J-low は 25% でセミブラフレイズ
    if (!h.isMadeNuts && isStrong && valid.includes(Action.RAISE) && r < 0.25) {
      const desired = Math.max(adapter.currentBet * 2.5, adapter.currentBet + Math.floor(pot * 0.66));
      return { action: Action.RAISE, amount: Math.floor(desired - adapter.currentBet) };
    }
    if (valid.includes(Action.CALL)) return { action: Action.CALL, amount: 0 };
    return { action: Action.FOLD, amount: 0 };
  }

  if (isMedium || bbCanDefend) {
    // ポットオッズ良ならコール
    if (potOdds < 0.35 && valid.includes(Action.CALL)) return { action: Action.CALL, amount: 0 };
    // 中〜高ポットオッズ: 45% コール、残りフォールド
    return r < 0.45 && valid.includes(Action.CALL)
      ? { action: Action.CALL, amount: 0 }
      : { action: Action.FOLD, amount: 0 };
  }

  // 弱ハンド: ポットオッズ極小でのみ稀にコール (ブラフキャッチ)
  if (potOdds < 0.18 && valid.includes(Action.CALL) && r < 0.18) {
    return { action: Action.CALL, amount: 0 };
  }
  return { action: Action.FOLD, amount: 0 };
}
