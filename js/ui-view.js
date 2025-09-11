// ui-view.js —— 视图/交互层（DOM 渲染、动画、事件、状态栏），调用 ui-core.js
import * as core from './ui-core.js';
import { COLORS } from './logic.js';

// ========== DOM ==========
const boardEl       = document.getElementById('board');
const statusEl      = document.getElementById('status');
const resetBtn      = document.getElementById('resetBtn');
const undoBtn       = document.getElementById('undoBtn');
const aiRedToggle   = document.getElementById('aiRedToggle');
const aiBlackToggle = document.getElementById('aiBlackToggle');
const aiLevelSelect = document.getElementById('aiLevel');

// ========== 读 CSS 变量 ==========
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

// ========== 图片映射 ==========
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
function codeOf(p){ return (p.color===COLORS.RED ? 'r':'b') + p.type; }
function imgSrcOf(p){ return PIECE_IMG[codeOf(p)] || null; }

// ========== 渲染节流 ==========
let renderScheduled = false;
function scheduleRender(){
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(()=>{ renderScheduled=false; render(); });
}

// ========== 交互状态（仅视图层） ==========
let aiThinking=false; // 控制“AI思考中…”显示与禁点
let animating=false;  // 控制动画进行中禁点

// ========== 绑定事件 ==========
boardEl.addEventListener('click', onBoardClick);
resetBtn?.addEventListener('click', () => { const s = initFromURL(); applySnapshot(s); });
undoBtn?.addEventListener('click', () => { const s = core.undo(); applySnapshot(s); });
aiRedToggle?.addEventListener('change', () => { core.setAIConfig({ aiRed: !!aiRedToggle.checked }); updateStatus(); maybeTriggerAI(); });
aiBlackToggle?.addEventListener('change', () => { core.setAIConfig({ aiBlack: !!aiBlackToggle.checked }); updateStatus(); maybeTriggerAI(); });
aiLevelSelect?.addEventListener('change', () => { core.setAILevels({ aiLevelR: aiLevelSelect.value, aiLevelB: aiLevelSelect.value }); updateStatus(); maybeTriggerAI(); });
window.addEventListener('resize', () => { ({offX:BOARD_OFF_X, offY:BOARD_OFF_TOP, stepX:BOARD_STEP_X, stepY:BOARD_STEP_Y} = readCSSNumbers()); scheduleRender(); });

// ========== URL 预设 ==========
function getURLParams(){
  const p = new URLSearchParams(location.search);
  return {
    aiRed:    p.get('aiRed') === '1',
    aiBlack:  p.get('aiBlack') === '1',
    aiLevelR: p.get('aiLevelR') || p.get('aiLevel') || 'medium',
    aiLevelB: p.get('aiLevelB') || p.get('aiLevel') || 'medium',
  };
}

// ========== 初始化 ==========
function initFromURL(){
  const preset = getURLParams();
  const snap = core.init(preset);
  if (aiRedToggle)   aiRedToggle.checked   = !!preset.aiRed;
  if (aiBlackToggle) aiBlackToggle.checked = !!preset.aiBlack;
  if (aiLevelSelect) aiLevelSelect.value   = preset.aiLevelR || 'medium';
  return snap;
}
function applySnapshot(){
  render(); updateStatus();
  if (core.isCurrentSideAI()) maybeTriggerAI();
}

// ========== 渲染（含图片重试兜底） ==========
function render(){
  const { board, selected, legalTargets } = core.getSnapshot();
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
      cell.style.top  = top + '%';
      cell.style.width  = BOARD_STEP_X + '%';
      cell.style.height = BOARD_STEP_Y + '%';

      const p = board[r][c];
      if (p) {
        const src = imgSrcOf(p);
        if (src) {
          const img = document.createElement('img');
          img.className = 'piece-img';
          img.src = src; img.alt = codeOf(p); img.draggable = false;
          img.decoding = 'async'; img.loading='eager'; try{ img.fetchPriority='high'; }catch{}
          img.onerror = () => {
            if (!img.dataset._retried) { img.dataset._retried='1'; img.src = img.src + (img.src.includes('?')?'&':'?') + 'v=' + Date.now(); return; }
            img.style.display='none';
            const fallback = document.createElement('div');
            fallback.className='piece-label';
            Object.assign(fallback.style,{position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',width:'80%',aspectRatio:'1/1',borderRadius:'50%',display:'grid',placeItems:'center',background:'#fffdf7',border:'2px solid #c9b9a5',fontWeight:'700',userSelect:'none'});
            fallback.textContent = img.alt?.toUpperCase()||'X';
            cell.appendChild(fallback);
          };
          cell.appendChild(img);
        }
        if (selected && selected.row===r && selected.col===c){
          const ring = document.createElement('div'); ring.className='select-ring'; cell.classList.add('selected'); cell.appendChild(ring);
        }
      }

      if (selected && legalTargets.some(t => t.row===r && t.col===c)){
        const targetHasPiece = !!board[r][c];
        const d = document.createElement('div'); d.className = targetHasPiece ? 'capture' : 'hint'; cell.appendChild(d);
      }

      boardEl.appendChild(cell);
    }
  }
}

// ========== 状态栏 ==========
function updateStatus(extra){
  const { baseStatus, warnings } = core.getSnapshot();
  let aiNote = '';
  if (core.isCurrentSideAI()){
    const level = aiLevelSelect?.value || 'medium';
    aiNote = `（AI：${level==='easy'?'简单':level==='hard'?'困难':'普通'}）`;
  }
  const txt = [ baseStatus, aiThinking?'AI思考中…':'', aiNote, warnings.text, extra||'' ]
    .filter(Boolean).join(' ｜ ');
  if (statusEl) statusEl.textContent = txt.trim();
}

// ========== 点击交互 ==========
function onBoardClick(e){
  if (aiThinking || animating) return;
  if (core.isCurrentSideAI()) return;

  const rect = boardEl.getBoundingClientRect();
  const xPct = ((e.clientX - rect.left) / rect.width ) * 100;
  const yPct = ((e.clientY - rect.top  ) / rect.height) * 100;
  const c = Math.round((xPct - BOARD_OFF_X)  / BOARD_STEP_X);
  const r = Math.round((yPct - BOARD_OFF_TOP) / BOARD_STEP_Y);
  if (r<0 || r>9 || c<0 || c>8) return;

  // 关键：先读取“点击前”的选中与可走
  const { selected: prevSel, legalTargets: prevTargets } = core.getSnapshot();

  // 如果点到了先前选中棋子的合法目标 -> 直接走子
  if (prevSel && prevTargets.some(t => t.row===r && t.col===c)){
    const from = { row: prevSel.row, col: prevSel.col };
    const to   = { row: r,          col: c };
    doAnimatedMove(from, to, () => {
      const ret = core.commitMove(from, to);

    // NEW: 通知在线模块这是一次“本地玩家的落子”
     window.dispatchEvent(new CustomEvent('local-move', { detail: { from, to } }));

      if (ret.end){ render(); updateStatus(ret.text); return; }
      render(); updateStatus();
      if (ret.aiShouldPlay) maybeTriggerAI();
    });
    return;
  }

  // 否则：只是改变选中
  core.selectSquare(r,c);
  scheduleRender(); updateStatus();
}


// ========== 动画 ==========
function doAnimatedMove(from, to, done){
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
    clone = document.createElement('div');
    clone.className='piece-label';
    Object.assign(clone.style,{position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',width:'80%',aspectRatio:'1/1',borderRadius:'50%',display:'grid',placeItems:'center',background:'#fffdf7',border:'2px solid #c9b9a5',fontWeight:'700'});
    clone.textContent='●';
  }

  clone.style.position='absolute';
  clone.style.left = (a.left - boardRect.left + a.width/2) + 'px';
  clone.style.top  = (a.top  - boardRect.top  + a.height/2) + 'px';
  clone.style.transform = 'translate(-50%, -50%)';
  clone.style.transition= 'left 220ms ease, top 220ms ease';
  boardEl.appendChild(clone);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    boardEl.removeChild(clone);
    animating = false;
    done();
  };
  clone.addEventListener('transitionend', cleanup, { once:true });
  clone.addEventListener('transitioncancel', cleanup, { once:true });
  setTimeout(cleanup, 300);

  requestAnimationFrame(() => {
    clone.style.left = (b.left - boardRect.left + b.width/2) + 'px';
    clone.style.top  = (b.top  - boardRect.top  + b.height/2) + 'px';
  });
}

// ========== AI 回合 ==========
async function maybeTriggerAI(){
  if (!core.isCurrentSideAI()) return;
  aiThinking = true; updateStatus();
  try{
    const mv = await core.computeAIMove();
    if (!mv) { aiThinking=false; updateStatus(); return; }
    await new Promise(r => setTimeout(r, 60));
    doAnimatedMove(mv.from, mv.to, () => {
      const ret = core.commitMove(mv.from, mv.to);
      render();
      if (ret.end){ aiThinking=false; updateStatus(ret.text); return; }
      updateStatus();
      aiThinking=false;
      if (core.isCurrentSideAI()) maybeTriggerAI();
    });
  }catch(e){
    aiThinking=false; updateStatus();
  }
}

// 启动
applySnapshot(initFromURL());
