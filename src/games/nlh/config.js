// NLH ゲーム設定
export default {
  gameId:           'nlh',
  displayName:      "No Limit Hold'em",
  icon:             '♠',
  hasCommunityCards: true,
  hasDrawPhase:     false,
  numHoleCards:     2,
  maxPlayers:       6,
  minPlayers:       2,
  startingBBs:      100,
  bigBlind:         10,
  smallBlind:       5,
  hasBlinds:        true,
  bettingStructure: 'no-limit',
  cpuLevel: 3,   // 1=beginner, 2=intermediate, 3=GTO
};
