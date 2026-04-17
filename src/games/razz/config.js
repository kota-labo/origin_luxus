// Razz (Seven Card Stud A-5 Lowball) ゲーム設定
// ベット構造: 0.25BB / 0.25BB / 1BB / 2BB
// bigBlind=20 で整数チップ制約を満たす
export default {
  gameId:             'razz',
  displayName:        'Razz',
  icon:               'A',
  hasCommunityCards:  false,
  hasDrawPhase:       false,
  isStudGame:         true,
  numHoleCards:       7,        // 最終的に7枚（3rd〜7th）
  maxPlayers:         6,
  minPlayers:         2,
  startingBBs:        100,
  bigBlind:           20,      // BB基準（表示・初期チップ計算用）
  smallBlind:         10,      // 未使用（Studはアンテ制）
  hasBlinds:          false,
  bettingStructure:   'fixed-limit',
  // Razz 固有
  ante:               5,       // 0.25BB — アンテ
  bringIn:            5,       // 0.25BB — ブリングイン
  smallBet:           20,      // 1BB — Third/Fourth Street
  bigBet:             40,      // 2BB — Fifth/Sixth/Seventh Street
  maxRaisesPerRound:  5,       // 5-bet cap（bet + 4 raises）
};
