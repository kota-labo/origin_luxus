// Fixed Limit Omaha Hi/Lo 8-or-Better (FLO8) — 設定
// 進行は NLH と同一 (PREFLOP/FLOP/TURN/RIVER/SHOWDOWN)
// 差分: 4枚ホール (Badugi UI を流用) + Fixed Limit + Hi/Lo 8-or-Better 分割
export default {
  gameId:             'flo8',
  displayName:        'FLO8',
  icon:               '♥',
  hasCommunityCards:  true,         // FLOP/TURN/RIVER あり (NLH UI 流用)
  hasDrawPhase:       false,
  hasLowHand:         true,         // ← Hi/Lo 識別フラグ (Stud 8 と同じ UI 分岐)
  variant:            'omaha-hi-lo-8',
  numHoleCards:       4,            // 4枚 (Badugi と同じ .cards-row レイアウト)
  maxPlayers:         6,
  minPlayers:         2,
  startingBBs:        100,
  bigBlind:           10,
  smallBlind:         5,
  hasBlinds:          true,         // NLH同様のブラインド制
  bettingStructure:   'fixed-limit',
  smallBet:           10,           // 1BB — PREFLOP, FLOP
  bigBet:             20,           // 2BB — TURN, RIVER
  maxRaisesPerRound:  5,
};
