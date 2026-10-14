// Vercel server function: makes the call to the platform from the server (no browser blocking)
// and returns the platform's reply exactly as it came back.
const ALLOWED = [
  'api.justwoker.icu',
  'conduit.ozdoev.net',
  'tabitoken.com',
  'kktoken.cc',
  'agentrouter.org',
];

module.exports = async (req, res) => {
  res.setHeader('x-relay', '1');
  if (req.method !== 'POST') return res.status(405).json({ relay_error: 'POST only' });

  const { base, key, payload } = req.body || {};
  let u;
  try { u = new URL(base); } catch { return res.status(400).json({ relay_error: 'Bad platform address' }); }
  if (u.protocol !== 'https:' || !ALLOWED.includes(u.hostname)) {
    return res.status(403).json({ relay_error: 'Platform not allowed: ' + u.hostname });
  }
  if (!key || !payload) return res.status(400).json({ relay_error: 'Missing key or payload' });

  // Same request Claude Code makes.
  if (!payload.system) payload.system = [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }];

  try {
    const up = await fetch(u.origin + '/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        'authorization': 'Bearer ' + key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
        'user-agent': 'claude-cli/2.0.14 (external, cli)',
        'x-app': 'cli',
      },
      body: JSON.stringify(payload),
    });
    const text = await up.text();
    res.setHeader('content-type', up.headers.get('content-type') || 'application/json');
    return res.status(up.status).send(text);
  } catch (e) {
    return res.status(502).json({ relay_error: 'Server could not reach the platform: ' + String(e) });
  }
};
