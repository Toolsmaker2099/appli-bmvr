import { fetchLoans } from './portal.js';

// Relais personnel : identifiants BMVR stockés comme secrets Cloudflare (BMVR_USER, BMVR_PASS), jamais dans le navigateur.
// L'appli (GitHub Pages) s'authentifie avec APP_TOKEN. CORS limité à ALLOWED_ORIGIN.

const json = (data, status, cors) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

function equal(a = '', b = '') {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGIN;
    const cors = origin && origin === allowed
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, OPTIONS', Vary: 'Origin' }
      : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    if (url.pathname !== '/loans' && url.pathname !== '/debug') return json({ error: 'introuvable' }, 404, cors);
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!env.APP_TOKEN || !equal(token, env.APP_TOKEN)) return json({ error: 'non autorisé' }, 401, cors);
    if (!env.BMVR_USER || !env.BMVR_PASS) return json({ error: 'identifiants BMVR non configurés' }, 500, cors);

    try {
      const r = await fetchLoans({ username: env.BMVR_USER, password: env.BMVR_PASS }, fetch, url.pathname === '/debug');
      return json({ ...r, fetchedAt: new Date().toISOString() }, 200, cors);
    } catch (e) {
      return json({ error: e.message }, 502, cors);
    }
  },
};
