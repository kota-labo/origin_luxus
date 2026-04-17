// NLH CPU AI — Position-aware, multi-level poker engine
// CLAUDE.md準拠: Math.random()禁止、crypto.getRandomValues()使用、チップは小数1桁まで (0.1単位)
// decideCpuAction(adapter) → { action, amount }

import { Action } from './logic.js';

// ══════════════════════════════════════════════
// §1  暗号論的安全乱数ユーティリティ
// ══════════════════════════════════════════════

function rng01() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x100000000;
}

/** 確率 p で true を返す */
function chance(p) { return rng01() < p; }

/** ± jitter (例: 0.7, 0.1 → 0.6〜0.8) */
function jitter(base, range) {
  return base + (rng01() * 2 - 1) * range;
}

// ══════════════════════════════════════════════
// §2  ポジション判定
// ══════════════════════════════════════════════

const POS = { SB: 'SB', BB: 'BB', UTG: 'UTG', HJ: 'HJ', CO: 'CO', BTN: 'BTN' };

function detectPosition(adapter, playerId) {
  const sbIdx  = adapter.getSBIndex();
  const bbIdx  = adapter.getBBIndex();
  const btnIdx = adapter.dealerIndex;

  if (playerId === sbIdx)  return POS.SB;
  if (playerId === bbIdx)  return POS.BB;
  if (playerId === btnIdx) return POS.BTN;

  // 残りプレイヤーを BB の次から BTN 手前まで並べてマッピング
  const n = adapter.players.length;
  const livePlayers = [];
  for (let i = 1; i <= n; i++) {
    const idx = (bbIdx + i) % n;
    if (idx === sbIdx || idx === bbIdx || idx === btnIdx) continue;
    const p = adapter.players[idx];
    if (p.chips > 0 && !p.folded) livePlayers.push(idx);
  }

  const pos = livePlayers.indexOf(playerId);
  if (pos === -1) return POS.UTG;

  const count = livePlayers.length;
  if (count <= 1) return POS.CO;   // 2人しかいないなら CO 扱い
  if (count === 2) return pos === 0 ? POS.UTG : POS.CO;
  // 3+: UTG, HJ, CO
  if (pos === 0) return POS.UTG;
  if (pos === count - 1) return POS.CO;
  return POS.HJ;
}

// ══════════════════════════════════════════════
// §3  プリフロップ ハンド分類
// ══════════════════════════════════════════════

/** card.value: 2=0, 3=1, ..., K=11, A=12 */
function handKey(hand) {
  let hi = hand[0].value, lo = hand[1].value;
  if (lo > hi) { const t = hi; hi = lo; lo = t; }
  const suited = hand[0].suit === hand[1].suit;
  const R = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  return R[hi] + R[lo] + (hi === lo ? '' : suited ? 's' : 'o');
}

// レンジテーブル: ポジションごとにオープンするハンドセット
// 各セットは handKey 文字列の Set
function buildRange(hands) { return new Set(hands); }

const PAIRS = 'AA KK QQ JJ TT 99 88 77 66 55 44 33 22'.split(' ');

const OPEN_RANGES = {
  [POS.UTG]: buildRange([
    ...PAIRS.slice(0, 9),  // AA-66
    'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s',
    'KQs','KJs','KTs','K9s','K8s',
    'QJs','QTs','Q9s',
    'JTs','J9s',
    'T9s','T8s',
    '98s',
    'AKo','AQo','AJo','ATo',
    'KQo','KJo',
    'QJo',
  ]),
  [POS.HJ]: buildRange([
    ...PAIRS.slice(0, 10), // AA-55
    'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
    'KQs','KJs','KTs','K9s','K8s','K7s',
    'QJs','QTs','Q9s',
    'JTs','J9s','J8s',
    'T9s','T8s',
    '98s','97s',
    '87s',
    'AKo','AQo','AJo','ATo',
    'KQo','KJo',
    'QJo','QTo',
  ]),
  [POS.CO]: buildRange([
    ...PAIRS.slice(0, 11), // AA-44
    'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
    'KQs','KJs','KTs','K9s','K8s','K7s','K6s',
    'QJs','QTs','Q9s','Q8s',
    'JTs','J9s','J8s',
    'T9s','T8s',
    '98s','97s',
    '87s','86s',
    '76s',
    'AKo','AQo','AJo','ATo','A9o',
    'KQo','KJo','KTo',
    'QJo','QTo',
    'JTo',
  ]),
  [POS.BTN]: buildRange([
    ...PAIRS,              // AA-22
    'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
    'KQs','KJs','KTs','K9s','K8s','K7s','K6s','K5s','K4s',
    'QJs','QTs','Q9s','Q8s','Q7s',
    'JTs','J9s','J8s','J7s',
    'T9s','T8s','T7s',
    '98s','97s','96s',
    '87s','86s',
    '76s','75s',
    '65s','64s',
    '54s',
    'AKo','AQo','AJo','ATo','A9o','A8o','A7o',
    'KQo','KJo','KTo','K9o',
    'QJo','QTo','Q9o',
    'JTo','J9o',
    'T9o',
    '98o',
  ]),
  [POS.SB]: buildRange([
    ...PAIRS,
    'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
    'KQs','KJs','KTs','K9s','K8s','K7s','K6s','K5s',
    'QJs','QTs','Q9s','Q8s',
    'JTs','J9s','J8s',
    'T9s','T8s',
    '98s','97s',
    '87s','86s',
    '76s',
    '65s',
    '54s',
    'AKo','AQo','AJo','ATo','A9o','A8o',
    'KQo','KJo','KTo',
    'QJo','QTo',
    'JTo',
  ]),
};

// BB defense: ほとんどのハンドをディフェンス
const BB_DEFEND = buildRange([
  ...PAIRS,
  'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
  'KQs','KJs','KTs','K9s','K8s','K7s','K6s','K5s','K4s','K3s','K2s',
  'QJs','QTs','Q9s','Q8s','Q7s','Q6s',
  'JTs','J9s','J8s','J7s',
  'T9s','T8s','T7s',
  '98s','97s','96s',
  '87s','86s','85s',
  '76s','75s',
  '65s','64s',
  '54s','53s',
  '43s',
  'AKo','AQo','AJo','ATo','A9o','A8o','A7o','A6o','A5o','A4o',
  'KQo','KJo','KTo','K9o','K8o',
  'QJo','QTo','Q9o',
  'JTo','J9o',
  'T9o','T8o',
  '98o','97o',
  '87o',
]);

// 3bet バリューレンジ: QQ+, AKs, AKo
const THREE_BET_VALUE = buildRange(['AA','KK','QQ','AKs','AKo']);
// 3bet ブラフレンジ: A5s-A2s, KTs, QTs, JTs
const THREE_BET_BLUFF = buildRange(['A5s','A4s','A3s','A2s','KTs','QTs','JTs']);
// 4bet バリュー: KK+, AKs
const FOUR_BET_VALUE = buildRange(['AA','KK','AKs']);
// 4bet ブラフ: A5s
const FOUR_BET_BLUFF = buildRange(['A5s']);

// プリフロップオープンサイズ (BB単位)
//   SB のみ 3BB、他ポジションは全て 2.5BB 固定
//   (既にコール・レイズが入っている場合は §8 で 75〜100% pot raise を適用)
const OPEN_SIZE = {
  [POS.UTG]: 2.5,
  [POS.HJ]:  2.5,
  [POS.CO]:  2.5,
  [POS.BTN]: 2.5,
  [POS.SB]:  3.0,
  [POS.BB]:  2.5,
};

// ══════════════════════════════════════════════
// §4  ボードテクスチャ分類
// ══════════════════════════════════════════════

const TEXTURE = { DRY: 'dry', SEMI_WET: 'semi_wet', WET: 'wet' };

function classifyBoard(communityCards) {
  if (!communityCards || communityCards.length === 0) return TEXTURE.DRY;

  const vals = communityCards.map(c => c.value).sort((a, b) => a - b);
  const suits = communityCards.map(c => c.suit);

  // フラッシュドロー: 同スート3枚以上
  const suitCount = {};
  for (const s of suits) suitCount[s] = (suitCount[s] || 0) + 1;
  const maxSuit = Math.max(...Object.values(suitCount));
  const hasFlushDraw = maxSuit >= 3;

  // ストレートドロー: 連続カード
  let connectedness = 0;
  for (let i = 1; i < vals.length; i++) {
    const gap = vals[i] - vals[i - 1];
    if (gap <= 2) connectedness++;
  }

  // ペアボード
  const valCount = {};
  for (const v of vals) valCount[v] = (valCount[v] || 0) + 1;
  const hasPair = Object.values(valCount).some(c => c >= 2);

  // ハイカード密度 (T以上の枚数)
  const highCards = vals.filter(v => v >= 8).length; // T=8, J=9, Q=10, K=11, A=12

  if (hasFlushDraw && connectedness >= 2) return TEXTURE.WET;
  if (hasFlushDraw || connectedness >= 2) return TEXTURE.SEMI_WET;
  if (hasPair && connectedness <= 1) return TEXTURE.DRY;
  if (highCards <= 1 && connectedness <= 1) return TEXTURE.DRY;

  return TEXTURE.SEMI_WET;
}

// ══════════════════════════════════════════════
// §5  ポストフロップ ハンド強度分析
// ══════════════════════════════════════════════

const HAND_CLASS = {
  TRASH:        0,
  DRAW:         1,
  BOTTOM_PAIR:  2,
  MID_PAIR:     3,
  TOP_PAIR_WEAK:4,  // TPウィークキッカー
  TOP_PAIR:     5,  // TPGK+
  OVERPAIR:     6,
  TWO_PAIR:     7,
  SET:          8,
  STRAIGHT:     9,
  FLUSH:        10,
  FULL_HOUSE:   11,
  QUADS:        12,
  STRAIGHT_FLUSH:13,
};

function classifyMadeHand(adapter, playerId) {
  const p = adapter.players[playerId];
  if (!p || p.hand.length === 0) return { cls: HAND_CLASS.TRASH, hasBlocker: false, hasDraw: false };

  const board = adapter.communityCards;
  if (board.length < 3) return { cls: HAND_CLASS.TRASH, hasBlocker: false, hasDraw: false };

  const result = adapter.evaluateCurrentHand(playerId);
  if (!result) return { cls: HAND_CLASS.TRASH, hasBlocker: false, hasDraw: false };

  const rank = result.rank;  // HandRank 0-9
  const holeVals = p.hand.map(c => c.value).sort((a, b) => b - a);
  const boardVals = board.map(c => c.value).sort((a, b) => b - a);

  let cls = HAND_CLASS.TRASH;

  if (rank >= 8)      cls = HAND_CLASS.STRAIGHT_FLUSH;
  else if (rank === 7) cls = HAND_CLASS.QUADS;
  else if (rank === 6) cls = HAND_CLASS.FULL_HOUSE;
  else if (rank === 5) cls = HAND_CLASS.FLUSH;
  else if (rank === 4) cls = HAND_CLASS.STRAIGHT;
  else if (rank === 3) {
    // セット or トリップス
    const holePair = holeVals[0] === holeVals[1];
    cls = holePair ? HAND_CLASS.SET : HAND_CLASS.TWO_PAIR; // trips ≈ 2pair strength
  } else if (rank === 2) {
    cls = HAND_CLASS.TWO_PAIR;
  } else if (rank === 1) {
    // ワンペア — トップペア or それ以下を判定
    const topBoard = boardVals[0];
    const pairVal = result.kickers ? result.kickers[0] : -1;
    if (pairVal > topBoard) {
      cls = HAND_CLASS.OVERPAIR;
    } else if (pairVal === topBoard) {
      // TPGK判定: キッカーが T(8) 以上なら TPGK
      const kicker = holeVals.find(v => v !== pairVal);
      cls = (kicker !== undefined && kicker >= 8) ? HAND_CLASS.TOP_PAIR : HAND_CLASS.TOP_PAIR_WEAK;
    } else if (boardVals.length >= 2 && pairVal === boardVals[1]) {
      cls = HAND_CLASS.MID_PAIR;
    } else {
      cls = HAND_CLASS.BOTTOM_PAIR;
    }
  }

  // ドロー判定
  const hasDraw = detectDraw(p.hand, board);

  // ブロッカー判定
  const hasBlocker = detectBlocker(p.hand, board);

  return { cls, hasBlocker, hasDraw };
}

/** フラッシュドロー or ストレートドロー検出 */
function detectDraw(hand, board) {
  const allCards = [...hand, ...board];

  // フラッシュドロー
  const suitCount = {};
  for (const c of allCards) suitCount[c.suit] = (suitCount[c.suit] || 0) + 1;
  const handSuits = hand.map(c => c.suit);
  for (const s of handSuits) {
    if (suitCount[s] === 4) return true; // 4枚同スート = フラッシュドロー
  }

  // OESDまたはガットショット (簡易検出)
  const vals = [...new Set(allCards.map(c => c.value))].sort((a, b) => a - b);
  // Ace-low ストレート考慮: A(12)→-1としても追加
  if (vals.includes(12)) vals.unshift(-1);
  for (let i = 0; i < vals.length - 3; i++) {
    const window = vals.slice(i, i + 5);
    if (window.length >= 4) {
      const span = window[window.length - 1] - window[0];
      if (span <= 4) return true; // 4枚が5幅以内 = ストレートドロー
    }
  }

  return false;
}

/** ブロッカー判定: ホールカードがナッツ級ドローをブロックしているか */
function detectBlocker(hand, board) {
  const boardVals = board.map(c => c.value);
  const holeVals = hand.map(c => c.value);

  // Aブロッカー (ナッツフラッシュドロー/ストレート妨害)
  if (holeVals.includes(12)) return true;  // A=12

  // トップペアブロッカー
  const topBoard = Math.max(...boardVals);
  if (holeVals.includes(topBoard)) return true;

  return false;
}

// ══════════════════════════════════════════════
// §6  SPR & ベットサイジング
// ══════════════════════════════════════════════

function calcSPR(adapter, playerId) {
  const p = adapter.players[playerId];
  const effectiveStack = p.chips;
  const pot = adapter.pot;
  if (pot <= 0) return 100;
  return effectiveStack / pot;
}

/** ポットに対する倍率でベット額を計算 (0.1単位で丸め) */
function potBet(adapter, fraction) {
  return Math.max(adapter.bigBlind, Math.floor(adapter.pot * fraction));
}

function chooseBetSize(adapter, playerId, handClass, texture) {
  const spr = calcSPR(adapter, playerId);
  const p = adapter.players[playerId];

  // SPR < 2: オールイン
  if (spr < 2) return p.chips;

  // SPR < 3: ポットサイズ
  if (spr < 3) return potBet(adapter, 1.0);

  // テクスチャベースのデフォルトサイジング
  let fraction;
  if (texture === TEXTURE.DRY) {
    fraction = handClass >= HAND_CLASS.TWO_PAIR ? 0.5 : 0.33;
  } else if (texture === TEXTURE.SEMI_WET) {
    fraction = handClass >= HAND_CLASS.TWO_PAIR ? 0.67 : 0.5;
  } else {
    // WET
    fraction = handClass >= HAND_CLASS.SET ? 0.75 : 0.67;
  }

  // 強いハンドは時々オーバーベット
  if (handClass >= HAND_CLASS.SET && spr > 4 && chance(0.15)) {
    fraction = 1.0;
  }

  return potBet(adapter, fraction);
}

// ══════════════════════════════════════════════
// §7  レベル別モディファイア
// ══════════════════════════════════════════════

/**
 * cpuLevel: 1=beginner, 2=intermediate, 3=GTO
 * レベルが低いほどミスが多い（ランダムにサブオプティマルな選択をする）
 */
function getLevelParams(level) {
  switch (level) {
    case 1:  // Beginner: 広すぎるレンジ、ベットサイズにブレ、フォールド少なめ
      return {
        rangeExpand:   0.25,   // レンジ外ハンドでも 25% で参加
        foldReduction: 0.4,    // フォールド判断の 40% をコールに変更
        sizeJitter:    0.35,   // ベットサイズ ±35% ブレ
        bluffFreqMod:  0.5,    // ブラフ頻度半減
        cBetFreqMod:   0.7,    // C-bet 頻度 70%
      };
    case 2:  // Intermediate
      return {
        rangeExpand:   0.10,
        foldReduction: 0.15,
        sizeJitter:    0.15,
        bluffFreqMod:  0.8,
        cBetFreqMod:   0.9,
      };
    case 3:  // GTO
    default:
      return {
        rangeExpand:   0.0,
        foldReduction: 0.0,
        sizeJitter:    0.05,
        bluffFreqMod:  1.0,
        cBetFreqMod:   1.0,
      };
  }
}

// ══════════════════════════════════════════════
// §8  プリフロップ判断エンジン
// ══════════════════════════════════════════════

function preflopDecision(adapter, p, valid, pos, key, level) {
  const lp = getLevelParams(level);
  const toCall = adapter.currentBet - p.currentBet;
  const bb = adapter.bigBlind;

  // リンプ or オープンレイズがあったか判定
  const preflopRaises = countPreflopRaises(adapter);
  const preflopCalls  = countPreflopCalls(adapter);
  // 「既にCALL or RAISE が入っている」判定 (BB自身を除く)
  const actionAlreadyIn = preflopRaises > 0 || preflopCalls > 0;

  // ── 4bet facing ──
  if (preflopRaises >= 3) {
    if (FOUR_BET_VALUE.has(key)) {
      if (valid.includes(Action.RAISE)) {
        return { action: Action.ALL_IN, amount: p.chips };
      }
      return { action: Action.CALL, amount: 0 };
    }
    if (FOUR_BET_BLUFF.has(key) && chance(0.10 * lp.bluffFreqMod)) {
      return { action: Action.ALL_IN, amount: p.chips };
    }
    if (chance(0.60 + lp.foldReduction * 0.2)) {
      return valid.includes(Action.CALL) ? { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
    }
    return { action: Action.FOLD, amount: 0 };
  }

  // ── 3bet facing → 4bet 判断 ──
  if (preflopRaises === 2) {
    if (THREE_BET_VALUE.has(key)) {
      if (valid.includes(Action.RAISE)) {
        return { action: Action.RAISE, amount: potRaiseAmount(adapter, p, 0.75, 1.0) };
      }
      return { action: Action.CALL, amount: 0 };
    }
    if (THREE_BET_BLUFF.has(key) && chance(0.30 * lp.bluffFreqMod)) {
      if (valid.includes(Action.RAISE)) {
        return { action: Action.RAISE, amount: potRaiseAmount(adapter, p, 0.75, 1.0) };
      }
    }
    // コールレンジ
    const range = OPEN_RANGES[pos] || BB_DEFEND;
    if (range.has(key) && chance(0.60 + lp.foldReduction * 0.15)) {
      return valid.includes(Action.CALL) ? { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
    }
    // レベル1: ランダムコール
    if (chance(lp.rangeExpand)) {
      return valid.includes(Action.CALL) ? { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
    }
    return { action: Action.FOLD, amount: 0 };
  }

  // ── オープンレイズ facing (preflopRaises === 1) → 3bet 判断 ──
  if (preflopRaises === 1 && toCall > bb) {
    // 3bet判定 — 75〜100% ポットレイズ
    if (THREE_BET_VALUE.has(key)) {
      if (valid.includes(Action.RAISE)) {
        return { action: Action.RAISE, amount: potRaiseAmount(adapter, p, 0.75, 1.0) };
      }
      return { action: Action.CALL, amount: 0 };
    }
    if (THREE_BET_BLUFF.has(key) && chance(0.30 * lp.bluffFreqMod)) {
      if (valid.includes(Action.RAISE)) {
        return { action: Action.RAISE, amount: potRaiseAmount(adapter, p, 0.75, 1.0) };
      }
    }

    // BB ディフェンス
    if (pos === POS.BB) {
      if (BB_DEFEND.has(key) || chance(lp.rangeExpand)) {
        // JJ+ / AQ+ で 3bet
        if (['AA','KK','QQ','JJ','AKs','AKo','AQs','AQo'].some(h => key === h)) {
          if (valid.includes(Action.RAISE)) {
            return { action: Action.RAISE, amount: potRaiseAmount(adapter, p, 0.75, 1.0) };
          }
        }
        return valid.includes(Action.CALL) ? { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
      }
      // レベル1 追加ディフェンス
      if (chance(lp.foldReduction)) {
        return valid.includes(Action.CALL) ? { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
      }
      return { action: Action.FOLD, amount: 0 };
    }

    // 他ポジション: コールレンジ
    const range = OPEN_RANGES[pos] || OPEN_RANGES[POS.UTG];
    if (range.has(key) || chance(lp.rangeExpand)) {
      return valid.includes(Action.CALL) ? { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
    }
    return { action: Action.FOLD, amount: 0 };
  }

  // ── リンプ facing or ファーストイン ──
  const range = pos === POS.BB ? BB_DEFEND : (OPEN_RANGES[pos] || OPEN_RANGES[POS.UTG]);
  const inRange = range.has(key) || chance(lp.rangeExpand);

  if (!inRange) {
    // レンジ外: チェックできるならチェック、できなければフォールド
    if (valid.includes(Action.CHECK)) return { action: Action.CHECK, amount: 0 };
    // レベル1: フォールド回避
    if (chance(lp.foldReduction) && valid.includes(Action.CALL)) {
      return { action: Action.CALL, amount: 0 };
    }
    return { action: Action.FOLD, amount: 0 };
  }

  // ファーストイン判定: まだ誰もCALL/RAISEしていない → 固定BBサイズでオープン
  //   performAction の RAISE は amount = raise-to 額 - adapter.currentBet の差分を期待するため、
  //   最終 raise-to チップ数から BB 額を引いた差分を渡す (そうしないと toCall 分が二重加算される)
  if (!actionAlreadyIn && toCall <= bb && valid.includes(Action.RAISE)) {
    const openBBs = OPEN_SIZE[pos] || 2.5;
    const sizeVariance = 1 + (rng01() * 2 - 1) * lp.sizeJitter;
    const desiredTotal = openBBs * bb * sizeVariance;       // 例: UTG=25chips(=2.5BB)
    const raiseAmount  = Math.max(bb, Math.floor(desiredTotal - adapter.currentBet));
    return { action: Action.RAISE, amount: raiseAmount };
  }
  if (!actionAlreadyIn && toCall <= bb && valid.includes(Action.BET)) {
    // BET アクションは amount = ベット額そのもの (performAction が toCall を足さない)
    const openBBs = OPEN_SIZE[pos] || 2.5;
    const sizeVariance = 1 + (rng01() * 2 - 1) * lp.sizeJitter;
    return { action: Action.BET, amount: Math.max(bb, Math.floor(openBBs * bb * sizeVariance)) };
  }

  // リンプポット (誰かCALLしているがRAISEはない): 75-100% ポットアイソレーションレイズ
  if (actionAlreadyIn && toCall <= bb && valid.includes(Action.RAISE)) {
    return { action: Action.RAISE, amount: potRaiseAmount(adapter, p, 0.75, 1.0) };
  }
  if (actionAlreadyIn && toCall <= bb && valid.includes(Action.BET)) {
    return { action: Action.BET, amount: potRaiseAmount(adapter, p, 0.75, 1.0) };
  }

  // BB チェック
  if (valid.includes(Action.CHECK)) return { action: Action.CHECK, amount: 0 };

  return valid.includes(Action.CALL) ? { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
}

/**
 * 75〜100% ポットレイズ額を計算する (performAction の amount パラメータ用)
 *   amount = fraction × (pot + toCall)
 *   fraction は [fracMin, fracMax] の一様乱数
 */
function potRaiseAmount(adapter, p, fracMin, fracMax) {
  const toCall = adapter.currentBet - p.currentBet;
  const fraction = fracMin + rng01() * (fracMax - fracMin);
  const potAfterCall = adapter.pot + toCall;
  const raise = potAfterCall * fraction;
  // 最低ミニレイズ以上、残りスタック以下
  const minRaise = Math.max(adapter.bigBlind, adapter.lastRaiseIncrement || adapter.bigBlind);
  return Math.max(minRaise, Math.floor(raise));
}

/** プリフロップのレイズ回数をカウント（ブラインドは除外） */
function countPreflopRaises(adapter) {
  let count = 0;
  for (const log of adapter.actionLog) {
    if (log.startsWith('--')) break; // ストリート区切り
    if (log.includes('raises to') || log.includes('ALL IN')) count++;
  }
  return count;
}

/** プリフロップのコール回数をカウント (BBへのコール = リンプ検出用) */
function countPreflopCalls(adapter) {
  let count = 0;
  for (const log of adapter.actionLog) {
    if (log.startsWith('--')) break;
    if (log.includes('  calls')) count++;
  }
  return count;
}

// ══════════════════════════════════════════════
// §9  ポストフロップ判断エンジン
// ══════════════════════════════════════════════

function postflopDecision(adapter, p, valid, pos, level) {
  const lp = getLevelParams(level);
  const toCall = adapter.currentBet - p.currentBet;
  const { cls, hasBlocker, hasDraw } = classifyMadeHand(adapter, p.id);
  const texture = classifyBoard(adapter.communityCards);
  const street = adapter.state; // 'FLOP', 'TURN', 'RIVER'

  // ── 面していない（チェック or ベット判断）──
  if (toCall === 0) {
    return decideWhenCheckedTo(adapter, p, valid, cls, texture, street, hasBlocker, hasDraw, lp);
  }

  // ── 面している（コール or レイズ or フォールド）──
  return decideWhenFacing(adapter, p, valid, cls, texture, street, toCall, hasBlocker, hasDraw, lp);
}

// ══════════════════════════════════════════════
// §9-X  ドンクベット/チェックレイズ判定ヘルパー
// ══════════════════════════════════════════════

/** 現ストリートで指定名のプレイヤーが "checks" を記録済みか */
function didCheckThisStreet(adapter, playerName) {
  const log = adapter.actionLog;
  const target = `${playerName}  checks`;
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry.startsWith('-- ')) break;  // ストリート区切り到達
    if (entry === target) return true;
  }
  return false;
}

/**
 * 前ストリートで最後にアグレッシブ (bet/raise/all-in) だったプレイヤーのIDを返す。
 * プリフロップのブラインド投稿 (`posts BB`) は除外。
 * 該当なし or プリフロップのみなら -1。
 */
function getPrevStreetAggressorId(adapter) {
  const log = adapter.actionLog;
  // Step 1: 現ストリートマーカーを探す (最後の "-- ..." 行)
  let curMarker = -1;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].startsWith('-- ')) { curMarker = i; break; }
  }
  if (curMarker === -1) return -1;  // プリフロップのみ

  // Step 2: 現マーカーより前を遡って "raises to" / "bets" / "ALL IN" を探す
  //         別のストリートマーカーに到達したら停止 (= 前ストリート全体をスキャン済み)
  for (let i = curMarker - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry.startsWith('-- ')) break;
    const m = entry.match(/^(.+?)\s\s+(raises to|bets|ALL IN)\s/);
    if (m) {
      const name = m[1];
      const pl = adapter.players.find(pl => pl.name === name);
      return pl ? pl.id : -1;
    }
  }
  return -1;
}

/**
 * ドンクベットスポット:
 *   - ポストフロップ (FLOP/TURN/RIVER)
 *   - 現ストリートでまだベットが出ていない (先手)
 *   - 前ストリートに実際のアグレッサー (自分以外) がいた
 */
function isDonkSpot(adapter, player) {
  const state = adapter.state;
  if (state !== 'FLOP' && state !== 'TURN' && state !== 'RIVER') return false;
  if (adapter.currentBet !== 0) return false;
  if (adapter.currentBet - player.currentBet !== 0) return false;
  const aggId = getPrevStreetAggressorId(adapter);
  if (aggId === -1) return false;
  return aggId !== player.id;
}

function decideWhenCheckedTo(adapter, p, valid, cls, texture, street, hasBlocker, hasDraw, lp) {
  // ドンクベット禁止: 前ストリートの相手アグレッサーに対し OOP で先行ベットしない
  //   → 必ず CHECK し、相手のベットに対してチェックレイズ/コール/フォールドで対応
  if (isDonkSpot(adapter, p)) {
    return { action: Action.CHECK, amount: 0 };
  }

  const canBet = valid.includes(Action.BET);
  const bb = adapter.bigBlind;

  // C-bet 判断（フロップ）
  if (street === 'FLOP') {
    let cBetFreq;
    if (texture === TEXTURE.DRY)      cBetFreq = 0.70;
    else if (texture === TEXTURE.SEMI_WET) cBetFreq = 0.55;
    else                               cBetFreq = 0.35;
    cBetFreq *= lp.cBetFreqMod;

    // 強いハンドは常にベット
    if (cls >= HAND_CLASS.TOP_PAIR) cBetFreq = Math.max(cBetFreq, 0.85);
    // ドロー付きならブラフC-bet
    if (hasDraw && cls < HAND_CLASS.TOP_PAIR) cBetFreq = Math.max(cBetFreq, 0.50);

    if (canBet && chance(cBetFreq)) {
      return { action: Action.BET, amount: chooseBetSize(adapter, p.id, cls, texture) };
    }
    return { action: Action.CHECK, amount: 0 };
  }

  // ターン
  if (street === 'TURN') {
    let betFreq = 0;
    if (cls >= HAND_CLASS.TWO_PAIR)     betFreq = 0.90;
    else if (cls >= HAND_CLASS.TOP_PAIR) betFreq = 0.70;
    else if (cls >= HAND_CLASS.TOP_PAIR_WEAK) betFreq = 0.40;
    else if (hasDraw) {
      // ガットショット + オーバーカード系
      betFreq = cls >= HAND_CLASS.MID_PAIR ? 0.30 : 0.20;
      betFreq *= lp.bluffFreqMod;
    }

    if (canBet && chance(betFreq)) {
      return { action: Action.BET, amount: chooseBetSize(adapter, p.id, cls, texture) };
    }
    return { action: Action.CHECK, amount: 0 };
  }

  // リバー
  if (street === 'RIVER') {
    let betFreq = 0;
    if (cls >= HAND_CLASS.TWO_PAIR)     betFreq = 0.80;
    else if (cls >= HAND_CLASS.TOP_PAIR) betFreq = 0.40;
    // ブラフ: ブロッカー持ち
    else if (hasBlocker && cls < HAND_CLASS.MID_PAIR) {
      betFreq = 0.25 * lp.bluffFreqMod;
    }
    // ブロッカーなしブラフ
    else if (cls < HAND_CLASS.BOTTOM_PAIR) {
      betFreq = 0.05 * lp.bluffFreqMod;
    }

    if (canBet && chance(betFreq)) {
      return { action: Action.BET, amount: chooseBetSize(adapter, p.id, cls, texture) };
    }
    return { action: Action.CHECK, amount: 0 };
  }

  return { action: Action.CHECK, amount: 0 };
}

function decideWhenFacing(adapter, p, valid, cls, texture, street, toCall, hasBlocker, hasDraw, lp) {
  const pot = adapter.pot;
  const potOdds = toCall / (pot + toCall);

  // チェックレイズ機会判定: 現ストリートで既にチェックしていれば、レイズはチェックレイズとなる
  // 目標 7-8% 均一: 適格ハンド (~50%) × 15% = 全体 7.5%
  const isCheckRaiseOpp = didCheckThisStreet(adapter, p.name);
  if (isCheckRaiseOpp) {
    const crQualifies =
      cls >= HAND_CLASS.TWO_PAIR ||                    // バリュー: ツーペア以上
      (hasBlocker && cls < HAND_CLASS.TOP_PAIR) ||     // ブラフ: ブロッカーあり弱ハンド
      (hasDraw && cls < HAND_CLASS.TOP_PAIR);          // セミブラフ: ドローあり
    if (crQualifies && valid.includes(Action.RAISE) && chance(0.15 * lp.bluffFreqMod)) {
      const size = chooseBetSize(adapter, p.id, cls, texture);
      return { action: Action.RAISE, amount: size };
    }
    // ここから下はチェックレイズしないケース → レイズ経路スキップ、コール/フォールドのみ
  }

  // ── 超強ハンド: レイズ (チェックレイズ機会でなければ通常レイズ) ──
  if (cls >= HAND_CLASS.SET) {
    if (!isCheckRaiseOpp && valid.includes(Action.RAISE)) {
      const raiseFreq = cls >= HAND_CLASS.FULL_HOUSE ? 0.90 : 0.65;
      if (chance(raiseFreq)) {
        const size = chooseBetSize(adapter, p.id, cls, texture);
        return { action: Action.RAISE, amount: size };
      }
    }
    return { action: Action.CALL, amount: 0 };
  }

  // ── ツーペア ──
  if (cls === HAND_CLASS.TWO_PAIR) {
    if (!isCheckRaiseOpp && valid.includes(Action.RAISE) && chance(0.35)) {
      const size = chooseBetSize(adapter, p.id, cls, texture);
      return { action: Action.RAISE, amount: size };
    }
    return { action: Action.CALL, amount: 0 };
  }

  // ── オーバーペア / TPGK ──
  if (cls >= HAND_CLASS.TOP_PAIR) {
    if (potOdds > 0.4 && street === 'RIVER') {
      return chance(0.55 + lp.foldReduction * 0.2) ?
        { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
    }
    return { action: Action.CALL, amount: 0 };
  }

  // ── TP ウィークキッカー ──
  if (cls === HAND_CLASS.TOP_PAIR_WEAK) {
    if (street === 'RIVER' && potOdds > 0.35) {
      return chance(0.40 + lp.foldReduction * 0.25) ?
        { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
    }
    return chance(0.70 + lp.foldReduction * 0.15) ?
      { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
  }

  // ── ミドルペア / ボトムペア ──
  if (cls >= HAND_CLASS.BOTTOM_PAIR) {
    if (hasDraw && street !== 'RIVER') {
      return chance(0.65 + lp.foldReduction * 0.2) ?
        { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
    }
    if (street === 'FLOP' && potOdds < 0.3) {
      return chance(0.55 + lp.foldReduction * 0.2) ?
        { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
    }
    return chance(0.25 + lp.foldReduction * 0.3) ?
      { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
  }

  // ── ドロー ──
  if (hasDraw && street !== 'RIVER') {
    const drawEquity = 0.20;
    if (potOdds < drawEquity + 0.05) {
      // セミブラフレイズ (チェックレイズ機会でなければ通常レイズ)
      if (!isCheckRaiseOpp && valid.includes(Action.RAISE) && chance(0.20 * lp.bluffFreqMod)) {
        const size = chooseBetSize(adapter, p.id, cls, texture);
        return { action: Action.RAISE, amount: size };
      }
      return { action: Action.CALL, amount: 0 };
    }
    return chance(0.35 + lp.foldReduction * 0.2) ?
      { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
  }

  // ── トラッシュ ──
  // リバーブロッカーブラフレイズ (チェックレイズ機会でなければ)
  if (street === 'RIVER' && hasBlocker && !isCheckRaiseOpp &&
      valid.includes(Action.RAISE) && chance(0.10 * lp.bluffFreqMod)) {
    const size = chooseBetSize(adapter, p.id, cls, texture);
    return { action: Action.RAISE, amount: size };
  }

  // フォールド (レベル1は追加コール)
  if (chance(lp.foldReduction)) {
    return valid.includes(Action.CALL) ? { action: Action.CALL, amount: 0 } : { action: Action.FOLD, amount: 0 };
  }
  return { action: Action.FOLD, amount: 0 };
}

// ══════════════════════════════════════════════
// §10  メインエントリポイント
// ══════════════════════════════════════════════

/**
 * CPUのアクションを決定する
 * @param {NLHGame} adapter - GameAdapter準拠のゲームインスタンス
 * @returns {{ action: string, amount: number }}
 */
export function decideCpuAction(adapter) {
  const p = adapter.getCurrentPlayer();
  if (!p) return { action: Action.CHECK, amount: 0 };

  const valid = adapter.getValidActions(p);
  if (valid.length === 0) return { action: Action.CHECK, amount: 0 };
  if (valid.length === 1) return { action: valid[0], amount: 0 };

  const level = (adapter.config && adapter.config.cpuLevel) || 3;
  const pos = detectPosition(adapter, p.id);

  let decision;

  if (adapter.state === 'PREFLOP') {
    const key = handKey(p.hand);
    decision = preflopDecision(adapter, p, valid, pos, key, level);
  } else {
    decision = postflopDecision(adapter, p, valid, pos, level);
  }

  // ── サイズ調整 (レベルジッター) ──
  const lp = getLevelParams(level);
  if (decision.amount > 0) {
    const variance = 1 + (rng01() * 2 - 1) * lp.sizeJitter;
    decision.amount = Math.max(adapter.bigBlind, Math.floor(decision.amount * variance));
  }

  // ── バリデーション ──
  if (!valid.includes(decision.action)) {
    // フォールバック
    if (decision.action === Action.BET && valid.includes(Action.RAISE)) {
      decision.action = Action.RAISE;
    } else if (decision.action === Action.RAISE && valid.includes(Action.BET)) {
      decision.action = Action.BET;
    } else if (valid.includes(Action.CHECK)) {
      decision = { action: Action.CHECK, amount: 0 };
    } else if (valid.includes(Action.CALL)) {
      decision = { action: Action.CALL, amount: 0 };
    } else {
      decision = { action: Action.FOLD, amount: 0 };
    }
  }

  return decision;
}
