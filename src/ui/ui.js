// UIコントローラー — Luxus Poker Platform
// ゲーム非依存化: initUI(adapter, config, decideCpuAction, callbacks) で初期化
// CLAUDE.md準拠: XSS対策・暗号乱数・整数チップ

import { cardHtml, sc, bb, esc, mkBar, mkGroup, mkDivider, mkBtn } from './components.js';

// ─── デスクトップ座席配置 ───────────────────────────
// NLH用: 2枚ホールカード、上部プレイヤーをヘッダー水準まで引き上げ
const SEATS = {
  2: [[50,89],[50,10]],
  3: [[50,89],[18,18],[82,18]],
  4: [[50,89],[17,20],[50,10],[83,20]],
  5: [[50,89],[16,65],[22,14],[78,14],[84,65]],
  6: [[50,89],[17,65],[20,14],[50,8],[80,14],[83,65]],
};

// Draw用: 5枚ホールカード、Studと同等のy配置 + x は5枚幅を考慮しやや中央寄せ
const SEATS_WIDE = {
  2: [[50,89],[50,16]],
  3: [[50,89],[20,25],[80,25]],
  4: [[50,89],[19,28],[50,18],[81,28]],
  5: [[50,89],[18,65],[22,22],[78,22],[82,65]],
  6: [[50,89],[17,65],[19,22],[50,16],[81,22],[83,65]],
};

// ─── モバイル座席配置 (≤500px) ───────────────────────
// NLH用: 上部プレイヤーをヘッダー水準まで引き上げ
const MOBILE_SEATS = {
  2: [[50,78],[50,16]],
  3: [[50,78],[16,26],[84,26]],
  4: [[50,78],[14,28],[50,16],[86,28]],
  5: [[50,78],[14,60],[27,16],[73,16],[86,60]],
  6: [[50,80],[18,62],[15,24],[50,16],[85,24],[82,62]],
};

// Draw用: 5枚ホールカード、Studと同等のy配置 + x は5枚幅を考慮しやや中央寄せ
const MOBILE_SEATS_WIDE = {
  2: [[50,78],[50,18]],
  3: [[50,78],[20,32],[80,32]],
  4: [[50,78],[18,30],[50,18],[82,30]],
  5: [[50,78],[22,58],[24,22],[76,22],[78,58]],
  6: [[50,80],[22,62],[20,30],[50,18],[80,30],[78,62]],
};

// デスクトップ座席配置（Stud用: 7枚カード対応、左右を広げて重なり防止）
const SEATS_STUD = {
  2: [[50,89],[50,16]],
  3: [[50,89],[20,25],[80,25]],
  4: [[50,89],[19,28],[50,18],[81,28]],
  5: [[50,89],[18,65],[22,22],[78,22],[82,65]],
  6: [[50,89],[15,65],[17,22],[50,16],[83,22],[85,65]],
};

// スマホ縦向き: Stud用（7枚カード対応、左右を広げて重なり防止）
const MOBILE_SEATS_STUD = {
  2: [[50,78],[50,18]],
  3: [[50,78],[18,32],[82,32]],
  4: [[50,78],[16,30],[50,18],[84,30]],
  5: [[50,78],[20,58],[22,22],[78,22],[80,58]],
  6: [[50,80],[20,62],[18,30],[50,18],[82,30],[80,62]],
};

const COLORS = ['#1e88e5','#8e24aa','#00897b','#e53935','#fb8c00','#43a047'];

const POS_LABELS = {
  2: ['BTN','BB'],
  3: ['BTN','SB','BB'],
  4: ['BTN','SB','BB','UTG'],
  5: ['BTN','SB','BB','UTG','CO'],
  6: ['BTN','SB','BB','UTG','HJ','CO'],
};

// ------- モジュールスコープ変数（initUIで初期化） -------
let adapter         = null;
let gameConfig      = null;
let cpuDecideFn     = null;  // decideCpuAction(adapter) → { action, amount }
let cpuDrawFn       = null;  // decideCpuDraw(adapter) → number[] （ドローゲーム用）
let onBackToTitle   = null;

let BB = 10; // config.bigBlind から設定

let mobileRaiseAmount = 0;
let mobileCustomMode  = false;
let lastActions       = {};
let lastActorId       = -1;
let prevStreet        = null;
let lastAnimatedStreet = null;

// Stud: ストリート変化時のフロートアニメーション管理
// 値が現在のストリート名と一致する間、最新カードにフロートアニメーションを適用
// 次のストリートに変わると自動的に不一致になりアニメーションは非適用になる
let _studFloatStreet  = null;

// Stud: ドアカード順次リビール管理
let _studDoorRevealing     = false;   // true = リビール演出中
let _studDoorRevealedPids  = new Set(); // リビール済みプレイヤーID
let _studLatestRevealPid   = -1;      // 直前にリビールされたPID（フロートアニメ対象）

// Stud: 4th Street以降の順次ディール管理
let _studStreetDealing     = false;   // true = ストリートディール演出中
let _studStreetDealtPids   = new Set(); // ディール済みプレイヤーID
let _studLatestDealPid     = -1;      // 直前にディールされたPID（フロートアニメ対象）

// Stud: 時計回りディール順序（右上→時計回り）
const STUD_DEAL_ORDER = {
  2: [1, 0],
  3: [2, 0, 1],
  4: [3, 0, 1, 2],
  5: [3, 4, 0, 1, 2],
  6: [4, 5, 0, 1, 2, 3],
};

// ドロー選択中のカードインデックス（プレイヤー0用）
let selectedDrawIndices = new Set();

// CPUドロー直後の1回限りアニメーション用（-1=なし、それ以外=アニメ対象のプレイヤーID）
// renderAll()→renderPlayers()の1回のみ適用し、その後クリア（再タップでアニメ再発を防ぐ）
let _drawAnimPlayerId = -1;

// 自プレイヤーのドロー確定後の1回限りアニメーション用（0=なし、N=N枚のカードをアニメ）
let _humanDrawAnimCount = 0;

// バブルアニメーション管理: Setに含まれるIDのバブルのみ ab-new クラスを付与して入場アニメ
// requestAnimationFrame でクリア → 次の renderAll() では settled（静的）扱いになる
let freshBubblePids = new Set();

// FOLD バブルのラウンド追跡: { [playerId]: stateName } — そのラウンド中は透過しない
let foldBubbleState = {};

// ドロー実行フェーズ中（全員宣言後のカード交換アニメーション / DOM直接操作中）
let _inDrawExecution = false;

// 個別捨て牌アニメーション中の PID セット（renderPlayers() の再構築を防ぐ）
let _discardingPids = new Set();

// ショーダウン後の勝利オーバーレイを一時的に遅らせる（カードリビール演出）
let _showdownDelayActive = false;

// ショーダウン時の1回限りカードリビールアニメーション
let _showdownReveal = false;

// 人間フォールド後の高速終了フラグ（stale タイマーを全て無効化）
let _fastFinishing = false;

// ------- 初期化エントリーポイント -------
/**
 * @param {object} gameAdapter - GameAdapter準拠のゲームインスタンス
 * @param {object} config      - ゲーム設定オブジェクト (config.js の export default)
 * @param {Function} decideCpu - decideCpuAction(adapter) → { action, amount }
 * @param {object} callbacks   - { onBackToTitle: Function, decideCpuDraw?: Function }
 */
export function initUI(gameAdapter, config, decideCpu, callbacks = {}) {
  adapter       = gameAdapter;
  gameConfig    = config;
  cpuDecideFn   = decideCpu;
  cpuDrawFn     = callbacks.decideCpuDraw || null;
  onBackToTitle = callbacks.onBackToTitle || (() => {});
  BB            = config.bigBlind;

  lastActions = {}; lastActorId = -1; prevStreet = null; lastAnimatedStreet = null;
  mobileRaiseAmount = 0; mobileCustomMode = false; selectedDrawIndices = new Set();

  // Fix Limit / ホールカード枚数 / プレイヤー数に応じて data 属性を設定（CSS で条件分岐）
  const gameScreen = document.getElementById('game-screen');
  if (config.bettingStructure === 'fixed-limit') {
    gameScreen.setAttribute('data-structure', 'fixlimit');
  } else {
    gameScreen.removeAttribute('data-structure');
  }
  gameScreen.setAttribute('data-holecards', String(config.numHoleCards || 2));
  gameScreen.setAttribute('data-players',   String(gameAdapter.players.length));
  if (config.isStudGame) {
    gameScreen.setAttribute('data-game', 'stud');
  } else if (config.hasDrawPhase) {
    gameScreen.setAttribute('data-game', 'draw');
  } else {
    gameScreen.setAttribute('data-game', 'nlh');
  }

  // テーブル上に現在のゲーム名を表示（Luxusロゴの上・POTブランドの上）
  const gameName = config.displayName || '';
  const tlbGame = document.getElementById('tlb-game');
  const pbGame  = document.getElementById('pb-game');
  if (tlbGame) tlbGame.textContent = gameName;
  if (pbGame)  pbGame.textContent  = gameName;

  // 退席ボタンを initUI 内でバインド（window グローバル不要）
  const quitBtn = document.querySelector('.quit-hdr-btn');
  if (quitBtn) {
    quitBtn.onclick = () => backToTitle();
  }

  startNewHand();
}

// ------- ハンド開始 -------
function startNewHand() {
  const ov = document.getElementById('win-overlay');
  if (ov) ov.classList.add('hidden');
  if (adapter.state === 'COMPLETE') adapter.nextHand();

  lastActions = {}; lastActorId = -1; freshBubblePids = new Set(); foldBubbleState = {};
  prevStreet = null; lastAnimatedStreet = null;
  mobileRaiseAmount = 0; mobileCustomMode = false;
  selectedDrawIndices = new Set(); _humanDrawAnimCount = 0;
  _discardingPids = new Set(); _inDrawExecution = false; _fastFinishing = false;
  _showdownDelayActive = false; _showdownReveal = false; _studFloatStreet = null;
  _studDoorRevealing = false; _studDoorRevealedPids = new Set(); _studLatestRevealPid = -1;
  _studStreetDealing = false; _studStreetDealtPids = new Set(); _studLatestDealPid = -1;

  const alive = adapter.players.filter(p => p.chips > 0);
  if (alive.length <= 1) {
    const w = alive[0] || adapter.players[0];
    adapter.addLog(`${w.name} wins the game!`);
    renderAll();
    const el  = document.getElementById('actions');
    el.innerHTML = '';
    const bar = mkBar();
    const b   = mkBtn('deal', 'BACK TO MENU'); b.onclick = backToTitle;
    bar.appendChild(b); el.appendChild(bar);
    return;
  }

  adapter.startHand();

  // Stud: ドアカード順次リビール演出
  if (gameConfig?.isStudGame) {
    _studDoorRevealing = true;
    _studDoorRevealedPids = new Set();
    _studLatestRevealPid = -1;
    renderAll(); // 初期描画（ドアカードなし）
    _startStudDoorReveal();
    return;
  }

  renderAll();
  if (isRunout()) { scheduleRunout(); return; }
  if (adapter.currentPlayerIndex !== 0 && adapter.state !== 'COMPLETE')
    setTimeout(cpuTurn, 800);
}

// ------- Stud ドアカード順次リビール -------
function _startStudDoorReveal() {
  const n = adapter.players.length;
  const order = STUD_DEAL_ORDER[n] || STUD_DEAL_ORDER[6];
  // バスト済みプレイヤーをスキップ
  const active = order.filter(pid => pid < n && !adapter.players[pid].folded);

  let delay = 300; // 最初の1枚は少し間を置く
  const interval = 380; // 枚間のインターバル

  for (let i = 0; i < active.length; i++) {
    setTimeout(() => {
      _studLatestRevealPid = active[i];
      _studDoorRevealedPids.add(active[i]);
      renderAll();

      // 最後の1枚リビール後 → アクション開始
      if (i === active.length - 1) {
        setTimeout(() => {
          _studDoorRevealing = false;
          _studLatestRevealPid = -1;
          renderAll();
          // CPUターン開始
          if (adapter.currentPlayerIndex !== 0 && adapter.state !== 'COMPLETE')
            setTimeout(cpuTurn, 600);
        }, 500);
      }
    }, delay);
    delay += interval;
  }
}

// ------- Stud 4th Street以降 順次ディール -------
function _startStudStreetDeal() {
  const n = adapter.players.length;
  const order = STUD_DEAL_ORDER[n] || STUD_DEAL_ORDER[6];
  // フォールド済みプレイヤーをスキップ
  const active = order.filter(pid => pid < n && !adapter.players[pid].folded);
  let delay = 300;
  const interval = 420;

  for (let i = 0; i < active.length; i++) {
    setTimeout(() => {
      _studLatestDealPid = active[i];
      _studStreetDealtPids.add(active[i]);
      renderAll();

      // 最後の1枚ディール後 → アクション開始
      if (i === active.length - 1) {
        setTimeout(() => {
          _studStreetDealing = false;
          _studLatestDealPid = -1;
          renderAll();
          if (adapter.currentPlayerIndex !== 0 && adapter.state !== 'COMPLETE')
            setTimeout(cpuTurn, 600);
        }, 400);
      }
    }, delay);
    delay += interval;
  }
}

// ------- テーマ -------
export function toggleThemeMenu() {
  const menu = document.getElementById('theme-menu');
  menu.classList.toggle('hidden');
  _syncActive();
  if (!menu.classList.contains('hidden'))
    setTimeout(() => document.addEventListener('click', _closeOut, { once: true }), 0);
}
function _syncActive() {
  const t  = document.documentElement.getAttribute('data-theme') || 'classic';
  const c  = document.documentElement.getAttribute('data-card')  || 'blue';
  const bg = document.documentElement.getAttribute('data-bg')    || 'default';
  document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
  document.querySelectorAll('.card-theme-btn').forEach(b => b.classList.toggle('active', b.dataset.card === c));
  document.querySelectorAll('.bg-opt').forEach(b => b.classList.toggle('active', b.dataset.bg === bg));
}
function _closeOut(e) {
  const wrap = document.querySelector('.theme-wrap');
  if (wrap && !wrap.contains(e.target)) document.getElementById('theme-menu').classList.add('hidden');
}
export function setTheme(name) {
  document.documentElement.setAttribute('data-theme', name);
  document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === name));
  document.getElementById('theme-menu').classList.add('hidden');
}
export function setCardTheme(name) {
  document.documentElement.setAttribute('data-card', name);
  document.querySelectorAll('.card-theme-btn').forEach(b => b.classList.toggle('active', b.dataset.card === name));
  document.getElementById('theme-menu').classList.add('hidden');
  if (adapter) renderPlayers();
}
export function setBgTheme(name) {
  document.documentElement.setAttribute('data-bg', name || 'default');
  document.querySelectorAll('.bg-opt').forEach(b => b.classList.toggle('active', b.dataset.bg === (name || 'default')));
  document.getElementById('theme-menu').classList.add('hidden');
}

// ------- ポジションラベル -------
function getPos(playerIdx) {
  // Stud はポジションラベルなし（アンテ制）
  if (gameConfig?.isStudGame) return '';
  const n    = adapter.players.length;
  const dist = (playerIdx - adapter.dealerIndex + n) % n;
  return (POS_LABELS[n] || POS_LABELS[6])[dist] || '';
}

// ------- アクションラベル -------
const ACTION_LABELS = {
  fold:   { label: 'FOLD',   type: 'fold'  },
  check:  { label: 'CHECK',  type: 'check' },
  call:   { label: 'CALL',   type: 'call'  },
  bet:    { label: 'BET',    type: 'bet'   },
  raise:  { label: 'RAISE',  type: 'raise' },
  all_in: { label: 'ALL IN', type: 'allin' },
  // ドロー系（draw_0 = スタンドパット、draw_N = N枚引く）
  draw_0: { label: 'PAT',    type: 'pat'   },
  draw_1: { label: 'DRAW 1', type: 'draw'  },
  draw_2: { label: 'DRAW 2', type: 'draw'  },
  draw_3: { label: 'DRAW 3', type: 'draw'  },
  draw_4: { label: 'DRAW 4', type: 'draw'  },
  draw_5: { label: 'DRAW 5', type: 'draw'  },
  // Stud 系
  bring_in: { label: 'BRING IN', type: 'bet'  },
  complete: { label: 'COMPLETE', type: 'raise' },
};

// ------- Stud カード2段レイアウト -------
// 上段: アップカード（最大4枚）+ 点線プレースホルダー
// 下段: ダウンカード（最大3枚）+ 点線プレースホルダー
function _renderStudCards(p, playerIdx, isHuman, isSD) {
  const upCards   = p.hand.filter(c => c.faceUp);
  const downCards = p.hand.filter(c => !c.faceUp);
  const showAll   = isHuman || isSD;

  // フォールド済みプレイヤーの表示:
  // - 3rd Street (hand.length <= 3): ドアカード(アップカード)を透過表示、ダウンカードは非表示
  // - 4th Street以降: カード非表示（プレースホルダーのみ）
  if (p.folded) {
    const isThirdStreet = p.hand.length <= 3;
    let upHtml = '';
    for (let i = 0; i < 4; i++) {
      if (isThirdStreet && i < upCards.length) {
        // 3rd Street: ドアカードを表示（透過はCSSの.seat-foldedで処理）
        upHtml += cardHtml(upCards[i], 'hole stud-up');
      } else {
        upHtml += '<span class="card hole stud-up stud-ph"></span>';
      }
    }
    let downHtml = '';
    for (let i = 0; i < 3; i++) {
      if (isThirdStreet && i < downCards.length) {
        // 3rd Street: ダウンカードは裏向き表示
        downHtml += isHuman ? cardHtml(downCards[i], 'hole stud-down') : '<span class="card hole stud-down bk"></span>';
      } else {
        downHtml += '<span class="card hole stud-down stud-ph"></span>';
      }
    }
    return `<div class="stud-row stud-row-up">${upHtml}</div><div class="stud-row stud-row-down">${downHtml}</div>`;
  }

  // フロートアニメーション判定
  const isSeventh   = adapter.state === 'SEVENTH_STREET';
  // ドアカードリビール中: 最新リビールPIDのみフロート
  const isDoorRevealFloat = _studDoorRevealing && playerIdx === _studLatestRevealPid;
  // ストリートディール中: 最新ディールPIDのみフロート（isStreetFloatは無効化）
  const isStreetDealFloat = _studStreetDealing && playerIdx === _studLatestDealPid;
  // 通常ストリート: _studFloatStreet 一致で最新カードをフロート（ディール中は無効）
  const isStreetFloat     = !_studDoorRevealing && !_studStreetDealing && _studFloatStreet === adapter.state;

  // ドアカードリビール中: 未リビールプレイヤーのアップカードを非表示
  const doorHidden = _studDoorRevealing && !_studDoorRevealedPids.has(playerIdx);
  // ストリートディール中: 未ディールプレイヤーの最新カードを非表示
  const streetDealHidden = _studStreetDealing && !_studStreetDealtPids.has(playerIdx);

  // ストリートディール中の表示枚数制限
  // 未ディールプレイヤーは最新カード（up or down）を1枚隠す
  const visibleUpCount   = streetDealHidden && !isSeventh ? upCards.length - 1 : upCards.length;
  const visibleDownCount = streetDealHidden && isSeventh  ? downCards.length - 1 : downCards.length;

  // 上段: アップカード（4枠）
  let upHtml = '';
  for (let i = 0; i < 4; i++) {
    if (doorHidden && i < upCards.length) {
      // リビール前: ドアカードはプレースホルダー表示
      upHtml += '<span class="card hole stud-up stud-ph"></span>';
    } else if (i < visibleUpCount) {
      const c = upCards[i];
      // ドアカードリビール時 or ストリート変化時の最新カードにフロート
      const floatDoor = isDoorRevealFloat && i === upCards.length - 1;
      const floatNew  = isStreetFloat && !isSeventh && i === upCards.length - 1;
      const floatDeal = isStreetDealFloat && !isSeventh && i === upCards.length - 1;
      if (floatDoor || floatNew || floatDeal) {
        upHtml += cardHtml(c, 'hole stud-up', 'stud-float', '');
      } else if (!isHuman && _showdownReveal && isSD) {
        upHtml += cardHtml(c, 'hole stud-up', 'card-reveal', `animation-delay:${i * 0.12}s`);
      } else {
        upHtml += cardHtml(c, 'hole stud-up');
      }
    } else {
      upHtml += '<span class="card hole stud-up stud-ph"></span>';
    }
  }

  // 下段: ダウンカード（3枠）
  let downHtml = '';
  for (let i = 0; i < 3; i++) {
    if (i < visibleDownCount) {
      const c = downCards[i];
      // 7th Street: 最新のダウンカード（配列末尾）にフロートアニメーション
      const floatNew  = isStreetFloat && isSeventh && i === downCards.length - 1;
      const floatDeal = isStreetDealFloat && isSeventh && i === downCards.length - 1;
      if ((floatNew || floatDeal) && showAll) {
        downHtml += cardHtml(c, 'hole stud-down', 'stud-float', '');
      } else if ((floatNew || floatDeal) && !showAll) {
        downHtml += `<span class="card hole stud-down bk stud-float"></span>`;
      } else if (showAll) {
        if (!isHuman && _showdownReveal && isSD) {
          downHtml += cardHtml(c, 'hole stud-down', 'card-reveal', `animation-delay:${(i + upCards.length) * 0.12}s`);
        } else {
          downHtml += cardHtml(c, 'hole stud-down');
        }
      } else {
        downHtml += '<span class="card hole stud-down bk"></span>';
      }
    } else {
      downHtml += '<span class="card hole stud-down stud-ph"></span>';
    }
  }

  return `<div class="stud-row stud-row-up">${upHtml}</div><div class="stud-row stud-row-down">${downHtml}</div>`;
}

// ------- Fix Limit ベットサイズ計算 -------
function _getStudFixedBetSize() {
  // Stud: Fifth Street 以降は bigBet
  const bigBetStates = ['FIFTH_STREET', 'SIXTH_STREET', 'SEVENTH_STREET', 'BETTING_3', 'BETTING_4'];
  return bigBetStates.includes(adapter.state) ? gameConfig.bigBet : gameConfig.smallBet;
}

// ------- レイズプリセット計算（NLH専用） -------
function potSizeTotal(frac, bet, pot) {
  return Math.round(frac * (2 * bet + pot) + bet);
}

function computeRaisePresets(player) {
  const toCall  = adapter.currentBet - player.currentBet;
  const isRaise = toCall > 0;
  const raiseAct = isRaise ? 'raise' : 'bet';
  const minTotal = isRaise ? adapter.currentBet + adapter.lastRaiseIncrement : adapter.bigBlind;
  const maxTotal = isRaise ? player.chips + player.currentBet : player.chips;
  const pot = adapter.pot;
  const bet = adapter.currentBet;

  const isPreflopFirst = adapter.state === 'PREFLOP' && adapter.currentBet <= adapter.bigBlind;
  const rawCandidates = isPreflopFirst
    ? [
        { label: '2BB',   total: 2   * adapter.bigBlind },
        { label: '2.3BB', total: Math.round(2.3 * adapter.bigBlind) },
        { label: '2.5BB', total: Math.round(2.5 * adapter.bigBlind) },
        { label: '3BB',   total: 3   * adapter.bigBlind },
      ]
    : [
        { label: '33%',  total: potSizeTotal(0.33, bet, pot) },
        { label: '50%',  total: potSizeTotal(0.5,  bet, pot) },
        { label: '100%', total: potSizeTotal(1.0,  bet, pot) },
      ];

  const seen = new Set();
  const presets = [];
  for (const r of rawCandidates) {
    const t = Math.max(minTotal, Math.min(maxTotal, r.total));
    if (t >= minTotal && !seen.has(t)) {
      seen.add(t);
      const amount = isRaise ? t - adapter.currentBet : t;
      presets.push({ label: r.label, total: t, amount });
    }
  }
  return { presets, minTotal, maxTotal, raiseAct };
}

// ------- レンダリング -------
function renderAll() {
  if (adapter.state !== prevStreet) {
    // Stud: ストリート変化時の処理
    if (gameConfig?.isStudGame) {
      const streetDealStates = ['FOURTH_STREET','FIFTH_STREET','SIXTH_STREET','SEVENTH_STREET'];
      if (streetDealStates.includes(adapter.state) && !_studStreetDealing) {
        // 4th Street以降: 順次ディール開始
        _studStreetDealing = true;
        _studStreetDealtPids = new Set();
        _studLatestDealPid = -1;
        prevStreet = adapter.state;
        renderPlayers(); renderCommunityCards(); renderPotInfo();
        renderActions(); renderLog(); renderWinOverlay();
        _startStudStreetDeal();
        return;
      } else if (!_studStreetDealing) {
        // 3rd Street以前: 従来通り全体フロート
        _studFloatStreet = adapter.state;
      }
    }
    prevStreet = adapter.state;
  }
  renderPlayers();
  // Stud: フロートアニメーションをrenderPlayers1回のみに適用
  if (_studFloatStreet) {
    _studFloatStreet = null;
  }
  renderCommunityCards();
  renderPotInfo();
  renderActions();
  renderLog();
  renderWinOverlay();
  // DOM描画後にフラグクリア → 次回 renderAll() でアニメしない（settled扱い）
  requestAnimationFrame(() => {
    freshBubblePids.clear();
    // isNew フラグ: アニメーション1フレーム描画後にクリア
    for (const p of adapter.players) {
      for (const c of p.hand) { c.isNew = false; }
    }
  });
}

// ------- 勝利オーバーレイ -------
function renderWinOverlay() {
  const overlay = document.getElementById('win-overlay');
  if (!overlay) return;
  if (_showdownDelayActive || adapter.state !== 'COMPLETE' || !adapter.lastWinners || adapter.lastWinners.length === 0) {
    overlay.classList.add('hidden'); return;
  }
  const winners = adapter.lastWinners;
  const isMulti = winners.length > 1;
  document.getElementById('win-player-name').textContent =
    isMulti ? winners.map(w => w.name.toUpperCase()).join(' & ') : winners[0].name.toUpperCase();
  document.getElementById('win-hand-name').textContent =
    winners[0].handResult ? winners[0].handResult.name : '';
  document.getElementById('win-pot').textContent =
    `+ ${bb(adapter.lastPot, BB)} BB`;
  overlay.classList.remove('hidden');
}

// ------- プレイヤー描画 -------
function renderPlayers() {
  // ドローDOMアニメーション中は innerHTML を再構築しない（チカチカ防止）
  if (_inDrawExecution || _discardingPids.size > 0) return;
  const el      = document.getElementById('players');
  el.innerHTML  = '';
  const isMobile  = window.innerWidth <= 500;
  const isStud    = !!gameConfig.isStudGame;
  const is5Card   = gameConfig.numHoleCards >= 5;
  const seatMap   = isStud
    ? (isMobile ? MOBILE_SEATS_STUD : SEATS_STUD)
    : isMobile ? (is5Card ? MOBILE_SEATS_WIDE : MOBILE_SEATS)
               : (is5Card ? SEATS_WIDE        : SEATS);
  const pos       = seatMap[adapter.players.length] || seatMap[6];
  const numHole  = gameConfig.numHoleCards;

  adapter.players.forEach((p, i) => {
    const isDlr    = i === adapter.dealerIndex;
    const isSB     = i === adapter.getSBIndex();
    const isBB     = i === adapter.getBBIndex();
    const isActive = i === adapter.currentPlayerIndex && adapter.state !== 'COMPLETE';
    const isHuman  = i === 0;
    const isSD     = adapter.state === 'SHOWDOWN' || adapter.state === 'COMPLETE';

    // ドロー宣言済み（捨て牌フェード後の状態）: 残り牌のみ左寄せ表示
    const isSeatDiscarding = p.hasDeclared && gameConfig.hasDrawPhase && adapter.state.startsWith('DRAW_');

    const seat = document.createElement('div');
    seat.className = `seat${isActive?' seat-active':''}${p.folded?' seat-folded':''}${p.chips<=0&&!p.isAllIn?' seat-bust':''}${isHuman?' seat-you':''}${isSeatDiscarding?' seat-discarding':''}`;
    seat.style.left = pos[i][0] + '%';
    seat.style.top  = pos[i][1] + '%';
    seat.dataset.pid = i;

    // SB/BB チップ（Stud はアンテ制のため表示しない）
    const posChip = isStud ? ''
                  : isSB ? '<div class="pos-chip bsb">SB</div>'
                  : isBB ? '<div class="pos-chip bbb">BB</div>'
                  : '';

    // ホールカード表示（numHoleCards枚に対応）
    const showFaceUp = isHuman || isSD || isRunout();
    let cards = '';
    if (isStud && p.hand.length) {
      // Stud: 2段レイアウト（上段: アップカード4枠、下段: ダウンカード3枠）
      // フォールド済みも同じ2段レイアウトを使用（透過はCSSで処理）
      cards = _renderStudCards(p, i, isHuman, isSD);
    } else if (p.hand.length) {
      if (p.folded) {
        cards = isHuman
          ? p.hand.map(c => cardHtml(c, 'hole')).join('')
          : `<span class="card hole bk"></span>`.repeat(p.hand.length || numHole);
      } else if (showFaceUp) {
        // isNew フラグ or _humanDrawAnimCount でカードのスタガーアニメーション
        // ショーダウン時は相手カードに card-reveal を付与
        const humanAnimStart = (isHuman && _humanDrawAnimCount > 0)
          ? p.hand.length - _humanDrawAnimCount : -1;
        cards = p.hand.map((c, idx) => {
          if (isHuman && humanAnimStart >= 0 && idx >= humanAnimStart) {
            const animIdx = idx - humanAnimStart;
            // 1枚目はゆっくり(.55s)、2枚目以降は標準(.35s)でオフセット
            const dur   = animIdx === 0 ? 'animation-duration:.55s;' : '';
            const delay = animIdx === 0 ? 0 : animIdx * 0.32 + 0.18;
            return cardHtml(c, 'hole', 'card-new', `${dur}animation-delay:${delay}s`);
          }
          if (!isHuman && c.isNew) {
            const animIdx = c.newIndex || 0;
            const dur   = animIdx === 0 ? 'animation-duration:.55s;' : '';
            const delay = animIdx === 0 ? 0 : animIdx * 0.32 + 0.18;
            return cardHtml(c, 'hole', 'card-new', `${dur}animation-delay:${delay}s`);
          }
          if (!isHuman && _showdownReveal && isSD) {
            const delay = idx * 0.12;
            return cardHtml(c, 'hole', 'card-reveal', `animation-delay:${delay}s`);
          }
          return cardHtml(c, 'hole');
        }).join('');
      } else if (isSeatDiscarding) {
        // 宣言済み（捨て牌フェード後）: 捨て牌を除いた残り牌のみ裏向きで表示
        const keepCount = p.hand.length - (p.selectedForDraw?.length ?? 0);
        cards = Array.from({length: Math.max(0, keepCount)}, () => '<span class="card hole bk"></span>').join('');
      } else {
        // 裏向き: ドロー直後は新しいカードをアニメーション（引いてくる演出）
        const n = p.hand.length;
        const drawN = (_drawAnimPlayerId === p.id && p.drawCount > 0) ? p.drawCount : 0;
        cards = p.hand.map((_, cardIdx) => {
          const isNewFaceDown = drawN > 0 && cardIdx >= (n - drawN);
          if (isNewFaceDown) {
            const animIdx = cardIdx - (n - drawN);
            const dur   = animIdx === 0 ? 'animation-duration:.55s;' : '';
            const delay = animIdx === 0 ? 0 : animIdx * 0.32 + 0.18;
            return `<span class="card hole bk card-new" style="${dur}animation-delay:${delay}s"></span>`;
          }
          return `<span class="card hole bk"></span>`;
        }).join('');
      }
    }

    const hname  = isSD && p.handResult && !p.folded ? `<span class="hname">${esc(p.handResult.name)}</span>` : '';
    const stt    = p.isAllIn  ? '<span class="stt stt-allin">ALL IN</span>'
                 : p.chips<=0 ? '<span class="stt stt-bust">BUST</span>' : '';

    // 生役表示（プレイヤー0自身 / ショーダウン以外 / フォールド前）
    let liveHand = '';
    if (i === 0 && !isSD && !p.folded && adapter.evaluateCurrentHand) {
      try {
        const lhr = adapter.evaluateCurrentHand(0);
        if (lhr && lhr.name && lhr.name !== '(invalid)') {
          let dn = lhr.name;
          // Badugi: "4-card Badugi (A-2-3-4)" → "A-2-3-4"
          const bm = dn.match(/\(([^)]+)\)/);
          if (bm && bm[1]) dn = bm[1];
          liveHand = `<span class="live-hand">${esc(dn)}</span>`;
        }
      } catch(e) { /* 評価エラーは無視 */ }
    }

    const la     = lastActions[i];
    const isNew  = freshBubblePids.has(i);
    // FOLDバブル: フォールドしたラウンド中は ab-fold-active（透過しない）
    const isFoldActive = la?.type === 'fold' && foldBubbleState[i] === adapter.state;
    // FOLD直後にCOMPLETEになった場合（ヘッズアップ最終フォールド等）も fresh なら表示する
    // ショーダウン遅延中（_showdownDelayActive）は直前のアクションバブルも表示する
    const showBubble = la && (!isSD || (la.type === 'fold' && freshBubblePids.has(i)) || _showdownDelayActive);
    const bubbleInner = showBubble
      ? `<div class="action-bubble ab-${la.type}${isNew?' ab-new':''}${isFoldActive?' ab-fold-active':''}">${la.label}</div>` : '';
    // Stud: バブルを固定高スロットに配置（出現・消滅でカードが動かないようにする）
    const bubble = isStud ? `<div class="bubble-slot">${bubbleInner}</div>` : bubbleInner;
    const arrow  = isActive ? '<span class="turn-arrow">▶</span>' : '';

    const posLbl    = getPos(i);
    const pcbetHtml = isMobile && p.currentBet > 0
      ? `<span class="pcbet">${bb(p.currentBet, BB)} BB</span>` : '';

    const cardsWrap = (isStud && p.hand.length)
      ? `<div class="stud-cards-wrap">${cards}</div>`
      : `<div class="cards-row">${cards}</div>`;

    seat.innerHTML = `
      ${arrow}
      ${cardsWrap}
      ${bubble}
      ${posChip}
      <div class="seat-pill">
        ${isDlr ? '<span class="dlr-badge">D</span>' : ''}
        <div class="av" style="background:${COLORS[i]}">${esc(p.name[0])}</div>
        <div class="pos-label pos-${posLbl.toLowerCase()}">${posLbl}</div>
        <div class="pinfo">
          <span class="pname">${esc(p.name)}</span>
          <span class="pstack">${bb(p.chips, BB)} BB</span>
          ${pcbetHtml}
        </div>
      </div>
      ${liveHand}${hname}${stt}
    `;
    el.appendChild(seat);

    // ドローフェーズ: プレイヤー0の座席カードをクリック可能にする
    if (isHuman && gameConfig.hasDrawPhase &&
        adapter.state.startsWith('DRAW_') && adapter.currentPlayerIndex === 0 && !p.folded) {
      const cardEls = seat.querySelectorAll('.cards-row .card.hole');
      cardEls.forEach((cardEl, idx) => {
        if (selectedDrawIndices.has(idx)) {
          cardEl.classList.add('draw-selected');
        } else {
          cardEl.classList.add('draw-keep');
        }
        cardEl.style.cursor = 'pointer';
        cardEl.addEventListener('click', () => {
          if (selectedDrawIndices.has(idx)) {
            selectedDrawIndices.delete(idx);
          } else {
            selectedDrawIndices.add(idx);
          }
          renderAll();
        });
      });
    }

    if (!isMobile && p.currentBet > 0) {
      const tchip = document.createElement('div');
      tchip.className = 'table-bet-chip';
      tchip.style.left = (pos[i][0] * 0.45 + 50 * 0.55) + '%';
      tchip.style.top  = (pos[i][1] * 0.45 + 50 * 0.55) + '%';
      tchip.innerHTML  = `<span class="chip-dot"></span>${bb(p.currentBet, BB)} BB`;
      el.appendChild(tchip);
    }
  });

}

// ------- コミュニティカード描画 -------
function renderCommunityCards() {
  const el = document.getElementById('community-cards');

  // ドローゲームはコミュニティカードなし
  if (!gameConfig.hasCommunityCards) {
    el.innerHTML = '';
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');

  const isNewStreet = adapter.communityCards.length > 0 &&
    adapter.state !== lastAnimatedStreet &&
    (adapter.state === 'FLOP' || adapter.state === 'TURN' || adapter.state === 'RIVER');
  if (isNewStreet) lastAnimatedStreet = adapter.state;

  el.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const c = adapter.communityCards[i];
    if (c) {
      el.insertAdjacentHTML('beforeend', cardHtml(c, 'comm'));
    } else {
      const ph = document.createElement('span');
      ph.className = 'card comm ph';
      el.appendChild(ph);
    }
  }

  if (isNewStreet) {
    const newStart = adapter.state === 'FLOP' ? 0 : adapter.communityCards.length - 1;
    el.querySelectorAll('.card.comm:not(.ph)').forEach((card, i) => {
      if (i >= newStart) {
        card.style.animationDelay = (adapter.state === 'FLOP' ? (i - newStart) * 0.3 : 0) + 's';
        card.classList.add('card-new');
      }
    });
  }
}

// ------- ポット情報描画 -------
function renderPotInfo() {
  const potAmt = (adapter.state === 'COMPLETE' && adapter.lastPot > 0)
    ? adapter.lastPot : adapter.pot;
  document.getElementById('pot-display').textContent = `POT  ${bb(potAmt, BB)} BB`;

  // ストリート表示
  const _DRAW_LABELS = {
    BETTING_1: 'PREDRAW',
    BETTING_2: '1st BETTING ROUND',
    BETTING_3: '2nd BETTING ROUND',
    BETTING_4: '3rd BETTING ROUND',
    DRAW_1:    '1st DRAW',
    DRAW_2:    '2nd DRAW',
    DRAW_3:    '3rd DRAW',
  };
  const _STUD_LABELS = {
    ANTE:           'ANTE',
    THIRD_STREET:   '3rd STREET',
    FOURTH_STREET:  '4th STREET',
    FIFTH_STREET:   '5th STREET',
    SIXTH_STREET:   '6th STREET',
    SEVENTH_STREET: '7th STREET',
  };
  const labelMap = gameConfig?.isStudGame ? _STUD_LABELS : _DRAW_LABELS;
  const stateLabel = labelMap[adapter.state] ?? adapter.state;
  document.getElementById('street-display').textContent = stateLabel;
}

// ------- アクション描画（メイン） -------
function renderActions() {
  if (window.innerWidth <= 500) { renderMobileActions(); return; }
  const el = document.getElementById('actions');
  el.innerHTML = '';

  // Stud: ドアカードリビール / ストリートディール演出中はアクション非表示
  if (_studDoorRevealing || _studStreetDealing) {
    const bar = mkBar();
    const msg = document.createElement('span');
    msg.className = 'waiting-msg';
    msg.textContent = 'DEALING...';
    bar.appendChild(msg); el.appendChild(bar); return;
  }

  // ドロー実行アニメーション中はベットUIを隠す
  if (_inDrawExecution) {
    const bar = mkBar();
    const msg = document.createElement('span');
    msg.className = 'waiting-msg';
    msg.textContent = 'Drawing cards...';
    bar.appendChild(msg);
    el.appendChild(bar);
    return;
  }

  const p = adapter.players[0];

  // フォールド済み（DRAW_フェーズ含む — 先に処理してスタイル崩れを防止）
  if (p.folded) {
    const bar = mkBar();
    if (adapter.state === 'COMPLETE' || adapter.state === 'SHOWDOWN') {
      const b = mkBtn('deal', 'NEXT HAND'); b.onclick = startNewHand;
      bar.appendChild(b);
    } else if (adapter.currentPlayerIndex !== 0) {
      const b = mkBtn('deal', 'NEXT HAND'); b.onclick = fastForwardHand;
      bar.appendChild(b);
    }
    el.appendChild(bar); return;
  }

  // ドローフェーズ
  if (gameConfig.hasDrawPhase && adapter.state && adapter.state.startsWith('DRAW_')) {
    renderDrawPhaseActions(el);
    return;
  }

  // オールインランアウト
  if (isRunout()) {
    const bar = mkBar();
    const msg = document.createElement('span');
    msg.className = 'waiting-msg';
    msg.textContent = 'ALL IN — RUNOUT';
    bar.appendChild(msg); el.appendChild(bar); return;
  }

  // SHOWDOWN / COMPLETE（非フォールド）
  if (adapter.state === 'COMPLETE' || adapter.state === 'SHOWDOWN') {
    if (_showdownDelayActive) { el.appendChild(mkBar()); return; } // リビール演出中はボタン非表示
    const bar = mkBar();
    const b   = mkBtn('deal', 'NEXT HAND'); b.onclick = startNewHand;
    bar.appendChild(b); el.appendChild(bar); return;
  }

  // CPUターン
  if (adapter.currentPlayerIndex !== 0 || p.isAllIn) {
    const cur = adapter.getCurrentPlayer();
    const bar = mkBar();
    if (cur && cur.id !== 0) {
      const msg = document.createElement('span');
      msg.className = 'waiting-msg';
      msg.textContent = `${cur.name}'s turn...`;
      bar.appendChild(msg);
    }
    el.appendChild(bar); return;
  }

  // 人間のターン（NLH / Fix Limit 共通）
  const valid  = adapter.getValidActions(p);
  const toCall = adapter.currentBet - p.currentBet;
  const bar = mkBar();

  // Stud: Bring-in 選択（BRING_IN or COMPLETE）
  if (valid.includes('bring_in')) {
    const leftGrp = mkGroup();
    const biBtn = mkBtn('call', `<span class="btn-label">BRING IN</span><span class="btn-sub">${bb(gameConfig.bringIn, BB)} BB</span>`);
    biBtn.onclick = () => humanAction('bring_in');
    leftGrp.appendChild(biBtn);
    bar.appendChild(leftGrp);
    if (valid.includes('complete')) {
      bar.appendChild(mkDivider());
      const midGrp = mkGroup();
      const compBtn = mkBtn('raise', `<span class="btn-label">COMPLETE</span><span class="btn-sub">${bb(gameConfig.smallBet, BB)} BB</span>`);
      compBtn.onclick = () => humanAction('complete', 0);
      midGrp.appendChild(compBtn);
      bar.appendChild(midGrp);
    }
    el.appendChild(bar);
    return;
  }

  // 左グループ: FOLD / CHECK / CALL
  const leftGrp = mkGroup();
  if (valid.includes('fold') && toCall > 0) {
    const b = mkBtn('fold', '<span class="btn-label">FOLD</span>');
    b.onclick = () => humanAction('fold');
    leftGrp.appendChild(b);
  }
  if (valid.includes('check')) {
    const b = mkBtn('check', '<span class="btn-label">CHECK</span>');
    b.onclick = () => humanAction('check');
    leftGrp.appendChild(b);
  } else if (valid.includes('call')) {
    const b = mkBtn('call', `<span class="btn-label">CALL</span><span class="btn-sub">${bb(adapter.currentBet, BB)} BB</span>`);
    b.onclick = () => humanAction('call');
    leftGrp.appendChild(b);
  }
  bar.appendChild(leftGrp);

  // 中央グループ: レイズプリセット（NLH）、Fixedベット（Fix Limit）、Complete（Stud）
  const hasRaise = valid.includes('raise') || valid.includes('bet');
  const hasComplete = valid.includes('complete');
  if (hasRaise || hasComplete) {
    if (gameConfig.bettingStructure === 'fixed-limit') {
      // Fix Limit: 固定額ボタン（Stud Complete 含む）
      bar.appendChild(mkDivider());
      const midGrp = mkGroup();

      if (hasComplete && !hasRaise) {
        // Stud: Complete ボタン（bring-in → small bet）
        const compAmt = gameConfig.smallBet;
        const b = mkBtn('raise', `<span class="btn-label">COMPLETE</span><span class="btn-sub">${bb(compAmt, BB)} BB</span>`);
        b.onclick = () => humanAction('complete', 0);
        midGrp.appendChild(b);
      } else {
        // 通常の Bet/Raise
        const betAmt = _getStudFixedBetSize();
        const betAct = toCall > 0 ? 'raise' : 'bet';
        const displayAmt = toCall > 0 ? adapter.currentBet + betAmt : betAmt;
        const _raiseOrBet = (toCall > 0 || adapter.currentBet > 0) ? 'RAISE' : 'BET';
        const b = mkBtn(betAct, `<span class="btn-label">${_raiseOrBet}</span><span class="btn-sub">${bb(displayAmt, BB)} BB</span>`);
        b.onclick = () => humanAction(betAct, betAmt);
        midGrp.appendChild(b);
      }
      bar.appendChild(midGrp);
    } else {
      // No-Limit: プリセット + カスタム
      bar.appendChild(mkDivider());
      const { presets, raiseAct } = computeRaisePresets(p);
      const midGrp = mkGroup();
      for (const ps of presets) {
        const b = document.createElement('button');
        b.className = 'raise-preset-btn rp-raise';
        b.innerHTML = `<span class="rpb-label">${ps.label}</span><span class="rpb-sub">${bb(ps.total, BB)} BB</span>`;
        const amount = ps.amount;
        b.onclick = () => humanAction(raiseAct, amount);
        midGrp.appendChild(b);
      }
      const cust = document.createElement('button');
      cust.className = 'raise-preset-btn rp-custom';
      cust.innerHTML = '<span class="rpb-label">▲</span><span class="rpb-sub">Custom</span>';
      cust.onclick = () => showSlider(raiseAct);
      midGrp.appendChild(cust);
      bar.appendChild(midGrp);
    }
  }

  // 右グループ: ALL IN（NLHのみ）
  if (valid.includes('all_in') && gameConfig.bettingStructure !== 'fixed-limit') {
    bar.appendChild(mkDivider());
    const rightGrp = mkGroup();
    const b = mkBtn('all_in', `<span class="btn-label">ALL IN</span><span class="btn-sub">${bb(p.chips, BB)} BB</span>`);
    b.onclick = () => humanAction('all_in');
    rightGrp.appendChild(b);
    bar.appendChild(rightGrp);
  }

  el.appendChild(bar);
}

// ------- ドローフェーズUI -------
// カード選択は renderPlayers() 内で座席カードをクリック可能にして行う。
// ここはボタン確認エリアのみ表示する。
function renderDrawPhaseActions(el) {
  // ドロー実行フェーズ中（アニメーション演出中）
  if (_inDrawExecution) {
    const bar = mkBar();
    const msg = document.createElement('span');
    msg.className = 'waiting-msg';
    msg.textContent = 'Drawing cards...';
    bar.appendChild(msg);
    el.appendChild(bar);
    return;
  }

  // 自分がすでに宣言済み（全員宣言済みか否かに関わらず Draw ボタンを隠す）
  if (adapter.players[0].hasDeclared) {
    const bar = mkBar();
    const msg = document.createElement('span');
    msg.className = 'waiting-msg';
    msg.textContent = adapter.allDeclared ? '' : 'Waiting for others...';
    bar.appendChild(msg);
    el.appendChild(bar);
    return;
  }

  // CPUの宣言待ち（human の番ではない）
  if (adapter.currentPlayerIndex !== 0 && !adapter.players[0].hasDeclared) {
    const bar = mkBar();
    const cur = adapter.getCurrentPlayer();
    if (cur && cur.id !== 0 && !cur.folded) {
      const msg = document.createElement('span');
      msg.className = 'waiting-msg';
      msg.textContent = `${cur.name} is thinking...`;
      bar.appendChild(msg);
    }
    el.appendChild(bar);
    // cpuDeclareTurn はチェーン（humanAction/cpuTurn から最初にトリガー済み）
    return;
  }

  // 人間のドロー宣言ボタン（カード選択は座席で行う）
  const bar  = mkBar();
  const zone = document.createElement('div');
  zone.className = 'draw-zone';

  const n = selectedDrawIndices.size;

  const drawBtn = document.createElement('button');
  drawBtn.className   = n === 0 ? 'draw-btn draw-btn-pat' : 'draw-btn draw-btn-draw';
  drawBtn.textContent = n === 0 ? 'Stand Pat' : `Draw ${n}`;
  drawBtn.onclick = () => {
    const humanIndices = [...selectedDrawIndices];
    const drawCount    = humanIndices.length; // declareDrawOnly より前に確定

    // 宣言のみ（カード交換は startDrawExecution() で行う）
    adapter.declareDrawOnly(0, humanIndices);
    selectedDrawIndices = new Set();

    // バブルデータをセット
    const drawInfo = ACTION_LABELS[`draw_${drawCount}`];
    if (drawInfo) { lastActions[0] = { ...drawInfo }; lastActorId = 0; freshBubblePids.add(0); }

    // drawCount>0 の場合: renderPlayers() がシート再構築しないよう事前ブロック
    // （再構築すると isSeatDiscarding で keepCount 枚に減り、アニメが正しく動かない）
    if (drawCount > 0) _discardingPids.add(0);

    renderAll(); // renderPlayers はブロック中でも renderActions は必ず実行される

    // renderPlayers がブロックされていても即時バブル表示（直接 DOM 注入）
    const _humanSeat = document.querySelector('#players .seat[data-pid="0"]');
    if (_humanSeat && drawInfo) {
      const _old = _humanSeat.querySelector('.action-bubble');
      if (_old) _old.remove();
      const _bbl = document.createElement('div');
      _bbl.className   = `action-bubble ab-${drawInfo.type} ab-new`;
      _bbl.textContent = drawInfo.label;
      const _cr = _humanSeat.querySelector('.cards-row');
      _humanSeat.insertBefore(_bbl, _cr ? _cr.nextSibling : null);
    }

    // カードアニメーション（チェンジ枚数がある場合のみ 450ms 遅延で開始）
    if (drawCount > 0) setTimeout(() => _discardPlayerCards(0), 450);

    if (adapter.allDeclared) {
      setTimeout(startDrawExecution, 1300);
    } else {
      const nextP = adapter.getCurrentPlayer();
      if (nextP && nextP.id !== 0 && !nextP.folded) {
        setTimeout(cpuDeclareTurn, 700);
      }
    }
  };
  zone.appendChild(drawBtn);

  const hint = document.createElement('span');
  hint.className   = 'draw-count-label';
  hint.textContent = n === 0 ? 'Refine Your Hand' : `${n} card${n > 1 ? 's' : ''} selected`;
  zone.appendChild(hint);

  bar.appendChild(zone);
  el.appendChild(bar);
}

// ------- スライダーUI（NLH カスタムレイズ） -------
function showSlider(act) {
  const p        = adapter.players[0];
  const isRaiseA = act === 'raise';
  const minTotal = isRaiseA ? adapter.currentBet + adapter.lastRaiseIncrement : adapter.bigBlind;
  const maxTotal = isRaiseA ? p.chips + p.currentBet : p.chips;
  const pot = adapter.pot;
  const bet = adapter.currentBet;
  const presets = [
    { label:'Min',    total:minTotal },
    { label:'33%',    total:potSizeTotal(0.33, bet, pot) },
    { label:'50%',    total:potSizeTotal(0.5,  bet, pot) },
    { label:'100%',   total:potSizeTotal(1.0,  bet, pot) },
    { label:'All In', total:maxTotal },
  ].filter((ps,i,arr)=>{
    const t=Math.max(minTotal,Math.min(maxTotal,ps.total));
    if(t<minTotal||t>maxTotal) return false;
    return arr.findIndex(x=>Math.max(minTotal,Math.min(maxTotal,x.total))===t)===i;
  });

  // DOM構築（inline handler を使わない）
  const actionsEl = document.getElementById('actions');
  actionsEl.innerHTML = '';

  const bar = document.createElement('div');
  bar.className = 'action-bar';
  const raiseWrap = document.createElement('div');
  raiseWrap.className = 'raise-wrap';

  // プリセットボタン
  const presetDiv = document.createElement('div');
  presetDiv.className = 'raise-presets';
  presets.forEach(ps => {
    const t = Math.max(minTotal, Math.min(maxTotal, ps.total));
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.innerHTML = `${ps.label}<span class="preset-sub">${bb(t, BB)} BB</span>`;
    btn.addEventListener('click', () => _setSliderVal(t));
    presetDiv.appendChild(btn);
  });

  // 入力行
  const inputRow = document.createElement('div');
  inputRow.className = 'raise-input-row';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'action-btn cancel';
  cancelBtn.textContent = '←';
  cancelBtn.addEventListener('click', renderActions);

  const slider = document.createElement('input');
  slider.type = 'range'; slider.id = 'rslider';
  slider.min = String(minTotal); slider.max = String(maxTotal);
  slider.value = String(minTotal); slider.step = '1';

  const inputGroup = document.createElement('div');
  inputGroup.className = 'raise-input-group';

  const bbInput = document.createElement('input');
  bbInput.type = 'number'; bbInput.id = 'rbb';
  bbInput.min = String(bb(minTotal, BB)); bbInput.max = String(bb(maxTotal, BB));
  bbInput.step = '0.5'; bbInput.value = String(bb(minTotal, BB));

  const unitSpan = document.createElement('span');
  unitSpan.className = 'raise-input-unit';
  unitSpan.textContent = 'BB';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'action-btn confirm';
  confirmBtn.textContent = 'OK';

  // イベント登録
  slider.addEventListener('input', () => {
    bbInput.value = bb(parseInt(slider.value), BB);
  });
  bbInput.addEventListener('input', () => {
    const parsed = parseFloat(bbInput.value);
    if (!Number.isFinite(parsed) || parsed < 0) return; // NaN / Infinity ガード
    const chips = Math.round(parsed * BB);
    slider.value = String(Math.max(+slider.min, Math.min(+slider.max, chips)));
  });
  confirmBtn.addEventListener('click', () => {
    const total = Math.max(minTotal, Math.min(maxTotal, parseInt(slider.value)));
    const amount = act === 'raise' ? total - adapter.currentBet : total;
    humanAction(act, amount);
  });

  inputGroup.appendChild(bbInput);
  inputGroup.appendChild(unitSpan);
  inputRow.appendChild(cancelBtn);
  inputRow.appendChild(slider);
  inputRow.appendChild(inputGroup);
  inputRow.appendChild(confirmBtn);
  raiseWrap.appendChild(presetDiv);
  raiseWrap.appendChild(inputRow);
  bar.appendChild(raiseWrap);
  actionsEl.appendChild(bar);
}

// スライダー値更新（内部ユーティリティ）
function _setSliderVal(total) {
  const s = document.getElementById('rslider');
  const b = document.getElementById('rbb');
  if (!s) return;
  const t = Math.max(+s.min, Math.min(+s.max, total));
  s.value = String(t);
  if (b) b.value = bb(t, BB);
}

// ------- モバイルアクション（≤500px） -------
function renderMobileActions() {
  const el = document.getElementById('actions');
  el.innerHTML = '';

  // Stud: ドアカードリビール / ストリートディール演出中はアクション非表示
  if (_studDoorRevealing || _studStreetDealing) {
    const wrap = document.createElement('div');
    wrap.className = 'mobile-action-wrap mob-simple-wrap';
    const msg = document.createElement('span');
    msg.className = 'waiting-msg'; msg.textContent = 'DEALING...';
    wrap.appendChild(msg); el.appendChild(wrap); return;
  }

  // ドロー実行アニメーション中はベットUIを隠す
  if (_inDrawExecution) {
    const wrap = document.createElement('div');
    wrap.className = 'mobile-action-wrap mob-simple-wrap';
    const msg = document.createElement('span');
    msg.className = 'waiting-msg'; msg.textContent = 'Drawing cards...';
    wrap.appendChild(msg); el.appendChild(wrap); return;
  }

  const p = adapter.players[0];

  // フォールド済み（DRAW_フェーズ含む — 先に処理して mob-deal スタイルを統一）
  if (p.folded) {
    const wrap = document.createElement('div');
    wrap.className = 'mobile-action-wrap mob-simple-wrap';
    if (adapter.state === 'COMPLETE' || adapter.state === 'SHOWDOWN') {
      const b = document.createElement('button');
      b.className = 'mob-btn mob-deal'; b.textContent = 'NEXT HAND'; b.onclick = startNewHand;
      wrap.appendChild(b);
    } else if (adapter.currentPlayerIndex !== 0) {
      const b = document.createElement('button');
      b.className = 'mob-btn mob-deal'; b.textContent = 'NEXT HAND'; b.onclick = fastForwardHand;
      wrap.appendChild(b);
    }
    el.appendChild(wrap); return;
  }

  // ドローフェーズ
  if (gameConfig.hasDrawPhase && adapter.state && adapter.state.startsWith('DRAW_')) {
    renderDrawPhaseActions(el);
    return;
  }

  if (isRunout()) {
    const wrap = document.createElement('div');
    wrap.className = 'mobile-action-wrap mob-simple-wrap';
    const msg = document.createElement('span');
    msg.className = 'waiting-msg'; msg.textContent = 'ALL IN — RUNOUT';
    wrap.appendChild(msg); el.appendChild(wrap); return;
  }

  if (adapter.state === 'COMPLETE' || adapter.state === 'SHOWDOWN') {
    const wrap = document.createElement('div');
    wrap.className = 'mobile-action-wrap mob-simple-wrap';
    const b = document.createElement('button');
    b.className = 'mob-btn mob-deal'; b.textContent = 'NEXT HAND'; b.onclick = startNewHand;
    wrap.appendChild(b); el.appendChild(wrap); return;
  }

  if (adapter.currentPlayerIndex !== 0 || p.isAllIn) {
    const wrap = document.createElement('div');
    wrap.className = 'mobile-action-wrap mob-simple-wrap';
    const cur = adapter.getCurrentPlayer();
    if (cur && cur.id !== 0) {
      const msg = document.createElement('span');
      msg.className = 'waiting-msg';
      msg.textContent = `${cur.name}'s turn...`;
      wrap.appendChild(msg);
    }
    el.appendChild(wrap); return;
  }

  const valid   = adapter.getValidActions(p);

  // Stud: Bring-in 選択（BRING_IN or COMPLETE）
  if (valid.includes('bring_in')) {
    const wrap = document.createElement('div');
    wrap.className = 'mobile-action-wrap';
    const btns = document.createElement('div');
    btns.className = 'mobile-btns';
    const biBtn = document.createElement('button');
    biBtn.className = 'mob-btn mob-call';
    biBtn.innerHTML = `<span class="mbl-act">BRING IN</span><span class="mbl-amt">${bb(gameConfig.bringIn, BB)} BB</span>`;
    biBtn.onclick = () => humanAction('bring_in');
    btns.appendChild(biBtn);
    if (valid.includes('complete')) {
      const compBtn = document.createElement('button');
      compBtn.className = 'mob-btn mob-raise';
      compBtn.innerHTML = `<span class="mbl-act">COMPLETE</span><span class="mbl-amt">${bb(gameConfig.smallBet, BB)} BB</span>`;
      compBtn.onclick = () => humanAction('complete', 0);
      btns.appendChild(compBtn);
    }
    wrap.appendChild(btns);
    el.appendChild(wrap);
    return;
  }

  const toCall  = adapter.currentBet - p.currentBet;
  const hasRaise = valid.includes('raise') || valid.includes('bet');
  const hasComplete = valid.includes('complete');
  const raiseAct = toCall > 0 ? 'raise' : 'bet';
  const minTotal = toCall > 0 ? adapter.currentBet + (adapter.lastRaiseIncrement || adapter.bigBlind) : adapter.bigBlind;
  const maxTotal = toCall > 0 ? p.chips + p.currentBet : p.chips;

  if (!mobileRaiseAmount || mobileRaiseAmount < minTotal || mobileRaiseAmount > maxTotal) {
    mobileRaiseAmount = minTotal;
  }

  const wrap = document.createElement('div');
  wrap.className = 'mobile-action-wrap';

  // プリセット行（NLH / Fix Limit で分岐）
  if (hasRaise || hasComplete) {
    if (gameConfig.bettingStructure === 'fixed-limit') {
      // Fix Limit: プリセット不要（固定額のみ）
    } else {
      // No-Limit: プリセット + カスタム
      const pot  = adapter.pot;
      const bet  = adapter.currentBet;
      const isPreflopFirst = adapter.state === 'PREFLOP' && adapter.currentBet <= adapter.bigBlind;
      const rawDefs = isPreflopFirst
        ? [
            { label:'2BB',   total: 2   * adapter.bigBlind },
            { label:'2.3BB', total: 23 },
            { label:'2.5BB', total: 25 },
            { label:'3BB',   total: 3   * adapter.bigBlind },
          ]
        : [
            { label:'33%',  total: potSizeTotal(0.33, bet, pot) },
            { label:'50%',  total: potSizeTotal(0.5,  bet, pot) },
            { label:'100%', total: potSizeTotal(1.0,  bet, pot) },
          ];
      const presetDefs = rawDefs
        .map(pd => ({ ...pd, total: Math.max(minTotal, Math.min(maxTotal, pd.total)) }))
        .filter(pd => pd.total >= minTotal && pd.total <= maxTotal);

      const presetsRow = document.createElement('div');
      presetsRow.className = 'mob-preset-row';
      for (const pd of presetDefs) {
        const btn = document.createElement('button');
        const isSel = !mobileCustomMode && mobileRaiseAmount === pd.total;
        btn.className = 'mob-preset-btn' + (isSel ? ' selected' : '');
        btn.innerHTML = `<span class="mpb-label">${pd.label}</span><span class="mpb-sub">${bb(pd.total, BB)} BB</span>`;
        btn.onclick = () => { mobileRaiseAmount = pd.total; mobileCustomMode = false; renderMobileActions(); };
        presetsRow.appendChild(btn);
      }
      const custBtn = document.createElement('button');
      custBtn.className = 'mob-preset-btn mob-preset-custom' + (mobileCustomMode ? ' selected' : '');
      custBtn.innerHTML = `<span class="mpb-label">✎</span><span class="mpb-sub">Custom</span>`;
      custBtn.onclick = () => { mobileCustomMode = true; renderMobileActions(); };
      presetsRow.appendChild(custBtn);
      wrap.appendChild(presetsRow);

      if (mobileCustomMode) {
        const customRow = document.createElement('div');
        customRow.className = 'mob-custom-row';
        const STEP = Math.max(1, Math.round(BB / 2));
        const minusBtn = document.createElement('button');
        minusBtn.className   = 'mob-step-btn'; minusBtn.textContent = '−';
        minusBtn.onclick = () => { mobileRaiseAmount = Math.max(minTotal, mobileRaiseAmount - STEP); renderMobileActions(); };
        const inp = document.createElement('input');
        inp.type='number'; inp.className='mob-custom-input';
        inp.value=bb(mobileRaiseAmount,BB); inp.min=bb(minTotal,BB); inp.max=bb(maxTotal,BB); inp.step='0.1';
        inp.oninput = () => {
          const v = Math.round(parseFloat(inp.value) * BB);
          if (Number.isFinite(v) && v >= minTotal && v <= maxTotal) {
            mobileRaiseAmount = v;
            // レイズボタンをリアルタイム更新（2行フォーマット）
            const rBtn = el.querySelector('.mob-btn.mob-raise, .mob-btn.mob-allin');
            if (rBtn) {
              const isAI = v >= maxTotal;
              const rl   = toCall > 0 ? 'RAISE' : (adapter.currentBet > 0 ? 'RAISE' : 'BET');
              if (isAI) {
                rBtn.className = 'mob-btn mob-allin';
                rBtn.innerHTML = `<span class="mbl-act">ALL IN</span><span class="mbl-amt">${bb(p.chips, BB)} BB</span>`;
                rBtn.onclick   = () => humanAction('all_in');
              } else {
                rBtn.className = 'mob-btn mob-raise';
                rBtn.innerHTML = `<span class="mbl-act">${rl}</span><span class="mbl-amt">${bb(v, BB)} BB</span>`;
                const amt = toCall > 0 ? v - adapter.currentBet : v;
                rBtn.onclick = () => humanAction(raiseAct, amt);
              }
            }
          }
        };
        const unit = document.createElement('span');
        unit.className='mob-custom-unit'; unit.textContent='BB';
        const plusBtn = document.createElement('button');
        plusBtn.className='mob-step-btn'; plusBtn.textContent='+';
        plusBtn.onclick = () => { mobileRaiseAmount = Math.min(maxTotal, mobileRaiseAmount + STEP); renderMobileActions(); };
        customRow.appendChild(minusBtn); customRow.appendChild(inp);
        customRow.appendChild(unit);    customRow.appendChild(plusBtn);
        wrap.appendChild(customRow);
      }
    }
  }

  // アクションボタン（横並び: FOLD左 / CALL-CHECK中 / RAISE右）
  const btns = document.createElement('div');
  btns.className = 'mobile-btns';

  // 1. FOLD（左）— コール必要時のみ
  if (valid.includes('fold') && toCall > 0) {
    const foldBtn = document.createElement('button');
    foldBtn.className = 'mob-btn mob-fold';
    foldBtn.innerHTML = '<span class="mbl-act">FOLD</span>';
    foldBtn.onclick = () => humanAction('fold');
    btns.appendChild(foldBtn);
  }

  // 2. CALL / CHECK（中央または左）
  if (valid.includes('call')) {
    const callBtn = document.createElement('button');
    callBtn.className = 'mob-btn mob-call';
    callBtn.innerHTML = `<span class="mbl-act">CALL</span><span class="mbl-amt">${bb(adapter.currentBet, BB)} BB</span>`;
    callBtn.onclick = () => humanAction('call');
    btns.appendChild(callBtn);
  } else if (valid.includes('check')) {
    const checkBtn = document.createElement('button');
    checkBtn.className = 'mob-btn mob-check';
    checkBtn.innerHTML = '<span class="mbl-act">CHECK</span>';
    checkBtn.onclick = () => humanAction('check');
    btns.appendChild(checkBtn);
  }

  // 3. RAISE / BET / COMPLETE（右）
  if (hasComplete && !hasRaise) {
    // Stud: Complete ボタン
    const compBtn = document.createElement('button');
    const compAmt = gameConfig.smallBet;
    compBtn.className = 'mob-btn mob-raise';
    compBtn.innerHTML = `<span class="mbl-act">COMPLETE</span><span class="mbl-amt">${bb(compAmt, BB)} BB</span>`;
    compBtn.onclick = () => humanAction('complete', 0);
    btns.appendChild(compBtn);
  } else if (hasRaise) {
    const raiseBtn = document.createElement('button');
    if (gameConfig.bettingStructure === 'fixed-limit') {
      const betAmt = _getStudFixedBetSize();
      const mDisplayAmt = toCall > 0 ? adapter.currentBet + betAmt : betAmt;
      const flLabel = (toCall > 0 || adapter.currentBet > 0) ? 'RAISE' : 'BET';
      raiseBtn.className = 'mob-btn mob-raise';
      raiseBtn.innerHTML = `<span class="mbl-act">${flLabel}</span><span class="mbl-amt">${bb(mDisplayAmt, BB)} BB</span>`;
      raiseBtn.onclick = () => humanAction(raiseAct, betAmt);
    } else {
      const isAllIn = mobileRaiseAmount >= maxTotal;
      const raiseLabel = toCall > 0 ? 'RAISE' : (adapter.currentBet > 0 ? 'RAISE' : 'BET');
      if (isAllIn) {
        raiseBtn.className = 'mob-btn mob-allin';
        raiseBtn.innerHTML = `<span class="mbl-act">ALL IN</span><span class="mbl-amt">${bb(p.chips, BB)} BB</span>`;
        raiseBtn.onclick   = () => humanAction('all_in');
      } else {
        raiseBtn.className = 'mob-btn mob-raise';
        raiseBtn.innerHTML = `<span class="mbl-act">${raiseLabel}</span><span class="mbl-amt">${bb(mobileRaiseAmount, BB)} BB</span>`;
        const amount = toCall > 0 ? mobileRaiseAmount - adapter.currentBet : mobileRaiseAmount;
        raiseBtn.onclick = () => humanAction(raiseAct, amount);
      }
    }
    btns.appendChild(raiseBtn);
  }

  wrap.appendChild(btns);
  el.appendChild(wrap);
}

// ショーダウン時のカードリビール演出を設定する（renderAll() 前に呼ぶ）
function _applyShowdownReveal() {
  if (adapter.state === 'COMPLETE' &&
      adapter.lastWinners.length > 0 &&
      adapter.lastWinners[0].handResult != null &&
      !_showdownDelayActive) {
    _showdownReveal     = true;
    _showdownDelayActive = true;
  }
}

// ------- 人間アクション -------
function humanAction(act, amount = 0) {
  const callTotal = adapter.currentBet;
  const chipsBefore = adapter.players[0].chips;
  try { adapter.performAction(0, act, amount); } catch(e) { console.error(e); return; }

  const info = ACTION_LABELS[act];
  if (info) {
    let label = info.label;
    if (act === 'call')                               label += `  ${bb(callTotal, BB)} BB`;
    if (act === 'bet' || act === 'raise')              label += `  ${bb(adapter.currentBet, BB)} BB`;
    if (act === 'complete')                            label += `  ${bb(adapter.currentBet, BB)} BB`;
    if (act === 'all_in')                              label += `  ${bb(chipsBefore, BB)} BB`;
    lastActions[0] = { ...info, label };
    lastActorId = 0; freshBubblePids.add(0);
    if (act === 'fold') foldBubbleState[0] = adapter.state;
  }
  _applyShowdownReveal();
  renderAll();
  _showdownReveal = false;
  if (isRunout()) { scheduleRunout(); return; }
  if (_showdownDelayActive) {
    setTimeout(() => { _showdownDelayActive = false; renderAll(); }, 2000);
    return;
  }
  if (adapter.state !== 'COMPLETE' && adapter.state !== 'SHOWDOWN') {
    if (act === 'fold') {
      // フォールド後は全 stale タイマーを無効化して即座に高速終了
      _fastFinishing = true;
      setTimeout(finishHandFast, 400);
      return;
    }
    // Stud: ストリートディール中はcpuTurnをスケジュールしない（_startStudStreetDealが処理）
    if (_studStreetDealing) return;
    if (adapter.currentPlayerIndex !== 0) setTimeout(cpuTurn, 1100);
  }
}

// ------- 人間フォールド後の高速ハンド終了（同期処理） -------
function finishHandFast() {
  _fastFinishing = false;
  _discardingPids.clear();
  _inDrawExecution = false;

  let safety = 300;
  while (safety-- > 0) {
    const st   = adapter.state;
    const cpix = adapter.currentPlayerIndex;
    if (st === 'COMPLETE' || st === 'SHOWDOWN') break;

    if (gameConfig.hasDrawPhase && st.startsWith('DRAW_')) {
      // 未宣言プレイヤーを全員同期宣言
      for (const q of adapter.players) {
        if (!q.folded && !q.hasDeclared) {
          const idx = cpuDrawFn ? cpuDrawFn(adapter) : [];
          try { adapter.declareDrawOnly(q.id, idx); } catch(e) { /* skip */ }
        }
      }
      // 全員宣言済みになったらドロー実行
      if (adapter.allDeclared) {
        const n  = adapter.players.length;
        const si = adapter.currentPlayerIndex >= 0 ? adapter.currentPlayerIndex : 0;
        for (let i = 0; i < n; i++) {
          const q = adapter.players[(si + i) % n];
          if (!q.folded && !q.hasDrawn) {
            try { adapter.confirmDraw(q.id); } catch(e) { /* skip */ }
          }
        }
      }
    } else {
      const curr = adapter.getCurrentPlayer();
      if (!curr || curr.id === 0) break;
      try {
        const { action, amount } = cpuDecideFn(adapter);
        adapter.performAction(curr.id, action, amount);
      } catch(e) {
        const valid = adapter.getValidActions(curr);
        const fb2 = valid.includes('check') ? 'check' : valid.includes('call') ? 'call' : 'fold';
        try { adapter.performAction(curr.id, fb2, 0); }
        catch(e2) { break; }
      }
    }
    // 進行なし → 無限ループ防止（state と currentPlayerIndex の両方が変化しなければ停止）
    if (adapter.state === st && adapter.currentPlayerIndex === cpix) break;
  }

  // フォールバック: ループが途中終了した場合は通常の CPU チェーンへ引き継ぐ
  if (adapter.state !== 'COMPLETE' && adapter.state !== 'SHOWDOWN') {
    renderAll();
    if (adapter.currentPlayerIndex !== 0) setTimeout(cpuTurn, 350);
    return;
  }

  // アクションバブルなしでリザルト表示
  lastActions = {};
  lastActorId  = -1;
  _applyShowdownReveal();
  renderAll();
  _showdownReveal = false;
  if (_showdownDelayActive) {
    setTimeout(() => { _showdownDelayActive = false; renderAll(); }, 1500);
  }
}

function fastForwardHand() {
  if (adapter.state === 'COMPLETE' || adapter.state === 'SHOWDOWN') { startNewHand(); return; }
  // finishHandFast で残局を同期的に一括処理（揺らぎ防止）
  _fastFinishing = true;
  finishHandFast();
}

// ------- CPU ベッティングターン -------
function cpuTurn() {
  if (_fastFinishing) return;
  // Stud: ストリートディール演出中はCPUターンをブロック
  if (_studStreetDealing) return;
  if (adapter.state === 'COMPLETE' || adapter.state === 'SHOWDOWN') { renderAll(); return; }
  if (gameConfig.hasDrawPhase && adapter.state.startsWith('DRAW_')) { cpuDeclareTurn(); return; }

  const p = adapter.getCurrentPlayer();
  if (!p || p.id === 0) { renderAll(); return; }

  renderActions();

  const callTotal = adapter.currentBet;
  const cpuChipsBefore = p.chips;
  const { action, amount } = cpuDecideFn(adapter);

  try {
    adapter.performAction(p.id, action, amount);
  } catch(e) {
    try {
      const valid = adapter.getValidActions(p);
      const fb = valid.includes('check') ? 'check' : valid.includes('call') ? 'call' : 'fold';
      adapter.performAction(p.id, fb, 0);
    } catch(e2) {
      console.error('[CPU fallback failed]', e2);
      renderAll();
      // チェーン継続（スタック防止）
      if (adapter.state !== 'COMPLETE' && adapter.state !== 'SHOWDOWN') {
        if (adapter.currentPlayerIndex !== 0) setTimeout(cpuTurn, 500);
      }
      return;
    }
  }

  const info = ACTION_LABELS[action];
  if (info) {
    let label = info.label;
    if (action === 'call')                                  label += `  ${bb(callTotal, BB)} BB`;
    if (action === 'bet' || action === 'raise')             label += `  ${bb(adapter.currentBet, BB)} BB`;
    if (action === 'complete')                              label += `  ${bb(adapter.currentBet, BB)} BB`;
    if (action === 'all_in')                                label += `  ${bb(cpuChipsBefore, BB)} BB`;
    lastActions[p.id] = { ...info, label };
    lastActorId = p.id; freshBubblePids.add(p.id);
    if (action === 'fold') foldBubbleState[p.id] = adapter.state;
  }
  _applyShowdownReveal();
  renderAll();
  _showdownReveal = false;
  if (isRunout()) { scheduleRunout(); return; }
  if (_showdownDelayActive) {
    setTimeout(() => { _showdownDelayActive = false; renderAll(); }, 2000);
    return;
  }
  if (adapter.state !== 'COMPLETE' && adapter.state !== 'SHOWDOWN') {
    // Stud: ストリートディール中はcpuTurnをスケジュールしない（_startStudStreetDealが処理）
    if (_studStreetDealing) return;
    const _d = adapter.players[0]?.folded ? 350 : 1300;
    if (adapter.currentPlayerIndex !== 0) setTimeout(cpuTurn, _d);
  }
}

// ------- CPU ドロー宣言ターン（全員宣言後に startDrawExecution を呼ぶ） -------
function cpuDeclareTurn() {
  if (_fastFinishing) return;
  if (!gameConfig.hasDrawPhase || !adapter.state.startsWith('DRAW_') || _inDrawExecution) return;
  const p = adapter.getCurrentPlayer();
  if (!p || p.id === 0 || p.folded) { renderAll(); return; }

  // ── Fast path: 人間がフォールド済みなら全 CPU 宣言をバッチ同期処理 ──
  if (adapter.players[0]?.folded) {
    let curr = p;
    while (curr && curr.id !== 0 && !curr.folded && !curr.hasDeclared) {
      const idxFast = cpuDrawFn ? cpuDrawFn(adapter) : [];
      adapter.declareDrawOnly(curr.id, idxFast);
      if (adapter.allDeclared) break;
      curr = adapter.getCurrentPlayer();
      if (!curr || curr.id === 0 || curr.folded || curr.hasDeclared) break;
    }
    if (adapter.allDeclared) setTimeout(startDrawExecution, 150);
    return;
  }

  // CPU の宣言インデックスを計算・宣言
  const indices  = cpuDrawFn ? cpuDrawFn(adapter) : [];
  const drawCount = indices.length; // declareDrawOnly より前に確定
  adapter.declareDrawOnly(p.id, indices);

  // バブルデータをセット
  const drawInfo = ACTION_LABELS[`draw_${drawCount}`];
  if (drawInfo) { lastActions[p.id] = { ...drawInfo }; lastActorId = p.id; freshBubblePids.add(p.id); }

  // drawCount>0 の場合: renderPlayers() がシート再構築しないよう事前ブロック
  if (drawCount > 0) _discardingPids.add(p.id);

  renderAll(); // renderPlayers はブロック中でも renderActions は必ず実行される

  // renderPlayers がブロックされていても即時バブル表示（直接 DOM 注入）
  const _pid     = p.id;
  const _cpuSeat = document.querySelector(`#players .seat[data-pid="${_pid}"]`);
  if (_cpuSeat && drawInfo) {
    const _old = _cpuSeat.querySelector('.action-bubble');
    if (_old) _old.remove();
    const _bbl = document.createElement('div');
    _bbl.className   = `action-bubble ab-${drawInfo.type} ab-new`;
    _bbl.textContent = drawInfo.label;
    const _cr = _cpuSeat.querySelector('.cards-row');
    _cpuSeat.insertBefore(_bbl, _cr ? _cr.nextSibling : null);
  }

  // カードアニメーション（チェンジ枚数がある場合のみ 450ms 遅延で開始）
  if (drawCount > 0) setTimeout(() => _discardPlayerCards(_pid), 450);

  if (adapter.allDeclared) {
    setTimeout(startDrawExecution, 1300);
  } else {
    const nextP = adapter.getCurrentPlayer();
    if (nextP && nextP.id !== 0 && !nextP.folded) {
      setTimeout(cpuDeclareTurn, 700);
    }
    // else: human's turn → renderAll() の renderActions で Draw UI が表示される
  }
}

// ------- 個別捨て牌アニメーション（宣言直後に各プレイヤーの捨て牌を即座にフェードアウト・削除）-------
function _discardPlayerCards(pid) {
  const seatEl = document.querySelector(`.seat[data-pid="${pid}"]`);
  if (!seatEl) return;
  const indices = new Set(adapter.players[pid].selectedForDraw || []);
  if (indices.size === 0) return; // スタンドパットはアニメなし

  _discardingPids.add(pid);

  // 即座に左寄せ開始（捨て牌フェード中もカードが中央寄りにならないよう）
  seatEl.classList.add('seat-discarding');

  // フェーズA: 捨て牌をフェードアウト
  const cardEls = seatEl.querySelectorAll('.cards-row .card.hole');
  indices.forEach(idx => {
    if (cardEls[idx]) cardEls[idx].classList.add('card-discard');
  });

  // フェーズB: 380ms後に捨て牌を DOM 削除 + FLIP スライド
  setTimeout(() => {
    const cardsRow = seatEl.querySelector('.cards-row');
    if (!cardsRow) { _discardingPids.delete(pid); return; }

    const allCards = Array.from(cardsRow.querySelectorAll('.card.hole'));
    const keptEls  = allCards.filter((_, i) => !indices.has(i));

    // FLIP: 削除前の位置を記録（seat-discarding 適用済みの左寄せ座標）
    const beforeX = keptEls.map(el => el.getBoundingClientRect().left);

    // 捨て牌を削除（降順）
    Array.from(indices).sort((a, b) => b - a).forEach(idx => {
      if (allCards[idx]) allCards[idx].remove();
    });

    // FLIP Play: 差分トランスフォームで残し牌をスライドイン
    keptEls.forEach((el, i) => {
      if (!el.isConnected) return;
      const deltaX = beforeX[i] - el.getBoundingClientRect().left;
      if (Math.abs(deltaX) > 0.5) {
        el.style.transition = 'none';
        el.style.transform  = `translateX(${deltaX}px)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.style.transition = 'transform 0.22s ease';
          el.style.transform  = '';
        }));
      }
    });

    // スライド完了後にフラグ解除
    setTimeout(() => {
      _discardingPids.delete(pid);
      // 全員の捨て牌アニメーションが終わり、人間のドロー宣言待ちになっていたら
      // renderPlayers() を再実行してクリックハンドラーを設定する
      if (adapter && gameConfig?.hasDrawPhase &&
          adapter.state.startsWith('DRAW_') &&
          adapter.currentPlayerIndex === 0 &&
          !adapter.players[0]?.hasDeclared &&
          _discardingPids.size === 0) {
        renderAll();
      }
    }, 300);
  }, 380);
}

// ------- ドロー実行フェーズ（全員宣言後にカードを順番に交換・アニメ） -------
function startDrawExecution() {
  if (_fastFinishing) return;
  // 前フェーズの捨て牌アニメーション残骸をクリア（fast-fold 後の競合防止）
  _discardingPids.clear();
  _inDrawExecution = true;

  const humanFolded = adapter.players[0]?.folded;

  // ── 事前計算（confirmDraw が状態を変える前に確定）──
  const n = adapter.players.length;
  const startIdx = adapter.currentPlayerIndex;
  const execOrder = [];
  const drawCounts = {};
  for (let i = 0; i < n; i++) {
    const p = adapter.players[(startIdx + i) % n];
    if (!p.folded && !p.hasDrawn) {
      execOrder.push(p.id);
      drawCounts[p.id] = p.drawCount;
    }
  }

  // ── フェーズ3: 全プレイヤーのドローをゲームロジックで一括実行 ──
  for (const pid of execOrder) adapter.confirmDraw(pid);
  // この時点でゲームは BETTING_X 状態に遷移済み

  renderActions();
  renderPotInfo();

  // ── Fast path: 人間フォールド後はアニメなし、即再描画してベッティングへ ──
  if (humanFolded) {
    _inDrawExecution = false;
    renderAll();
    if (adapter.state !== 'COMPLETE' && adapter.state !== 'SHOWDOWN') {
      if (adapter.currentPlayerIndex !== 0) setTimeout(cpuTurn, 350);
    }
    return;
  }

  // DOM スナップショット（アニメーション用）
  const seatElsMap = {};
  document.querySelectorAll('#players .seat[data-pid]').forEach(el => {
    seatElsMap[Number(el.dataset.pid)] = el;
  });

  // ── フェーズ4: 順番に新カードをアニメーション ──
  let delay = 200;
  for (const pid of execOrder) {
    const dc = drawCounts[pid];
    if (dc === 0) continue;
    setTimeout(() => _animateNewCardsForPlayer(pid, dc, seatElsMap[pid]), delay);
    delay += Math.max(900, dc * 350 + 350);
  }

  // ── フェーズ5: 全完了後に全体再描画してベッティングへ ──
  setTimeout(() => {
    _inDrawExecution = false;
    renderAll();
    if (adapter.state !== 'COMPLETE' && adapter.state !== 'SHOWDOWN') {
      if (adapter.currentPlayerIndex !== 0) setTimeout(cpuTurn, 800);
    }
  }, delay + 400);
}

// 指定プレイヤーの新しいカードを DOM に直接追加してアニメーション
function _animateNewCardsForPlayer(pid, drawCount, seatEl) {
  if (!seatEl || drawCount === 0) return;
  const cardsRow = seatEl.querySelector('.cards-row');
  if (!cardsRow) return;

  const isHuman  = pid === 0;
  const isSD     = adapter.state === 'SHOWDOWN' || adapter.state === 'COMPLETE';
  const showFaceUp = isHuman || isSD;
  const player   = adapter.players[pid];
  const keptCount = player.hand.length - drawCount;

  for (let i = 0; i < drawCount; i++) {
    let cardEl;
    if (showFaceUp) {
      const tmp = document.createElement('div');
      tmp.innerHTML = cardHtml(player.hand[keptCount + i], 'hole');
      cardEl = tmp.firstElementChild;
    } else {
      cardEl = document.createElement('span');
      cardEl.className = 'card hole bk';
    }
    // 1枚目はゆっくり(.55s)、以降は標準(.35s) + オフセット遅延
    const dur   = i === 0 ? '.55s' : '.35s';
    const delay = i === 0 ? 0 : (i * 0.32 + 0.18);
    cardEl.style.cssText += `;animation-duration:${dur};animation-delay:${delay}s`;
    cardEl.classList.add('card-new');
    cardsRow.appendChild(cardEl);
  }
}

// ------- オールインランアウト（NLH専用） -------
function isRunout() {
  if (!adapter) return false;
  if (!gameConfig.hasCommunityCards) return false;
  if (adapter.state === 'SHOWDOWN' || adapter.state === 'COMPLETE' || adapter.state === 'WAITING') return false;
  return adapter.currentPlayerIndex === -1 && adapter.activeInHandPlayers.length > 1;
}

function scheduleRunout() {
  if (!isRunout()) return;
  const delay = adapter.state === 'FLOP' ? 1400 : 950;
  setTimeout(() => {
    if (!adapter || adapter.state === 'SHOWDOWN' || adapter.state === 'COMPLETE') return;
    adapter.advanceStreet();
    renderAll();
    scheduleRunout();
  }, delay);
}

// ------- ログ描画 -------
function renderLog() {
  const el = document.getElementById('action-log');
  el.innerHTML = adapter.actionLog.slice(-3).map(m => `<div class="log-entry">${esc(m)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

// ------- タイトルに戻る -------
function backToTitle() {
  document.getElementById('game-screen').classList.add('hidden');
  adapter = null; lastActions = {}; lastActorId = -1; prevStreet = null;
  onBackToTitle();
}

