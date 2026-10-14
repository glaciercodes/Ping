// Cloudflare Worker: a tiny relay so the Model Pinger page can reach platforms that block browser requests.
// Only forwards to the five platforms below. Deploy at dash.cloudflare.com -> Workers & Pages -> Create -> paste this.
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

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return new Response('Missing ?url=', { status: 400, headers: CORS });

    let t;
    try { t = new URL(target); } catch { return new Response('Bad url', { status: 400, headers: CORS }); }
    if (!ALLOWED.includes(t.hostname)) return new Response('Host not allowed', { status: 403, headers: CORS });

    const headers = new Headers(request.headers);
    headers.delete('origin');
    headers.delete('referer');

    const res = await fetch(t.toString(), { method: request.method, headers, body: request.body });
    const out = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) out.set(k, v);
    return new Response(res.body, { status: res.status, headers: out });
  },
};
