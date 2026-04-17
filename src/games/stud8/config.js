// Seven Card Stud Hi/Lo 8-or-Better — 設定
// 進行・アクション・ベット構造は Stud-Hi と完全同一
// 差分は Hi/Lo 評価とポット分割のみ
export default {
  gameId:             'stud8',
  displayName:        'Stud 8',
  icon:               '8',
  hasCommunityCards:  false,
  hasDrawPhase:       false,
  isStudGame:         true,
  hasLowHand:         true,        // ← Stud 8 識別フラグ (UI分岐用)
  variant:            'hi-lo-8',
  numHoleCards:       7,
  maxPlayers:         6,
  minPlayers:         2,
  startingBBs:        100,
  bigBlind:           10,
  smallBlind:         5,
  hasBlinds:          false,
  bettingStructure:   'fixed-limit',
  ante:               2.5,       // 0.25BB — 全員から徴収
  bringIn:            2.5,       // 0.25BB
  smallBet:           10,
  bigBet:             20,
  maxRaisesPerRound:  5,
};
