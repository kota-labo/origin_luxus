// シングルプレイヤーモード
// CPU対戦を起動するラッパー。タイミング制御はui.js内で行う。
// 将来のマルチプレイヤーモード追加を見据えた分離点。

import { initUI } from '../ui/ui.js';

/**
 * シングルプレイヤーモードを起動する
 * @param {object} gameAdapter    - GameAdapter準拠のゲームインスタンス
 * @param {object} config         - ゲーム設定オブジェクト
 * @param {Function} decideCpuAction - CPU判断関数 (adapter) → { action, amount }
 * @param {Function} [decideCpuDraw] - CPUドロー判断関数 (adapter) → number[] （ドローゲーム用）
 * @param {Function} onBackToTitle   - タイトルに戻るコールバック
 */
export function startSingleplayer(gameAdapter, config, decideCpuAction, decideCpuDraw, onBackToTitle) {
  initUI(gameAdapter, config, decideCpuAction, {
    decideCpuDraw,
    onBackToTitle,
  });
}
