// /api/ai/move.js
export const config = { runtime: 'edge' }; // 或删掉用 node 也行

const OPENAI_API = process.env.OPENAI_API || 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const DEEPSEEK_API = process.env.DEEPSEEK_API || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return json({ error:'bad json' }, 400); }

  const { board, side, difficulty='medium', choices } = body || {};
  if (!board || !side || !Array.isArray(choices) || !choices.length) {
    return json({ error:'missing board/side/choices' }, 400);
  }

  // ---- quick heuristic fallback (also used for easy/medium) ----
  const grid = parseBoard(board); // 10x9 char[][]
  const scored = scoreChoices(grid, choices, side);
  const pickHeuristic = (tier) => {
    // easy: 随机偏差更大
    // medium: 软最大值
    // hard: 取分最高（若 LLM 失效也能正常下）
    if (tier === 'easy')    return randWeighted(scored, 0.6);
    if (tier === 'medium')  return softmaxPick(scored, 1.2);
    return scored[0];  // hard 默认最高分
  };

  // 如果没配置密钥，直接用启发式
  if ((side === 'r' && !OPENAI_KEY) || (side === 'b' && !DEEPSEEK_KEY)) {
    const pick = pickHeuristic(difficulty);
    return json({ from: pick.choice.from, to: pick.choice.to });
  }

  // ---- Ask LLM to pick index among candidates ----
  const sys = [
    'You are a Xiangqi (Chinese Chess) assistant.',
    'You are given the full board and ALL legal candidate moves for the side to move.',
    'Pick the SINGLE best move index from candidates considering tactics and simple strategy.',
    'Return ONLY a compact JSON: {"index": <number>} with no extra text.',
    'Prioritize: checkmate > safe capture > attack high-value piece > improve activity > avoid blunders.',
  ].join(' ');

  const user = JSON.stringify({
    side,               // 'r' / 'b'
    board,              // 10 rows, '/' separated, '.' empty, uppercase=red, lowercase=black
    candidates: choices // [{from:[r,c], to:[r,c]}]
  });

  // 带一个“建议起点”供模型参考（但不是强制）
  const heuristicBest = pickHeuristic(difficulty)?.idx ?? 0;

  const messages = [
    { role:'system', content: sys },
    { role:'user',   content: user },
    { role:'assistant', content: `Suggestion (you may override): {"index": ${heuristicBest}}` }
  ];

  try {
    const { index } = await askModel(side, { messages, difficulty });
    if (Number.isInteger(index) && index >= 0 && index < choices.length) {
      return json({ index });
    }
  } catch (e) {
    // console.error('LLM error', e);
  }

  // LLM 失败就用启发式
  const fallback = pickHeuristic('hard');
  return json({ from: fallback.choice.from, to: fallback.choice.to });
}

async function askModel(side, { messages, difficulty }) {
  if (side === 'r') {
    // 红方 -> OpenAI
    const res = await fetch(OPENAI_API, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: difficulty==='hard' ? 0.8 : 0.2,
        response_format: { type: 'json_object' },
        messages
      })
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '{}';
    return safeJSON(text);
  } else {
    // 黑方 -> DeepSeek
    const res = await fetch(DEEPSEEK_API, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        temperature: difficulty==='hard' ? 0.8 : 0.2,
        response_format: { type: 'json_object' },
        messages
      })
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '{}';
    return safeJSON(text);
  }
}

// -------- utils: response helper --------
function json(obj, status=200){ return new Response(JSON.stringify(obj), { status, headers:{'Content-Type':'application/json'} }); }
function safeJSON(s){ try{ return JSON.parse(s); }catch{ return {}; } }

// -------- utils: board parsing & heuristic scoring --------
// board: "........./....." 10 rows '/', each 9 chars
function parseBoard(s){
  const rows = s.split('/');
  if (rows.length !== 10) throw new Error('bad board rows');
  return rows.map(r => r.split(''));
}
const VAL = { k:10000, r:500, c:450, n:300, b:250, a:250, p:100 }; // rook>cannon>knight>elephant/advisor>pawn
function pieceVal(ch){
  const low = ch.toLowerCase();
  return VAL[low] ?? 0;
}
// 根据 to 位置是否有敌子，给予加分；再加一点“向前”鼓励（兵/卒）
function scoreChoices(grid, choices, side){
  const isRed = side === 'r';
  const res = choices.map((choice, idx) => {
    const [fr,fc] = choice.from, [tr,tc] = choice.to;
    const target = grid[tr][tc];
    let s = 0;

    // 抓子加分（抓价值越高越好）
    if (target && target !== '.') {
      const isEnemy = isRed ? (target === target.toLowerCase()) : (target === target.toUpperCase());
      if (isEnemy) s += pieceVal(target) || 1;
      else s -= 5; // 绝不自吃（理论上不会出现，因为 choices 是合法生成）
    }

    // 兵/卒向前小奖励
    const mover = grid[fr][fc];
    if (mover && mover.toLowerCase() === 'p') {
      s += isRed ? (fr>tr ? 6 : 0) : (tr>fr ? 6 : 0);
    }

    // 更中心的格子微弱奖励（活跃度）
    const centerDist = Math.abs(4-tc) + Math.abs(4.5-tr);
    s += (8 - centerDist) * 0.8;

    return { idx, score: s, choice };
  });

  // 分数从高到低排序
  res.sort((a,b)=>b.score - a.score);
  return res;
}
// Softmax 随机（温度越大越随机）
function softmaxPick(scored, T=1.0){
  const exp = scored.map(x => Math.exp(x.score / T));
  const sum = exp.reduce((a,b)=>a+b,0);
  let r = Math.random()*sum;
  for (let i=0;i<scored.length;i++){
    r -= exp[i];
    if (r<=0) return scored[i];
  }
  return scored[0];
}
// 偏随机（用于 easy）
function randWeighted(scored, keepTop=0.5){
  const topK = Math.max(1, Math.floor(scored.length * keepTop));
  const pool = scored.slice(0, topK);
  return pool[Math.floor(Math.random()*pool.length)];
}
