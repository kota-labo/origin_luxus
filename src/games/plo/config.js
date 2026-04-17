// Pot Limit Omaha (PLO) — 設定
// ゲーム進行は NLH と同一 (PREFLOP/FLOP/TURN/RIVER/SHOWDOWN)
// 差分:
//   1. 4枚ホールカード (Omaha ルール: 手札2 + ボード3 の 60通り評価)
//   2. Pot Limit ベッティング (最大ベット = ポットサイズ)
//   3. Hi 評価のみ (Hi/Lo 分割なし)
export default {
  gameId:             'plo',
  displayName:        'Pot Limit Omaha',
  icon:               '♠',
  hasCommunityCards:  true,
  hasDrawPhase:       false,
  hasLowHand:         false,          // Hi のみ (FLO8 との違い)
  variant:            'pot-limit-omaha',
  numHoleCards:       4,              // Omaha: 4 枚ホール
  maxPlayers:         6,
  minPlayers:         2,
  startingBBs:        100,
  bigBlind:           10,
  smallBlind:         5,
  hasBlinds:          true,
  bettingStructure:   'pot-limit',    // ← 新しいベット構造 (NLH と別、UI はスライダー流用)
};
