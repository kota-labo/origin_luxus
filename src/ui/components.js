// UIコンポーネント共通ヘルパー
// DOM要素生成・カードHTML・エスケープなど純粋ユーティリティ

const SUIT_SYM = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

// カードHTML生成
// extraCls: 追加クラス文字列（例: 'card-new'）
// extraStyle: 追加インラインスタイル文字列（例: 'animation-delay:.3s'）
export function cardHtml(c, size, extraCls = '', extraStyle = '') {
  const colorCls = c.isRed ? 'red' : 'blk';
  const cls = `card ${size} ${colorCls} ${sc(c)}${extraCls ? ' ' + extraCls : ''}`;
  const styleAttr = extraStyle ? ` style="${extraStyle}"` : '';
  return `<span class="${cls}"${styleAttr}><span class="c-rank">${c.rank}</span><span class="c-suit">${SUIT_SYM[c.suit]}</span></span>`;
}

// スーツクラス名
export function sc(card) { return `suit-${card.suit}`; }

// チップ → BB表示（bigBlindを引数で渡す）
export function bb(chips, bigBlind) {
  if (!bigBlind || bigBlind <= 0) return '0';
  const v = chips / bigBlind;
  return Number.isInteger(v) ? `${v}` : v.toFixed(1);
}

// XSS対策: innerHTML に挿入する文字列をすべてエスケープ
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ------- DOM生成ヘルパー -------
export function mkBar() {
  const d = document.createElement('div');
  d.className = 'action-bar';
  return d;
}

export function mkGroup() {
  const d = document.createElement('div');
  d.className = 'action-group';
  return d;
}

export function mkDivider() {
  const d = document.createElement('div');
  d.className = 'action-divider';
  return d;
}

export function mkBtn(cls, html) {
  const b = document.createElement('button');
  b.className = `action-btn ${cls}`;
  b.innerHTML = html;
  return b;
}
