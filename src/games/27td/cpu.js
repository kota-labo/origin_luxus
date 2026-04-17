// 2-7 Triple Draw CPU — ルールベース強化版
// 「できるだけシンプルだが強い」2軸評価 (HighCard + Smoothness) による実戦型AI
// CLAUDE.md準拠: Math.random()禁止、crypto.getRandomValues()使用
//
// card.value (0〜12):
//   0='2'(最強) 1='3' 2='4' 3='5' 4='6' 5='7' 6='8' 7='9'
//   8='T' 9='J' 10='Q' 11='K' 12='A'(最弱)
//
// 重要なスペック対応:
//   HighCard <= 7 ⇔ value <= 5
//   HighCard <= 8 ⇔ value <= 6
//   HighCard <= 9 ⇔ value <= 7
//   HighCard <= T ⇔ value <= 8
//   HighCard <= J ⇔ value <= 9
//
// ストリート対応 (DrawGame ステートマシン):
//   BETTING_1 → 未ドロー: 自分のハンドのみで判断
//   BETTING_2 → spec「1st Betting Round」(Draw1 後)
//   BETTING_3 → spec「2nd Betting Round」(Draw2 後)
//   BETTING_4 → spec「3rd Betting Round (最終)」
//   DRAW_1 → spec「1st Draw」 / DRAW_2 → 「2nd Draw」 / DRAW_3 → 「3rd Draw」

import { DrawAction } from '../shared/drawGame.js';

// ══════════════════════════════════════════════
// §0  暗号論的安全乱数
// ══════════════════════════════════════════════

function _rand() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x100000000;
}

// ══════════════════════════════════════════════
// §1  ハンド評価 (HighCard + Smoothness)
// ══════════════════════════════════════════════

/**
 * 2軸ハンド評価:
 *   highValue  — 最大カードの value (小さいほど強い)
 *   smooth     — 隣接しないペア数 (ギャップ数)
 *   paired     — ペア/トリップスありか (2-7ではバッド)
 *   uniqueVals — ソート済みユニーク値配列
 */
function analyzeHand(hand) {
  if (!hand || hand.length === 0) {
    return { highValue: 12, smooth: 99, paired: true, uniqueVals: [] };
  }

  const valCount = {};
  for (const c of hand) valCount[c.value] = (valCount[c.value] || 0) + 1;
  const paired = Object.values(valCount).some(c => c > 1);

  const uniqueVals = [...new Set(hand.map(c => c.value))].sort((a, b) => a - b);
  const highValue  = uniqueVals[uniqueVals.length - 1];

  // Smoothness = 連続しない隣接ペアの数 (例: 2,3,4,5,7 → diff [1,1,1,2] → gap=1)
  let smooth = 0;
  for (let i = 1; i < uniqueVals.length; i++) {
    if (uniqueVals[i] - uniqueVals[i - 1] > 1) smooth++;
  }

  return { highValue, smooth, paired, uniqueVals };
}

// ══════════════════════════════════════════════
// §2  相手のドロー状況分析
// ══════════════════════════════════════════════

/**
 * 最強の可能性がある相手の直前ドロー枚数 (=最小drawCount) を返す。
 * BETTING_1 では全員 drawCount=0 だが未ドローなので意味を持たない (呼び側で除外)。
 */
function getMinOppDrawCount(adapter, selfId) {
  let min = Infinity;
  for (const p of adapter.players) {
    if (p.folded || p.id === selfId) continue;
    const d = (typeof p.drawCount === 'number') ? p.drawCount : 0;
    if (d < min) min = d;
  }
  return min === Infinity ? null : min;
}

// ══════════════════════════════════════════════
// §3  ドロー枚数決定 (ストリート別)
// ══════════════════════════════════════════════

/**
 * ドローラウンドで廃棄するカードのインデックス配列を返す。
 * @returns {number[]}
 */
export function decideCpuDraw(adapter) {
  const player = adapter.getCurrentPlayer();
  if (!player) return [];

  const round = adapter.drawRound; // 1, 2, 3
  const { highValue, smooth, paired } = analyzeHand(player.hand);
  const r = _rand();

  // ── ペアあり: 重複解消 + 高カード処分 ──
  if (paired) {
    // 最終ラウンドは慎重に1〜2枚、それ以外は2〜3枚ドロー
    const drawN = round === 3 ? (r < 0.5 ? 1 : 2) : (r < 0.5 ? 2 : 3);
    return pickDiscardIndices(player.hand, drawN);
  }

  let drawN;

  if (round === 1) {
    // 1st Draw
    if (highValue <= 5 && smooth <= 1) drawN = 0;           // Pat (HighCard<=7 & smooth)
    else if (highValue <= 7)           drawN = 1;           // HighCard <= 9
    else if (highValue <= 9)           drawN = 2;           // HighCard <= J
    else                               drawN = 3;
  } else if (round === 2) {
    // 2nd Draw
    if (highValue <= 5 && smooth <= 1) drawN = 0;
    else if (highValue <= 7)           drawN = 1;
    else if (highValue <= 9)           drawN = (r < 0.30 ? 2 : 1);  // J以下: 30%で2枚
    else                               drawN = (r < 0.50 ? 3 : 2);  // Q以上: 50%で3枚
  } else {
    // 3rd Draw (最終)
    if (highValue <= 6 && smooth <= 1) drawN = 0;           // Pat (HighCard<=8)
    else if (highValue <= 8)           drawN = 1;           // HighCard <= T
    else                               drawN = (r < 0.50 ? 2 : 1); // 弱い時のみ2枚
  }

  return pickDiscardIndices(player.hand, drawN);
}

/**
 * 悪さスコア順に N 枚のインデックスを返す。
 * スコア = (ペア重複) * 100 + value
 * ペアの2枚目以降 → 必ず廃棄候補。それ以外は高カード優先で廃棄。
 */
function pickDiscardIndices(hand, n) {
  if (n <= 0) return [];
  if (n >= hand.length) return hand.map((_, i) => i);

  const seen = {};
  const ranked = hand.map((c, i) => {
    seen[c.value] = (seen[c.value] || 0) + 1;
    const dupPenalty = seen[c.value] > 1 ? 100 : 0; // 2枚目以降=強制廃棄
    return { idx: i, badness: dupPenalty + c.value };
  });

  ranked.sort((a, b) => b.badness - a.badness);
  return ranked.slice(0, n).map(x => x.idx);
}

// ══════════════════════════════════════════════
// §4  ベッティング判断
// ══════════════════════════════════════════════

/**
 * ベッティングラウンドの CPU アクションを決定する。
 * @returns {{ action: string, amount: number }}
 */
export function decideCpuAction(adapter) {
  const player = adapter.getCurrentPlayer();
  if (!player) return { action: DrawAction.CHECK, amount: 0 };

  const valid = adapter.getValidActions(player);
  if (valid.length === 0) return { action: DrawAction.CHECK, amount: 0 };

  const state   = adapter.state;
  const betSize = adapter._roundBetSize;
  const { highValue, smooth, paired } = analyzeHand(player.hand);

  // ペアありハンドは事実上「HighCard=A」扱い (最弱レンジ)
  const effHigh = paired ? 12 : highValue;

  const canBet   = valid.includes(DrawAction.BET);
  const canRaise = valid.includes(DrawAction.RAISE);
  const canCall  = valid.includes(DrawAction.CALL);
  const canCheck = valid.includes(DrawAction.CHECK);

  const r = _rand();

  // ── BETTING_1: 未ドロー — 自分のハンドのみで判断 ──
  if (state === 'BETTING_1') {
    return decidePreFirstDraw(effHigh, smooth, canBet, canRaise, canCall, canCheck, betSize, r);
  }

  // ── BETTING_2〜4: 相手のドロー情報で判断 ──
  const selfDraw   = player.drawCount || 0;
  const minOppDraw = getMinOppDrawCount(adapter, player.id);
  const oppPat     = minOppDraw === 0;
  const oppDraw1   = minOppDraw === 1;
  const oppDraw2   = minOppDraw === 2;
  const oppDraw23  = minOppDraw !== null && minOppDraw >= 2;

  const selfPat    = selfDraw === 0;
  const selfDraw1  = selfDraw === 1;
  const selfDraw2  = selfDraw === 2;
  const selfDraw3p = selfDraw >= 3;

  // ── BETTING_4 (spec: 3rd Betting = 最終) ──
  if (state === 'BETTING_4') {
    return decideFinalBetting(
      effHigh, smooth, oppPat, oppDraw23,
      canBet, canRaise, canCall, canCheck, betSize, r
    );
  }

  // ── BETTING_2 / BETTING_3 (spec: 1st / 2nd Betting) ──
  const specRound = state === 'BETTING_2' ? 1 : 2;
  return decideMidBetting(
    specRound,
    effHigh, smooth,
    selfPat, selfDraw1, selfDraw2, selfDraw3p,
    oppPat, oppDraw1, oppDraw2, oppDraw23,
    canBet, canRaise, canCall, canCheck, betSize, r
  );
}

// ──────────────────────────────────────────────
// §4-A  BETTING_1: 未ドロー (自分のハンドのみ)
// ──────────────────────────────────────────────
function decidePreFirstDraw(effHigh, smooth, canBet, canRaise, canCall, canCheck, betSize, r) {
  const isStrong = effHigh <= 5 && smooth <= 1;  // 7-low smooth → pat候補
  const isMedium = effHigh <= 7;                  // 9以下

  if (canCheck) {
    if (isStrong && canBet && r < 0.70) return { action: DrawAction.BET, amount: betSize };
    if (isMedium && canBet && r < 0.25) return { action: DrawAction.BET, amount: betSize };
    return { action: DrawAction.CHECK, amount: 0 };
  }

  // 面している
  if (isStrong) {
    if (canRaise && r < 0.40) return { action: DrawAction.RAISE, amount: betSize };
    return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
  }
  if (isMedium) {
    return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
  }
  // 弱いハンドは原則フォールド (少額ならたまにコール)
  if (effHigh <= 9 && r < 0.25 && canCall) return { action: DrawAction.CALL, amount: 0 };
  return { action: DrawAction.FOLD, amount: 0 };
}

// ──────────────────────────────────────────────
// §4-B  1st / 2nd Betting Round (BETTING_2 / BETTING_3)
// ──────────────────────────────────────────────
function decideMidBetting(
  specRound,
  effHigh, smooth,
  selfPat, selfDraw1, selfDraw2, selfDraw3p,
  oppPat, oppDraw1, oppDraw2, oppDraw23,
  canBet, canRaise, canCall, canCheck, betSize, r
) {
  // ブラフ頻度算出 (状況依存)
  let bluffFreq = 0;
  if (selfPat && oppDraw23)                         bluffFreq = 0.30;
  else if (selfDraw1 && oppDraw2)                   bluffFreq = 0.20;
  else if (selfDraw1 && oppDraw23 && !oppDraw2)     bluffFreq = 0.35; // opp draw 3
  else if (selfDraw1 && oppDraw23)                  bluffFreq = 0.25;

  // レイズバリュー条件
  const raiseValue =
    (selfPat && effHigh <= 5) ||                // Pat かつ HighCard<=7
    (selfDraw1 && effHigh <= 6) ||              // 1枚ドロー済みで HighCard<=8
    oppDraw23;                                   // 相手が弱レンジ (セミブラフ含)

  // ── 主導権あり (チェック可能) ──
  if (canCheck) {
    // 自分 Pat vs 相手 2-3枚 → Bet (spec)
    if (selfPat && oppDraw23 && canBet) {
      return { action: DrawAction.BET, amount: betSize };
    }
    // 自分 Pat で強い → Bet 55%
    if (selfPat && effHigh <= 6 && canBet && r < 0.55) {
      return { action: DrawAction.BET, amount: betSize };
    }
    // 自分 1枚 vs 相手 1枚:
    //   1st Round → Check or Call (= Check)
    //   2nd Round → Check 70% / Bet 30%
    if (selfDraw1 && oppDraw1 && specRound === 2 && canBet && r < 0.30) {
      return { action: DrawAction.BET, amount: betSize };
    }
    // 自分 1枚でバリュー十分 (HighCard<=8) → 時々ベット
    if (selfDraw1 && effHigh <= 6 && canBet && r < 0.35) {
      return { action: DrawAction.BET, amount: betSize };
    }
    // ブラフ
    if (canBet && r < bluffFreq) return { action: DrawAction.BET, amount: betSize };
    return { action: DrawAction.CHECK, amount: 0 };
  }

  // ── 面している ──
  // 自分 3枚ドロー → 原則 Fold (spec)
  if (selfDraw3p) return { action: DrawAction.FOLD, amount: 0 };

  // 自分 2枚 vs 相手 Pat → Fold (spec)
  if (selfDraw2 && oppPat) {
    if (r < 0.08 && canCall) return { action: DrawAction.CALL, amount: 0 };
    return { action: DrawAction.FOLD, amount: 0 };
  }

  // 自分 Pat は強気 — レイズ or コール
  if (selfPat) {
    if (raiseValue && canRaise && r < 0.40) {
      return { action: DrawAction.RAISE, amount: betSize };
    }
    return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
  }

  // 自分 1枚 vs 相手 1枚 → Check/Call (spec)
  if (selfDraw1 && oppDraw1) {
    return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
  }

  // 自分 1枚 vs 相手 Pat → 慎重コール 40%
  if (selfDraw1 && oppPat) {
    if (r < 0.40 && canCall) return { action: DrawAction.CALL, amount: 0 };
    return { action: DrawAction.FOLD, amount: 0 };
  }

  // 自分 1枚 vs 相手 2-3枚 → 優位 コール (時々レイズ)
  if (selfDraw1 && oppDraw23) {
    if (canRaise && r < 0.25) return { action: DrawAction.RAISE, amount: betSize };
    return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
  }

  // 自分 2枚 vs 相手 1枚 → Call 50% (spec)
  if (selfDraw2 && oppDraw1) {
    if (r < 0.50 && canCall) return { action: DrawAction.CALL, amount: 0 };
    return { action: DrawAction.FOLD, amount: 0 };
  }

  // 自分 2枚 vs 相手 2-3枚 → 同等の弱レンジ、Call 55%
  if (selfDraw2 && oppDraw23) {
    if (r < 0.55 && canCall) return { action: DrawAction.CALL, amount: 0 };
    return { action: DrawAction.FOLD, amount: 0 };
  }

  // フォールバック
  if (canCall && r < 0.25) return { action: DrawAction.CALL, amount: 0 };
  return { action: DrawAction.FOLD, amount: 0 };
}

// ──────────────────────────────────────────────
// §4-C  3rd Betting Round (BETTING_4 = 最終)
// ──────────────────────────────────────────────
function decideFinalBetting(
  effHigh, smooth, oppPat, oppDraw23,
  canBet, canRaise, canCall, canCheck, betSize, r
) {
  // バリューベット頻度
  //   HighCard <= 7 (value<=5) → 100%
  //   HighCard <= 8 (value<=6) → 50%
  //   HighCard <= 9 (value<=7) → Check/Call (ベット0%)
  let valueFreq = 0;
  if (effHigh <= 5)       valueFreq = 1.00;
  else if (effHigh <= 6)  valueFreq = 0.50;

  // ブラフ頻度
  //   相手が 2-3枚ドローしていた → 30%
  //   相手が Pat で自分が弱そう(T以上) → 15%
  let bluffFreq = 0;
  if (oppDraw23)                      bluffFreq = 0.30;
  else if (oppPat && effHigh >= 8)    bluffFreq = 0.15;

  // ── チェック可能 ──
  if (canCheck) {
    // バリュー先に判定
    if (r < valueFreq && canBet) return { action: DrawAction.BET, amount: betSize };
    // 残りのレンジでブラフ
    if (valueFreq < 1 && canBet) {
      const r2 = _rand();
      if (r2 < bluffFreq) return { action: DrawAction.BET, amount: betSize };
    }
    return { action: DrawAction.CHECK, amount: 0 };
  }

  // ── 面している ──
  // HighCard >= T (value>=8) → 原則 Fold (spec)
  if (effHigh >= 8) {
    if (r < 0.08 && canCall) return { action: DrawAction.CALL, amount: 0 }; // 稀なヒーローコール
    return { action: DrawAction.FOLD, amount: 0 };
  }

  // HighCard <= 7 → レイズ or コール
  if (effHigh <= 5) {
    if (canRaise && r < 0.35) return { action: DrawAction.RAISE, amount: betSize };
    return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
  }

  // HighCard <= 8 → コール
  if (effHigh <= 6) {
    return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
  }

  // HighCard = 9 (value=7) → Check/Call寄り (60%)
  if (r < 0.60 && canCall) return { action: DrawAction.CALL, amount: 0 };
  return { action: DrawAction.FOLD, amount: 0 };
}
