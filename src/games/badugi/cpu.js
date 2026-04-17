// Badugi CPU — ルールベース強化版
// 「できるだけシンプルだが実戦で強い」2軸評価 (BadugiCount + HighCard) による実戦型AI
// CLAUDE.md準拠: Math.random()禁止、crypto.getRandomValues()使用
//
// card.value (0〜12): 0='2', 1='3', ..., 11='K', 12='A'
// Badugi値 (bv): A→0 (最強), 2→1, 3→2, ..., K→12 (最弱)
//
// スペック HighCard 閾値 → Badugi 値変換:
//   HighCard <= 4 ⇔ bv <= 3
//   HighCard <= 5 ⇔ bv <= 4
//   HighCard <= 6 ⇔ bv <= 5
//   HighCard <= 7 ⇔ bv <= 6
//   HighCard <= 8 ⇔ bv <= 7
//   HighCard <= 9 ⇔ bv <= 8
//   HighCard >= 7 ⇔ bv >= 6
//
// ストリート対応 (DrawGame ステートマシン):
//   BETTING_1 → 未ドロー: 自分のハンドのみ判断
//   BETTING_2 → spec「1st Betting Round」(Draw1 後)
//   BETTING_3 → spec「2nd Betting Round」(Draw2 後)
//   BETTING_4 → spec「3rd Betting Round (最終)」
//   DRAW_1 → spec「1st Draw」 / DRAW_2 → 「2nd Draw」 / DRAW_3 → 「3rd Draw」

import { DrawAction } from '../shared/drawGame.js';
import { bestBadugiHand } from './evaluator.js';

// ══════════════════════════════════════════════
// §0  暗号論的安全乱数
// ══════════════════════════════════════════════

function _rand() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x100000000;
}

// card.value → Badugi 値 (A=0 最強, 2=1, ..., K=12 最弱)
const _bv = v => (v === 12 ? 0 : v + 1);

// ══════════════════════════════════════════════
// §1  ハンド評価 (BadugiCount + HighCard)
// ══════════════════════════════════════════════

/**
 * 2軸ハンド評価:
 *   size     — BadugiCount (1〜4)
 *   highBv   — 有効 Badugi 集合内の最大 bv (最弱カード)
 *              サイズ 0 の場合は 12 (最弱)
 */
function analyzeBadugi(hand) {
  const { size, bvs } = bestBadugiHand(hand);
  if (size === 0) return { size: 0, highBv: 12 };
  // bvs は降順 → bvs[0] が最大 bv (最弱カード)
  const highBv = bvs[0];
  return { size, highBv };
}

// ══════════════════════════════════════════════
// §2  相手のドロー状況分析
// ══════════════════════════════════════════════

/**
 * 最強の可能性がある相手の直前ドロー枚数 (=最小drawCount) を返す。
 * BETTING_1 では未ドローのため null。
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
  const { size, highBv } = analyzeBadugi(player.hand);
  const r = _rand();

  let drawN;

  if (round === 1) {
    // 1st Draw
    if (size === 4)                       drawN = 0;                     // Pat
    else if (size === 3 && highBv <= 4)   drawN = 1;                     // 強い3枚 (HC<=5)
    else if (size === 3)                  drawN = (r < 0.30 ? 2 : 1);    // 弱い3枚: 30%で2枚
    else if (size === 2)                  drawN = (r < 0.50 ? 3 : 2);    // 2枚: 2〜3
    else                                  drawN = 3;                     // 1枚以下
  } else if (round === 2) {
    // 2nd Draw
    if (size === 4)                       drawN = 0;                     // Pat
    else if (size === 3 && highBv <= 5)   drawN = 1;                     // 強い3枚 (HC<=6)
    else if (size === 3)                  drawN = (r < 0.20 ? 2 : 1);    // 弱い3枚: 20%で2枚
    else if (size === 2)                  drawN = 2;
    else                                  drawN = (r < 0.40 ? 3 : 2);    // 1枚以下
  } else {
    // 3rd Draw (最終)
    if (size === 4 && highBv <= 7)        drawN = 0;                     // Pat (HC<=8)
    else if (size === 4)                  drawN = (r < 0.10 ? 1 : 0);    // 4枚弱: 10%で1枚
    else if (size === 3 && highBv <= 4)   drawN = 1;                     // 戦える3枚 (HC<=5)
    else if (size === 3)                  drawN = 1;                     // 弱い3枚: 1枚ドロー
    else                                  drawN = (r < 0.50 ? 2 : 1);    // 2枚以下
  }

  return pickDiscardIndices(player.hand, drawN);
}

/**
 * bestBadugiHand の有効サブセットに対応する hand インデックス Set を返す。
 * 同 bv カードが複数ある場合は最初にマッチしたものを採用。
 */
function _keptSet(hand) {
  const { bvs } = bestBadugiHand(hand);
  const kept = new Set();
  for (const need of bvs) {
    for (let i = 0; i < hand.length; i++) {
      if (!kept.has(i) && _bv(hand[i].value) === need) { kept.add(i); break; }
    }
  }
  return kept;
}

/**
 * N 枚廃棄するインデックスを返す。
 * 優先: 非 Badugi 有効 (keptに含まれない) → Badugi 有効内の最悪 bv
 */
function pickDiscardIndices(hand, n) {
  if (n <= 0) return [];
  if (n >= hand.length) return hand.map((_, i) => i);

  const kept      = _keptSet(hand);
  const nonKept   = hand.map((_, i) => i).filter(i => !kept.has(i));
  // 非 Badugi カードは高 value (badness) 順で並べる
  nonKept.sort((a, b) => _bv(hand[b].value) - _bv(hand[a].value));

  if (nonKept.length >= n) return nonKept.slice(0, n);

  // 足りない: Badugi 有効内の最悪 bv から追加廃棄
  const inKept = [...kept].sort((a, b) => _bv(hand[b].value) - _bv(hand[a].value));
  const needed = n - nonKept.length;
  return [...nonKept, ...inKept.slice(0, needed)];
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
  const { size, highBv } = analyzeBadugi(player.hand);

  const canBet   = valid.includes(DrawAction.BET);
  const canRaise = valid.includes(DrawAction.RAISE);
  const canCall  = valid.includes(DrawAction.CALL);
  const canCheck = valid.includes(DrawAction.CHECK);

  const r = _rand();

  // ── BETTING_1: 未ドロー — 自分のハンドのみで判断 ──
  if (state === 'BETTING_1') {
    return decidePreFirstDraw(size, highBv, canBet, canRaise, canCall, canCheck, betSize, r);
  }

  // ── BETTING_2〜4: 相手のドロー情報で判断 ──
  const minOppDraw = getMinOppDrawCount(adapter, player.id);
  const oppPat     = minOppDraw === 0;
  const oppDraw1   = minOppDraw === 1;
  const oppDraw23  = minOppDraw !== null && minOppDraw >= 2;

  // ── BETTING_4 (spec: 3rd Betting = 最終) ──
  if (state === 'BETTING_4') {
    return decideFinalBetting(
      size, highBv, oppPat, oppDraw23,
      canBet, canRaise, canCall, canCheck, betSize, r
    );
  }

  // ── BETTING_2 / BETTING_3 (spec: 1st / 2nd Betting) ──
  const specRound = state === 'BETTING_2' ? 1 : 2;
  return decideMidBetting(
    specRound, size, highBv,
    oppPat, oppDraw1, oppDraw23,
    canBet, canRaise, canCall, canCheck, betSize, r
  );
}

// ──────────────────────────────────────────────
// §4-A  BETTING_1: 未ドロー (自分のハンドのみ)
// ──────────────────────────────────────────────
function decidePreFirstDraw(size, highBv, canBet, canRaise, canCall, canCheck, betSize, r) {
  // 4枚Badugi or 強い3枚(HC<=5) は主導
  const isStrong = size === 4 || (size === 3 && highBv <= 4);
  // 3枚は中程度
  const isMedium = size === 3;

  if (canCheck) {
    if (isStrong && canBet && r < 0.70) return { action: DrawAction.BET, amount: betSize };
    if (isMedium && canBet && r < 0.30) return { action: DrawAction.BET, amount: betSize };
    return { action: DrawAction.CHECK, amount: 0 };
  }

  // 面している
  if (isStrong) {
    if (canRaise && r < 0.45) return { action: DrawAction.RAISE, amount: betSize };
    return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
  }
  if (isMedium) {
    return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
  }
  // 2枚以下: たまにコール、原則フォールド
  if (size === 2 && r < 0.25 && canCall) return { action: DrawAction.CALL, amount: 0 };
  return { action: DrawAction.FOLD, amount: 0 };
}

// ──────────────────────────────────────────────
// §4-B  1st / 2nd Betting Round (BETTING_2 / BETTING_3)
// ──────────────────────────────────────────────
function decideMidBetting(
  specRound, size, highBv,
  oppPat, oppDraw1, oppDraw23,
  canBet, canRaise, canCall, canCheck, betSize, r
) {
  // ブラフ頻度算出
  //   自分 4枚 vs 相手 2-3枚 → 25〜30%
  //   自分 3枚 & HC<=5 vs 相手 3枚 → 20%
  //   自分 3枚 vs 相手 2-3枚 (相手弱そう) → 20〜25%
  let bluffFreq = 0;
  if (size === 4 && oppDraw23)                  bluffFreq = 0.28;
  else if (size === 3 && highBv <= 4 && oppDraw23) bluffFreq = 0.20;
  else if (size === 3 && oppDraw23)              bluffFreq = 0.22;

  // レイズバリュー条件 (spec):
  //   自分 4枚 & HC<=7
  //   自分 4枚 & 相手 2-3枚
  //   自分 3枚 & HC<=4 & 相手 2-3枚
  const raiseValue =
    (size === 4 && highBv <= 6) ||
    (size === 4 && oppDraw23) ||
    (size === 3 && highBv <= 3 && oppDraw23);

  // ── 主導権あり (チェック可能) ──
  if (canCheck) {
    // 自分 4枚 vs 相手 2-3枚 → Bet (spec)
    if (size === 4 && oppDraw23 && canBet) {
      return { action: DrawAction.BET, amount: betSize };
    }
    // 自分 4枚 vs 相手 1枚 → Bet 50% (spec)
    if (size === 4 && oppDraw1 && canBet && r < 0.50) {
      return { action: DrawAction.BET, amount: betSize };
    }
    // 自分 4枚 vs 相手 Pat → 慎重 40% ベット
    if (size === 4 && oppPat && canBet && r < 0.40) {
      return { action: DrawAction.BET, amount: betSize };
    }
    // 自分 3枚 & HC<=5 vs 相手 2-3枚 → Bet (spec)
    if (size === 3 && highBv <= 4 && oppDraw23 && canBet) {
      return { action: DrawAction.BET, amount: betSize };
    }
    // 自分 3枚 & HC<=5 vs 相手 1枚 → Check or Bet 25%
    if (size === 3 && highBv <= 4 && oppDraw1 && canBet && r < 0.25) {
      return { action: DrawAction.BET, amount: betSize };
    }
    // ブラフ
    if (canBet && r < bluffFreq) return { action: DrawAction.BET, amount: betSize };
    return { action: DrawAction.CHECK, amount: 0 };
  }

  // ── 面している ──
  // 2枚以下 → Check/Fold (spec)
  if (size <= 2) {
    // 相手が明らかに弱く小額なら稀にブラフコール
    if (oppDraw23 && r < 0.12 && canCall) return { action: DrawAction.CALL, amount: 0 };
    return { action: DrawAction.FOLD, amount: 0 };
  }

  // 自分 4枚: 強気にプレイ
  if (size === 4) {
    if (raiseValue && canRaise && r < 0.55) {
      return { action: DrawAction.RAISE, amount: betSize };
    }
    // HC<=9 までは常にコール
    if (highBv <= 8) {
      return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
    }
    // 4枚でHC>=T: Pat相手には慎重
    if (oppPat && r < 0.55 && canCall) return { action: DrawAction.CALL, amount: 0 };
    return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
  }

  // 自分 3枚: HighCard + 相手状況で判断
  if (size === 3) {
    // 自分 3枚 & HC>=7 vs 相手 Pat → Fold寄り (spec 1st)
    if (highBv >= 6 && oppPat) {
      if (specRound === 2) {
        // 2nd Round: spec「Call or Fold (HighCardによる)」 — HC<=6なら40%コール
        if (highBv <= 5 && r < 0.40 && canCall) return { action: DrawAction.CALL, amount: 0 };
      }
      if (r < 0.08 && canCall) return { action: DrawAction.CALL, amount: 0 };
      return { action: DrawAction.FOLD, amount: 0 };
    }

    // 自分 3枚 vs 相手 1枚 → Check/Call (spec)
    if (oppDraw1) {
      // HC<=5 なら時々レイズ
      if (highBv <= 4 && canRaise && r < 0.20) {
        return { action: DrawAction.RAISE, amount: betSize };
      }
      return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
    }

    // 自分 3枚 & HC<=5 vs 相手 2-3枚 → 優位 (raiseValueあり)
    if (highBv <= 4 && oppDraw23) {
      if (canRaise && r < 0.35) return { action: DrawAction.RAISE, amount: betSize };
      return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
    }

    // 自分 3枚 弱め vs 相手 2-3枚: ほぼ同レンジ、Call 55%
    if (oppDraw23) {
      if (r < 0.55 && canCall) return { action: DrawAction.CALL, amount: 0 };
      return { action: DrawAction.FOLD, amount: 0 };
    }

    // Pat 相手 HC<=5
    if (oppPat && highBv <= 4) {
      if (r < 0.45 && canCall) return { action: DrawAction.CALL, amount: 0 };
      return { action: DrawAction.FOLD, amount: 0 };
    }
  }

  // フォールバック
  if (canCall && r < 0.25) return { action: DrawAction.CALL, amount: 0 };
  return { action: DrawAction.FOLD, amount: 0 };
}

// ──────────────────────────────────────────────
// §4-C  3rd Betting Round (BETTING_4 = 最終)
// ──────────────────────────────────────────────
function decideFinalBetting(
  size, highBv, oppPat, oppDraw23,
  canBet, canRaise, canCall, canCheck, betSize, r
) {
  // バリューベット頻度 (spec)
  //   4枚 & HC<=7 (bv<=6) → 常に Bet
  //   4枚 & HC<=9 (bv<=8) → 50%
  //   3枚 & HC<=4 (bv<=3) → 40%
  let valueFreq = 0;
  if (size === 4 && highBv <= 6)       valueFreq = 1.00;
  else if (size === 4 && highBv <= 8)  valueFreq = 0.50;
  else if (size === 3 && highBv <= 3)  valueFreq = 0.40;

  // ブラフ頻度 (spec)
  //   相手が 2-3枚ドロー → 30%
  //   相手が Pat だが弱い3枚想定 → 15%
  let bluffFreq = 0;
  if (oppDraw23)                        bluffFreq = 0.30;
  else if (oppPat && size <= 3)         bluffFreq = 0.15;

  // ── チェック可能 ──
  if (canCheck) {
    // バリュー判定
    if (r < valueFreq && canBet) return { action: DrawAction.BET, amount: betSize };
    // 残りでブラフ
    if (valueFreq < 1 && canBet) {
      const r2 = _rand();
      if (r2 < bluffFreq) return { action: DrawAction.BET, amount: betSize };
    }
    return { action: DrawAction.CHECK, amount: 0 };
  }

  // ── 面している ──
  // 2枚以下 → Fold (spec)
  if (size <= 2) {
    if (oppDraw23 && r < 0.10 && canCall) return { action: DrawAction.CALL, amount: 0 };
    return { action: DrawAction.FOLD, amount: 0 };
  }

  // 3枚 & HC>=7 (bv>=6) → Fold (spec)
  if (size === 3 && highBv >= 6) {
    if (oppDraw23 && r < 0.15 && canCall) return { action: DrawAction.CALL, amount: 0 };
    return { action: DrawAction.FOLD, amount: 0 };
  }

  // 4枚 & HC<=7: レイズ or コール
  if (size === 4 && highBv <= 6) {
    if (canRaise && r < 0.45) return { action: DrawAction.RAISE, amount: betSize };
    return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
  }

  // 4枚 & HC<=9: コール中心、稀にレイズ
  if (size === 4 && highBv <= 8) {
    if (canRaise && oppDraw23 && r < 0.20) return { action: DrawAction.RAISE, amount: betSize };
    return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
  }

  // 4枚 弱 (HC>=T): 相手Pat に対してはフォールド寄り、弱レンジにはコール
  if (size === 4) {
    if (oppDraw23 && canCall) return { action: DrawAction.CALL, amount: 0 };
    if (oppPat && r < 0.25 && canCall) return { action: DrawAction.CALL, amount: 0 };
    return { action: DrawAction.FOLD, amount: 0 };
  }

  // 3枚 & HC<=6 (bv<=5): 中堅 — コール寄り
  if (size === 3 && highBv <= 5) {
    if (oppDraw23) {
      return canCall ? { action: DrawAction.CALL, amount: 0 } : { action: DrawAction.FOLD, amount: 0 };
    }
    if (r < 0.45 && canCall) return { action: DrawAction.CALL, amount: 0 };
    return { action: DrawAction.FOLD, amount: 0 };
  }

  // フォールバック
  return { action: DrawAction.FOLD, amount: 0 };
}
