import { fetchLoans, fetchServiceUrl, renewLoan, diagnose, fetchReservations, cancelReservation, searchCatalogue, reserveInfo, reserveRank, makeReservation, fetchAccount, deleteMessage, withSession, basketOp, fetchNotice, AuthError } from './portal.js';

// Relais multi-utilisateurs sans état : l'appli envoie les identifiants BMVR de la personne à chaque requête (HTTPS),
// le relais s'en sert pour interroger le portail puis les oublie. Rien n'est stocké ni journalisé.
// Seule l'appli publiée sur ALLOWED_ORIGIN est autorisée à l'appeler depuis un navigateur.

const json = (data, status, cors) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const ok = origin && origin === env.ALLOWED_ORIGIN;
    const cors = ok ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' } : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors });

    const url = new URL(req.url);
    if (req.method !== 'POST' || !['/loans', '/service', '/renew', '/reservations', '/cancel', '/search', '/reserve-info', '/reserve-rank', '/reserve', '/account', '/delete-message', '/basket', '/notice'].includes(url.pathname)) return json({ error: 'introuvable' }, 404, cors);
    if (!ok) return json({ error: 'origine non autorisée' }, 403, cors);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'requête invalide' }, 400, cors); }
    const { username, password } = body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password || username.length > 100 || password.length > 200) {
      return json({ error: 'identifiant et mot de passe requis' }, 400, cors);
    }

    try {
      const READS = ['/loans', '/reservations', '/account', '/search', '/notice', '/reserve-info', '/basket'];
      const who = { username, password, cache: READS.includes(url.pathname) && !(url.pathname === '/basket' && body.action && body.action !== 'list' && body.action !== 'content') };
      if (url.pathname === '/reservations') return json({ ...(await withSession(who, (w) => fetchReservations(w, fetch, body.debug === true))), fetchedAt: new Date().toISOString() }, 200, cors);
      if (url.pathname === '/cancel') return json(await cancelReservation(who, body), 200, cors);
      if (url.pathname === '/search') return json(await withSession(who, (w) => searchCatalogue(w, body.query, fetch, body.debug === true)), 200, cors);
      if (url.pathname === '/reserve-info') return json(await withSession(who, (w) => reserveInfo(w, body.id, fetch, body.debug === true)), 200, cors);
      if (url.pathname === '/reserve-rank') return json(await reserveRank(who, body), 200, cors);
      if (url.pathname === '/reserve') return json(await makeReservation(who, body), 200, cors);
      if (url.pathname === '/account') return json({ ...(await withSession(who, (w) => fetchAccount(w, body.kind, fetch, body.debug === true))), fetchedAt: new Date().toISOString() }, 200, cors);
      if (url.pathname === '/delete-message') return json(await deleteMessage(who, body.id), 200, cors);
      if (url.pathname === '/basket') return json(await withSession(who, (w) => basketOp(w, body, fetch, body.debug === true)), 200, cors);
      if (url.pathname === '/notice') return json(await withSession(who, (w) => fetchNotice(w, body.id, fetch, body.debug === true)), 200, cors);
      if (url.pathname === '/renew') return json(await renewLoan({ username, password }, body.documentId), 200, cors);
      if (url.pathname === '/service') {
        const trace = [];
        try { return json({ url: await fetchServiceUrl({ username, password }, body.service, fetch, trace), trace }, 200, cors); } catch (e) { return json({ error: e.message, trace }, e instanceof AuthError ? 401 : 502, cors); }
      }
      if (body.diagnostic === true) return json(await diagnose({ username, password }), 200, cors);
      const r = await withSession(who, (w) => fetchLoans(w, fetch, body.debug === true));
      return json({ ...r, fetchedAt: new Date().toISOString() }, 200, cors);
    } catch (e) {
      return json({ error: e.message }, e instanceof AuthError ? 401 : 502, cors);
    }
  },
};
