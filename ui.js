// ui.js —— 渲染/交互/模式选择参数支持；依赖 logic.js
import {
  COLORS, createInitialBoard, legalMovesAt, deepCopyBoard,
  other, checkMateStatus, isInCheck, collectAllLegalMoves, bestMoveMinimax
} from './logic.js';

/* ========== 读取模式页传参（来自 mode.html） ========== */
// /index.html?redAI=0|1&blackAI=0|1&level=easy|medium|hard
function getBootParams(){
  const sp = new URLSearchParams(location.search);
  return {
    bootRedAI:   sp.get('redAI') === '1',
    bootBlackAI: sp.get('blackAI') === '1',
    bootLevel:   sp.get('level') || 'medium',
  };
}
const { bootRedAI, bootBlackAI, bootLevel } = getBootParams();

/* ========== DOM ========== */
const boardEl  = document.getElementById('board');
const statusEl = document.getElementById('status');

const resetBtn   = document.getElementById('resetBtn');
const undoBtn    = document.getElementById('undoBtn');
const aiLevelSel = document.getElementById('aiLevel');
const aiRedTgl   = document.getElementById('aiRedToggle');
const aiBlackTgl = document.getElementById('aiBlackToggle');
const menuBtn    = document.getElementById('menuBtn');

/* ========== CSS变量 -> 网格步长 ========== */
function readCSS() {
  const s1 = getComputedStyle(boardEl);
  const s2 = getComputedStyle(document.documentElement);
  const offX = parseFloat(s1.getPropertyValue('--off-x')) || parseFloat(s2.getPropertyValue('--board-off-x')) || 0;
  const offY = parseFloat(s1.getPropertyValue('--off-top')) || parseFloat(s2.getPropertyValue('--board-off-top')) || 0;
  const stepX = (100 - 2*offX) / 8; // 9列 -> 8间距
  const stepY = (100 - 2*offY) / 9; // 10行 -> 9间距
  return { offX, offY, stepX, stepY };
}
let { offX:OX, offY:OY, stepX:SX, stepY:SY } = readCSS();
window.addEventListener('resize', () => { ({offX:OX, offY:OY, stepX:SX, stepY:SY} = readCSS()); render(); });

/* ========== 图片映射（14张） ========== */
const PIECE_IMG = {
  rK:'img/pieces/red-king.png',     rA:'img/pieces/red-advisor.png',
  rB:'img/pieces/red-elephant.png', rN:'img/pieces/red-horse.png',
  rR:'img/pieces/red-rook.png',     rC:'img/pieces/red-cannon.png',
  rP:'img/pieces/red-soldier.png',
  bK:'img/pieces/black-king.png',   bA:'img/pieces/black-advisor.png',
  bB:'img/pieces/black-elephant.png', bN:'img/pieces/black-horse.png',
  bR:'img/pieces/black-rook.png',   bC:'img/pieces/black-cannon.png',
  bP:'img/pieces/black-soldier.png',
};
const codeOf = p => (p.color===COLORS.RED ? 'r':'b') + p.type;
const imgSrcOf = p => PIECE_IMG[codeOf(p)] || null;

// === 文字棋子兜底（图片缺失也能看到） ===
const PIECE_TEXT = {
  rK:'帅', rA:'仕', rB:'相', rN:'马', rR:'车', rC:'炮', rP:'兵',
  bK:'将', bA:'士', bB:'象', bN:'马', bR:'车', bC:'炮', bP:'卒',
};
function makePieceNode(p) {
  const src = imgSrcOf(p);
  if (src) {
    const img = document.createElement('img');
    img.className = 'piece-img';
    img.src = src;
    img.alt = codeOf(p);
    img.draggable = false;
    // 图片加载失败则退回文字
    img.onerror = () => {
      const span = document.createElement('span');
      span.className = 'piece-label ' + (p.color===COLORS.RED?'red':'black');
      span.textContent = PIECE_TEXT[codeOf(p)] || '?';
      img.replaceWith(span);
    };
    return img;
  }
  const span = document.createElement('span');
  span.className = 'piece-label ' + (p.color===COLORS.RED?'red':'black');
  span.textContent = PIECE_TEXT[codeOf(p)] || '?';
  return span;
}


/* ========== 状态 ========== */
let board, current, selected=null, targets=[];
let history=[];                 // 盘面快照
let redAI   = bootRedAI;
let blackAI = bootBlackAI;
let aiLevel = bootLevel;
let aiThinking = false;
let animating  = false;

/* ========== 初始化/事件 ========== */
function init(){
  board   = createInitialBoard();
  current = COLORS.RED;
  selected = null; targets = [];
  history = [{ board: deepCopyBoard(board), current }];

  if (aiRedTgl)   aiRedTgl.checked   = redAI;
  if (aiBlackTgl) aiBlackTgl.checked = blackAI;
  if (aiLevelSel) aiLevelSel.value   = aiLevel;

  render(); updateStatus();
  // 若开局红方即为 AI，则立即走第一步
  maybeTriggerAI();
}

resetBtn?.addEventListener('click', init);
undoBtn?.addEventListener('click', undoMove);
menuBtn?.addEventListener('click', () => { location.href = '/'; });


aiLevelSel?.addEventListener('change', () => {
  aiLevel = aiLevelSel.value || 'medium';
  updateStatus(); maybeTriggerAI();
});
aiRedTgl?.addEventListener('change', () => {
  redAI = !!aiRedTgl.checked;
  updateStatus(); maybeTriggerAI();
});
aiBlackTgl?.addEventListener('change', () => {
  blackAI = !!aiBlackTgl.checked;
  updateStatus(); maybeTriggerAI();
});

/* ========== 渲染 ========== */
function render(){
  boardEl.innerHTML = '';
  for (let r=0; r<10; r++){
    for (let c=0; c<9; c++){
      const cell = document.createElement('div');
      cell.className = `cell row-${r} col-${c}`;
      cell.dataset.row = r; cell.dataset.col = c;

      cell.style.left   = (OX + SX * c) + '%';
      cell.style.top    = (OY + SY * r) + '%';
      cell.style.width  = SX + '%';
      cell.style.height = SY + '%';

      const p = board[r][c];
      if (p) {
        const src = imgSrcOf(p);
        if (src) {
          const img = document.createElement('img');
          img.className = 'piece-img';
          img.src = src;
          img.alt = codeOf(p);
          img.draggable = false;
          cell.appendChild(img);
        } else {
          console.warn('Missing piece image for', codeOf(p));
        }
        if (selected && selected.row===r && selected.col===c){
          const ring = document.createElement('div');
          ring.className = 'select-ring';
          cell.classList.add('selected');
          cell.appendChild(ring);
        }
      }

      if (selected && targets.some(t => t.row===r && t.col===c)) {
        const hasEnemy = !!board[r][c];
        const d = document.createElement('div');
        d.className = hasEnemy ? 'capture' : 'hint';
        cell.appendChild(d);
      }

      cell.addEventListener('click', onCellClick);
      boardEl.appendChild(cell);
    }
  }
}

function updateStatus(extra){
  const sideName = current===COLORS.RED ? '红方' : '黑方';
  let txt = `${sideName}走棋`;
  if (isInCheck(board, current)) txt += ' - 将军！';

  const needAI = (current===COLORS.RED && redAI) || (current===COLORS.BLACK && blackAI);
  if (needAI) {
    txt = aiThinking ? `${sideName}AI思考中…` : `${txt}（AI：${aiLevel==='easy'?'简单':aiLevel==='hard'?'困难':'普通'}）`;
  }
  if (extra) txt = `${extra} | ${txt}`;
  if (statusEl) statusEl.textContent = txt;
}

/* ========== 交互 ========== */
function onCellClick(e){
  if (aiThinking || animating) return;
  // 若当前方是 AI，禁止人类下子
  if ((current===COLORS.RED && redAI) || (current===COLORS.BLACK && blackAI)) return;

  const r = +e.currentTarget.dataset.row;
  const c = +e.currentTarget.dataset.col;

  if (selected && targets.some(t => t.row===r && t.col===c)) {
    makeAndApplyMove(selected, {row:r, col:c});
    return;
  }
  const p = board[r][c];
  if (p && ((current===COLORS.RED && codeOf(p)[0]==='r') || (current===COLORS.BLACK && codeOf(p)[0]==='b'))) {
    selected = {row:r, col:c};
    targets  = legalMovesAt(board, r, c, current);
    render(); return;
  }
  selected = null; targets = []; render();
}

function makeAndApplyMove(from, to){
  const legal = legalMovesAt(board, from.row, from.col, current);
  if (!legal.some(m => m.row===to.row && m.col===to.col)) return;

  const movingPiece = board[from.row][from.col];
  selected = null; targets = [];

  animateMove(from, to, movingPiece, () => {
    board[to.row][to.col] = movingPiece;
    board[from.row][from.col] = null;
    postMove();
  });
}

function animateMove(from, to, piece, done){
  const fromCell = document.querySelector(`.cell.row-${from.row}.col-${from.col}`);
  const toCell   = document.querySelector(`.cell.row-${to.row}.col-${to.col}`);
  if (!fromCell || !toCell) return done();

  animating = true;
  const fromEl = fromCell.querySelector('.piece-img');
  const toEl   = toCell.querySelector('.piece-img');
  if (fromEl) fromEl.style.visibility = 'hidden';
  if (toEl)   toEl.style.visibility   = 'hidden';

  const boardRect = boardEl.getBoundingClientRect();
  const a = fromCell.getBoundingClientRect();
  const b = toCell.getBoundingClientRect();

  let clone = fromEl?.cloneNode(true);
  if (!clone) {
    const i = document.createElement('img');
    i.className = 'piece-img';
    i.src = imgSrcOf(piece) || '';
    i.alt = codeOf(piece);
    clone = i;
  }
  clone.style.position = 'absolute';
  clone.style.left   = (a.left - boardRect.left + a.width/2) + 'px';
  clone.style.top    = (a.top  - boardRect.top  + a.height/2) + 'px';
  clone.style.transform = 'translate(-50%, -50%)';
  clone.style.transition = 'left .25s ease, top .25s ease';
  boardEl.appendChild(clone);

  requestAnimationFrame(() => {
    clone.style.left = (b.left - boardRect.left + b.width/2) + 'px';
    clone.style.top  = (b.top  - boardRect.top  + b.height/2) + 'px';
  });

  clone.addEventListener('transitionend', () => {
    boardEl.removeChild(clone);
    animating = false;
    done();
  }, { once:true });
}

function postMove(){
  const next = other(current);
  const mate = checkMateStatus(board, next);

  if (mate.mate){
    render(); updateStatus(`${current===COLORS.RED?'红方':'黑方'}胜！（将死）`);
    return;
  }
  if (mate.stalemate){
    render(); updateStatus('和棋（无子可动）'); return;
  }

  current = next;
  history.push({ board: deepCopyBoard(board), current });
  render(); updateStatus();
  maybeTriggerAI();
}

function undoMove(){
  if (aiThinking || animating) return;
  if (history.length <= 1) return;
  history.pop();
  const prev = history[history.length-1];
  board   = deepCopyBoard(prev.board);
  current = prev.current;
  selected = null; targets = [];
  render(); updateStatus();
  // 若撤回到 AI 的回合，继续触发
  maybeTriggerAI();
}

/* ========== AI ========== */
async function maybeTriggerAI(){
  const needAI = (current===COLORS.RED && redAI) || (current===COLORS.BLACK && blackAI);
  if (!needAI) return;

  aiThinking = true; updateStatus();
  try{
    // 优先服务端模型（/api/ai/move），失败则本地策略兜底
    const mv = await requestAIMove();
    if (mv && isAIMoveValid(mv)) {
      makeAndApplyMove(mv.from, mv.to);
    } else {
      const fb = fallbackAIMove();
      if (fb) makeAndApplyMove(fb.from, fb.to);
    }
  } catch (err){
    console.error('AI move error:', err);
    const fb = fallbackAIMove();
    if (fb) makeAndApplyMove(fb.from, fb.to);
  } finally {
    aiThinking = false; updateStatus();
    // 双 AI 时，下一回合继续
    setTimeout(() => maybeTriggerAI(), 10);
  }
}

function isAIMoveValid(mv){
  const p = board[mv.from.row]?.[mv.from.col];
  if (!p) return false;
  const moves = legalMovesAt(board, mv.from.row, mv.from.col, current);
  return moves.some(m => m.row===mv.to.row && m.col===mv.to.col);
}

function fallbackAIMove(){
  const moves = collectAllLegalMoves(board, current);
  if (!moves.length) return null;
  if (aiLevel==='easy') return moves[Math.floor(Math.random()*moves.length)];
  if (aiLevel==='medium') {
    const caps = moves.filter(m => !!board[m.to.row][m.to.col]);
    const pool = caps.length ? caps : moves;
    return pool[Math.floor(Math.random()*pool.length)];
  }
  // hard: 简单极小极大
  return bestMoveMinimax(board, current, 2);
}

function requestAIMove(){
  const legalMoves = collectAllLegalMoves(board, current).map(m => ({
    from: [m.from.row, m.from.col],
    to:   [m.to.row,   m.to.col]
  }));
  const payload = {
    board: serializeBoardForAI(board),
    side: current===COLORS.RED ? 'r' : 'b',
    difficulty: aiLevel,
    legalMoves
  };
  return fetch('/api/ai/move', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  })
  .then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })
  .then(o => ({
    from:{row:o.from[0], col:o.from[1]},
    to:{row:o.to[0], col:o.to[1]}
  }));
}

/* ========== 序列化给后端 ========== */
function serializeBoardForAI(b){
  const map = p => {
    if (!p) return '.';
    const t = { R:'r', N:'n', B:'b', A:'a', K:'k', C:'c', P:'p' }[p.type] || '?';
    return (codeOf(p)[0]==='r') ? t.toUpperCase() : t;
  };
  return b.map(row => row.map(map).join('')).join('/');
}

/* ========== 启动 ========== */
init();
