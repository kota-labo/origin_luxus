// Fixed Limit Hold'em (FLH) — 設定
// 進行・アクション順は NLH と同一 (PREFLOP/FLOP/TURN/RIVER/SHOWDOWN)
// 差分: Fixed Limit ベッティング (smallBet/bigBet 固定、maxRaisesPerRound=5)
export default {
  gameId:             'flh',
  displayName:        "Limit Hold'em",
  icon:               '♠',
  hasCommunityCards:  true,         // FLOP/TURN/RIVER あり (NLH UI 流用)
  hasDrawPhase:       false,
  numHoleCards:       2,            // NLH と同じ
  maxPlayers:         6,
  minPlayers:         2,
  startingBBs:        100,
  bigBlind:           10,
  smallBlind:         5,
  hasBlinds:          true,
  bettingStructure:   'fixed-limit',
  smallBet:           10,           // 1BB — PREFLOP, FLOP
  bigBet:             20,           // 2BB — TURN, RIVER
  maxRaisesPerRound:  5,            // Bet → Raise → 3Bet → 4Bet → 5Bet Cap
};
