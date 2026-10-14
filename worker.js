// Relay for Model Pinger. Sends the request the way Claude Code does (same endpoint, Bearer token,
// Claude Code headers + system prompt) and returns the platform's raw reply untouched.
// Deploy: dash.cloudflare.com -> Workers & Pages -> Create -> Hello World -> Edit code -> paste this -> Deploy.
const ALLOWED = [
  'api.justwoker.icu',
  'conduit.ozdoev.net',
  'tabitoken.com',
  'kktoken.cc',
  'agentrouter.org',
];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': '*',
};

const json = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'content-type': 'application/json' } });

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return json({ worker_error: 'Missing ?url=' }, 400);

    let t;
    try { t = new URL(target); } catch { return json({ worker_error: 'Bad url' }, 400); }
    if (!ALLOWED.includes(t.hostname)) return json({ worker_error: 'Host not allowed: ' + t.hostname }, 403);

    // Add the Claude Code system prompt if the page did not send one.
    let body = await request.text();
    try {
      const j = JSON.parse(body);
      if (!j.system) j.system = [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }];
      body = JSON.stringify(j);
    } catch {}

    const headers = new Headers({
      'content-type': 'application/json',
      'accept': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
      'user-agent': 'claude-cli/2.0.14 (external, cli)',
      'x-app': 'cli',
    });
    const auth = request.headers.get('authorization');
    if (auth) headers.set('authorization', auth);

    try {
      const res = await fetch(t.toString(), { method: 'POST', headers, body });
      const out = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) out.set(k, v);
      out.delete('content-encoding');
      return new Response(res.body, { status: res.status, headers: out });
    } catch (e) {
      return json({ worker_error: 'Relay could not reach the platform: ' + String(e) }, 502);
    }
  },
};
