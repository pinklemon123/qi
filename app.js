// Simple Xiangqi (Chinese Chess) in vanilla JS
// Board: 10 rows x 9 cols. Row 0 at Black side (top), Row 9 at Red side (bottom)

const COLORS = { RED: 'r', BLACK: 'b' };
const TYPES = { R: 'R', N: 'N', B: 'B', A: 'A', K: 'K', C: 'C', P: 'P' };

let board = null; // 2D array [row][col] => {type, color} | null
let current = COLORS.RED; // Red moves first
let selected = null; // {row, col}
let legalTargets = []; // [{row, col}]
let blackAI = false; // whether black is AI-controlled
let aiThinking = false;
let aiLevel = 'medium'; // easy | medium | hard

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const resetBtn = document.getElementById('resetBtn');
const aiToggle = document.getElementById('aiToggle');
const aiLevelSelect = document.getElementById('aiLevel');

// layout constants based on board.png (percentages of container size)
const BOARD_OFF_X = 5.08;      // left/right margin
const BOARD_OFF_TOP = 5.08;    // top margin
const BOARD_STEP_X = 11.23;    // horizontal distance between files
const BOARD_STEP_Y = 9.982;    // vertical distance between ranks

resetBtn.addEventListener('click', () => init());
aiToggle?.addEventListener('change', () => {
  blackAI = !!aiToggle.checked;
  updateStatus();
  maybeTriggerAI();
});
aiLevelSelect?.addEventListener('change', () => {
  aiLevel = aiLevelSelect.value || 'medium';
  updateStatus();
  maybeTriggerAI();
});

function init() {
  board = createInitialBoard();
  current = COLORS.RED;
  selected = null;
  legalTargets = [];
  aiThinking = false;
  if (aiToggle) aiToggle.checked = blackAI;
  if (aiLevelSelect) aiLevelSelect.value = aiLevel;
  render();
  updateStatus();
}

function createInitialBoard() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  // Helpers
  const place = (r, c, type, color) => (b[r][c] = { type, color });

  // Black side (top)
  place(0, 0, TYPES.R, COLORS.BLACK);
  place(0, 1, TYPES.N, COLORS.BLACK);
  place(0, 2, TYPES.B, COLORS.BLACK);
  place(0, 3, TYPES.A, COLORS.BLACK);
  place(0, 4, TYPES.K, COLORS.BLACK);
  place(0, 5, TYPES.A, COLORS.BLACK);
  place(0, 6, TYPES.B, COLORS.BLACK);
  place(0, 7, TYPES.N, COLORS.BLACK);
  place(0, 8, TYPES.R, COLORS.BLACK);
  place(2, 1, TYPES.C, COLORS.BLACK);
  place(2, 7, TYPES.C, COLORS.BLACK);
  [0, 2, 4, 6, 8].forEach((c) => place(3, c, TYPES.P, COLORS.BLACK));

  // Red side (bottom)
  place(9, 0, TYPES.R, COLORS.RED);
  place(9, 1, TYPES.N, COLORS.RED);
  place(9, 2, TYPES.B, COLORS.RED);
  place(9, 3, TYPES.A, COLORS.RED);
  place(9, 4, TYPES.K, COLORS.RED);
  place(9, 5, TYPES.A, COLORS.RED);
  place(9, 6, TYPES.B, COLORS.RED);
  place(9, 7, TYPES.N, COLORS.RED);
  place(9, 8, TYPES.R, COLORS.RED);
  place(7, 1, TYPES.C, COLORS.RED);
  place(7, 7, TYPES.C, COLORS.RED);
  [0, 2, 4, 6, 8].forEach((c) => place(6, c, TYPES.P, COLORS.RED));

  return b;
}

function render() {
  boardEl.innerHTML = '';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement('div');
      cell.className = `cell row-${r} col-${c}`;
      cell.setAttribute('role', 'gridcell');
      cell.dataset.row = r;
      cell.dataset.col = c;

      const left = BOARD_OFF_X + BOARD_STEP_X * c;
      const top = BOARD_OFF_TOP + BOARD_STEP_Y * r;
      cell.style.left = left + '%';
      cell.style.top = top + '%';
      cell.style.width = BOARD_STEP_X + '%';
      cell.style.height = BOARD_STEP_Y + '%';

      // coordinate labels
      if (c === 0) {
        const lbl = document.createElement('div');
        lbl.className = 'row-label';
        lbl.textContent = 10 - r;
        cell.appendChild(lbl);
      }
      if (r === 9) {
        const lbl = document.createElement('div');
        lbl.className = 'col-label';
        lbl.textContent = String.fromCharCode(65 + c);
        cell.appendChild(lbl);
      }

      const p = board[r][c];
      if (p) {
        const el = document.createElement('div');
        el.className = `piece ${p.color === COLORS.RED ? 'red' : 'black'} ${selected && selected.row === r && selected.col === c ? 'focus' : ''}`;
        el.textContent = getPieceChar(p);
        el.draggable = false;
        cell.appendChild(el);
      }

      // move hints
      if (selected && legalTargets.some(t => t.row === r && t.col === c)) {
        const hint = document.createElement('div');
        hint.className = 'hint';
        const dot = document.createElement('div');
        const targetHasPiece = !!board[r][c];
        dot.className = `dot ${targetHasPiece ? 'capture' : ''}`;
        hint.appendChild(dot);
        cell.appendChild(hint);
      }

      cell.addEventListener('click', onCellClick);
      boardEl.appendChild(cell);
    }
  }
}

function updateStatus(extra) {
  const side = current === COLORS.RED ? '红方' : '黑方';
  let text = `${side}走棋`;
  const inCheck = isInCheck(board, current);
  if (inCheck) text += ' - 将军!';
  if (blackAI && current === COLORS.BLACK) {
    if (aiThinking) text = '黑方AI思考中…';
    else text += `（AI：${aiLevel === 'easy' ? '简单' : aiLevel === 'hard' ? '困难' : '普通'}）`;
  }
  if (extra) text = `${extra} | ${text}`;
  statusEl.textContent = text;
}

function onCellClick(e) {
  if (aiThinking) return; // disable interactions while AI thinks
  const r = Number(e.currentTarget.dataset.row);
  const c = Number(e.currentTarget.dataset.col);
  const p = board[r][c];

  // If a legal move target was clicked
  if (selected && legalTargets.some(t => t.row === r && t.col === c)) {
    makeAndApplyMove(selected, { row: r, col: c });
    return;
  }

  // Select own piece
  if (p && p.color === current) {
    selected = { row: r, col: c };
    legalTargets = legalMovesAt(board, r, c, current);
    render();
    return;
  }

  // Clicked elsewhere - clear selection
  selected = null;
  legalTargets = [];
  render();
}

function makeAndApplyMove(from, to) {
  const moves = legalMovesAt(board, from.row, from.col, current);
  if (!moves.some(m => m.row === to.row && m.col === to.col)) return; // guard

  // Apply move (mutate)
  board[to.row][to.col] = board[from.row][from.col];
  board[from.row][from.col] = null;

  // Clear selection
  selected = null;
  legalTargets = [];

  // Check end conditions for opponent
  const next = other(current);
  const mateInfo = checkMateStatus(board, next);
  if (mateInfo.mate) {
    render();
    statusEl.textContent = `${current === COLORS.RED ? '红方' : '黑方'}胜！(将死)`;
    return;
  }
  if (mateInfo.stalemate) {
    render();
    statusEl.textContent = '和棋 (无子可动)';
    return;
  }

  // Switch turn
  current = next;
  render();
  updateStatus();
  maybeTriggerAI();
}

function other(color) { return color === COLORS.RED ? COLORS.BLACK : COLORS.RED; }

function inBounds(r, c) { return r >= 0 && r < 10 && c >= 0 && c < 9; }

function deepCopyBoard(b) { return b.map(row => row.map(cell => cell ? { ...cell } : null)); }

function serializeBoard(b) {
  // 10 rows x 9 cols. Uppercase = Red, lowercase = Black. . = empty
  const map = (p) => {
    if (!p) return '.';
    const m = { R:'r',N:'n',B:'b',A:'a',K:'k',C:'c',P:'p' };
    const ch = m[p.type] || '?';
    return p.color === COLORS.RED ? ch.toUpperCase() : ch;
  };
  const rows = b.map(row => row.map(map).join(''));
  return rows.join('/');
}

function collectAllLegalMoves(b, side) {
  const all = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (!p || p.color !== side) continue;
      const moves = legalMovesAt(b, r, c, side);
      for (const m of moves) all.push({ from: {row:r,col:c}, to: m });
    }
  }
  return all;
}

function chooseHeuristicMove(b, side) {
  const moves = collectAllLegalMoves(b, side);
  if (!moves.length) return null;
  // prefer captures
  const caps = moves.filter(m => b[m.to.row][m.to.col]);
  const pool = caps.length ? caps : moves;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function maybeTriggerAI() {
  if (!(blackAI && current === COLORS.BLACK)) return;
  aiThinking = true;
  updateStatus();
  try {
    const move = await requestAIMove();
    if (move && isValidAIMove(move)) {
      applyMoveDirect(move.from, move.to);
    } else {
      const fallback = chooseAIMoveByLevel(board, COLORS.BLACK, aiLevel) || chooseHeuristicMove(board, COLORS.BLACK);
      if (fallback) applyMoveDirect(fallback.from, fallback.to);
    }
  } catch (e) {
    console.error('AI move error:', e);
    const fallback = chooseAIMoveByLevel(board, COLORS.BLACK, aiLevel) || chooseHeuristicMove(board, COLORS.BLACK);
    if (fallback) applyMoveDirect(fallback.from, fallback.to);
  } finally {
    aiThinking = false;
    updateStatus();
  }
}

function isValidAIMove(move) {
  if (!move || !move.from || !move.to) return false;
  const { from, to } = move;
  if (!inBounds(from.row, from.col) || !inBounds(to.row, to.col)) return false;
  const p = board[from.row][from.col];
  if (!p || p.color !== COLORS.BLACK) return false;
  const moves = legalMovesAt(board, from.row, from.col, COLORS.BLACK);
  return moves.some(m => m.row === to.row && m.col === to.col);
}

function applyMoveDirect(from, to) {
  // Apply and handle end/turn similar to makeAndApplyMove
  const moves = legalMovesAt(board, from.row, from.col, current);
  if (!moves.some(m => m.row === to.row && m.col === to.col)) return;
  board[to.row][to.col] = board[from.row][from.col];
  board[from.row][from.col] = null;
  selected = null;
  legalTargets = [];
  const next = other(current);
  const mateInfo = checkMateStatus(board, next);
  if (mateInfo.mate) {
    render();
    statusEl.textContent = `${current === COLORS.RED ? '红方' : '黑方'}胜！(将死)`;
    return;
  }
  if (mateInfo.stalemate) {
    render();
    statusEl.textContent = '和棋 (无子可动)';
    return;
  }
  current = next;
  render();
  updateStatus();
  maybeTriggerAI();
}

async function requestAIMove() {
  const payload = {
    board: serializeBoard(board),
    side: 'b',
    difficulty: aiLevel,
  };
  const res = await fetch('/ai/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
  const data = await res.json();
  // Expect { from:[r,c], to:[r,c] }
  if (Array.isArray(data.from) && Array.isArray(data.to)) {
    return { from: { row: data.from[0], col: data.from[1] }, to: { row: data.to[0], col: data.to[1] } };
  }
  if (data && data.move && Array.isArray(data.move.from) && Array.isArray(data.move.to)) {
    return { from: { row: data.move.from[0], col: data.move.from[1] }, to: { row: data.move.to[0], col: data.move.to[1] } };
  }
  return null;
}

function getPieceChar(p) {
  const red = p.color === COLORS.RED;
  // Red (简体): 车马相仕帅炮兵; Black (繁体): 車馬象士將砲卒
  switch (p.type) {
    case TYPES.R: return red ? '车' : '車';
    case TYPES.N: return red ? '马' : '馬';
    case TYPES.B: return red ? '相' : '象';
    case TYPES.A: return red ? '仕' : '士';
    case TYPES.K: return red ? '帅' : '將';
    case TYPES.C: return red ? '炮' : '砲';
    case TYPES.P: return red ? '兵' : '卒';
    default: return '?';
  }
}

function palaceContains(color, r, c) {
  if (c < 3 || c > 5) return false;
  if (color === COLORS.BLACK) return r >= 0 && r <= 2;
  return r >= 7 && r <= 9;
}

function onOwnSide(color, r) {
  // River between rows 4 and 5. Black side: rows 0..4; Red side: 5..9
  if (color === COLORS.BLACK) return r <= 4;
  return r >= 5;
}

function pathClearStraight(b, r1, c1, r2, c2) {
  if (r1 === r2) {
    const dir = c2 > c1 ? 1 : -1;
    for (let c = c1 + dir; c !== c2; c += dir) if (b[r1][c]) return false;
    return true;
  } else if (c1 === c2) {
    const dir = r2 > r1 ? 1 : -1;
    for (let r = r1 + dir; r !== r2; r += dir) if (b[r][c1]) return false;
    return true;
  }
  return false;
}

function legalMovesAt(b, r, c, color) {
  const p = b[r][c];
  if (!p || p.color !== color) return [];
  const pseudo = generatePseudoMoves(b, r, c, p);
  // Filter out moves that leave own general in check
  const res = [];
  for (const m of pseudo) {
    const nb = deepCopyBoard(b);
    nb[m.row][m.col] = nb[r][c];
    nb[r][c] = null;
    if (!isInCheck(nb, color)) res.push(m);
  }
  return res;
}

function generatePseudoMoves(b, r, c, p) {
  const moves = [];
  const push = (rr, cc) => { if (inBounds(rr, cc)) moves.push({ row: rr, col: cc }); };
  const sameColor = (rr, cc) => b[rr][cc] && b[rr][cc].color === p.color;

  if (p.type === TYPES.R) {
    // Rook: straight until blocked
    // up
    for (let rr = r - 1; rr >= 0; rr--) { if (!b[rr][c]) push(rr, c); else { if (!sameColor(rr,c)) push(rr,c); break; } }
    // down
    for (let rr = r + 1; rr < 10; rr++) { if (!b[rr][c]) push(rr, c); else { if (!sameColor(rr,c)) push(rr,c); break; } }
    // left
    for (let cc = c - 1; cc >= 0; cc--) { if (!b[r][cc]) push(r, cc); else { if (!sameColor(r,cc)) push(r,cc); break; } }
    // right
    for (let cc = c + 1; cc < 9; cc++) { if (!b[r][cc]) push(r, cc); else { if (!sameColor(r,cc)) push(r,cc); break; } }
  }

  if (p.type === TYPES.C) {
    // Cannon: move like rook without capture; capture with exactly one screen
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      let seenScreen = false;
      while (inBounds(rr, cc)) {
        if (!seenScreen) {
          if (!b[rr][cc]) {
            push(rr, cc);
          } else {
            seenScreen = true; // found screen
          }
        } else {
          if (b[rr][cc]) { // first piece after screen: capture if enemy
            if (!sameColor(rr, cc)) push(rr, cc);
            break; // stop regardless
          }
        }
        rr += dr; cc += dc;
      }
    }
  }

  if (p.type === TYPES.N) {
    // Knight with leg rule
    const jumps = [
      [-2,-1],[-2,1],[2,-1],[2,1],
      [-1,-2],[-1,2],[1,-2],[1,2]
    ];
    for (const [dr, dc] of jumps) {
      const rr = r + dr, cc = c + dc;
      if (!inBounds(rr, cc)) continue;
      // blocking leg
      const br = r + (dr === 2 ? 1 : dr === -2 ? -1 : 0);
      const bc = c + (dc === 2 ? 1 : dc === -2 ? -1 : 0);
      if (b[br][bc]) continue;
      if (!b[rr][cc] || !sameColor(rr, cc)) push(rr, cc);
    }
  }

  if (p.type === TYPES.B) {
    // Elephant: 2 diag, no eye block, cannot cross river
    const diags = [[2,2],[2,-2],[-2,2],[-2,-2]];
    for (const [dr, dc] of diags) {
      const rr = r + dr, cc = c + dc;
      if (!inBounds(rr, cc)) continue;
      const eyeR = r + dr/2, eyeC = c + dc/2;
      if (b[eyeR][eyeC]) continue;
      if (!onOwnSide(p.color, rr)) continue; // cannot cross river
      if (!b[rr][cc] || !sameColor(rr, cc)) push(rr, cc);
    }
  }

  if (p.type === TYPES.A) {
    // Advisor: 1 diag inside palace
    const diags = [[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [dr, dc] of diags) {
      const rr = r + dr, cc = c + dc;
      if (!inBounds(rr, cc)) continue;
      if (!palaceContains(p.color, rr, cc)) continue;
      if (!b[rr][cc] || !sameColor(rr, cc)) push(rr, cc);
    }
  }

  if (p.type === TYPES.K) {
    // General: 1 orth inside palace
    const orth = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dr, dc] of orth) {
      const rr = r + dr, cc = c + dc;
      if (!inBounds(rr, cc)) continue;
      if (!palaceContains(p.color, rr, cc)) continue;
      if (!b[rr][cc] || !sameColor(rr, cc)) push(rr, cc);
    }
    // Flying general capture: if on same column and clear, can capture opposing general
    const enemyK = findGeneral(b, other(p.color));
    if (enemyK && enemyK.col === c && pathClearStraight(b, r, c, enemyK.row, enemyK.col)) {
      push(enemyK.row, enemyK.col);
    }
  }

  if (p.type === TYPES.P) {
    // Pawn: forward one; after crossing river, can move left/right one; never backward
    const forward = p.color === COLORS.RED ? -1 : 1;
    const rr = r + forward;
    if (inBounds(rr, c) && (!b[rr][c] || !sameColor(rr, c))) push(rr, c);
    // side moves after river
    if (!onOwnSide(p.color, r)) {
      if (inBounds(r, c-1) && (!b[r][c-1] || !sameColor(r, c-1))) push(r, c-1);
      if (inBounds(r, c+1) && (!b[r][c+1] || !sameColor(r, c+1))) push(r, c+1);
    }
  }

  return moves;
}

function findGeneral(b, color) {
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (p && p.type === TYPES.K && p.color === color) return { row: r, col: c };
    }
  }
  return null;
}

function isInCheck(b, color) {
  const k = findGeneral(b, color);
  if (!k) return true; // general captured => treat as checked
  return isSquareAttacked(b, k.row, k.col, other(color));
}

function isSquareAttacked(b, tr, tc, byColor) {
  // Rooks and cannons along ranks/files
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  for (const [dr, dc] of dirs) {
    let rr = tr + dr, cc = tc + dc;
    let blockers = 0;
    while (inBounds(rr, cc)) {
      const q = b[rr][cc];
      if (q) {
        if (q.color === byColor) {
          if (blockers === 0 && q.type === TYPES.R) return true;
          if (blockers === 1 && q.type === TYPES.C) return true;
          // General facing
          if (blockers === 0 && q.type === TYPES.K && cc === tc) return true;
        }
        blockers++;
      }
      rr += dr; cc += dc;
    }
  }

  // Knights
  const knightSources = [
    [-2,-1],[-2,1],[2,-1],[2,1],
    [-1,-2],[-1,2],[1,-2],[1,2]
  ];
  for (const [dr, dc] of knightSources) {
    const sr = tr + dr, sc = tc + dc;
    if (!inBounds(sr, sc)) continue;
    const q = b[sr][sc];
    if (!q || q.color !== byColor || q.type !== TYPES.N) continue;
    // leg block relative to source
    const br = sr + (dr === 2 ? -1 : dr === -2 ? 1 : 0);
    const bc = sc + (dc === 2 ? -1 : dc === -2 ? 1 : 0);
    if (inBounds(br, bc) && !b[br][bc]) return true;
  }

  // Elephants (cannot cross river)
  const eleSources = [[2,2],[2,-2],[-2,2],[-2,-2]];
  for (const [dr, dc] of eleSources) {
    const sr = tr + dr, sc = tc + dc;
    if (!inBounds(sr, sc)) continue;
    const q = b[sr][sc];
    if (!q || q.color !== byColor || q.type !== TYPES.B) continue;
    // eye block in middle
    const eyeR = sr - dr/2, eyeC = sc - dc/2; // midpoint between src and target
    if (b[eyeR][eyeC]) continue;
    // must remain on own side (attacker side)
    if (!onOwnSide(q.color, tr)) continue;
    return true;
  }

  // Advisors (inside palace, 1 diag)
  const advSources = [[1,1],[1,-1],[-1,1],[-1,-1]];
  for (const [dr, dc] of advSources) {
    const sr = tr + dr, sc = tc + dc;
    if (!inBounds(sr, sc)) continue;
    const q = b[sr][sc];
    if (!q || q.color !== byColor || q.type !== TYPES.A) continue;
    if (palaceContains(q.color, sr, sc)) return true;
  }

  // General adjacent (1 orth inside palace)
  const orth = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const [dr, dc] of orth) {
    const sr = tr + dr, sc = tc + dc;
    if (!inBounds(sr, sc)) continue;
    const q = b[sr][sc];
    if (q && q.color === byColor && q.type === TYPES.K && palaceContains(q.color, sr, sc)) return true;
  }

  // Pawns (attack same as move)
  const forward = byColor === COLORS.RED ? -1 : 1;
  const pr = tr + forward, pc = tc;
  if (inBounds(pr, pc)) {
    const q = b[pr][pc];
    if (q && q.color === byColor && q.type === TYPES.P) return true;
  }
  // side after river from pawn perspective
  for (const dc of [-1, 1]) {
    const sr = tr, sc = tc + dc;
    if (!inBounds(sr, sc)) continue;
    const q = b[sr][sc];
    if (q && q.color === byColor && q.type === TYPES.P) {
      if (!onOwnSide(byColor, sr)) return true;
    }
  }

  return false;
}

function checkMateStatus(b, side) {
  // Returns { mate, stalemate }
  const anyMove = hasAnyLegalMove(b, side);
  if (anyMove) return { mate: false, stalemate: false };
  if (isInCheck(b, side)) return { mate: true, stalemate: false };
  return { mate: false, stalemate: true };
}

function hasAnyLegalMove(b, side) {
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (!p || p.color !== side) continue;
      const moves = legalMovesAt(b, r, c, side);
      if (moves.length) return true;
    }
  }
  return false;
}

// ===== AI helpers (difficulty) =====
function chooseAIMoveByLevel(b, side, level) {
  const moves = collectAllLegalMoves(b, side);
  if (!moves.length) return null;
  if (level === 'easy') {
    return moves[Math.floor(Math.random() * moves.length)];
  }
  if (level === 'medium') {
    const caps = moves.filter(m => b[m.to.row][m.to.col]);
    const pool = caps.length ? caps : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  // hard: shallow minimax depth=2
  return findBestMoveMinimax(b, side, 2);
}

function pieceValue(p, r, c) {
  const base = {
    [TYPES.K]: 10000,
    [TYPES.R]: 900,
    [TYPES.C]: 450,
    [TYPES.N]: 400,
    [TYPES.B]: 200,
    [TYPES.A]: 200,
    [TYPES.P]: 100,
  }[p.type] || 0;
  // Pawn bonus after river
  let bonus = 0;
  if (p.type === TYPES.P) {
    const crossed = !onOwnSide(p.color, r);
    if (crossed) bonus += 40;
  }
  return base + bonus;
}

function evaluateBoard(b, side) {
  let score = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (!p) continue;
      const val = pieceValue(p, r, c);
      score += (p.color === side ? val : -val);
    }
  }
  return score;
}

function findBestMoveMinimax(b, side, depth) {
  let best = null;
  let bestScore = -Infinity;
  const moves = collectAllLegalMoves(b, side);
  for (const mv of moves) {
    const nb = deepCopyBoard(b);
    nb[mv.to.row][mv.to.col] = nb[mv.from.row][mv.from.col];
    nb[mv.from.row][mv.from.col] = null;
    const sc = -negamax(nb, other(side), depth - 1, -Infinity, Infinity);
    if (sc > bestScore) { bestScore = sc; best = mv; }
  }
  return best || null;
}

function negamax(b, side, depth, alpha, beta) {
  const mateInfo = checkMateStatus(b, side);
  if (mateInfo.mate) return -999999 + (2 - depth); // losing
  if (depth === 0) return evaluateBoard(b, side);
  let best = -Infinity;
  const moves = collectAllLegalMoves(b, side);
  if (!moves.length) {
    if (mateInfo.stalemate) return 0;
    return -999999 + (2 - depth);
  }
  for (const mv of moves) {
    const nb = deepCopyBoard(b);
    nb[mv.to.row][mv.to.col] = nb[mv.from.row][mv.from.col];
    nb[mv.from.row][mv.from.col] = null;
    const val = -negamax(nb, other(side), depth - 1, -beta, -alpha);
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// Bootstrap
init();
