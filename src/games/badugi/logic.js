// Badugi ゲームロジック
// DrawGame 基底クラスを継承し、ハンド評価のみ実装する。

import { DrawGame } from '../shared/drawGame.js';
import { evaluateBadugi, determineWinnersBadugi } from './evaluator.js';

export class BadugiGame extends DrawGame {
  evaluateHand(cards) {
    return evaluateBadugi(cards);
  }

  determineWinners(players) {
    return determineWinnersBadugi(players);
  }
}
