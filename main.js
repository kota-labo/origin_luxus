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

  // FLH (Limit Hold'em): ♥ 上 + ♣ 下 の縦並びペアクレスト
  //   モチーフ: 2スートが縦に積まれた1つの紋章シルエット
  //   意味:
  //     - 上 (♥ ハート) = プレイヤーの直感・Hold'em の感情的側面
  //     - 下 (♣ クラブ) = 構造・秩序・Limit の固定ベット規律
  //     - 縦並びペア = NLH の「単独スペード (無限)」に対する「対の構造」=
  //       Fixed Limit の二段階ベット (small bet / big bet) を象徴
  flh: `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 12 C14 12 8 8.5 8 5.5 C8 4.3 9 3.5 10.2 3.5 C11.3 3.5 12.5 4.2 14 6 C15.5 4.2 16.7 3.5 17.8 3.5 C19 3.5 20 4.3 20 5.5 C20 8.5 14 12 14 12 Z"/>
      <circle cx="14" cy="17.5" r="2.1"/>
      <circle cx="11.3" cy="20.5" r="2.1"/>
      <circle cx="16.7" cy="20.5" r="2.1"/>
      <path d="M14 22.5 L14 25"/>
    </svg>`,

  // PLO (Pot Limit Omaha): 2×2 菱形 (= Omaha 4枚ホール, FLO8 踏襲) + 下部の同心円 (= Pot Limit)
  //   モチーフ: 上半部に 2×2 で並んだ菱形がホールカードを、
  //           下半部に同心円 (外縁 + 内点) が "ポット=ベット上限" を表現
  //   意味:
  //     - 2×2 菱形 = Omaha 4枚ホール (2枚ずつ使う制約を 2列×2段 で暗示、FLO8 と共通言語)
  //     - 下部 同心円 = ポットの「縁=上限」と「中心=現在高」を示唆 (Pot Limit の核)
  //     - FLO8 のコインスタック (8形) → PLO は単一のコイン (pot) に置換: 姉妹関係を保ちつつ差異化
  plo: `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 4 L12 6 L10 8 L8 6 Z"/>
      <path d="M18 4 L20 6 L18 8 L16 6 Z"/>
      <path d="M10 10 L12 12 L10 14 L8 12 Z" opacity=".8"/>
      <path d="M18 10 L20 12 L18 14 L16 12 Z" opacity=".8"/>
      <circle cx="14" cy="21" r="4"/>
      <circle cx="14" cy="21" r="1.5" fill="currentColor" stroke="none" opacity=".7"/>
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

  // 2-7 Single Draw: 中央 1 本のみプロミネント (=Single Draw の "1回ドロー")
  //   27TD との対比で、3 本のうち中央 1 本だけが強く、他は輪郭として残る
  '27sd': `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 9 L22 9" opacity=".22"/>
      <path d="M6 14 L22 14"/>
      <path d="M6 19 L22 19" opacity=".22"/>
      <circle cx="6"  cy="14" r="1.4" fill="currentColor" stroke="none"/>
      <circle cx="22" cy="14" r="1.4" fill="currentColor" stroke="none"/>
    </svg>`,

  // Badugi: 4つの菱形 (=4スート・レインボー構造)
  badugi: `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 4 L17 7 L14 10 L11 7 Z"/>
      <path d="M7 11 L10 14 L7 17 L4 14 Z" opacity=".7"/>
      <path d="M21 11 L24 14 L21 17 L18 14 Z" opacity=".7"/>
      <path d="M14 18 L17 21 L14 24 L11 21 Z" opacity=".4"/>
    </svg>`,

  // Stud (Seven Card Stud): 7つの菱形ローゼッタ (中央 + 周囲6つ)
  //   モチーフ: 六角対称に配置された 7 つの菱形による "花" 状クラスタ
  //   意味:
  //     - 7 菱形 = Seven Card Stud の "7 枚" を直接的に象徴
  //     - 菱形 = Luxu's ブランドの sparkle (✦) モチーフを継承した輝きの幾何
  //     - ローゼッタ配置 = 単独の菱形ではなく "7つで1つの紋章" = まとまったシンボル
  //     - 中央の強勢 = ベーシック Stud の "主幹" 的位置付け
  stud: `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 12 L16 14 L14 16 L12 14 Z"/>
      <path d="M14 4 L16 6 L14 8 L12 6 Z" opacity=".8"/>
      <path d="M20 8 L22 10 L20 12 L18 10 Z" opacity=".8"/>
      <path d="M20 16 L22 18 L20 20 L18 18 Z" opacity=".55"/>
      <path d="M14 20 L16 22 L14 24 L12 22 Z" opacity=".55"/>
      <path d="M8 16 L10 18 L8 20 L6 18 Z" opacity=".55"/>
      <path d="M8 8 L10 10 L8 12 L6 10 Z" opacity=".8"/>
    </svg>`,

  // Razz: 逆三角形 (=A-5 Low / 降順の最強)
  razz: `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 7 L23 7 L14 22 Z"/>
      <path d="M9 11 L19 11" opacity=".55"/>
      <path d="M11.5 15 L16.5 15" opacity=".35"/>
    </svg>`,

  // Stud 8 (Hi/Lo 8-or-Better): 菱形 4+4 上下対称 + 中央 Hi/Lo 分割
  //   モチーフ: 8つの菱形が上下各4つに分かれ、中央の細い水平線で二分される
  //   意味:
  //     - 8 菱形 = "Eight-or-Better" のゲーム名の数字 "8"
  //     - 上4菱形 = Hi サイド (通常のポーカーハンド勝者群)
  //     - 下4菱形 = Lo サイド (8以下の低ハンド勝者群、わずかにフェードで表現)
  //     - 中央水平線 = Hi/Lo ポット 50-50 分割ライン
  //     - 上下対称 = スプリットゲームの "公正な二分構造"
  stud8: `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6.5 6 L8 7.5 L6.5 9 L5 7.5 Z"/>
      <path d="M11.5 6 L13 7.5 L11.5 9 L10 7.5 Z"/>
      <path d="M16.5 6 L18 7.5 L16.5 9 L15 7.5 Z"/>
      <path d="M21.5 6 L23 7.5 L21.5 9 L20 7.5 Z"/>
      <path d="M4 14 L24 14" opacity=".55"/>
      <path d="M6.5 19 L8 20.5 L6.5 22 L5 20.5 Z" opacity=".6"/>
      <path d="M11.5 19 L13 20.5 L11.5 22 L10 20.5 Z" opacity=".6"/>
      <path d="M16.5 19 L18 20.5 L16.5 22 L15 20.5 Z" opacity=".6"/>
      <path d="M21.5 19 L23 20.5 L21.5 22 L20 20.5 Z" opacity=".6"/>
    </svg>`,

  // FLO8 (Omaha Hi/Lo 8-or-Better): 2×2 菱形クラスタ + 下部 Figure-8
  //   モチーフ: 上半分にホールカードを表す 2×2 菱形 / 下半分に数字 "8" の形 (Hi/Lo + qualifier)
  //   意味:
  //     - 上部 2×2 菱形 = Omaha の 4枚ホールカード (必ず 2枚使う制約を "2列×2段" で示唆)
  //     - 下部 Figure-8 (縦積み 2 円) = 3 つの意味を同時に表現:
  //         1. 数字 "8" = Eight-or-Better の Lo 適格制約
  //         2. 上ループ = Hi サイド (濃色)
  //         3. 下ループ = Lo サイド (淡色)
  //       → 1つのシンボル内に "8-or-Better + Hi/Lo 分割" が内包されている
  //     - Badugi の菱形モチーフと呼応しつつ、下部の "8" で FLO8 固有性を獲得
  flo8: `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 4 L12 6 L10 8 L8 6 Z"/>
      <path d="M18 4 L20 6 L18 8 L16 6 Z"/>
      <path d="M10 10 L12 12 L10 14 L8 12 Z" opacity=".8"/>
      <path d="M18 10 L20 12 L18 14 L16 12 Z" opacity=".8"/>
      <circle cx="14" cy="19.5" r="2"/>
      <circle cx="14" cy="23.5" r="2" opacity=".55"/>
    </svg>`,
};

// ゲームレジストリ（動的インポートで遅延ロード）
const GAME_REGISTRY = {
  nlh: {
    label:  "No Limit Hold'em",
    icon:   GAME_ICONS.nlh,
    type:   'No Limit / Flop',
    module: () => import('./src/games/nlh/logic.js'),
    cpu:    () => import('./src/games/nlh/cpu.js'),
    config: () => import('./src/games/nlh/config.js'),
  },
  flh: {
    label:  "Limit Hold'em",
    icon:   GAME_ICONS.flh,
    type:   'Fixed Limit / Flop',
    module: () => import('./src/games/flh/logic.js'),
    cpu:    () => import('./src/games/flh/cpu.js'),
    config: () => import('./src/games/flh/config.js'),
  },
  plo: {
    label:  'Pot Limit Omaha',
    icon:   GAME_ICONS.plo,
    type:   'Pot Limit / Flop',
    module: () => import('./src/games/plo/logic.js'),
    cpu:    () => import('./src/games/plo/cpu.js'),
    config: () => import('./src/games/plo/config.js'),
  },
  flo8: {
    label:  'FL Omaha Hi/Lo 8-or-Better',
    icon:   GAME_ICONS.flo8,
    type:   'Fixed Limit / Flop',
    module: () => import('./src/games/flo8/logic.js'),
    cpu:    () => import('./src/games/flo8/cpu.js'),
    config: () => import('./src/games/flo8/config.js'),
  },
  '27td': {
    label:  '2-7 Triple Draw',
    icon:   GAME_ICONS['27td'],
    type:   'Fixed Limit / Draw',
    module: () => import('./src/games/27td/logic.js'),
    cpu:    () => import('./src/games/27td/cpu.js'),
    config: () => import('./src/games/27td/config.js'),
  },
  '27sd': {
    label:  '2-7 Single Draw',
    icon:   GAME_ICONS['27sd'],
    type:   'No Limit / Draw',
    module: () => import('./src/games/27sd/logic.js'),
    cpu:    () => import('./src/games/27sd/cpu.js'),
    config: () => import('./src/games/27sd/config.js'),
  },
  badugi: {
    label:  'Badugi',
    icon:   GAME_ICONS.badugi,
    type:   'Fixed Limit / Draw',
    module: () => import('./src/games/badugi/logic.js'),
    cpu:    () => import('./src/games/badugi/cpu.js'),
    config: () => import('./src/games/badugi/config.js'),
  },
  stud: {
    label:  'Seven Card Stud',
    icon:   GAME_ICONS.stud,
    type:   'Fixed Limit / Stud',
    module: () => import('./src/games/stud/logic.js'),
    cpu:    () => import('./src/games/stud/cpu.js'),
    config: () => import('./src/games/stud/config.js'),
  },
  razz: {
    label:  'Razz',
    icon:   GAME_ICONS.razz,
    type:   'Fixed Limit / Stud',
    module: () => import('./src/games/razz/logic.js'),
    cpu:    () => import('./src/games/razz/cpu.js'),
    config: () => import('./src/games/razz/config.js'),
  },
  stud8: {
    label:  'Stud Hi/Lo 8-or-Better',
    icon:   GAME_ICONS.stud8,
    type:   'Fixed Limit / Stud',
    module: () => import('./src/games/stud8/logic.js'),
    cpu:    () => import('./src/games/stud8/cpu.js'),
    config: () => import('./src/games/stud8/config.js'),
  },
};

// ------- ダブルタップズーム防止（iOS 10+ は viewport meta を無視するため JS でも抑制）-------
let _lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - _lastTouchEnd < 300) e.preventDefault();
  _lastTouchEnd = now;
}, { passive: false });

// ------- ドラッグ選択・コピー抑止 (全要素) -------
//   CSS の user-select/webkit-user-drag に加え、dragstart/copy イベントも捕捉:
//   テキスト選択してからのドラッグコピー、カード画像のドラッグ等を抑止する
//   input/textarea は入力が必要なのでスキップ
document.addEventListener('dragstart', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  e.preventDefault();
}, { passive: false });
document.addEventListener('copy', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  e.preventDefault();
});
document.addEventListener('selectstart', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  // Shift+Click 等のテキスト範囲選択も抑止
  e.preventDefault();
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
    || gameModule.FLHGame
    || gameModule.PLOGame
    || gameModule.TDGame
    || gameModule.SDGame
    || gameModule.BadugiGame
    || gameModule.StudGame
    || gameModule.RazzGame
    || gameModule.Stud8Game
    || gameModule.FLO8Game
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
