// 軽量リアクティブストア
// グローバルなセッション状態（現在のゲームID、プレイヤー数など）を管理する

let _state = {
  selectedGame:        'nlh',
  selectedPlayerCount: 4,
};

const _subscribers = [];

export function getState() {
  return { ..._state };
}

// 許可するキーのみ受け付ける（Prototype Pollution 対策）
const _ALLOWED_KEYS = new Set(['selectedGame', 'selectedPlayerCount']);

export function patchState(partial) {
  const safe = {};
  for (const key of Object.keys(partial)) {
    if (_ALLOWED_KEYS.has(key)) safe[key] = partial[key];
  }
  _state = { ..._state, ...safe };
  for (const fn of _subscribers) fn(_state);
}

export function subscribe(fn) {
  _subscribers.push(fn);
  return () => {
    const idx = _subscribers.indexOf(fn);
    if (idx !== -1) _subscribers.splice(idx, 1);
  };
}
