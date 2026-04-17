// Seven Card Stud High ゲーム設定
export default {
  gameId:             'stud',
  displayName:        'Seven Card Stud',
  icon:               '7',
  hasCommunityCards:  false,
  hasDrawPhase:       false,
  isStudGame:         true,
  numHoleCards:       7,        // 最終的に7枚（3rd〜7th）
  maxPlayers:         6,
  minPlayers:         2,
  startingBBs:        100,
  bigBlind:           10,      // BB基準（表示・初期チップ計算用）
  smallBlind:         5,       // 未使用（Studはアンテ制）
  hasBlinds:          false,
  bettingStructure:   'fixed-limit',
  // Stud 固有
  ante:               2.5,     // 0.25BB — アンテ (全員から徴収)
  bringIn:            2.5,     // 0.25BB — ブリングイン
  smallBet:           10,      // 1BB — Third/Fourth Street
  bigBet:             20,      // 2BB — Fifth/Sixth/Seventh Street
  maxRaisesPerRound:  5,       // 5-bet cap（bet + 4 raises）
};
