// Luxus Poker Platform — メインエントリーポイント
// ゲーム選択 → 動的インポート → シングルプレイヤーモード起動

import { patchState, getState } from './src/state/store.js';
import { toggleThemeMenu, setTheme, setCardTheme, setBgTheme } from './src/ui/ui.js';

// Luxus ブランドアイコン — 未来的×ミニマル×高級感
// 統一仕様: 28x28 viewBox, stroke:currentColor, stroke-width:1.2, fill:none
// 細線・幾何学・対称性でブランドトーンを統一
const GAME_ICONS = {
  // NLH: ダイヤモンド枠内にスペードシルエット (=ノーリミットの鋭さ×無限性)
  nlh: `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 5 L22 14 L14 23 L6 14 Z" opacity=".35"/>
      <path d="M14 9 C14 9 10 12.5 10 15.2 C10 17 11.4 18.2 13 18 C13.4 18 13.7 17.8 14 17.5 C14.3 17.8 14.6 18 15 18 C16.6 18.2 18 17 18 15.2 C18 12.5 14 9 14 9 Z"/>
      <path d="M14 17.5 L14 20"/>
    </svg>`,

  // 2-7 Triple Draw: 3本の下降ライン (=Lowball×Triple Draw の反復変化)
  '27td': `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 9 L22 9" opacity=".85"/>
      <path d="M6 14 L22 14" opacity=".55"/>
      <path d="M6 19 L22 19" opacity=".3"/>
      <circle cx="6" cy="9" r="1.2" fill="currentColor" stroke="none"/>
      <circle cx="22" cy="19" r="1.2" fill="currentColor" stroke="none"/>
    </svg>`,

  // Badugi: 4つの菱形 (=4スート・レインボー構造)
  badugi: `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 4 L17 7 L14 10 L11 7 Z"/>
      <path d="M7 11 L10 14 L7 17 L4 14 Z" opacity=".7"/>
      <path d="M21 11 L24 14 L21 17 L18 14 Z" opacity=".7"/>
      <path d="M14 18 L17 21 L14 24 L11 21 Z" opacity=".4"/>
    </svg>`,

  // Stud: 7本の縦ライン (=7枚勝負)
  stud: `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
      <path d="M5 8 L5 20"/>
      <path d="M8 8 L8 20" opacity=".85"/>
      <path d="M11 8 L11 20" opacity=".7"/>
      <path d="M14 8 L14 20" opacity=".9"/>
      <path d="M17 8 L17 20" opacity=".7"/>
      <path d="M20 8 L20 20" opacity=".85"/>
      <path d="M23 8 L23 20"/>
    </svg>`,

  // Razz: 逆三角形 (=A-5 Low / 降順の最強)
  razz: `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 7 L23 7 L14 22 Z"/>
      <path d="M9 11 L19 11" opacity=".55"/>
      <path d="M11.5 15 L16.5 15" opacity=".35"/>
    </svg>`,
};

// ゲームレジストリ（動的インポートで遅延ロード）
const GAME_REGISTRY = {
  nlh: {
    label:  "No-Limit Hold'em",
    icon:   GAME_ICONS.nlh,
    type:   'No-Limit',
    module: () => import('./src/games/nlh/logic.js'),
    cpu:    () => import('./src/games/nlh/cpu.js'),
    config: () => import('./src/games/nlh/config.js'),
  },
  '27td': {
    label:  '2-7 Triple Draw',
    icon:   GAME_ICONS['27td'],
    type:   'Fix Limit / Draw',
    module: () => import('./src/games/27td/logic.js'),
    cpu:    () => import('./src/games/27td/cpu.js'),
    config: () => import('./src/games/27td/config.js'),
  },
  badugi: {
    label:  'Badugi',
    icon:   GAME_ICONS.badugi,
    type:   'Fix Limit / Draw',
    module: () => import('./src/games/badugi/logic.js'),
    cpu:    () => import('./src/games/badugi/cpu.js'),
    config: () => import('./src/games/badugi/config.js'),
  },
  stud: {
    label:  'Seven Card Stud',
    icon:   GAME_ICONS.stud,
    type:   'Fix Limit / Stud',
    module: () => import('./src/games/stud/logic.js'),
    cpu:    () => import('./src/games/stud/cpu.js'),
    config: () => import('./src/games/stud/config.js'),
  },
  razz: {
    label:  'Razz',
    icon:   GAME_ICONS.razz,
    type:   'Fix Limit / Stud',
    module: () => import('./src/games/razz/logic.js'),
    cpu:    () => import('./src/games/razz/cpu.js'),
    config: () => import('./src/games/razz/config.js'),
  },
};

// ------- ダブルタップズーム防止（iOS 10+ は viewport meta を無視するため JS でも抑制）-------
let _lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - _lastTouchEnd < 300) e.preventDefault();
  _lastTouchEnd = now;
}, { passive: false });

// ------- DOMContentLoaded -------
document.addEventListener('DOMContentLoaded', () => {
  buildGameSelector();
  wirePlayerCountButtons();
  document.getElementById('start-btn').addEventListener('click', launchGame);
  wireHeaderButtons();
});

// ゲーム選択タイルを動的生成
function buildGameSelector() {
  const container = document.getElementById('game-select');
  for (const [gameId, info] of Object.entries(GAME_REGISTRY)) {
    const card = document.createElement('button');
    card.className = 'game-card' + (gameId === getState().selectedGame ? ' selected' : '');
    card.dataset.game = gameId;
    card.innerHTML = `
      <span class="game-card-icon">${info.icon}</span>
      <span class="game-card-label">${info.label}</span>
      <span class="game-type-badge">${info.type}</span>
    `;
    card.addEventListener('click', () => {
      document.querySelectorAll('.game-card').forEach(b => b.classList.remove('selected'));
      card.classList.add('selected');
      patchState({ selectedGame: gameId });
    });
    container.appendChild(card);
  }
}

// プレイヤー数ボタンのイベント登録
function wirePlayerCountButtons() {
  document.querySelectorAll('.player-num').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.player-num').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      patchState({ selectedPlayerCount: parseInt(btn.dataset.val) });
    });
  });
}

// ヘッダー・テーマボタンのイベント登録（inline onclick の代替）
function wireHeaderButtons() {
  // 退席ボタン: initUI 内で backToTitle() が直接バインドされる

  // テーマメニュー開閉
  document.querySelector('.theme-btn')
    ?.addEventListener('click', toggleThemeMenu);

  // テーブルテーマ選択
  document.querySelectorAll('.theme-opt').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });

  // 背景デザイン選択
  document.querySelectorAll('.bg-opt').forEach(btn => {
    btn.addEventListener('click', () => setBgTheme(btn.dataset.bg));
  });

  // カードデザイン選択
  document.querySelectorAll('.card-theme-btn').forEach(btn => {
    btn.addEventListener('click', () => setCardTheme(btn.dataset.card));
  });
}

// ゲーム起動
async function launchGame() {
  const { selectedGame, selectedPlayerCount } = getState();
  const reg = GAME_REGISTRY[selectedGame];
  if (!reg) return;

  // 動的インポート
  const [gameModule, cpuModule, configModule] = await Promise.all([
    reg.module(), reg.cpu(), reg.config(),
  ]);
  const { default: config } = configModule;

  // ゲームクラスを特定（各モジュールが named export でクラスを export）
  const LogicClass = gameModule.NLHGame
    || gameModule.TDGame
    || gameModule.BadugiGame
    || gameModule.StudGame
    || gameModule.RazzGame
    || Object.values(gameModule).find(v => typeof v === 'function');

  const decideCpuAction = cpuModule.decideCpuAction;
  const decideCpuDraw   = cpuModule.decideCpuDraw || null;

  const names       = ['You','Alice','Bob','Carol','Dave','Eve'].slice(0, selectedPlayerCount);
  const gameAdapter = new LogicClass(names, config);

  // 画面切り替え
  document.getElementById('title-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');

  // シングルプレイヤーモード起動
  const { startSingleplayer } = await import('./src/modes/singleplayer.js');
  startSingleplayer(gameAdapter, config, decideCpuAction, decideCpuDraw, () => {
    // タイトルに戻る
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('title-screen').classList.remove('hidden');
  });
}
