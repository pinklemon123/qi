// ui.js —— UI/交互层（含图片加载增强、反重复/防长将告警、红/黑双 AI、URL 参数预设、候选走法传后端）
import {
  COLORS, createInitialBoard, legalMovesAt, isInCheck,
  checkMateStatus, deepCopyBoard, other, collectAllLegalMoves
} from './logic.js';

// ========== DOM ========== //
const boardEl       = document.getElementById('board');
const statusEl      = document.getElementById('status');
const resetBtn      = document.getElementById('resetBtn');
const undoBtn       = document.getElementById('undoBtn');
const aiRedToggle   = document.getElementById('aiRedToggle');
const aiBlackToggle = document.getElementById('aiBlackToggle');
const aiLevelSelect = document.getElementById('aiLevel');

// ========== 棋子图片映射（14 张） ========== //
const PIECE_IMG = {
  rK: 'img/pieces/red-king.png',     rA: 'img/pieces/red-advisor.png',
  rB: 'img/pieces/red-elephant.png', rN: 'img/pieces/red-horse.png',
  rR: 'img/pieces/red-rook.png',     rC: 'img/pieces/red-cannon.png',
  rP: 'img/pieces/red-soldier.png',
  bK: 'img/pieces/black-king.png',   bA: 'img/pieces/black-advisor.png',
  bB: 'img/pieces/black-elephant.png', bN: 'img/pieces/black-horse.png',
  bR: 'img/pieces/black-rook.png',   bC: 'img/pieces/black-cannon.png',
  bP: 'img/pieces/black-soldier.png',
};
const ALL_PIECE_URLS = [...new Set(Object.values(PIECE_IMG))];

function codeOf(p){ return (p.color===COLORS.RED ? 'r':'b') + p.type; }
function imgSrcOf(p){ return PIECE_IMG[codeOf(p)] || null; }

// ========== 读 CSS 变量（与 style.css 对齐） ========== //
function readCSSNumbers() {
  const s1 = getComputedStyle(boardEl);
  const s2 = getComputedStyle(document.documentElement);
  const offX = parseFloat(s1.getPropertyValue('--off-x')) || parseFloat(s2.getPropertyValue('--board-off-x')) || 0;
  const offY = parseFloat(s1.getPropertyValue('--off-top')) || parseFloat(s2.getPropertyValue('--board-off-top')) || 0;
  const stepX = (100 - 2*offX) / 8; // 9列 -> 8间距
  const stepY = (100 - 2*offY) / 9; // 10行 -> 9间距
  return { offX, offY, stepX, stepY };
}
let { offX:BOARD_OFF_X, offY:BOARD_OFF_TOP, stepX:BOARD_STEP_X, stepY:BOARD_STEP_Y } = readCSSNumbers();

// ========== 图片预加载（缓解首渲染慢 & 偶发抖动） ========== //
let preloadedOnce = false;
function preloadPieces(timeoutMs = 12000){
  if (preloadedOnce) return Promise.resolve();
  const timeout = new Promise((_,rej)=>setTimeout(()=>rej(new Error('preload timeout')), timeoutMs));
  const jobs = ALL_PIECE_URLS.map(u => new Promise((resolve) => {
    const im = new Image();
    im.decoding = 'async';
    im.loading = 'eager';
    try { im.fetchPriority = 'high'; } catch {}
    im.onload = () => resolve(true);
    im.onerror = () => resolve(false);
    im.src = u;
  }));
  preloadedOnce = true;
  return Promise.race([Promise.all(jobs), timeout]).catch(()=>{});
}

// ========== 渲染节流（防止频繁重排） ========== //
let renderScheduled = false;
function scheduleRender(){
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => { renderScheduled = false; render(); });
}

// ========== 反重复 / 防长将参数 ========== //
const REP_LIMIT = 5;         // 同局面 ≥5 次 -> 警告
const PINGPONG_LIMIT = 5;    // A→B / B→A 来回 ≥5 次 -> 警告
const CHECK_STREAK_LIMIT = 5;// 同一方连续将军 ≥5 次 -> 警告

// 局面重复：key = serializeBoardForAI(board)+'|'+(当前行棋方 'r'/'b')
const repCounts = new Map();         // Map<posKey, count>
const historyPosKeys = [];           // 最近的 posKey（最多存 40）
const AVOID_KEYS_SEND_THRESHOLD = 4; // ≥4 次的局面，强烈建议 AI 回避（发给后端）

// 来回对走检测（ping-pong）
let pingPongCount = 0;
let lastMove = null;  // {from:{r,c}, to:{r,c}}
let prevMove = null;  // 记录对手上一手（用于判断往返）

// 同一方连续将军次数
const checkStreak = { r:0, b:0 };

// ========== 游戏状态（UI 层） ========== //
let board, current, selected=null, legalTargets=[];
let history = [];
let redAI = false, blackAI = false;
let aiLevelR = 'medium', aiLevelB = 'medium';
let aiThinking = false, animating = false;

// ========== 事件 ========== //
boardEl.addEventListener('click', onBoardClick);
resetBtn?.addEventListener('click', init);
undoBtn?.addEventListener('click', undoMove);
aiRedToggle?.addEventListener('change', () => { redAI = !!aiRedToggle.checked; updateStatus(); maybeTriggerAI(); });
aiBlackToggle?.addEventListener('change', () => { blackAI = !!aiBlackToggle.checked; updateStatus(); maybeTriggerAI(); });
aiLevelSelect?.addEventListener('change', () => {
  aiLevelR = aiLevelSelect.value || 'medium';
  aiLevelB = aiLevelSelect.value || 'medium';
  updateStatus(); maybeTriggerAI();
});
window.addEventListener('resize', () => { ({offX:BOARD_OFF_X, offY:BOARD_OFF_TOP, stepX:BOARD_STEP_X, stepY:BOARD_STEP_Y} = readCSSNumbers()); scheduleRender(); });

// ========== URL 参数（来自 mode.html） ========== //
function getURLParams(){
  const p = new URLSearchParams(location.search);
  return {
    aiRed:    p.get('aiRed') === '1',
    aiBlack:  p.get('aiBlack') === '1',
    aiLevelR: p.get('aiLevelR') || p.get('aiLevel') || 'medium',
    aiLevelB: p.get('aiLevelB') || p.get('aiLevel') || 'medium',
  };
}

// ========== 序列化（供 AI/重复检测） ========== //
function serializeBoardForAI(b){
  const map = p => {
    if (!p) return '.';
    const m = { R:'r', N:'n', B:'b', A:'a', K:'k', C:'c', P:'p' }[p.type] || '?';
    return p.color===COLORS.RED ? m.toUpperCase() : m;
  };
  return b.map(row => row.map(map).join('')).join('/');
}
function posKeyForSide(b, side){ // side: COLORS.RED/BLACK
  const s = (side===COLORS.RED) ? 'r':'b';
  return serializeBoardForAI(b) + '|' + s;
}

// ========== 初始化 ========== //
async function init(){
  const preset = getURLParams();

  board   = createInitialBoard();
  current = COLORS.RED;
  selected = null; legalTargets = [];
  aiThinking = false; animating = false;
  redAI   = preset.aiRed;   blackAI = preset.aiBlack;
  aiLevelR = preset.aiLevelR; aiLevelB = preset.aiLevelB;

  if (aiRedToggle)   aiRedToggle.checked   = redAI;
  if (aiBlackToggle) aiBlackToggle.checked = blackAI;
  if (aiLevelSelect) aiLevelSelect.value = current===COLORS.RED ? aiLevelR : aiLevelB;

  history = [{ board: deepCopyBoard(board), current }];

  // 重置重复检测器
  repCounts.clear();
  historyPosKeys.length = 0;
  pingPongCount = 0;
  lastMove = null; prevMove = null;
  checkStreak.r = 0; checkStreak.b = 0;

  // 记录开局局面
  touchPositionCounter();

  preloadPieces();
  render(); updateStatus();

  maybeTriggerAI();
}

// ========== 渲染（含图片加载增强） ========== //
function render(){
  if (!boardEl) return;
  if (animating) return;

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
        const src = imgSrcOf(p);
        if (src) {
          const img = document.createElement('img');
          img.className = 'piece-img';
          img.src = src;
          img.alt = codeOf(p);
          img.draggable = false;

          // 加速加载 + 失败重试 + 兜底文字
          img.decoding = 'async';
          img.loading = 'eager';
          try { img.fetchPriority = 'high'; } catch {}
          img.onerror = () => {
            if (!img.dataset._retried) {
              img.dataset._retried = '1';
              img.src = img.src + (img.src.includes('?') ? '&' : '?') + 'v=' + Date.now();
              return;
            }
            img.style.display = 'none';
            const fallback = document.createElement('div');
            fallback.className = 'piece-label';
            fallback.textContent = img.alt?.toUpperCase() || 'X';
            Object.assign(fallback.style, {
              position:'absolute', left:'50%', top:'50%', transform:'translate(-50%,-50%)',
              width:'80%', aspectRatio:'1/1', borderRadius:'50%', display:'grid', placeItems:'center',
              background:'#fffdf7', border:'2px solid #c9b9a5', fontWeight:'700', userSelect:'none'
            });
            cell.appendChild(fallback);
          };

          cell.appendChild(img);
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

// ========== 交互 ========== //
function onBoardClick(e){
  if (aiThinking || animating) return;
  if ((current===COLORS.RED && redAI) || (current===COLORS.BLACK && blackAI)) return;

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
    scheduleRender(); return;
  }

  selected = null; legalTargets = []; scheduleRender();
}

// ========== 棋子移动/动画 ========== //
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
    i.decoding = 'async';
    i.loading = 'eager';
    try { i.fetchPriority = 'high'; } catch {}
    clone = i;
  }

  clone.style.position = 'absolute';
  clone.style.left   = (a.left - boardRect.left + a.width/2) + 'px';
  clone.style.top    = (a.top  - boardRect.top  + a.height/2) + 'px';
  clone.style.transform = 'translate(-50%, -50%)';
  clone.style.transition = 'left 220ms ease, top 220ms ease';
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

  // 记录 ping-pong（当前走是否与对手上一手反向一致）
  const thisMove = { from:{row:from.row, col:from.col}, to:{row:to.row, col:to.col} };
  if (prevMove &&
      prevMove.from.row===thisMove.to.row && prevMove.from.col===thisMove.to.col &&
      prevMove.to.row===thisMove.from.row && prevMove.to.col===thisMove.from.col) {
    pingPongCount++;
  } else {
    pingPongCount = 0;
  }

  selected = null; legalTargets = [];

  animateMove(from, to, movingPiece, () => {
    board[to.row][to.col] = movingPiece;
    board[from.row][from.col] = null;

    // 判断是否“将军”（用于长将计数）
    const opponent = other(current);
    const gaveCheck = isInCheck(board, opponent);
    if (current===COLORS.RED) {
      checkStreak.r = gaveCheck ? (checkStreak.r+1) : 0;
    } else {
      checkStreak.b = gaveCheck ? (checkStreak.b+1) : 0;
    }

    // 更新 last/prev（注意顺序：当前走完，这步成为“lastMove”，对手之前的那步是 prevMove）
    prevMove = lastMove;
    lastMove = thisMove;

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

  // 撤销后，简单清零反重复计数（实现更严谨的回溯较复杂，这里取折中）
  repCounts.clear(); historyPosKeys.length = 0;
  pingPongCount = 0; lastMove=null; prevMove=null; checkStreak.r=0; checkStreak.b=0;
  touchPositionCounter();

  selected = null; legalTargets = [];
  render(); updateStatus();
}

function postMove(){
  const next = other(current);
  const mate = checkMateStatus(board, next);
  if (mate.mate){
    render(); statusEl.textContent = `${current===COLORS.RED?'红方':'黑方'}胜！（将死）`; return;
  }
  if (mate.stalemate){
    render(); statusEl.textContent = '和棋（无子可动）'; return;
  }

  // 切换行棋方
  current = next;
  history.push({ board: deepCopyBoard(board), current });

  // 记录新局面并做“磨棋/长将”告警
  touchPositionCounter();

  render(); updateStatus();
  maybeTriggerAI();
}

// ========== 状态条 / 告警 ========== //
function updateStatus(extra){
  const sideTxt = current===COLORS.RED ? '红方' : '黑方';
  const inCheck = isInCheck(board, current) ? ' - 将军！' : '';
  let aiNote = '';
  if (current===COLORS.RED && redAI)     aiNote = `（AI：${toCN(aiLevelR)}）`;
  if (current===COLORS.BLACK && blackAI) aiNote = `（AI：${toCN(aiLevelB)}）`;

  const warn = buildRepetitionWarningText();
  let txt = `${sideTxt}走棋${inCheck} ${aiThinking? '｜AI思考中…':''} ${aiNote} ${warn? '｜'+warn : ''}`;
  if (extra) txt = `${extra} | ${txt}`;
  if (statusEl) statusEl.textContent = txt.trim();
}
function toCN(level){ return level==='easy'?'简单':level==='hard'?'困难':'普通'; }

function buildRepetitionWarningText(){
  const manyPos = getAvoidKeys().length>0;
  const tooPing = pingPongCount >= PINGPONG_LIMIT;
  const tooCheck= (checkStreak.r>=CHECK_STREAK_LIMIT || checkStreak.b>=CHECK_STREAK_LIMIT);
  if (manyPos || tooPing || tooCheck){
    return '⚠️ 避免磨棋/长将：更换走法';
  }
  return '';
}

// 记录/统计当前局面；维护 repCounts / historyPosKeys
function touchPositionCounter(){
  const key = posKeyForSide(board, current);
  const n = (repCounts.get(key) || 0) + 1;
  repCounts.set(key, n);
  historyPosKeys.push(key);
  if (historyPosKeys.length > 40) historyPosKeys.shift();
}

// 需要 AI 回避的局面（≥4 次）
function getAvoidKeys(){
  const bad = [];
  for (const [k,v] of repCounts.entries()){
    if (v >= AVOID_KEYS_SEND_THRESHOLD) bad.push(k);
  }
  return bad;
}

// ========== AI：按当前方决定是否调用；向后端发送候选步 + 反重复线索 ========== //
async function maybeTriggerAI(){
  const side = current;
  const needAI = (side===COLORS.RED && redAI) || (side===COLORS.BLACK && blackAI);
  if (!needAI) return;

  aiThinking = true; updateStatus();
  try{
    const mv = await requestAIMove(side);
    if (mv && isAIMoveValid(mv, side)) {
      // 小延时让观感更自然
      await new Promise(r => setTimeout(r, 60));
      makeAndApplyMove(mv.from, mv.to);
    } else {
      const fallback = fallbackAIMove(side);
      if (fallback) makeAndApplyMove(fallback.from, fallback.to);
    }
  }catch(err){
    console.error('AI move error:', err);
    const fallback = fallbackAIMove(side);
    if (fallback) makeAndApplyMove(fallback.from, fallback.to);
  }finally{
    aiThinking = false; updateStatus();
  }
}
function isAIMoveValid(mv, side){
  const p = board[mv.from.row][mv.from.col];
  if (!p || p.color!==side) return false;
  const moves = legalMovesAt(board, mv.from.row, mv.from.col, side);
  return moves.some(m => m.row===mv.to.row && m.col===mv.to.col);
}

// 启发式兜底：避免导致重复局面的走法
function fallbackAIMove(side){
  const moves = collectAllLegalMoves(board, side);
  if (!moves.length) return null;

  const avoidSet = new Set(getAvoidKeys());
  const scoreOf = (m)=>{
    let s = 0;
    const tgt = board[m.to.row][m.to.col];
    if (tgt) {
      const map = { R:500, N:300, B:250, A:250, K:10000, C:450, P:100 };
      const isEnemy = (side===COLORS.RED) ? (tgt.color===COLORS.BLACK) : (tgt.color===COLORS.RED);
      if (isEnemy) s += map[tgt.type] || 1;
    }
    // 中心活跃度
    const centerDist = Math.abs(4 - m.to.col) + Math.abs(4.5 - m.to.row);
    s += (8 - centerDist) * 0.8;
    // 兵/卒向前
    const mover = board[m.from.row][m.from.col];
    if (mover && mover.type==='P') {
      s += side===COLORS.RED ? (m.from.row>m.to.row ? 6 : 0) : (m.to.row>m.from.row ? 6 : 0);
    }
    // 预测新局面是否在“回避列表”
    const nextSide = other(side);
    const simKey = posKeyForSide(simApply(board, m), nextSide);
    if (avoidSet.has(simKey)) s -= 1e4;
    if (pingPongCount >= PINGPONG_LIMIT) s -= 500; // 避免来回对走
    if ((side===COLORS.RED && checkStreak.r>=CHECK_STREAK_LIMIT) ||
        (side===COLORS.BLACK && checkStreak.b>=CHECK_STREAK_LIMIT)) s -= 800; // 避免长将
    return s;
  };
  const sorted = [...moves].sort((a,b)=>scoreOf(b)-scoreOf(a));
  for (const m of sorted){
    const nextSide = other(side);
    const key = posKeyForSide(simApply(board, m), nextSide);
    if (!getAvoidKeys().includes(key)) return m;
  }
  return sorted[0] || null;
}

// 模拟落子（不改原盘）
function simApply(b, m){
  const nb = deepCopyBoard(b);
  nb[m.to.row][m.to.col] = nb[m.from.row][m.from.col];
  nb[m.from.row][m.from.col] = null;
  return nb;
}

// 发送：棋盘 + 当前方 + 候选走法 + 反重复线索
async function requestAIMove(side){
  const difficulty = side===COLORS.RED ? aiLevelR : aiLevelB;
  const choices = collectAllLegalMoves(board, side).map(m => ({
    from: [m.from.row, m.from.col],
    to:   [m.to.row,   m.to.col]
  }));
  if (!choices.length) return null;

  const payload = {
    board: serializeBoardForAI(board),          // 10行'/'分隔；大写=红，小写=黑，'.'=空
    side:  side===COLORS.RED ? 'r':'b',         // 'r' / 'b'
    difficulty,
    choices,
    repetition: {
      avoidKeys: getAvoidKeys(),                // ≥4 次的局面（强烈回避）
      historyKeys: historyPosKeys.slice(-20),   // 最近局面（最多 20）
      pingPongCount,
      checkStreak
    }
  };

  const res = await fetch('/api/ai/move', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`AI HTTP ${res.status}`);

  const data = await res.json();
  if (Array.isArray(data?.from) && Array.isArray(data?.to)) {
    return { from:{row:data.from[0], col:data.from[1]}, to:{row:data.to[0], col:data.to[1]} };
  }
  if (Number.isInteger(data?.index) && data.index>=0 && data.index<choices.length) {
    const pick = choices[data.index];
    return { from:{row:pick.from[0], col:pick.from[1]}, to:{row:pick.to[0], col:pick.to[1]} };
  }
  return null;
}

// ========== 启动 ========== //
init();
