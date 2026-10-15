// Vercel server function: makes the call to the platform from the server (no browser blocking)
// and returns the platform's reply exactly as it came back.
// It picks the request format from the model name (Claude / GPT / Gemini) and, if the platform
// refuses one way of asking, tries the next way before giving up.
const ALLOWED = [
  'api.justwoker.icu',
  'conduit.ozdoev.net',
  'tabitoken.com',
  'kktoken.cc',
  'agentrouter.org',
];

const JSON_H = { 'content-type': 'application/json', 'accept': 'application/json' };
const bearer = (k) => ({ authorization: 'Bearer ' + k });

function family(model) {
  const m = String(model).toLowerCase();
  if (m.startsWith('gemini') || m.startsWith('gemma')) return 'gemini';
  if (/^(gpt|chatgpt|o\d|codex|text-|davinci)/.test(m)) return 'openai';
  return 'anthropic';
}

// ---- Claude: POST /v1/messages (same as Pace, which uses the Anthropic SDK) ----
const CLAUDE_STYLES = [
  { name: 'Same as Pace (Anthropic SDK style, Bearer token)', auth: 'bearer', sdk: true },
  { name: 'Authorization Bearer, plain request',              auth: 'bearer' },
  { name: 'x-api-key, plain request',                         auth: 'xapi' },
  { name: 'Authorization Bearer + Claude Code headers',       auth: 'bearer', cc: true },
];

function claudeAttempts(key, p) {
  return CLAUDE_STYLES.map((s) => {
    const headers = { ...JSON_H, 'anthropic-version': '2023-06-01' };
    if (s.auth === 'bearer') headers.authorization = 'Bearer ' + key; else headers['x-api-key'] = key;
    const body = { model: p.model, max_tokens: p.max_tokens, messages: p.messages };
    if (s.sdk) {
      Object.assign(headers, {
        'user-agent': 'Anthropic/JS 0.65.0',
        'x-stainless-lang': 'js',
        'x-stainless-package-version': '0.65.0',
        'x-stainless-os': 'Linux',
        'x-stainless-arch': 'x64',
        'x-stainless-runtime': 'node',
        'x-stainless-runtime-version': process.version,
        'x-stainless-retry-count': '0',
        'x-stainless-timeout': '600',
      });
    }
    if (s.cc) {
      headers['anthropic-beta'] = 'claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14';
      headers['user-agent'] = 'claude-cli/2.0.14 (external, cli)';
      headers['x-app'] = 'cli';
      body.system = [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }];
    }
    return { name: s.name, path: '/v1/messages', headers, body: JSON.stringify(body), retry: (st) => st === 401 || st === 403 };
  });
}

// ---- GPT: POST /v1/chat/completions, then the Responses API ----
function openaiAttempts(key, p) {
  const budget = Math.max(p.max_tokens, 256); // reasoning models need room to answer
  const h = { ...JSON_H, ...bearer(key) };
  const retry = (st) => [400, 404, 405, 422].includes(st);
  return [
    { name: 'OpenAI chat completions', path: '/v1/chat/completions', headers: h, retry,
      body: JSON.stringify({ model: p.model, messages: p.messages, max_completion_tokens: budget }) },
    { name: 'OpenAI chat completions (max_tokens)', path: '/v1/chat/completions', headers: h, retry,
      body: JSON.stringify({ model: p.model, messages: p.messages, max_tokens: budget }) },
    { name: 'OpenAI Responses API', path: '/v1/responses', headers: h, retry: () => true,
      body: JSON.stringify({ model: p.model, input: p.messages, max_output_tokens: budget }) },
  ];
}

// ---- Gemini: native generateContent, then the OpenAI-compatible route ----
function geminiAttempts(key, p) {
  const budget = Math.max(p.max_tokens, 256);
  const path = '/v1beta/models/' + encodeURIComponent(p.model) + ':generateContent';
  const native = JSON.stringify({
    contents: p.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] })),
    generationConfig: { maxOutputTokens: budget },
  });
  const retry = (st) => [400, 401, 403, 404, 405].includes(st);
  return [
    { name: 'Gemini native (x-goog-api-key)', path, headers: { ...JSON_H, 'x-goog-api-key': key }, body: native, retry },
    { name: 'Gemini native (Bearer)', path, headers: { ...JSON_H, ...bearer(key) }, body: native, retry },
    { name: 'Gemini via OpenAI-compatible route', path: '/v1/chat/completions', headers: { ...JSON_H, ...bearer(key) }, retry: () => true,
      body: JSON.stringify({ model: p.model, messages: p.messages, max_tokens: budget }) },
  ];
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
  if (!key || !payload || !Array.isArray(payload.messages)) return res.status(400).json({ relay_error: 'Missing key or payload' });
  if (!/^[A-Za-z0-9._:\/-]+$/.test(String(payload.model || ''))) return res.status(400).json({ relay_error: 'Bad model name' });

  const fam = family(payload.model);
  const attempts = fam === 'gemini' ? geminiAttempts(key, payload)
                 : fam === 'openai' ? openaiAttempts(key, payload)
                 : claudeAttempts(key, payload);

  const reply = (r, tried) => {
    res.setHeader('x-relay-style', r.style);
    res.setHeader('x-relay-tried', String(tried));
    res.setHeader('content-type', r.type || 'application/json');
    return res.status(r.status).send(r.text);
  };

  let first = null;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    let up, text;
    try {
      up = await fetch(u.origin + a.path, { method: 'POST', headers: a.headers, body: a.body });
      text = await up.text();
    } catch (e) {
      return res.status(502).json({ relay_error: 'Server could not reach the platform: ' + String(e) });
    }
    const r = { status: up.status, text, type: up.headers.get('content-type'), style: a.name };
    first = first || r;
    if (up.status < 400 || !a.retry(up.status)) return reply(r, i + 1);
  }
  return reply(first, attempts.length); // every way failed: show the first (main) reply
};
