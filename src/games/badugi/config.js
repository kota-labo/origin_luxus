// Badugi 設定
export default {
  gameId:            'badugi',
  displayName:       'Badugi',
  icon:              '◆',
  hasCommunityCards: false,
  hasDrawPhase:      true,
  numDrawRounds:     3,
  numHoleCards:      4,
  maxPlayers:        6,
  minPlayers:        2,
  handRanking:       'badugi',
  bettingStructure:  'fixed-limit',
  smallBet:          10,          // BETTING_1, BETTING_2
  bigBet:            20,          // BETTING_3, BETTING_4
  maxRaisesPerRound: 5,
  hasBlinds:         true,
  smallBlind:        5,
  bigBlind:          10,
  startingBBs:       100,
  aceIsLow:          true,        // Badugi では A がローカード（最強）
};
