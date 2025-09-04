// ui.js —— 与 DOM 交互；引入 logic.js
import {
  COLORS, TYPES, createInitialBoard, legalMovesAt, isInCheck,
  checkMateStatus, deepCopyBoard, other, collectAllLegalMoves
} from './logic.js';

// === DOM ===
const boardEl       = document.getElementById('board');
const statusEl      = document.getElementById('status');
const resetBtn      = document.getElementById('resetBtn');
const undoBtn       = document.getElementById('undoBtn');
const aiToggle      = document.getElementById('aiToggle');
const aiLevelSelect = document.getElementById('aiLevel');

// === CSS 变量（与 style.css 对齐） ===
function readCSSNumbers() {
  // 优先读 #board 暴露的变量；读不到再读 :root
  const s1 = getComputedStyle(boardEl);
  const s2 = getComputedStyle(document.documentElement);
  const offX = parseFloat(s1.getPropertyValue('--off-x')) || parseFloat(s2.getPropertyValue('--board-off-x')) || 0;
  const offY = parseFloat(s1.getPropertyValue('--off-top')) || parseFloat(s2.getPropertyValue('--board-off-top')) || 0;
  const stepX = (100 - 2*offX) / 8; // 9列 -> 8间距
  const stepY = (100 - 2*offY) / 9; // 10行 -> 9间距
  return { offX, offY, stepX, stepY };
}
let { offX:BOARD_OFF_X, offY:BOARD_OFF_TOP, stepX:BOARD_STEP_X, stepY:BOARD_STEP_Y } = readCSSNumbers();

// === 图片映射（按你的 14 张图） ===
const PIECE_IMG = {
  rK: 'img/pieces/red-king.png',
  rA: 'img/pieces/red-advisor.png',
  rB: 'img/pieces/red-elephant.png',
  rN: 'img/pieces/red-horse.png',
  rR: 'img/pieces/red-rook.png',
  rC: 'img/pieces/red-cannon.png',
  rP: 'img/pieces/red-soldier.png',
  bK: 'img/pieces/black-king.png',
  bA: 'img/pieces/black-advisor.png',
  bB: 'img/pieces/black-elephant.png',
  bN: 'img/pieces/black-horse.png',
  bR: 'img/pieces/black-rook.png',
  bC: 'img/pieces/black-cannon.png',
  bP: 'img/pieces/black-soldier.png',
};
function codeOf(p){
  const side = p.color === COLORS.RED ? 'r' : 'b';
  return side + p.type; // e.g. rK / bP
}
function imgSrcOf(p){ return PIECE_IMG[codeOf(p)] || null; }

// === 游戏状态（UI 层） ===
let board, current, selected=null, legalTargets=[];
let history = [];
let blackAI = false;
let aiLevel = 'medium';
let aiThinking = false;
let animating = false;

// === 事件 ===
boardEl.addEventListener('click', onBoardClick);
resetBtn?.addEventListener('click', init);
undoBtn?.addEventListener('click', undoMove);
aiToggle?.addEventListener('change', () => { blackAI = !!aiToggle.checked; updateStatus(); maybeTriggerAI(); });
aiLevelSelect?.addEventListener('change', () => { aiLevel = aiLevelSelect.value || 'medium'; updateStatus(); maybeTriggerAI(); });
window.addEventListener('resize', () => { ({offX:BOARD_OFF_X, offY:BOARD_OFF_TOP, stepX:BOARD_STEP_X, stepY:BOARD_STEP_Y} = readCSSNumbers()); render(); });

// === 初始化 ===
function init(){
  board   = createInitialBoard();
  current = COLORS.RED;
  selected = null; legalTargets = [];
  aiThinking = false;
  if (aiToggle) aiToggle.checked = blackAI;
  if (aiLevelSelect) aiLevelSelect.value = aiLevel;
  history = [{ board: deepCopyBoard(board), current }];
  render(); updateStatus();
}

// === 渲染 ===
function render(){
  boardEl.innerHTML = '';
  for (let r=0; r<10; r++){
    for (let c=0; c<9; c++){
      const cell = document.createElement('div');
      cell.className = `cell row-${r} col-${c}`;
      cell.dataset.row = r; cell.dataset.col = c;

      const left = BOARD_OFF_X + BOARD_STEP_X * c;
      const top  = BOARD_OFF_TOP + BOARD_STEP_Y * r;
      cell.style.left = left + '%';
      cell.style.top  = top  + '%';
      cell.style.width  = BOARD_STEP_X + '%';
      cell.style.height = BOARD_STEP_Y + '%';

       const p = board[r][c];
      if (p) {
        // 只渲染图片，不再回退到文字，避免出现“帅/將”
        const src = imgSrcOf(p);
        if (src) {
          const img = document.createElement('img');
          img.className = 'piece-img';
          img.src = src;
          img.alt = codeOf(p);
          img.draggable = false;
          cell.appendChild(img);
        } else {
          // 没有对应图片就不渲染（可在控制台提示）
          console.warn('Missing piece image for', codeOf(p));
        }
        if (selected && selected.row===r && selected.col===c){
          const ring = document.createElement('div');
          ring.className = 'select-ring';
          cell.classList.add('selected');
          cell.appendChild(ring);
        }
      }

      // 提示：可走/可吃
      if (selected && legalTargets.some(t => t.row===r && t.col===c)) {
        const targetHasPiece = !!board[r][c];
        const d = document.createElement('div');
        d.className = targetHasPiece ? 'capture' : 'hint';
        cell.appendChild(d);
      }

      boardEl.appendChild(cell);
    }
  }
}


// === 交互 ===
function onBoardClick(e){
  if (aiThinking || animating) return;
  const rect = boardEl.getBoundingClientRect();
  const xPct = ((e.clientX - rect.left) / rect.width ) * 100;
  const yPct = ((e.clientY - rect.top  ) / rect.height) * 100;
  const c = Math.round((xPct - BOARD_OFF_X)  / BOARD_STEP_X);
  const r = Math.round((yPct - BOARD_OFF_TOP) / BOARD_STEP_Y);
  if (r<0 || r>9 || c<0 || c>8) return;

  if (selected && legalTargets.some(t => t.row===r && t.col===c)) {
    makeAndApplyMove(selected, {row:r, col:c});
    return;
  }

  const p = board[r][c];
  if (p && p.color === current) {
    selected = {row:r, col:c};
    legalTargets = legalMovesAt(board, r, c, current);
    render(); return;
  }

  selected = null; legalTargets = []; render();
}

// === 棋子移动/动画 ===
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

  // 必须克隆图片；若没有 fromEl，则用映射补建一张 <img>
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

function makeAndApplyMove(from, to){
  const moves = legalMovesAt(board, from.row, from.col, current);
  if (!moves.some(m => m.row===to.row && m.col===to.col)) return;

  const movingPiece = board[from.row][from.col];
  // 先清选中，避免闪烁
  selected = null; legalTargets = [];

  // 动画后再落子，避免瞬移
  animateMove(from, to, movingPiece, () => {
    board[to.row][to.col] = movingPiece;
    board[from.row][from.col] = null;
    postMove();
  });
}

function undoMove(){
  if (aiThinking || animating) return;
  if (history.length <= 1) return;
  history.pop();
  const prev = history[history.length-1];
  board = deepCopyBoard(prev.board);
  current = prev.current;
  selected = null; legalTargets = [];
  render(); updateStatus();
}

function postMove(){
  // 回合切换/胜负判定/记录历史/触发AI
  const next = other(current);
  const mate = checkMateStatus(board, next);
  if (mate.mate){
    render(); statusEl.textContent = `${current===COLORS.RED?'红方':'黑方'}胜！（将死）`; return;
  }
  if (mate.stalemate){
    render(); statusEl.textContent = '和棋（无子可动）'; return;
  }

  current = next;
  history.push({ board: deepCopyBoard(board), current });
  render(); updateStatus();
  maybeTriggerAI();
}

// === 状态条 ===
function updateStatus(extra){
  const side = current===COLORS.RED ? '红方' : '黑方';
  let txt = `${side}走棋`;
  if (isInCheck(board, current)) txt += ' - 将军！';
  if (blackAI && current===COLORS.BLACK) {
    txt = aiThinking ? '黑方AI思考中…' : `${txt}（AI：${aiLevel==='easy'?'简单':aiLevel==='hard'?'困难':'普通'}）`;
  }
  if (extra) txt = `${extra} | ${txt}`;
  if (statusEl) statusEl.textContent = txt;
}

// === AI ===
async function maybeTriggerAI(){
  if (!(blackAI && current===COLORS.BLACK)) return;
  aiThinking = true; updateStatus();
  try{
    const mv = await requestAIMove();  // 优先调用后端
    if (mv && isAIMoveValid(mv)) { makeAndApplyMove(mv.from, mv.to); }
    else {
      const fallback = fallbackAIMove();
      if (fallback) makeAndApplyMove(fallback.from, fallback.to);
    }
  }catch(err){
    console.error('AI move error:', err);
    const fallback = fallbackAIMove();
    if (fallback) makeAndApplyMove(fallback.from, fallback.to);
  }finally{
    aiThinking = false; updateStatus();
  }
}
function fallbackAIMove(){
  const moves = collectAllLegalMoves(board, COLORS.BLACK);
  if (!moves.length) return null;
  // 简易难度策略可以自行扩展；这里直接随机
  return moves[Math.floor(Math.random()*moves.length)];
}
function isAIMoveValid(mv){
  const p = board[mv.from.row][mv.from.col];
  if (!p || p.color!==COLORS.BLACK) return false;
  const moves = legalMovesAt(board, mv.from.row, mv.from.col, COLORS.BLACK);
  return moves.some(m => m.row===mv.to.row && m.col===mv.to.col);
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
  }).then(r => r.json()).then(o => ({
    from:{row:o.from[0], col:o.from[1]},
    to:{row:o.to[0], col:o.to[1]}
  }));
}

function serializeBoardForAI(b){
  // 与你原先格式一致：10x9，Red 大写，Black 小写，. 为空
  const map = p => {
    if (!p) return '.';
    const m = { R:'r', N:'n', B:'b', A:'a', K:'k', C:'c', P:'p' }[p.type] || '?';
    return p.color===COLORS.RED ? m.toUpperCase() : m;
  };
  return b.map(row => row.map(map).join('')).join('/');
}

// === 启动 ===
init();
