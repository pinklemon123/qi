// Vercel Serverless Function: Proxy to DeepSeek to get a BLACK move
// Expects POST JSON: { board: string, side: 'b', difficulty?: 'easy'|'medium'|'hard' }
// Returns JSON: { from:[r,c], to:[r,c] }

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const bodyIn = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { board, side, difficulty } = bodyIn;
    if (!board || !side) return res.status(400).json({ error: 'missing board/side' });

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return res.status(501).json({ error: 'DEEPSEEK_API_KEY not set on server' });
    }

    const endpoint = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

    const system = [
      'You are a Xiangqi (Chinese Chess) assistant playing as BLACK.',
      'Board is 10 rows x 9 columns. Rows 0..9 from black(top) to red(bottom).',
      'Board encoding: 10 row strings joined by "/". Each row has 9 chars.',
      'Uppercase letters are RED pieces, lowercase are BLACK: R/N/B/A/K/C/P.',
      'Dot "." means empty. Example row: ".r.n..k..".',
      'You must pick one legal BLACK move given the current position and reply ONLY as JSON: {"from":[r,c],"to":[r,c]} with 0-based coordinates.',
      'Do not include any explanation or code fences.',
      'When difficulty is easy, prefer random/legal moves; when hard, choose stronger tactical/positional moves; when medium, a balance.'
    ].join(' ');

    const user = `Board: ${board}\nSide to move: ${side}\nDifficulty: ${difficulty || 'medium'}\nReturn strictly JSON with keys from,to.`;
    const tempMap = { easy: 1.0, medium: 0.7, hard: 0.2 };
    const temperature = tempMap[(difficulty || 'medium')] ?? 0.7;

    const payload = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
    };

    const rsp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!rsp.ok) {
      const t = await rsp.text();
      return res.status(502).json({ error: 'Upstream error', detail: t });
    }

    const data = await rsp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    let move = null;
    try {
      const jsonStr = content.trim().replace(/^```(json)?/i, '').replace(/```$/,'').trim();
      move = JSON.parse(jsonStr);
    } catch (e) {
      return res.status(500).json({ error: 'Invalid AI response', raw: content });
    }

    if (!move || !Array.isArray(move.from) || !Array.isArray(move.to)) {
      return res.status(500).json({ error: 'AI move missing from/to', raw: content });
    }

    return res.status(200).json({ from: move.from, to: move.to });
  } catch (err) {
    return res.status(500).json({ error: 'server_error', detail: String(err) });
  }
};

