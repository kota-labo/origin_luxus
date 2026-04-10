// Luxus Poker Platform — メインエントリーポイント
// ゲーム選択 → 動的インポート → シングルプレイヤーモード起動

import { patchState, getState } from './src/state/store.js';
import { toggleThemeMenu, setTheme, setCardTheme, setBgTheme } from './src/ui/ui.js';

// ゲームレジストリ（動的インポートで遅延ロード）
const GAME_REGISTRY = {
  nlh: {
    label:  "No-Limit Hold'em",
    icon:   '♠',
    type:   'No-Limit',
    module: () => import('./src/games/nlh/logic.js'),
    cpu:    () => import('./src/games/nlh/cpu.js'),
    config: () => import('./src/games/nlh/config.js'),
  },
  '27td': {
    label:  '2-7 Triple Draw',
    icon:   '✦',
    type:   'Fix Limit / Draw',
    module: () => import('./src/games/27td/logic.js'),
    cpu:    () => import('./src/games/27td/cpu.js'),
    config: () => import('./src/games/27td/config.js'),
  },
  badugi: {
    label:  'Badugi',
    icon:   '◆',
    type:   'Fix Limit / Draw',
    module: () => import('./src/games/badugi/logic.js'),
    cpu:    () => import('./src/games/badugi/cpu.js'),
    config: () => import('./src/games/badugi/config.js'),
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
  // 退席ボタン（ゲーム中に window._uiBackToTitle がセットされる）
  document.querySelector('.quit-hdr-btn')
    ?.addEventListener('click', () => window._uiBackToTitle?.());

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
