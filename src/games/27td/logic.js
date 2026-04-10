// 2-7 Triple Draw ゲームロジック
// DrawGame 基底クラスを継承し、ハンド評価のみ実装する。

import { DrawGame } from '../shared/drawGame.js';
import { evaluate27td, determineWinners27td } from './evaluator.js';

export class TDGame extends DrawGame {
  evaluateHand(cards) {
    return evaluate27td(cards);
  }

  determineWinners(players) {
    return determineWinners27td(players);
  }
}
