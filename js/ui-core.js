// ui-core.js —— 纯逻辑/状态层（不碰 DOM）
import {
  COLORS, createInitialBoard, legalMovesAt, isInCheck,
  checkMateStatus, deepCopyBoard, other, collectAllLegalMoves
} from './logic.js';

// ======= 反重复 / 防长将参数 =======
const REP_LIMIT = 5;
const PINGPONG_LIMIT = 5;
const CHECK_STREAK_LIMIT = 5;
const AVOID_KEYS_SEND_THRESHOLD = 4;

// ======= 内部状态 =======
let board, current, selected=null, legalTargets=[];
let history = [];
let redAI=false, blackAI=false;
let aiLevelR='medium', aiLevelB='medium';

// 重复与长将统计
const repCounts = new Map();     // Map<posKey, count>
const historyPosKeys = [];       // 最近局面
let pingPongCount = 0;
let lastMove = null;             // {from:{row,col}, to:{row,col}}
let prevMove = null;
const checkStreak = { r:0, b:0 };

// ======= 工具：序列化局面 & key =======
function serializeBoardForAI(b){
  const map = p => {
    if (!p) return '.';
    const m = { R:'r', N:'n', B:'b', A:'a', K:'k', C:'c', P:'p' }[p.type] || '?';
    return p.color===COLORS.RED ? m.toUpperCase() : m;
  };
  return b.map(row => row.map(map).join('')).join('/');
}
function posKeyForSide(b, side){
  const s = (side===COLORS.RED) ? 'r':'b';
  return serializeBoardForAI(b) + '|' + s;
}

function touchPositionCounter(){
  const key = posKeyForSide(board, current);
  const n = (repCounts.get(key) || 0) + 1;
  repCounts.set(key, n);
  historyPosKeys.push(key);
  if (historyPosKeys.length > 40) historyPosKeys.shift();
}
function getAvoidKeys(){
  const bad = [];
  for (const [k,v] of repCounts.entries()) if (v >= AVOID_KEYS_SEND_THRESHOLD) bad.push(k);
  return bad;
}

// ======= 对外：初始化 / 配置 =======
export function init(preset={}){
  board   = createInitialBoard();
  current = COLORS.RED;
  selected = null; legalTargets = [];
  history = [{ board: deepCopyBoard(board), current }];

  // AI 配置
  redAI    = !!preset.aiRed;
  blackAI  = !!preset.aiBlack;
  aiLevelR = preset.aiLevelR || 'medium';
  aiLevelB = preset.aiLevelB || 'medium';

  // 统计器清零
  repCounts.clear(); historyPosKeys.length = 0;
  pingPongCount = 0; lastMove = null; prevMove = null; checkStreak.r = 0; checkStreak.b = 0;

  // 记录开局局面
  touchPositionCounter();

  return getSnapshot();
}
export function setAIConfig({ aiRed, aiBlack, aiLevel }){
  if (typeof aiRed === 'boolean')  redAI   = aiRed;
  if (typeof aiBlack === 'boolean') blackAI = aiBlack;
  if (aiLevel) { aiLevelR = aiLevel; aiLevelB = aiLevel; }
}
export function setAILevels({ aiLevelR: r, aiLevelB: b }){
  if (r) aiLevelR = r; if (b) aiLevelB = b;
}

// ======= 快照/状态文本 =======
export function getSnapshot(){
  return {
    board, current, selected, legalTargets: [...legalTargets],
    warnings: buildWarnings(),
    baseStatus: buildBaseStatus()
  };
}
function buildBaseStatus(){
  const sideTxt = current===COLORS.RED ? '红方' : '黑方';
  const inCheck = isInCheck(board, current) ? ' - 将军！' : '';
  return `${sideTxt}走棋${inCheck}`;
}
function buildWarnings(){
  const manyPos = getAvoidKeys().length>0;
  const tooPing = pingPongCount >= PINGPONG_LIMIT;
  const tooCheck= (checkStreak.r>=CHECK_STREAK_LIMIT || checkStreak.b>=CHECK_STREAK_LIMIT);
  const text = (manyPos||tooPing||tooCheck) ? '⚠️ 避免磨棋/长将：更换走法' : '';
  return {
    text,
    limits: { REP_LIMIT, PINGPONG_LIMIT, CHECK_STREAK_LIMIT },
    repetition: {
      avoidKeys: getAvoidKeys(),
      historyKeys: historyPosKeys.slice(-20),
      pingPongCount,
      checkStreak: { ...checkStreak }
    }
  };
}

// ======= 选择与走子（不做动画，由 view 调度） =======
export function selectSquare(r,c){
  const p = board?.[r]?.[c];
  if (p && p.color === current){
    selected = { row:r, col:c };
    legalTargets = legalMovesAt(board, r, c, current);
  } else {
    selected = null; legalTargets = [];
  }
  return getSnapshot();
}
export function isLegalTarget(r,c){
  return !!legalTargets.find(t => t.row===r && t.col===c);
}

// 提交走子（由 view 在动画结束后调用）
export function commitMove(from, to){
  const moves = legalMovesAt(board, from.row, from.col, current);
  if (!moves.some(m => m.row===to.row && m.col===to.col)) return { ok:false };

  const movingPiece = board[from.row][from.col];

  // 来回对走统计
  const thisMove = { from:{row:from.row,col:from.col}, to:{row:to.row,col:to.col} };
  if (prevMove &&
      prevMove.from.row===thisMove.to.row && prevMove.from.col===thisMove.to.col &&
      prevMove.to.row===thisMove.from.row && prevMove.to.col===thisMove.from.col) {
    pingPongCount++;
  } else {
    pingPongCount = 0;
  }

  // 落子
  board[to.row][to.col] = movingPiece;
  board[from.row][from.col] = null;

  // 长将统计
  const opponent = other(current);
  const gaveCheck = isInCheck(board, opponent);
  if (current===COLORS.RED) checkStreak.r = gaveCheck ? (checkStreak.r+1) : 0;
  else                      checkStreak.b = gaveCheck ? (checkStreak.b+1) : 0;

  // 更新 last / prev
  prevMove = lastMove; lastMove = thisMove;

  // 胜负或和棋判定
  const mate = checkMateStatus(board, opponent);
  if (mate.mate){
    history.push({ board: deepCopyBoard(board), current: opponent });
    selected=null; legalTargets=[];
    return { ok:true, end:true, text:`${current===COLORS.RED?'红方':'黑方'}胜！（将死）` };
  }
  if (mate.stalemate){
    history.push({ board: deepCopyBoard(board), current: opponent });
    selected=null; legalTargets=[];
    return { ok:true, end:true, text:'和棋（无子可动）' };
  }

  // 交换回合、记录局面
  current = opponent;
  history.push({ board: deepCopyBoard(board), current });
  touchPositionCounter();
  selected=null; legalTargets=[];

  return { ok:true, end:false, snapshot:getSnapshot(), aiShouldPlay: isCurrentSideAI() };
}

export function undo(){
  if (history.length <= 1) return getSnapshot();
  history.pop();
  const prev = history[history.length-1];
  board = deepCopyBoard(prev.board);
  current = prev.current;
  // 简化：撤销后清空统计并重算开局一次
  repCounts.clear(); historyPosKeys.length=0; pingPongCount=0; lastMove=null; prevMove=null; checkStreak.r=0; checkStreak.b=0;
  touchPositionCounter();
  selected=null; legalTargets=[];
  return getSnapshot();
}

// ======= AI 相关 =======
export function isCurrentSideAI(){
  return (current===COLORS.RED && redAI) || (current===COLORS.BLACK && blackAI);
}
export function currentSide(){ return current; }
export function boardState(){ return board; }

function difficultyOf(side){ return side===COLORS.RED ? aiLevelR : aiLevelB; }
function choicesFor(side){
  return collectAllLegalMoves(board, side).map(m => ({ from:[m.from.row,m.from.col], to:[m.to.row,m.to.col] }));
}

function fallbackAIMove(side){
  // 简易启发式，避免重复局面/长将
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
    const centerDist = Math.abs(4 - m.to.col) + Math.abs(4.5 - m.to.row);
    s += (8 - centerDist) * 0.8;
    const mover = board[m.from.row][m.from.col];
    if (mover && mover.type==='P') s += side===COLORS.RED ? (m.from.row>m.to.row ? 6 : 0) : (m.to.row>m.from.row ? 6 : 0);
    const next = deepCopyBoard(board);
    next[m.to.row][m.to.col] = next[m.from.row][m.from.col];
    next[m.from.row][m.from.col] = null;
    const nextKey = posKeyForSide(next, other(side));
    if (avoidSet.has(nextKey)) s -= 1e4;
    if (pingPongCount >= PINGPONG_LIMIT) s -= 500;
    if ((side===COLORS.RED && checkStreak.r>=CHECK_STREAK_LIMIT) || (side===COLORS.BLACK && checkStreak.b>=CHECK_STREAK_LIMIT)) s -= 800;
    return s;
  };
  const sorted = [...moves].sort((a,b)=>scoreOf(b)-scoreOf(a));
  for (const m of sorted){
    const next = deepCopyBoard(board);
    next[m.to.row][m.to.col] = next[m.from.row][m.from.col];
    next[m.from.row][m.from.col] = null;
    const k = posKeyForSide(next, other(side));
    if (!avoidSet.has(k)) return { from:{row:m.from.row,col:m.from.col}, to:{row:m.to.row,col:m.to.col} };
  }
  const m = sorted[0];
  return { from:{row:m.from.row,col:m.from.col}, to:{row:m.to.row,col:m.to.col} };
}

export async function computeAIMove(){
  const side = current;
  const choices = choicesFor(side);
  if (!choices.length) return null;
  const payload = {
    board: serializeBoardForAI(board),
    side:  side===COLORS.RED ? 'r':'b',
    difficulty: difficultyOf(side),
    choices,
    repetition: buildWarnings().repetition
  };
  try{
    const res = await fetch('/api/ai/move', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('AI HTTP '+res.status);
    const data = await res.json();
    if (Array.isArray(data?.from) && Array.isArray(data?.to)) {
      return { from:{row:data.from[0], col:data.from[1]}, to:{row:data.to[0], col:data.to[1]} };
    }
    if (Number.isInteger(data?.index) && data.index>=0 && data.index<choices.length) {
      const p = choices[data.index];
      return { from:{row:p.from[0], col:p.from[1]}, to:{row:p.to[0], col:p.to[1]} };
    }
  }catch(e){ /* fall back below */ }
  return fallbackAIMove(side);
}
// ======= 供 AI API 使用的简易棋盘处理函数 =======