// Vercel server function: makes the call to the platform from the server (no browser blocking)
// and returns the platform's reply exactly as it came back.
// If the platform rejects the key (401/403), it retries with other ways of sending the same key
// and reports which one worked.
const ALLOWED = [
  'api.justwoker.icu',
  'conduit.ozdoev.net',
  'tabitoken.com',
  'kktoken.cc',
  'agentrouter.org',
];

const STYLES = [
  { name: 'Authorization Bearer + Claude Code headers', auth: 'bearer', cc: true },
  { name: 'x-api-key + Claude Code headers',            auth: 'xapi',   cc: true },
  { name: 'Authorization Bearer, plain request',        auth: 'bearer', cc: false },
  { name: 'x-api-key, plain request',                   auth: 'xapi',   cc: false },
];

function build(style, key, payload) {
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (style.auth === 'bearer') headers['authorization'] = 'Bearer ' + key;
  else headers['x-api-key'] = key;

  const body = { ...payload };
  if (style.cc) {
    headers['anthropic-beta'] = 'claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14';
    headers['user-agent'] = 'claude-cli/2.0.14 (external, cli)';
    headers['x-app'] = 'cli';
    if (!body.system) body.system = [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }];
  }
  return { headers, body: JSON.stringify(body) };
}

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

  const reply = (r, tried, allRejected) => {
    res.setHeader('x-relay-style', r.style);
    res.setHeader('x-relay-tried', String(tried));
    res.setHeader('x-relay-rejected', allRejected ? '1' : '0');
    res.setHeader('content-type', r.type || 'application/json');
    return res.status(r.status).send(r.text);
  };

  let first = null;
  for (let i = 0; i < STYLES.length; i++) {
    const s = STYLES[i];
    const { headers, body } = build(s, key, payload);
    let up, text;
    try {
      up = await fetch(u.origin + '/v1/messages', { method: 'POST', headers, body });
      text = await up.text();
    } catch (e) {
      return res.status(502).json({ relay_error: 'Server could not reach the platform: ' + String(e) });
    }
    const r = { status: up.status, text, type: up.headers.get('content-type'), style: s.name };
    first = first || r;
    if (up.status !== 401 && up.status !== 403) return reply(r, i + 1, false);
  }
  return reply(first, STYLES.length, true);
};
