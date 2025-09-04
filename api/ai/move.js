// api/ai/move.js — Vercel Serverless Function
// 入参: { board: string, side: 'r'|'b', difficulty?: 'easy'|'medium'|'hard', legalMoves: [{from:[r,c],to:[r,c]}] }
// 出参: { from:[r,c], to:[r,c], source:'openai'|'deepseek'|'fallback' }

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { board, side, difficulty = 'medium', legalMoves } = body;

    if (!board || !side) return res.status(400).json({ error: 'missing board/side' });
    if (!Array.isArray(legalMoves) || legalMoves.length === 0) {
      return res.status(400).json({ error: 'missing legalMoves' });
    }

    // 仅允许从服务端环境变量读取密钥（前端拿不到）
    const oaiKey = process.env.OPENAI_API_KEY || '';
    const dskKey = process.env.DEEPSEEK_API_KEY || '';
    if (!oaiKey && !dskKey) return res.status(501).json({ error: 'no_api_key' });

    // 把候选着法串给模型，强约束只能从中选择
    const choices = legalMoves.map(m => `[${m.from[0]},${m.from[1]}]->[${m.to[0]},${m.to[1]}]`).join('\n');
    const sys = `
你是中国象棋AI，当前执${side === 'r' ? '红' : '黑'}。只能在“候选着法列表”里选择一个着法。
仅输出JSON：{"from":[row,col],"to":[row,col]}，坐标0基，严禁输出其它内容。
`.trim();
    const usr = `
棋盘(10x9，/ 分行；红=大写，黑=小写，.=空):
${board}

候选着法（必须从中二选一）:
${choices}

难度: ${difficulty}
`.trim();
    const tempMap = { easy: 1.0, medium: 0.6, hard: 0.2 };
    const temperature = tempMap[difficulty] ?? 0.6;

    // 选提供方：优先 OpenAI（ChatGPT），否则 DeepSeek
    let content = '';
    if (oaiKey) {
      const rsp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${oaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }]
        })
      });
      if (!rsp.ok) {
        const t = await rsp.text();
        return res.status(502).json({ error: 'openai_upstream', detail: t.slice(0, 500) });
      }
      const data = await rsp.json();
      content = data?.choices?.[0]?.message?.content || '{}';
    } else {
      const endpoint = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';
      const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
      const rsp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${dskKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }], temperature })
      });
      if (!rsp.ok) {
        const t = await rsp.text();
        return res.status(502).json({ error: 'deepseek_upstream', detail: t.slice(0, 500) });
      }
      const data = await rsp.json();
      content = (data?.choices?.[0]?.message?.content || '').trim();
      // DeepSeek 可能包三引号，去掉再 parse
      if (content.startsWith('```')) content = content.replace(/^```(json)?/i, '').replace(/```$/,'').trim();
    }

    // 解析并校验在白名单内
    let move = {};
    try { move = JSON.parse(content); } catch {}
    const isSame = (a,b) => a[0]===b[0] && a[1]===b[1];
    const hit = legalMoves.find(m => Array.isArray(move?.from) && Array.isArray(move?.to)
      && isSame(move.from, m.from) && isSame(move.to, m.to));

    if (!hit) {
      const fb = legalMoves[Math.floor(Math.random()*legalMoves.length)];
      return res.json({ from: fb.from, to: fb.to, source: 'fallback' });
    }
    return res.json({ from: move.from, to: move.to, source: oaiKey ? 'openai' : 'deepseek' });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e).slice(0,500) });
  }
};
