// No Limit 2-7 Single Draw (NL27SD) — 設定
// ゲーム進行: BETTING_1 (predraw) → DRAW_1 → BETTING_2 (postdraw) → SHOWDOWN
// ベット構造: No Limit (NLH と同じスライダー付き UI)
// 評価: 2-7 Triple Draw と同じローボール評価を流用
export default {
  gameId:             '27sd',
  displayName:        '2-7 Single Draw',
  icon:               '—',
  hasCommunityCards:  false,
  hasDrawPhase:       true,
  numDrawRounds:      1,              // ← 単一ドロー (27TD は 3)
  numHoleCards:       5,
  maxPlayers:         6,
  minPlayers:         2,
  startingBBs:        100,
  bigBlind:           10,
  smallBlind:         5,
  hasBlinds:          true,
  bettingStructure:   'no-limit',     // ← NL (27TD は 'fixed-limit')
  handRanking:        'lowball-27',
  aceIsLow:           false,
};
