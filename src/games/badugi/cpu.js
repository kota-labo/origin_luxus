// Badugi CPU ロジック — Level 1 / 2 / 3 対応
// Level 3 = GTO 風（スコアベース＋相手ドロー履歴＋混合戦略）
// CLAUDE.md準拠: crypto.getRandomValues() 使用
//
// card.value (0〜12): 0='2', ..., 11='K', 12='A'
// Badugi値 (bv): A→0(最強), 2→1, ..., K→12(最弱)

import { bestBadugiHand } from './evaluator.js';

// ────────────────────────────────────────────────────────────
// レベル設定
// ────────────────────────────────────────────────────────────
/** 動作レベル: 1=Basic / 2=Medium / 3=GTO */
let _level = 3;

/**
 * CPU のプレイレベルを設定する。
 * @param {1|2|3} n
 */
export function setCpuLevel(n) {
  if (n === 1 || n === 2 || n === 3) _level = n;
}

// ────────────────────────────────────────────────────────────
// 低レベルユーティリティ
// ────────────────────────────────────────────────────────────
// card.value → Badugi 値 (A=0 最強, 2=1, ..., K=12 最弱)
const _bv = v => (v === 12 ? 0 : v + 1);

function _rand() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 0xFFFFFFFF;
}

// 'BETTING_1' → 1, 'BETTING_4' → 4
const _betRound = state => {
  const n = parseInt(state.slice(-1), 10);
  return Number.isFinite(n) ? n : 1;
};

// ────────────────────────────────────────────────────────────
// ハンドスコア計算 (0〜100)
// ────────────────────────────────────────────────────────────
/**
 * 手札強度スコアを 0〜100 で返す。
 *
 * 構成:
 *   BASE     Badugi 枚数基礎点 (4=75 / 3=50 / 2=20 / 1=5)
 *   lowBonus 低カード加算 — avgBv が低いほど大きい (最大+22)
 *   smooth   スムーズネスボーナス (+5 / +2 / +0)
 *   -waste   非 Badugi カード 1 枚につき -3
 *   -rank    Q(bv11):-2, K(bv12):-4
 *
 * スコア目安:
 *   4-Badugi 強 (A-2-3-4): ~99      4-Badugi 弱 (T-J-Q-K): ~74
 *   3-Badugi 強 (A-2-3)  : ~72      3-Badugi 弱 (K-Q-J)  : ~43
 *   2-Badugi 強 (A-2)    : ~35      2-Badugi 弱 (K-Q)    : ~12
 */
function _score(hand) {
  const { size, bvs } = bestBadugiHand(hand);
  if (size === 0) return 0;

  const BASE  = { 1: 5, 2: 20, 3: 50, 4: 75 };
  const avgBv = bvs.reduce((s, v) => s + v, 0) / size;
  const lowB  = Math.max(0, (1 - avgBv / 10.5) * 22); // avgBv 低=強, 最大 22

  let smooth = 0;
  if (size >= 3) {
    const asc = [...bvs].sort((a, b) => a - b);
    let g = 0;
    for (let i = 1; i < asc.length; i++) g = Math.max(g, asc[i] - asc[i - 1]);
    smooth = g <= 3 ? 5 : g <= 5 ? 2 : 0;
  }

  let rp = 0;
  for (const bv of bvs) {
    if (bv === 12) rp += 4;
    else if (bv === 11) rp += 2;
  }

  return Math.max(0, Math.min(100, Math.round(
    BASE[size] + lowB + smooth - (hand.length - size) * 3 - rp
  )));
}

// ────────────────────────────────────────────────────────────
// ドロー履歴トラッカー (WeakMap — メモリリークなし)
// ────────────────────────────────────────────────────────────
// 構造: adapter → { [drawRound]: { [playerId]: drawCount } }
const _hist = new WeakMap();
const _h    = a => { if (!_hist.has(a)) _hist.set(a, {}); return _hist.get(a); };

/**
 * 現ドローラウンドで hasDeclared=true の全プレイヤーの枚数を記録する。
 * decideCpuDraw 冒頭で呼び出す。
 */
function _record(adapter) {
  const h = _h(adapter);
  const r = adapter.drawRound;
  if (!h[r]) h[r] = {};
  for (const p of adapter.players) {
    if (p.hasDeclared) h[r][p.id] = p.drawCount;
  }
}

/** 指定プレイヤーの最新ドロー枚数 (記録なし = null) */
function _lastDraw(adapter, pid) {
  const h = _h(adapter);
  for (let r = 3; r >= 1; r--) {
    if (h[r] && h[r][pid] !== undefined) return h[r][pid];
  }
  return null;
}

/**
 * 自分以外の相手の「脅威度」を返す (0=不明 / 1=弱 / 2=中 / 3=強)。
 * 複数の相手がいる場合は最も脅威な相手の値を使用。
 * パット(0枚)=3, 1枚=2, 2〜3枚=1。
 */
function _threat(adapter) {
  const myId = adapter.getCurrentPlayer()?.id;
  let max = 0;
  for (const p of adapter.players) {
    if (p.id === myId || p.folded) continue;
    const dc = _lastDraw(adapter, p.id);
    if (dc === null) continue;
    const s = dc === 0 ? 3 : dc === 1 ? 2 : 1;
    if (s > max) max = s;
  }
  return max;
}

// ────────────────────────────────────────────────────────────
// 廃棄インデックス特定ヘルパー
// ────────────────────────────────────────────────────────────

/** bestBadugiHand の有効カード群に対応する hand インデックスの Set を返す */
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

/** kept に含まれないインデックスの配列 */
const _discardFrom = (hand, kept) => hand.map((_, i) => i).filter(i => !kept.has(i));

// ────────────────────────────────────────────────────────────
// ドロー計算
// ────────────────────────────────────────────────────────────

/**
 * Level 1/2: 最強部分集合を保持し、それ以外を廃棄するシンプル戦略。
 */
function _drawSimple(hand) {
  const { size } = bestBadugiHand(hand);
  if (size === 4) return [];
  const kept    = _keptSet(hand);
  const discard = _discardFrom(hand, kept);
  // 廃棄ゼロなのに 4 枚未達 → 最悪 Badugi カードを 1 枚捨て
  if (!discard.length && size < 4) {
    const worst = [...kept].sort((a, b) => _bv(hand[b].value) - _bv(hand[a].value))[0];
    return [worst];
  }
  return discard;
}

/**
 * Level 3 GTO: スコア・ドローラウンドを考慮した戦略的廃棄。
 *
 * ─ 4枚Badugi ─────── 常にパット (0枚廃棄)
 * ─ 強3枚 (sc≥65) ─── 1枚ドロー。残り≤1ラウンドで 13% パットブラフ
 * ─ 弱3枚 (sc<65) ─── 1枚ドロー基本。中盤以降はパットブラフ 10%、
 *                       最悪カード追加廃棄 (2枚ドロー) 22%
 * ─ 2枚Badugi ──────── 2枚ドロー基本。スコア低+残りあれば 3枚ドロー 20%
 * ─ 1枚Badugi ──────── 3枚ドロー
 */
function _drawGTO(hand, drawRound) {
  const { size } = bestBadugiHand(hand);
  const sc       = _score(hand);
  const rem      = 3 - drawRound; // このドロー完了後に残る回数
  const r        = _rand();

  if (size === 4) return [];

  const kept    = _keptSet(hand);
  const discard = _discardFrom(hand, kept); // 通常廃棄 (size別: 3→1枚, 2→2枚, 1→3枚)

  if (size === 3) {
    // パットブラフ: 強3枚でラスト付近 13%
    if (sc >= 65 && rem <= 1 && r < 0.13) return [];
    // 弱3枚 × 中盤以降: パットブラフ 10% / 2枚ドロー 22%
    if (sc < 65 && drawRound >= 2) {
      if (r < 0.10) return []; // パットブラフ (弱い手でも相手を揺さぶる)
      if (r < 0.32) {           // 最悪 Badugi カードも追加廃棄して 2 枚ドロー
        const worst = [...kept].sort((a, b) => _bv(hand[b].value) - _bv(hand[a].value))[0];
        return [...discard, worst];
      }
    }
    return discard; // 通常 1 枚ドロー
  }

  if (size === 2) {
    // 弱い 2 枚 Badugi + ドローチャンス残り: 20% で 3 枚ドロー (最悪カード追加廃棄)
    if (sc < 30 && rem >= 1 && r < 0.20) {
      const worst = [...kept].sort((a, b) => _bv(hand[b].value) - _bv(hand[a].value))[0];
      return [...discard, worst];
    }
    return discard; // 通常 2 枚ドロー
  }

  // 1 枚 Badugi: 3 枚ドロー
  return discard;
}

// ────────────────────────────────────────────────────────────
// ベッティング: Level 1 (Basic)
// ────────────────────────────────────────────────────────────
function _actL1(acts, size, toCall, pot) {
  const po = pot > 0 ? toCall / (pot + toCall) : 0;
  if (acts.includes('check')) {
    if (size >= 3 && acts.includes('bet') && _rand() < 0.65) return 'bet';
    return 'check';
  }
  if (toCall > 0) {
    if (size >= 3 && acts.includes('call'))                   return 'call';
    if (size === 2 && po < 0.35 && acts.includes('call'))     return 'call';
    return acts.includes('fold') ? 'fold' : 'call';
  }
  return 'check';
}

// ────────────────────────────────────────────────────────────
// ベッティング: Level 2 (Medium)
// ────────────────────────────────────────────────────────────
function _actL2(acts, size, toCall, pot) {
  const po = pot > 0 ? toCall / (pot + toCall) : 0;
  const r  = _rand();
  if (acts.includes('check')) {
    if (size >= 3 && acts.includes('bet') && r < 0.72) return 'bet';
    if (size === 2 && acts.includes('bet') && r < 0.25) return 'bet';
    return 'check';
  }
  if (toCall > 0) {
    if (size === 4) {
      if (acts.includes('raise') && r < 0.75) return 'raise';
      return acts.includes('call') ? 'call' : 'fold';
    }
    if (size === 3) {
      if (acts.includes('raise') && r < 0.35) return 'raise';
      return acts.includes('call') ? 'call' : 'fold';
    }
    if (size === 2 && po < 0.30 && acts.includes('call')) return 'call';
    return acts.includes('fold') ? 'fold' : acts.includes('call') ? 'call' : 'check';
  }
  return 'check';
}

// ────────────────────────────────────────────────────────────
// ベッティング: Level 3 (GTO)
// ────────────────────────────────────────────────────────────

/**
 * ベット頻度テーブル — 先手のチェックからベットする確率
 * 行インデックス = ベットラウンド (1〜4)
 * 列 = スコア帯 (s80=80+ / s65=65-79 / s50=50-64 / sL=<50)
 *
 *   Pre-draw : 情報なし段階。スコアのみで判断。
 *   Bet2/3   : 相手ドロー枚数を加味し調整。
 *   Bet4     : ショーダウン前。バリュー頻度を最大化。
 */
const _BF = [
  null,                                              // 0 は未使用
  { s80: 0.80, s65: 0.70, s50: 0.15, sL: 0.10 },  // BETTING_1 (Pre-draw)
  { s80: 0.85, s65: 0.65, s50: 0.25, sL: 0.18 },  // BETTING_2 (After Draw1)
  { s80: 0.85, s65: 0.68, s50: 0.20, sL: 0.15 },  // BETTING_3 (After Draw2)
  { s80: 0.90, s65: 0.75, s50: 0.15, sL: 0.08 },  // BETTING_4 (Showdown)
];

/** ベット頻度を返す (相手脅威度 thr で補正) */
function _bfreq(sc, br, thr) {
  const t   = _BF[Math.min(br, 4)] || _BF[1];
  const raw = sc >= 80 ? t.s80 : sc >= 65 ? t.s65 : sc >= 50 ? t.s50 : t.sL;
  // 相手が弱い(1): ブラフ・バリュー両方アップ / 相手が強い(3): ダウン
  const mod = thr === 1 ? +0.12 : thr === 3 ? -0.15 : 0;
  return Math.min(0.95, Math.max(0, raw + mod));
}

/** レイズ頻度を返す (後半ラウンドほど上昇, 相手脅威度で補正) */
function _rfreq(sc, br, thr) {
  const base = sc >= 90 ? 0.70 : sc >= 80 ? 0.52 : sc >= 65 ? 0.28 : 0.10;
  const mod  = (br - 1) * 0.04 + (thr === 1 ? +0.08 : thr === 3 ? -0.15 : 0);
  return Math.min(0.90, Math.max(0, base + mod));
}

/**
 * Level 3 GTO ベッティング判断。
 *
 * @param {string[]} acts      - getValidActions の結果
 * @param {number}   sc        - _score() の値 (0〜100)
 * @param {number}   size      - Badugi 枚数 (1〜4)
 * @param {number}   toCall    - コールに必要なチップ
 * @param {number}   pot       - 現ポット
 * @param {number}   br        - ベットラウンド (1〜4)
 * @param {number}   thr       - 相手脅威度 (0〜3)
 * @returns {string}           - アクション文字列
 */
function _actL3(acts, sc, size, toCall, pot, br, thr) {
  const po = pot > 0 ? toCall / (pot + toCall) : 0;
  const r  = _rand();

  // 4-Badugi 後半: ほぼ確実に勝てるので最大限アグレッシブ
  const strongFinal = (size === 4 && br >= 3);

  // ── 先手 (チェック可能) ──────────────────────────────────
  if (acts.includes('check')) {
    const freq = strongFinal ? 0.92 : _bfreq(sc, br, thr);
    if (acts.includes('bet') && r < freq) return 'bet';
    return 'check';
  }

  // ── 後手 (toCall > 0: コール / レイズ / フォールド) ──────
  if (toCall > 0) {
    if (strongFinal) {
      // 4-Badugi 後半: レイズ 70% / コール残り
      if (acts.includes('raise') && r < 0.70) return 'raise';
      return acts.includes('call') ? 'call' : 'fold';
    }

    if (sc >= 65) {
      // 強い手: レイズ混合 / コール
      if (acts.includes('raise') && r < _rfreq(sc, br, thr)) return 'raise';
      return acts.includes('call') ? 'call' : 'fold';
    }

    if (sc >= 50) {
      // 中程度: ポットオッズ確認
      if (po < 0.33) {
        // 相手弱 × 低確率でブラフレイズ
        if (acts.includes('raise') && thr === 1 && r < 0.10) return 'raise';
        return acts.includes('call') ? 'call' : 'fold';
      }
      return acts.includes('fold') ? 'fold' : acts.includes('call') ? 'call' : 'check';
    }

    // sc < 50: ほぼフォールド
    // 相手が弱そうで良いポットオッズならブラフコール 20%
    if (thr === 1 && po < 0.28 && r < 0.20 && acts.includes('call')) return 'call';
    return acts.includes('fold') ? 'fold' : acts.includes('call') ? 'call' : 'check';
  }

  return 'check';
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/**
 * ベッティングラウンドの CPU アクションを決定する。
 * @param {object} adapter - GameAdapter 準拠のゲームインスタンス
 * @returns {{ action: string, amount: number }}
 */
export function decideCpuAction(adapter) {
  const player = adapter.getCurrentPlayer();
  const acts   = adapter.getValidActions(player);
  const pot    = adapter.pot;
  const toCall = adapter.currentBet - player.currentBet;
  const size   = bestBadugiHand(player.hand).size;

  let action;

  if (_level === 1) {
    action = _actL1(acts, size, toCall, pot);
  } else if (_level === 2) {
    action = _actL2(acts, size, toCall, pot);
  } else {
    // Level 3: スコア + ラウンド + 相手脅威度
    action = _actL3(
      acts,
      _score(player.hand),
      size,
      toCall,
      pot,
      _betRound(adapter.state),
      _threat(adapter),
    );
  }

  // フォールバック (万が一 action が validActs に含まれない場合)
  if (!acts.includes(action)) {
    action = acts.includes('check') ? 'check'
           : acts.includes('call')  ? 'call'
           : acts[0];
  }

  return { action, amount: 0 };
}

/**
 * ドローラウンドの廃棄インデックスを決定する。
 * @param {object} adapter - GameAdapter 準拠のゲームインスタンス
 * @returns {number[]} 廃棄するカードのインデックス配列
 */
export function decideCpuDraw(adapter) {
  const player = adapter.getCurrentPlayer();
  // 宣言済みプレイヤーのドロー枚数を履歴に記録
  _record(adapter);
  return _level <= 2
    ? _drawSimple(player.hand)
    : _drawGTO(player.hand, adapter.drawRound);
}
