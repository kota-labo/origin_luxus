// 2-7 Triple Draw 設定
export default {
  gameId:            '27td',
  displayName:       '2-7 Triple Draw',
  icon:              '✦',
  hasCommunityCards: false,
  hasDrawPhase:      true,
  numDrawRounds:     3,
  numHoleCards:      5,
  maxPlayers:        6,
  minPlayers:        2,
  handRanking:       'lowball-27',
  bettingStructure:  'fixed-limit',
  smallBet:          10,          // BETTING_1, BETTING_2
  bigBet:            20,          // BETTING_3, BETTING_4
  maxRaisesPerRound: 5,
  hasBlinds:         true,
  smallBlind:        5,
  bigBlind:          10,
  startingBBs:       100,
  aceIsLow:          false,       // 2-7TD では A がハイカード（最弱）
};
