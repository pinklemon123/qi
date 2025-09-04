// Simple local server to host the Xiangqi app and proxy DeepSeek API
// Usage:
//   DEEPSEEK_API_KEY=sk-xxx node server.js
// Optional:
//   DEEPSEEK_API_URL (default: https://api.deepseek.com/v1/chat/completions)
//   DEEPSEEK_MODEL (default: deepseek-chat)

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Serve static files (index.html, app.js, style.css) from repo root
app.use(express.static(path.resolve(__dirname)));

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Proxy to DeepSeek to get a move for black side
app.post('/ai/move', async (req, res) => {
  try {
    const { board, side, difficulty } = req.body || {};
    if (!board || !side) return res.status(400).json({ error: 'missing board/side' });

    // Prefer env; fallback to local.config.js in non-production for local-only usage
    let apiKey = process.env.DEEPSEEK_API_KEY;
    let localCfg = {};
    if (!apiKey && process.env.NODE_ENV !== 'production') {
      try { localCfg = require('./local.config'); apiKey = localCfg.DEEPSEEK_API_KEY || apiKey; } catch (_) {}
    }
    if (!apiKey) {
      return res.status(501).json({ error: 'DEEPSEEK_API_KEY not set on server' });
    }

    const endpoint = process.env.DEEPSEEK_API_URL || localCfg.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';
    const model = process.env.DEEPSEEK_MODEL || localCfg.DEEPSEEK_MODEL || 'deepseek-chat';

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
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
    };

    const fetchImpl = globalThis.fetch || (await import('node-fetch')).default;
    const rsp = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!rsp.ok) {
      const t = await rsp.text();
      return res.status(502).json({ error: 'Upstream error', detail: t });
    }
    const data = await rsp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    let move = null;
    try {
      // Strip possible fence
      const jsonStr = content.trim().replace(/^```(json)?/i, '').replace(/```$/,'').trim();
      move = JSON.parse(jsonStr);
    } catch (e) {
      return res.status(500).json({ error: 'Invalid AI response', raw: content });
    }
    // Expect { from:[r,c], to:[r,c] }
    if (!move || !Array.isArray(move.from) || !Array.isArray(move.to)) {
      return res.status(500).json({ error: 'AI move missing from/to', raw: content });
    }
    return res.json({ from: move.from, to: move.to });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error', detail: String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Xiangqi app + AI proxy on http://localhost:${port}`));
