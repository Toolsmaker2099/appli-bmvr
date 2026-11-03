import { fetchLoans, fetchServiceUrl, renewLoan, renewMany, fetchHours, fetchAgenda, fetchAgendaEvent, fetchDocExtra, fetchNouveautes, fetchServices, fetchDocuments, savedSearches, diagnose, fetchReservations, cancelReservation, searchCatalogue, reserveInfo, reserveRank, makeReservation, fetchAccount, deleteMessage, withSession, basketOp, fetchNotice, AuthError } from './portal.js';

// Relais multi-utilisateurs sans état : l'appli envoie les identifiants BMVR de la personne à chaque requête (HTTPS),
// le relais s'en sert pour interroger le portail puis les oublie. Rien n'est stocké ni journalisé.
// Seule l'appli publiée sur ALLOWED_ORIGIN est autorisée à l'appeler depuis un navigateur.

const json = (data, status, cors) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });

const HITS = new Map();
const LIMIT = 90; // requêtes par minute et par adresse
function tooMany(ip, now) {
  const h = (HITS.get(ip) ?? []).filter((t) => now - t < 60000);
  h.push(now); HITS.set(ip, h);
  if (HITS.size > 2000) for (const [k, v] of HITS) if (!v.length || now - v[v.length - 1] >= 60000) HITS.delete(k);
  return h.length > LIMIT;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const ok = origin && origin === env.ALLOWED_ORIGIN;
    const cors = ok ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' } : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors });

    const url = new URL(req.url);
    if (req.method !== 'POST' || !['/loans', '/service', '/renew', '/renew-many', '/horaires', '/agenda', '/agenda-event', '/doc-extra', '/nouveautes', '/services', '/documents', '/saved-searches', '/reservations', '/cancel', '/search', '/reserve-info', '/reserve-rank', '/reserve', '/account', '/delete-message', '/basket', '/notice'].includes(url.pathname)) return json({ error: 'introuvable' }, 404, cors);
    if (!ok) return json({ error: 'origine non autorisée' }, 403, cors);

    // Limite de débit (par adresse, en mémoire de l'instance) : freine les abus sans rien stocker de durable.
    const ip = req.headers.get('CF-Connecting-IP') || 'inconnue';
    if (tooMany(ip, Date.now())) return json({ error: 'Trop de requêtes, réessayez dans une minute.' }, 429, { ...cors, 'Retry-After': '60' });

    let body;
    try { body = await req.json(); } catch { return json({ error: 'requête invalide' }, 400, cors); }
    const { username, password } = body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password || username.length > 100 || password.length > 200) {
      return json({ error: 'identifiant et mot de passe requis' }, 400, cors);
    }

    try {
      const READS = ['/documents', '/loans', '/reservations', '/account', '/search', '/notice', '/reserve-info', '/basket'];
      const who = { username, password, cache: READS.includes(url.pathname) && !(url.pathname === '/basket' && body.action && body.action !== 'list' && body.action !== 'content') };
      if (url.pathname === '/reservations') return json({ ...(await withSession(who, (w) => fetchReservations(w, fetch, body.debug === true))), fetchedAt: new Date().toISOString() }, 200, cors);
      if (url.pathname === '/cancel') return json(await cancelReservation(who, body), 200, cors);
      if (url.pathname === '/search') return json(await withSession(who, (w) => searchCatalogue(w, body.query, fetch, body.debug === true, body.page, body.queryId, body)), 200, cors);
      if (url.pathname === '/reserve-info') return json(await withSession(who, (w) => reserveInfo(w, body.id, fetch, body.debug === true)), 200, cors);
      if (url.pathname === '/reserve-rank') return json(await reserveRank(who, body), 200, cors);
      if (url.pathname === '/reserve') return json(await makeReservation(who, body), 200, cors);
      if (url.pathname === '/account') return json({ ...(await withSession(who, (w) => fetchAccount(w, body.kind, fetch, body.debug === true))), fetchedAt: new Date().toISOString() }, 200, cors);
      if (url.pathname === '/delete-message') return json(await deleteMessage(who, body.id), 200, cors);
      if (url.pathname === '/basket') return json(await withSession(who, (w) => basketOp(w, body, fetch, body.debug === true)), 200, cors);
      if (url.pathname === '/notice') return json(await withSession(who, (w) => fetchNotice(w, body.id, fetch, body.debug === true)), 200, cors);
      if (url.pathname === '/documents') return json(await withSession(who, (w) => fetchDocuments(w, body.ids)), 200, cors);
      if (url.pathname === '/nouveautes') return json(await fetchNouveautes(body), 200, cors);
      if (url.pathname === '/saved-searches') return json(await withSession(who, (w) => savedSearches(w, body)), 200, cors);
      if (url.pathname === '/agenda') return json(await fetchAgenda(), 200, cors);
      if (url.pathname === '/doc-extra') return json(await fetchDocExtra(body.id), 200, cors);
      if (url.pathname === '/agenda-event') return json(await fetchAgendaEvent(body.id), 200, cors);
      if (url.pathname === '/horaires') return json(await fetchHours(), 200, cors);
      if (url.pathname === '/renew-many') return json(await renewMany({ username, password }, body.documentIds), 200, cors);
      if (url.pathname === '/renew') return json(await renewLoan({ username, password }, body.documentId), 200, cors);
      if (url.pathname === '/services') return json(await fetchServices(), 200, cors);
      if (url.pathname === '/service') {
        const trace = [];
        // Une adresse n'est suivie que si elle figure sur la page officielle « En ligne » (jamais une adresse libre).
        let service = body.service;
        if (typeof body.url === 'string') {
          const ok = (await fetchServices()).sections.some((x) => x.items.some((i) => i.url === body.url && i.kind === 'sso'));
          if (!ok) return json({ error: 'Service inconnu' }, 400, cors);
          service = { url: body.url };
        }
        try { return json({ url: await fetchServiceUrl({ username, password }, service, fetch, trace, body.follow === true), trace }, 200, cors); } catch (e) { return json({ error: e.message, trace }, e instanceof AuthError ? 401 : 502, cors); }
      }
      if (body.diagnostic === true) return json(await diagnose({ username, password }), 200, cors);
      const r = await withSession(who, (w) => fetchLoans(w, fetch, body.debug === true));
      return json({ ...r, fetchedAt: new Date().toISOString() }, 200, cors);
    } catch (e) {
      return json({ error: e.message }, e instanceof AuthError ? 401 : 502, cors);
    }
  },
};
