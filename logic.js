// logic.js —— 只包含“状态、规则、AI”等与 DOM 无关的逻辑

export const COLORS = { RED: 'r', BLACK: 'b' };
export const TYPES  = { R: 'R', N: 'N', B: 'B', A: 'A', K: 'K', C: 'C', P: 'P' };

// === 初始棋局 ===
export function createInitialBoard() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  const place = (r, c, type, color) => (b[r][c] = { type, color });

  // Black (上)
  place(0,0,TYPES.R, COLORS.BLACK); place(0,1,TYPES.N, COLORS.BLACK); place(0,2,TYPES.B, COLORS.BLACK);
  place(0,3,TYPES.A, COLORS.BLACK); place(0,4,TYPES.K, COLORS.BLACK); place(0,5,TYPES.A, COLORS.BLACK);
  place(0,6,TYPES.B, COLORS.BLACK); place(0,7,TYPES.N, COLORS.BLACK); place(0,8,TYPES.R, COLORS.BLACK);
  place(2,1,TYPES.C, COLORS.BLACK); place(2,7,TYPES.C, COLORS.BLACK);
  [0,2,4,6,8].forEach(c => place(3,c,TYPES.P, COLORS.BLACK));

  // Red (下)
  place(9,0,TYPES.R, COLORS.RED); place(9,1,TYPES.N, COLORS.RED); place(9,2,TYPES.B, COLORS.RED);
  place(9,3,TYPES.A, COLORS.RED); place(9,4,TYPES.K, COLORS.RED); place(9,5,TYPES.A, COLORS.RED);
  place(9,6,TYPES.B, COLORS.RED); place(9,7,TYPES.N, COLORS.RED); place(9,8,TYPES.R, COLORS.RED);
  place(7,1,TYPES.C, COLORS.RED); place(7,7,TYPES.C, COLORS.RED);
  [0,2,4,6,8].forEach(c => place(6,c,TYPES.P, COLORS.RED));

  return b;
}

// === 工具 ===
export const other = c => (c === COLORS.RED ? COLORS.BLACK : COLORS.RED);
export const inBounds = (r,c) => r>=0 && r<10 && c>=0 && c<9;
export const deepCopyBoard = b => b.map(row => row.map(cell => cell ? {...cell} : null));

export function palaceContains(color, r, c) {
  if (c < 3 || c > 5) return false;
  return color === COLORS.BLACK ? (r>=0 && r<=2) : (r>=7 && r<=9);
}
export function onOwnSide(color, r) {
  // 河界在 4/5 行之间；黑方在上（0..4），红方在下（5..9）
  return color === COLORS.BLACK ? (r <= 4) : (r >= 5);
}
function pathClearStraight(b, r1, c1, r2, c2) {
  if (r1 === r2) {
    const dir = c2 > c1 ? 1 : -1;
    for (let c = c1+dir; c !== c2; c += dir) if (b[r1][c]) return false;
    return true;
  } else if (c1 === c2) {
    const dir = r2 > r1 ? 1 : -1;
    for (let r = r1+dir; r !== r2; r += dir) if (b[r][c1]) return false;
    return true;
  }
  return false;
}

// === 走法生成 + 过滤被将 ===
export function legalMovesAt(b, r, c, color) {
  const p = b[r][c];
  if (!p || p.color !== color) return [];
  const pseudo = generatePseudoMoves(b, r, c, p);
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
  const push = (rr, cc) => { if (inBounds(rr, cc)) moves.push({row:rr, col:cc}); };
  const same = (rr, cc) => b[rr][cc] && b[rr][cc].color === p.color;

  if (p.type === TYPES.R) {
    // 车
    for (let rr=r-1; rr>=0; rr--) { if (!b[rr][c]) push(rr,c); else { if (!same(rr,c)) push(rr,c); break; } }
    for (let rr=r+1; rr<10; rr++) { if (!b[rr][c]) push(rr,c); else { if (!same(rr,c)) push(rr,c); break; } }
    for (let cc=c-1; cc>=0; cc--) { if (!b[r][cc]) push(r,cc); else { if (!same(r,cc)) push(r,cc); break; } }
    for (let cc=c+1; cc<9;  cc++) { if (!b[r][cc]) push(r,cc); else { if (!same(r,cc)) push(r,cc); break; } }
  }

  if (p.type === TYPES.C) {
    // 炮：平移；隔一子打
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr,dc] of dirs) {
      let rr=r+dr, cc=c+dc, scr=false;
      while (inBounds(rr,cc)) {
        if (!scr) {
          if (!b[rr][cc]) push(rr,cc); else scr=true;
        } else {
          if (b[rr][cc]) { if (!same(rr,cc)) push(rr,cc); break; }
        }
        rr+=dr; cc+=dc;
      }
    }
  }

  if (p.type === TYPES.N) {
    // 马：蹩马腿
    const jumps = [[-2,-1],[-2,1],[2,-1],[2,1],[-1,-2],[-1,2],[1,-2],[1,2]];
    for (const [dr,dc] of jumps) {
      const rr=r+dr, cc=c+dc; if (!inBounds(rr,cc)) continue;
      const br = r + (dr=== 2 ? 1 : dr===-2 ? -1 : 0);
      const bc = c + (dc=== 2 ? 1 : dc===-2 ? -1 : 0);
      if (b[br][bc]) continue;
      if (!b[rr][cc] || !same(rr,cc)) push(rr,cc);
    }
  }

  if (p.type === TYPES.B) {
    // 相/象：不过河、塞象眼
    const diags = [[2,2],[2,-2],[-2,2],[-2,-2]];
    for (const [dr,dc] of diags) {
      const rr=r+dr, cc=c+dc; if (!inBounds(rr,cc)) continue;
      if (b[r+dr/2][c+dc/2]) continue;
      if (!onOwnSide(p.color, rr)) continue;
      if (!b[rr][cc] || !same(rr,cc)) push(rr,cc);
    }
  }

  if (p.type === TYPES.A) {
    // 士/仕：九宫内斜一步
    const diags = [[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [dr,dc] of diags) {
      const rr=r+dr, cc=c+dc; if (!inBounds(rr,cc)) continue;
      if (!palaceContains(p.color, rr, cc)) continue;
      if (!b[rr][cc] || !same(rr,cc)) push(rr,cc);
    }
  }

  if (p.type === TYPES.K) {
    // 将/帅：九宫内正一步；“照面”吃将
    const orth = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dr,dc] of orth) {
      const rr=r+dr, cc=c+dc; if (!inBounds(rr,cc)) continue;
      if (!palaceContains(p.color, rr, cc)) continue;
      if (!b[rr][cc] || !same(rr,cc)) push(rr,cc);
    }
    // 飞将
    const enemy = findGeneral(b, other(p.color));
    if (enemy && enemy.col === c && pathClearStraight(b, r, c, enemy.row, enemy.col)) {
      push(enemy.row, enemy.col);
    }
  }

  if (p.type === TYPES.P) {
    // 兵/卒：前进一步；过河后可左右一步；不后退
    const forward = p.color === COLORS.RED ? -1 : 1;
    const rr = r + forward;
    if (inBounds(rr,c) && (!b[rr][c] || !same(rr,c))) push(rr,c);
    if (!onOwnSide(p.color, r)) {
      if (inBounds(r,c-1) && (!b[r][c-1] || !same(r,c-1))) push(r,c-1);
      if (inBounds(r,c+1) && (!b[r][c+1] || !same(r,c+1))) push(r,c+1);
    }
  }
  return moves;
}

export function findGeneral(b, color) {
  for (let r=0;r<10;r++) for (let c=0;c<9;c++) {
    const p=b[r][c]; if (p && p.type===TYPES.K && p.color===color) return {row:r,col:c};
  }
  return null;
}

export function isInCheck(b, color) {
  const k = findGeneral(b, color);
  if (!k) return true;
  return isSquareAttacked(b, k.row, k.col, other(color));
}

function isSquareAttacked(b, tr, tc, byColor) {
  // 车/炮/将（直线）
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  for (const [dr,dc] of dirs) {
    let rr=tr+dr, cc=tc+dc, blockers=0;
    while (inBounds(rr,cc)) {
      const q=b[rr][cc];
      if (q) {
        if (q.color===byColor) {
          if (blockers===0 && q.type===TYPES.R) return true;
          if (blockers===1 && q.type===TYPES.C) return true;
          if (blockers===0 && q.type===TYPES.K && cc===tc) return true; // 照面将
        }
        blockers++;
      }
      rr+=dr; cc+=dc;
    }
  }
  // 马（蹩马腿）
  const jumps=[[-2,-1],[-2,1],[2,-1],[2,1],[-1,-2],[-1,2],[1,-2],[1,2]];
  for (const [dr,dc] of jumps) {
    const sr=tr+dr, sc=tc+dc; if (!inBounds(sr,sc)) continue;
    const q=b[sr][sc]; if (!q || q.color!==byColor || q.type!==TYPES.N) continue;
    const br = sr + (dr=== 2 ? -1 : dr===-2 ? 1 : 0);
    const bc = sc + (dc=== 2 ? -1 : dc===-2 ? 1 : 0);
    if (inBounds(br,bc) && !b[br][bc]) return true;
  }
  // 相/象（不过河）
  const el=[[2,2],[2,-2],[-2,2],[-2,-2]];
  for (const [dr,dc] of el) {
    const sr=tr+dr, sc=tc+dc; if (!inBounds(sr,sc)) continue;
    const q=b[sr][sc]; if (!q || q.color!==byColor || q.type!==TYPES.B) continue;
    if (b[sr-dr/2][sc-dc/2]) continue;             // 象眼塞住
    if (!onOwnSide(q.color, tr)) continue;         // 必须与攻击方同侧
    return true;
  }
  // 士/仕（九宫对角）
  const adv=[[1,1],[1,-1],[-1,1],[-1,-1]];
  for (const [dr,dc] of adv) {
    const sr=tr+dr, sc=tc+dc; if (!inBounds(sr,sc)) continue;
    const q=b[sr][sc]; if (!q || q.color!==byColor || q.type!==TYPES.A) continue;
    if (palaceContains(q.color, sr, sc)) return true;
  }
  // 将/帅（九宫正邻）
  const orth=[[1,0],[-1,0],[0,1],[0,-1]];
  for (const [dr,dc] of orth) {
    const sr=tr+dr, sc=tc+dc; if (!inBounds(sr,sc)) continue;
    const q=b[sr][sc];
    if (q && q.color===byColor && q.type===TYPES.K && palaceContains(q.color, sr, sc)) return true;
  }
  // 兵/卒
  const f = byColor===COLORS.RED ? -1 : 1;
  if (inBounds(tr+f, tc) && b[tr+f][tc]?.type===TYPES.P && b[tr+f][tc]?.color===byColor) return true;
  for (const dc of [-1,1]) {
    const sr=tr, sc=tc+dc; if (!inBounds(sr,sc)) continue;
    const q=b[sr][sc];
    if (q && q.color===byColor && q.type===TYPES.P && !onOwnSide(byColor, sr)) return true;
  }
  return false;
}

export function checkMateStatus(b, side) {
  const any = hasAnyLegalMove(b, side);
  if (any) return { mate:false, stalemate:false };
  if (isInCheck(b, side)) return { mate:true, stalemate:false };
  return { mate:false, stalemate:true };
}
export function hasAnyLegalMove(b, side) {
  for (let r=0;r<10;r++) for (let c=0;c<9;c++) {
    const p=b[r][c]; if (!p || p.color!==side) continue;
    if (legalMovesAt(b,r,c,side).length) return true;
  }
  return false;
}

export function collectAllLegalMoves(b, side) {
  const all=[];
  for (let r=0;r<10;r++) for (let c=0;c<9;c++) {
    const p=b[r][c]; if (!p || p.color!==side) continue;
    for (const m of legalMovesAt(b,r,c,side)) all.push({from:{row:r,col:c}, to:m});
  }
  return all;
}

// === AI（easy/medium/hard=minimax2） ===
export function chooseAIMoveByLevel(b, side, level='medium') {
  const moves = collectAllLegalMoves(b, side);
  if (!moves.length) return null;
  if (level === 'easy') return moves[Math.floor(Math.random()*moves.length)];
  if (level === 'medium') {
    const caps = moves.filter(m => b[m.to.row][m.to.col]);
    const pool = caps.length ? caps : moves;
    return pool[Math.floor(Math.random()*pool.length)];
  }
  return findBestMoveMinimax(b, side, 2);
}
function pieceValue(p, r, c) {
  const base = { [TYPES.K]:1e4, [TYPES.R]:900, [TYPES.C]:450, [TYPES.N]:400, [TYPES.B]:200, [TYPES.A]:200, [TYPES.P]:100 }[p.type]||0;
  return base + (p.type===TYPES.P && !onOwnSide(p.color, r) ? 40 : 0);
}
function evaluateBoard(b, side) {
  let score=0;
  for (let r=0;r<10;r++) for (let c=0;c<9;c++) {
    const p=b[r][c]; if (!p) continue;
    const v=pieceValue(p,r,c);
    score += (p.color===side ? v : -v);
  }
  return score;
}
function findBestMoveMinimax(b, side, depth) {
  let best=null, bestScore=-Infinity;
  const moves=collectAllLegalMoves(b, side);
  for (const mv of moves) {
    const nb=deepCopyBoard(b);
    nb[mv.to.row][mv.to.col]=nb[mv.from.row][mv.from.col];
    nb[mv.from.row][mv.from.col]=null;
    const sc=-negamax(nb, other(side), depth-1, -Infinity, Infinity);
    if (sc>bestScore){bestScore=sc;best=mv;}
  }
  return best;
}
function negamax(b, side, depth, alpha, beta) {
  const mate=checkMateStatus(b, side);
  if (mate.mate) return -999999 + (2-depth);
  if (depth===0) return evaluateBoard(b, side);
  let best=-Infinity;
  const moves=collectAllLegalMoves(b, side);
  if (!moves.length) return mate.stalemate ? 0 : -999999 + (2-depth);
  for (const mv of moves) {
    const nb=deepCopyBoard(b);
    nb[mv.to.row][mv.to.col] = nb[mv.from.row][mv.from.col];
    nb[mv.from.row][mv.from.col] = null;
    const val=-negamax(nb, other(side), depth-1, -beta, -alpha);
    if (val>best) best=val;
    if (best>alpha) alpha=best;
    if (alpha>=beta) break;
  }
  return best;
}


