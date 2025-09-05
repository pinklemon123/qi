// /api/ai/move.js — 禁止磨棋/长将/重复局面；红=OpenAI，黑=DeepSeek；启发式兜底
export const config = { runtime: 'edge' };

const OPENAI_API   = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEEPSEEK_API = process.env.DEEPSEEK_API || 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const OAI_KEY = process.env.OPENAI_API_KEY || '';
const DSK_KEY = process.env.DEEPSEEK_API_KEY || '';

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error:'method_not_allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error:'bad_json' }, 400); }

  const { board, side, difficulty='medium', repetition={} } = body || {};
  // 候选名兼容：choices / legalMoves
  const choices = Array.isArray(body.choices) ? body.choices
                 : Array.isArray(body.legalMoves) ? body.legalMoves
                 : null;

  if (!board || (side!=='r' && side!=='b')) return json({ error:'missing board/side' }, 400);
  if (!choices || !choices.length) return json({ error:'missing candidates' }, 400);

  const avoidKeys = Array.isArray(repetition.avoidKeys) ? repetition.avoidKeys : [];
  const historyKeys = Array.isArray(repetition.historyKeys) ? repetition.historyKeys : [];
  const pingPongCount = Number.isInteger(repetition.pingPongCount) ? repetition.pingPongCount : 0;
  const checkStreak = (repetition.checkStreak && typeof repetition.checkStreak==='object') ? repetition.checkStreak : { r:0, b:0 };

  // ---- Heuristic scoring (with anti-repetition penalty) ----
  const grid = parseBoard(board); // 10x9 char[][]
  const avoidSet = new Set(avoidKeys);
  const scored = choices.map((ch, idx) => {
    const ng = cloneGrid(grid);
    const [fr,fc] = ch.from, [tr,tc] = ch.to;
    const mover = ng[fr][fc];               // char
    const target = ng[tr][tc];

    let s = 0;
    // capture value
    if (target && target!=='.') s += val(target);

    // center activity
    const centerDist = Math.abs(4-tc) + Math.abs(4.5-tr);
    s += (8 - centerDist) * 0.8;

    // pawn push bonus
    if (mover && mover.toLowerCase()==='p') {
      const isRed = side==='r';
      s += isRed ? (fr>tr ? 6 : 0) : (tr>fr ? 6 : 0);
    }

    // apply move
    ng[tr][tc] = mover;
    ng[fr][fc] = '.';

    // next side key (用于“重复局面”黑名单)
    const nextKey = serializeGrid(ng) + '|' + (side==='r' ? 'b' : 'r');

    // 大幅惩罚：若产生回避局面
    if (avoidSet.has(nextKey)) s -= 1e4;

    // 一些软惩罚：当前已存在 ping-pong/长将迹象
    if (pingPongCount >= 5) s -= 500;
    if ((side==='r' && (checkStreak?.r||0) >= 5) || (side==='b' && (checkStreak?.b||0) >= 5)) s -= 800;

    return { idx, score: s, nextKey };
  }).sort((a,b)=>b.score-a.score);

  // 若没有密钥，直接按启发式选择
  if ((side==='r' && !OAI_KEY) || (side==='b' && !DSK_KEY)) {
    const pick = scored[0];
    return json({ from: choices[pick.idx].from, to: choices[pick.idx].to });
  }

  // ---- Ask LLM (with anti-repetition instruction) ----
  // 强约束：不得选择导致“avoidKeys”的候选；不得长将/长捉/无意义重复
  const sys = [
    'You are a Xiangqi (Chinese Chess) assistant.',
    'You MUST choose exactly ONE move from candidates.',
    'IMPORTANT RULES:',
    '- No perpetual repetition (no repeating the same position sequence).',
    '- No perpetual check (长将) and no perpetual chase (长捉).',
    '- If a candidate leads to a repeated/forbidden position (avoidKeys), DO NOT choose it.',
    'Prefer breaking repetition even if the local tactic looks tempting, unless a forced mate exists.',
    'Return ONLY JSON: {"index": <number>} with no extra text.'
  ].join(' ');

  const user = JSON.stringify({
    side,                   // 'r' / 'b'
    board,                  // 10x9, '/' rows, '.' empty, UPPER=red, lower=black
    candidates: choices,    // [{from:[r,c], to:[r,c]}]
    repetition: {
      avoidKeys,
      historyKeys,
      pingPongCount,
      checkStreak
    }
  });

  const suggestIdx = scored[0]?.idx ?? 0; // 启发式建议（非强制）
  const messages = [
    { role:'system', content: sys },
    { role:'user',   content: user },
    { role:'assistant', content: `Suggestion (may override): {"index": ${suggestIdx}}` }
  ];

  const temperature = ({easy:0.9, medium:0.5, hard:0.2}[String(difficulty).toLowerCase()] ?? 0.5);

  try {
    const { index } = await askModel(side, { messages, temperature });
    if (Number.isInteger(index) && index>=0 && index<choices.length) {
      // 二次校验：若 LLM 仍选择了 avoidKey，退回启发式最佳
      const chosen = scored.find(s => s.idx===index);
      if (!chosen || avoidSet.has(chosen.nextKey)) {
        const safer = scored.find(s => !avoidSet.has(s.nextKey)) || scored[0];
        return json({ index: safer.idx });
      }
      return json({ index });
    }
  } catch (e) {
    // fallthrough to heuristic
  }

  // 兜底：选第一个“非 avoidKey”的候选，否则取 heuristic 第一名
  const safer = scored.find(s => !avoidSet.has(s.nextKey)) || scored[0];
  return json({ from: choices[safer.idx].from, to: choices[safer.idx].to });
}

// ======== model call helpers ========
async function askModel(side, { messages, temperature }){
  if (side === 'r') { // OpenAI
    const rsp = await fetch(OPENAI_API, {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${OAI_KEY}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ model: OPENAI_MODEL, temperature, response_format:{type:'json_object'}, messages })
    });
    const data = await rsp.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '{}';
    return safeJSON(text);
  } else { // DeepSeek
    const rsp = await fetch(DEEPSEEK_API, {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${DSK_KEY}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ model: DEEPSEEK_MODEL, temperature, messages })
    });
    const data = await rsp.json();
    let text = data?.choices?.[0]?.message?.content?.trim() || '{}';
    if (text.startsWith('```')) text = text.replace(/^```(json)?/i,'').replace(/```$/,'').trim();
    return safeJSON(text);
  }
}

// ======== utils ========
function json(obj, status=200){ return new Response(JSON.stringify(obj), { status, headers:{'Content-Type':'application/json'} }); }
function safeJSON(s){ try{ return JSON.parse(s); }catch{ return {}; } }

function parseBoard(s){
  const rows = String(s||'').split('/');
  if (rows.length !== 10) throw new Error('bad board');
  return rows.map(r => r.split(''));
}
function cloneGrid(g){ return g.map(r => r.slice()); }
function serializeGrid(g){ return g.map(r => r.join('')).join('/'); }
function val(ch){
  const v = { k:10000, r:500, c:450, n:300, b:250, a:250, p:100 };
  return v[String(ch).toLowerCase()] || 0;
}
