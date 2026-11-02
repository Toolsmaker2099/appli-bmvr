// Client minimal du portail BMVR (Syracuse / Archimed), reconstitué depuis l'appli web publique du portail.
// Chaque requête porte l'en-tête X-InMedia-Authorization = "Bearer <session> <apiToken> <somme de contrôle>".

const BASE = 'https://www.bmvr.marseille.fr';
const API = `${BASE}/in/rest`;

export class AuthError extends Error {}

// Somme de contrôle utilisée par le portail (ce n'est pas un secret, juste une vérification d'intégrité).
export function checksum(str) {
  let n = 305419896;
  const s = str.normalize('NFC');
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) * (i + 1);
  return String(n);
}

export async function getApiToken(fetchFn = fetch) {
  const js = await (await fetchFn(`${API}/api/settings.js`)).text();
  const m = js.match(/"apiToken":"([^"]+)"/);
  if (!m) throw new Error("Jeton d'API du portail introuvable");
  return m[1];
}

function makeClient(fetchFn) {
  const BMVR_HOST = new URL(BASE).host;
  let apiToken = null;
  let cookies = new Map();
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const base = { 'X-microsite-id': 'mainSite', 'User-Agent': 'Mozilla/5.0 (compatible; appli-bmvr)' };

  return {
    snapshot: () => ({ apiToken, cookies: [...cookies] }),
    restore(snap) { apiToken = snap.apiToken; cookies = new Map(snap.cookies); },
    // Comme l'appli web : charger settings.js d'abord (il ouvre la session et donne le jeton d'API), en gardant les cookies.
    async init() {
      const res = await fetchFn(`${API}/api/settings.js`, { headers: { ...base } });
      keep(res);
      const m = (await res.text()).match(/"apiToken":"([^"]+)"/);
      if (!m) throw new Error("Jeton d'API du portail introuvable");
      apiToken = m[1];
    },
    async post(token, path, body, { binary = false, contentType = 'application/json' } = {}) {
      const raw = typeof body === 'string' ? body : JSON.stringify(body);
      const auth = binary ? `Bearer ${token} ${apiToken}` : `Bearer ${token} ${apiToken} ${checksum(raw)}`;
      const res = await fetchFn(`${API}/api/${path}`, {
        method: 'POST',
        headers: { ...base, 'Content-Type': contentType, 'X-InMedia-Authorization': auth, Cookie: cookieHeader() },
        body: raw,
      });
      keep(res);
      if (res.status === 401 && path === 'authenticate') throw new AuthError('Connexion refusée : identifiant ou mot de passe incorrect');
      if (!res.ok) throw new Error(`Portail: ${path} → HTTP ${res.status} ${(await res.text()).replace(/\s+/g, ' ').slice(0, 160)}`);
      return res.json();
    },
    // Suit les redirections d'un service en ligne (CAS) avec la session de la personne, et s'arrête juste avant d'ouvrir
    // l'adresse finale du service : elle contient un ticket à usage unique que le navigateur de la personne utilisera.
    async serviceUrl(startUrl, trace = []) {
      let url = startUrl;
      let cameFromBmvr = false;
      for (let hop = 0; hop < 10; hop++) {
        const host = new URL(url).host;
        const isBmvr = host === BMVR_HOST;
        const res = await fetchFn(url, { redirect: 'manual', headers: { ...base, ...(isBmvr ? { Cookie: cookieHeader() } : {}) } });
        if (isBmvr) keep(res);
        const loc = res.headers.get('Location');
        if (!loc || res.status < 300 || res.status > 399) throw new Error(`Service : pas de redirection (HTTP ${res.status})`);
        const next = new URL(loc, url).toString();
        { const n = new URL(next); trace.push(`${res.status} ${host} → ${n.host}${n.pathname} [${[...n.searchParams.keys()].join(',')}]`); }
        if (isBmvr && new URL(next).host !== BMVR_HOST) return next;
        if (isBmvr && /\/login(\?|$)/.test(new URL(next).pathname) && new URL(next).host === BMVR_HOST && hop > 0) throw new Error('Service : la BMVR ne reconnaît pas la session');
        cameFromBmvr = cameFromBmvr || isBmvr;
        url = next;
      }
      throw new Error('Service : trop de redirections');
    },
    cookieNames: () => [...cookies.keys()],
    // Sonde de diagnostic : même appel, avec des variantes de l'en-tête d'autorisation / des cookies.
    async probe(token, path, { auth, cookie, noMicrosite = false, query = '?locale=fr' }) {
      const headers = { ...base, 'X-InMedia-Authorization': auth(token, apiToken, query), Cookie: cookie ?? cookieHeader() };
      if (noMicrosite) delete headers['X-microsite-id'];
      const res = await fetchFn(`${API}/api/${path}${query}&_=${Date.now()}`, { headers });
      if (!res.ok) return { status: res.status };
      const j = await res.json();
      return j?.errorReponse ? { code: j.code, error: String(j.error).slice(0, 80) } : { ok: true, shape: shapeOf(j) };
    },
    // Le portail lie la session au cookie en visitant connect.xhtml juste après la connexion (comme son appli web).
    async connect() {
      const res = await fetchFn(`${BASE}/in/connect.xhtml`, { headers: { ...base, Cookie: cookieHeader() }, redirect: 'manual' });
      keep(res);
      return res.status;
    },
    async get(token, path, params) {
      // Comme l'appli du portail : adresse encodée, mais somme de contrôle calculée sur la version décodée.
      const qs = Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      const signed = `?${qs}`;
      const res = await fetchFn(`${API}/api/${path}${signed}&_=${Date.now()}`, {
        headers: { ...base, 'X-InMedia-Authorization': `Bearer ${token} ${apiToken} ${checksum(decodeURIComponent(signed))}`, Cookie: cookieHeader() },
      });
      keep(res);
      if (!res.ok) throw new Error(`Portail: ${path} → HTTP ${res.status} ${(await res.text()).replace(/\s+/g, ' ').slice(0, 200)}`);
      return res.json();
    },
  };
}

// Parcours récursif : première valeur texte trouvée sous l'une des clés demandées.
export function findText(node, keys) {
  if (node == null || typeof node !== 'object') return null;
  for (const k of keys) {
    const v = node[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    if (v && typeof v === 'object' && typeof v.value === 'string') return v.value;
  }
  for (const v of Object.values(node)) {
    const r = findText(v, keys);
    if (r) return r;
  }
  return null;
}

// Date du portail → AAAA-MM-JJ. Le portail indique son format (dateFormat, p. ex. "dd/MM/yyyy") ; à défaut on devine.
export function toISODate(v, fmt) {
  if (v == null || v === '') return null;
  const str = String(v).trim();
  const pad = (n) => String(n).padStart(2, '0');
  const ok = (y, m, d) => (y >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);
  if (fmt && /[dMy]/.test(fmt)) {
    const order = [];
    const re = fmt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/yyyy|yy|MM|dd/g, (t) => { order.push(t); return t === 'yyyy' ? '(\\d{4})' : '(\\d{2})'; });
    const m = str.match(new RegExp(re));
    if (m && order.length === 3) {
      const g = Object.fromEntries(order.map((t, i) => [t, Number(m[i + 1])]));
      const y = g.yyyy ?? 2000 + g.yy;
      const r = ok(y, g.MM, g.dd);
      if (r) return r;
    }
  }
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/) || str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return ok(+m[3], +m[2], +m[1]); // jour/mois/année (usage français)
  if (/^\d{10,}$/.test(str)) { const d = new Date(Number(str)); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  const d = new Date(str);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

// Titre de notice → titre lisible : « Titre[ Texte imprimé : sous-titre / Auteur » devient « Titre : sous-titre ».
export function cleanTitle(t) {
  let s = String(t ?? '').replace(/\s*\[\s*(?:Texte imprimé|Texte manuscrit|Document[^\]:/]*|Enregistrement[^\]:/]*|Vidéo[^\]:/]*|Multimédia[^\]:/]*|Ressource[^\]:/]*|Image[^\]:/]*|Musique imprimée|Partition|Carte[^\]:/]*|Objet[^\]:/]*)\s*\]?/i, '');
  s = s.replace(/\s*\/\s+.*$/, '').replace(/(\S)\s*:\s+/g, '$1 : ');
  return s.replace(/\s+/g, ' ').replace(/[\s.:;,/]+$/, '').trim();
}

// « Gaudin, Rodolphe 1975-.... » → « Rodolphe Gaudin »
export function cleanAuthor(a) {
  let s = String(a ?? '').replace(/\s*\(?\d{3,4}\s*-\s*(?:\d{0,4})?\.*\)?\.*\s*$/, '').replace(/[\s.,;]+$/, '').trim();
  const m = s.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}`.trim() : s;
}

// Le portail renvoie parfois des clés de traduction (« globalErrorLeg_list.OK ») : on ne garde que du texte lisible.
const readable = (v) => (/\s/.test(v) && !/^[\w.]+$/.test(v) ? v : '');
const hhmm = (h) => String(h ?? '').trim().replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1');

// Le portail renvoie la liste directement : [{ title, author, returnDate, dateFormat, seqNo, isLate, isRenewable, … }].
// On garde toutes les informations utiles à l'affichage.
export function parseLoans(loans) {
  const items = Array.isArray(loans) ? loans : loans?.items ?? [];
  const text = (v) => (v == null ? '' : String(v).trim());
  return items
    .map((it, i) => {
      const f = it.dateFormat;
      return {
        id: String(it.seqNo ?? it.documentNumber ?? i),
        title: cleanTitle(it.title ?? it.documentTitle) || 'Document',
        author: cleanAuthor(it.author),
        loanDate: toISODate(it.loanDate, f),
        dueDate: toISODate(it.returnDate ?? it.dateDue ?? it.dueDate, f),
        returnHour: hhmm(it.returnHour),
        branch: text(it.branch?.desc),
        late: !!it.isLate,
        // Règle de l'appli web du portail : prolongeable si la condition vaut « OK » et que le prêt n'a pas déjà été prolongé par le lecteur.
        canRenew: text(it.renewalCondition).toUpperCase() === 'OK' && !it.userRenewed && it.isRenewable !== false,
        renewalMessage: readable(text(it.renewalConditionMessage)),
        prolongation: text(it.prolongation),
        prolongationMax: text(it.prolongationMax),
        userRenewed: !!it.userRenewed,
        canChangeDueDate: !!it.canChangeDueDate,
        recalled: !!it.recalled,
        reserved: !!it.reserved,
        lost: !!it.lost,
        hasCharge: !!it.hasCharge,
        copyProblem: !!it.copyProblem,
        lateNotices: it.nbLateNoticeSent ? Number(it.nbLateNoticeSent) : 0,
        lateNoticeDates: (it.lateNoticeDates ?? []).map((d) => toISODate(d, f)).filter(Boolean),
        documentNumber: text(it.documentNumber),
        issueCaption: text(it.issueCaption),
        volume: text(it.volume),
        // Identifiant de notice du portail (même règle que son appli web) → image de couverture publique du portail.
        coverId: /^\d{1,10}$/.test(String(it.seqNo ?? '')) ? `p::usmarcdef_${String(it.seqNo).padStart(10, '0')}` : '',
        isbn: text(it.isbn13 || it.isbn10 || it.isbn).replace(/[^0-9Xx]/g, ''),
      };
    })
    .filter((l) => l.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export async function fetchLoans(creds, fetchFn = fetch, debug = false) {
  const { c, token } = await login(creds, fetchFn);
  const session = { token };
  // Le portail attend parfois la langue, parfois non : on essaie les deux et on garde la première réponse valide.
  let loans, lastErr;
  for (const params of [{ locale: 'fr' }, {}, { locale: 'fr', id: '' }]) {
    try { loans = await c.get(session.token, 'loans', params); break; } catch (e) { lastErr = e; }
  }
  if (!loans) throw lastErr;
  if (loans.errorReponse) throw new Error(`Portail: loans → ${loans.code} ${String(loans.error).slice(0, 150)}`);
  const parsed = parseLoans(loans);
  return debug ? { loans: parsed, shape: shapeOf(loans) } : { loans: parsed };
}

// Structure sans valeurs : utile pour ajuster l'analyse sans exposer de données personnelles.
export function shapeOf(v, depth = 0) {
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1), `…${v.length}`] : [];
  if (v && typeof v === 'object') return depth > 6 ? '{…}' : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x, depth + 1)]));
  return typeof v;
}

// Diagnostic : statuts HTTP des principaux appels après connexion, sans aucune donnée personnelle (les corps ne sont pas renvoyés
// sauf pour les erreurs, tronqués). Sert à comprendre un refus du portail.
export async function diagnose({ username, password }, fetchFn = fetch) {
  const c = makeClient(fetchFn);
  await c.init();
  const session = await c.post(null, 'authenticate', { username: username.includes('@') ? username.toLowerCase() : username, password, locale: 'fr' });
  if (!session.token) throw new AuthError(`Connexion refusée : ${session.error || 'identifiants incorrects ?'}`);
  const out = { sessionKeys: Object.keys(session).sort(), passwordPoliticsInvalidated: session.passwordPoliticsInvalidated, tokenLength: session.token.length, cookiesAfterLogin: c.cookieNames(), connectStatus: await c.connect(), cookiesAfterConnect: c.cookieNames(), steps: [] };
  const step = async (label, fn) => {
    try { const r = await fn(); out.steps.push(r?.errorReponse ? { label, ok: false, code: r.code, error: String(r.error).slice(0, 200) } : { label, ok: true, shape: shapeOf(r) }); return r; } catch (e) { out.steps.push({ label, ok: false, error: e.message.slice(0, 250) }); }
  };
  const jsess = c.cookieNames().includes('JSESSIONID') ? c.cookieNames().filter((n) => n === 'JSESSIONID') : [];
  const variants = {
    base: {},
    sansCookie: { cookie: '' },
    checksumRequeteComplete: { auth: (t, a, q) => `Bearer ${t} ${a} ${checksum(q + '&_=' + Date.now())}` },
    sansChecksum: { auth: (t, a) => `Bearer ${t} ${a}` },
    sansApiToken: { auth: (t, a, q) => `Bearer ${t} ${checksum(q)}` },
    checksumVide: { auth: (t, a) => `Bearer ${t} ${a} ${checksum('')}` },
    sansMicrosite: { noMicrosite: true },
  };
  out.variants = {};
  for (const [name, v] of Object.entries(variants)) {
    try { out.variants[name] = await c.probe(session.token, 'profile', { auth: (t, a, q) => `Bearer ${t} ${a} ${checksum(q)}`, ...v }); } catch (e) { out.variants[name] = { error: e.message.slice(0, 100) }; }
  }
  // L'adresse de sortie de Cloudflare change-t-elle entre deux appels ? (seulement le nombre d'adresses distinctes est renvoyé)
  try {
    const ips = new Set();
    for (let i = 0; i < 4; i++) ips.add((await (await fetchFn('https://api.ipify.org')).text()).trim());
    out.egressDistinctIps = ips.size;
  } catch (e) { out.egressDistinctIps = 'inconnu'; }
  for (const aspect of ['loans', 'accountSummary', 'rights', 'profile']) {
    await step(`${aspect} locale=fr`, () => c.get(session.token, aspect, { locale: 'fr' }));
    await step(`${aspect} sans paramètre`, () => c.get(session.token, aspect, {}));
  }
  return out;
}

export const SERVICES = {
  mediapart: 'https://www.bmvr.marseille.fr/in/rest/cas/login?service=https%3A%2F%2Fwww.mediapart.fr%2F%3Fcasid%3DBMVR.Marseille',
  // Marsactu passe par la plateforme d'accès brief.me (connexion CAS de la BMVR), comme le lien « mars-actu-connexion-sso » du site.
  marsactu: 'https://www.bmvr.marseille.fr/in/rest/cas/login?service=' + encodeURIComponent('https://www.brief.me/?cas_sso_id=www.bmvr.marseille.fr&platform=inmedia&client=marsactu'),
  cafeyn: 'https://www.cafeyn.co/loginexternal/648',
};

// Connexion à la BMVR puis adresse d'entrée (avec ticket) du service demandé.
export async function fetchServiceUrl({ username, password }, service, fetchFn = fetch, trace = [], follow = false) {
  const start = typeof service === 'string' && SERVICES[service] ? SERVICES[service] : service?.url;
  if (!start) throw new Error('Service inconnu');
  const c = makeClient(fetchFn);
  await c.init();
  const session = await c.post(null, 'authenticate', { username: username.includes('@') ? username.toLowerCase() : username, password, locale: 'fr' });
  if (!session.token) throw new AuthError(`Connexion refusée : ${session.error || 'identifiants incorrects ?'}`);
  await c.connect();
  trace.push(`session ${c.cookieNames().join('+')}`);
  const entry = await c.serviceUrl(start, trace);
  if (follow) await followChain(entry, fetchFn, trace); // diagnostic : suit la suite des redirections côté relais
  return entry;
}

// Diagnostic : suit les redirections après l'adresse d'entrée et note, sans valeurs, hôtes, chemins, noms de paramètres et de cookies.
async function followChain(start, fetchFn, trace) {
  const jar = new Map();
  let url = start;
  for (let hop = 0; hop < 12; hop++) {
    const u = new URL(url);
    const cookie = [...(jar.get(u.host) ?? new Map())].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetchFn(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; appli-bmvr)', ...(cookie ? { Cookie: cookie } : {}) } });
    const names = [];
    for (const sc of res.headers.getSetCookie?.() ?? []) { const [pair] = sc.split(';'); const i = pair.indexOf('='); if (!jar.has(u.host)) jar.set(u.host, new Map()); jar.get(u.host).set(pair.slice(0, i), pair.slice(i + 1)); names.push(pair.slice(0, i)); }
    const loc = res.headers.get('Location');
    const nx = loc ? new URL(loc, url) : null;
    trace.push(`suite ${res.status} ${u.host}${u.pathname} [${[...u.searchParams.keys()].join(',')}]${names.length ? ' cookies:' + names.join('+') : ''}${nx ? ` → ${nx.host}${nx.pathname} [${[...nx.searchParams.keys()].join(',')}]` : ''}`);
    if (!nx && res.status === 200 && /marsactu\.fr$/.test(u.host)) { const t = await res.text(); const cls = (t.match(/<body[^>]*class="([^"]*)"/i)?.[1] ?? '').split(/\s+/).filter((c) => /member|membre|logged|access|referrer|abonn|subscri|role|guest|visitor/i.test(c)); trace.push(`page finale : classes[${cls.join(' ')}] · « Je m'abonne » ×${(t.match(/je m['’]abonne/gi) || []).length} · « Accès bibliothèque » ×${(t.match(/acc[èe]s biblioth[èe]que/gi) || []).length} · « Se déconnecter/Déconnexion » ×${(t.match(/d[ée]connexion|se d[ée]connecter/gi) || []).length} · « Mon compte » ×${(t.match(/mon compte/gi) || []).length} · « Se connecter/Je me connecte » ×${(t.match(/se connecter|je me connecte/gi) || []).length}`); return; }
    if (!nx) { if (res.status === 200) { const t = (await res.text()).slice(0, 4000); const m = t.match(/(?:window\.location(?:\.href)?\s*=|location\.replace\(|http-equiv=["']refresh["'][^>]*url=)\s*["']?([^"')\s>]+)/i); if (m) trace.push(`page ${u.host} redirige (script/meta) vers ${m[1].slice(0, 120).replace(/[?&]((?:ticket|token|code)[^=]*)=[^&]*/gi, '?$1=XXX')}`); } return; }
    url = nx.toString();
  }
}

// Prolongation de plusieurs prêts en une connexion : un résultat par document (jamais d'arrêt au premier refus).
export async function renewMany(creds, documentIds, fetchFn = fetch) {
  const ids = [...new Set((Array.isArray(documentIds) ? documentIds : []).map(String))].slice(0, 20);
  if (!ids.length || ids.some((id) => !/^[A-Za-z0-9_-]{1,40}$/.test(id))) throw new Error('Sélection invalide');
  const { c, token } = await login({ ...creds, cache: false }, fetchFn);
  const results = [];
  for (const documentId of ids) {
    try {
      const r = await c.get(token, 'renewLoan', { documentId });
      results.push({ documentId, extended: r.extended === true, newReturnDate: toISODate(r.newReturnDate), warnings: Array.isArray(r.warnings) ? r.warnings : [], message: r.errorReponse ? String(r.error || '') : r.faultString || '' });
    } catch (e) { results.push({ documentId, extended: false, warnings: [], message: String(e.message).slice(0, 120) }); }
  }
  return { results };
}

// Prolongation d'un prêt (même appel que le bouton « Prolonger » du portail). documentId = numéro de document du prêt.
export async function renewLoan({ username, password }, documentId, fetchFn = fetch) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(documentId ?? '')) throw new Error('Document invalide');
  const c = makeClient(fetchFn);
  await c.init();
  const session = await c.post(null, 'authenticate', { username: username.includes('@') ? username.toLowerCase() : username, password, locale: 'fr' });
  if (!session.token) throw new AuthError(`Connexion refusée : ${session.error || 'identifiants incorrects ?'}`);
  await c.connect();
  const r = await c.get(session.token, 'renewLoan', { documentId });
  const f = r.faultString || '';
  return {
    extended: r.extended === true,
    newReturnDate: toISODate(r.newReturnDate),
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
    message: r.errorReponse ? String(r.error || '') : f,
  };
}


// ---------- Réservations, recherche ----------
// Connexion commune : session + jeton, prêts à interroger le portail.
// Session gardée quelques minutes dans la mémoire du relais (jamais sur disque, jamais le mot de passe : seulement le jeton de session,
// rangé sous une empreinte irréversible des identifiants). Les lectures suivantes évitent les 3 étapes de connexion.
const SESSIONS = new Map();
const SESSION_TTL = 5 * 60 * 1000;
async function sessionKey({ username, password }) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${username}\u0000${password}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function login(creds, fetchFn) {
  const { username, password } = creds;
  const key = creds.cache ? await sessionKey(creds) : null;
  const now = Date.now();
  if (key) {
    const hit = SESSIONS.get(key);
    if (hit && now - hit.at < SESSION_TTL) { const c = makeClient(fetchFn); c.restore(hit.snap); return { c, token: hit.token }; }
    for (const [k, v] of SESSIONS) if (now - v.at >= SESSION_TTL) SESSIONS.delete(k);
    if (SESSIONS.size > 300) SESSIONS.clear();
  }
  const c = makeClient(fetchFn);
  await c.init();
  const session = await c.post(null, 'authenticate', { username: username.includes('@') ? username.toLowerCase() : username, password, locale: 'fr' });
  if (!session.token) throw new AuthError(`Connexion refusée : ${session.error || 'identifiants incorrects ?'}`);
  await c.connect();
  if (key) SESSIONS.set(key, { at: now, token: session.token, snap: c.snapshot() });
  return { c, token: session.token };
}
// Si une session gardée a expiré côté portail, on l'oublie et on recommence une fois avec une connexion neuve.
export async function withSession(creds, fn) {
  if (!creds.cache) return fn(creds);
  const key = await sessionKey(creds);
  const hadHit = SESSIONS.has(key);
  try { return await fn(creds); } catch (e) {
    if (!hadHit || e instanceof AuthError) throw e;
    SESSIONS.delete(key);
    return fn(creds);
  }
}

const failIfError = (r, what) => {
  if (r?.errorReponse) throw new Error(`${what} : ${readable(String(r.error || '')) || r.code || 'refusé par la bibliothèque'}`);
  return r;
};
const first = (v) => (Array.isArray(v) ? (v[0]?.value ?? v[0]) : v?.value ?? v);

// Réservations en cours : une carte par réservation.
export function parseReservations(list) {
  const items = Array.isArray(list) ? list : list?.items ?? [];
  const text = (v) => (v == null ? '' : String(v).trim());
  return items.map((raw, i) => {
    const it = raw?.data ?? raw;
    const f = it.dateFormat;
    const seq = text(it.seqNo);
    const status = it.statusDescription;
    return {
      id: text(it.reservationId) || `${seq}-${i}`,
      reservationId: text(it.reservationId),
      title: cleanTitle(it.title) || 'Document',
      author: cleanAuthor(it.author),
      volume: text(it.volume),
      issueCaption: text(it.issueCaption),
      branch: text(it.branch?.desc ?? it.pickupBranchDesc),
      reservedOn: toISODate(it.resvDate, f),
      activationDate: toISODate(it.activationDate, f),
      expiryDate: toISODate(it.expiryDate, f),
      pickupDeadline: toISODate(it.dateHoldForPickup, f),
      rank: it.rank != null && it.rank !== '' ? Number(it.rank) || 0 : null,
      status: readable(text(typeof status === 'object' ? status?.desc : status)),
      statusCode: text(it.statusCode),
      available: /AVAILABLE/i.test(text(it.statusCode)),
      ilsType: text(it.ilsType ?? raw?.ilsType),
      seqNo: seq,
      omnidexId: text(it.omnidexId),
      pickupBranch: text(it.branch?.branchCode ?? it.pickupBranch),
      canCancel: it.canCancel !== false && !it.canceled && (!!text(it.reservationId) || !!seq),
      coverId: /^\d{1,10}$/.test(seq) ? `p::usmarcdef_${seq.padStart(10, '0')}` : '',
    };
  });
}

export async function fetchReservations(creds, fetchFn = fetch, debug = false) {
  const { c, token } = await login(creds, fetchFn);
  let res, lastErr;
  for (const [path, params] of [['reservations', { locale: 'fr' }], ['accountPage', { type: 'reservations', pageNo: 1, pageSize: 100, locale: 'fr' }], ['reservations', {}]]) {
    try { res = failIfError(await c.get(token, path, params), 'Réservations'); break; } catch (e) { lastErr = e; }
  }
  if (!res) throw lastErr;
  const reservations = parseReservations(res);
  return debug ? { reservations, shape: shapeOf(res) } : { reservations };
}

// Annulation d'une réservation (même appel que le bouton « Annuler » du portail, selon le type de système de la bibliothèque).
export async function cancelReservation(creds, req, fetchFn = fetch) {
  const ok = (v, re) => v == null || v === '' || re.test(String(v));
  const { reservationId, ilsType, seqNo, volume, omnidexId, pickupBranch } = req ?? {};
  if (!ok(reservationId, /^[A-Za-z0-9_-]{1,40}$/) || !ok(seqNo, /^[A-Za-z0-9_-]{1,40}$/) || !ok(omnidexId, /^[A-Za-z0-9_.:-]{1,60}$/) || !ok(pickupBranch, /^[A-Za-z0-9_-]{1,20}$/) || !ok(volume, /^[^"\\<>]{1,60}$/)) throw new Error('Réservation invalide');
  if (!reservationId && !seqNo) throw new Error('Réservation invalide');
  const { c, token } = await login(creds, fetchFn);
  let r;
  if (/^syracuse$/i.test(ilsType ?? '') && reservationId) r = await c.get(token, 'cancelReservation', { ilsType: 'Syracuse', reservationId });
  else if (reservationId && !seqNo) r = await c.get(token, 'cancelReservation', { ilsType: 'concerto', reservationId });
  else { const cp = { seqNo, volNo: volume || null, omnidexId: omnidexId || null, pickupBranch: pickupBranch || null }; r = await c.get(token, 'cancelReservation', cp).catch(() => c.post(token, 'cancelReservation', cp)); }
  failIfError(r, 'Annulation');
  return { canceled: true };
}

// Recherche dans le catalogue. Chaque résultat garde tout ce que donne le portail : les champs connus sont mis en forme,
// les autres sont listés tels quels dans « fields ».
const LABELS = { publisher: 'Éditeur', summary: 'Résumé', collection: 'Collection', language: 'Langue', isbn: 'ISBN', issn: 'ISSN', date: 'Date', subject: 'Sujets', genre: 'Genre', physicalDescription: 'Description', series: 'Série', edition: 'Édition', callNumber: 'Cote', ark: 'Identifiant ARK', contentType: 'Type', format: 'Format', typeOfDocumentFacet: 'Type de document' };
const SKIP = /^(id|title|author|authorExplore|authorHits|iid|meta|stickers|thumbUrl|zmat\w*|imageSource.*|exploreQuery|.*Explore|.*Hits|rights|needsApproval|posInSet|readerEnabled|readerLabel|disable\w+|hidden\w*|score|_.*)$/i;
const pretty = (k) => LABELS[k] ?? k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
function flat(v, depth = 0) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap((x) => flat(x, depth + 1));
  if (typeof v === 'object') {
    if ('value' in v && depth < 4 && (typeof v.value !== 'object')) return flat(v.value, depth + 1);
    return depth > 2 ? [] : Object.entries(v).filter(([k]) => !SKIP.test(k)).flatMap(([k, x]) => flat(x, depth + 1).map((t) => `${pretty(k)} : ${t}`));
  }
  const t = String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? [t] : [];
}

export function parseSearch(res) {
  const rows = res?.resultSet ?? [];
  return rows.map((e) => {
    const id = String(first(e.id) ?? '');
    const num = id.match(/usmarcdef_(\d+)/)?.[1];
    const fields = [];
    const seen = new Set();
    const add = (label, vals) => { const v = [...new Set(vals)].join(' · ').slice(0, 600); if (v && !seen.has(label + v)) { seen.add(label + v); fields.push([label, v]); } };
    // Comme la carte du site officiel : auteur / éditeur / date viennent de « meta » (meta.author, meta.publisher…), le type de
    // « TypeOfDocumentFacet ». Les intitulés sont toujours écrits en français ici ; un champ inconnu n'est pas affiché.
    const FR = [
      [/^(authors?|creators?|auteurs?)$/i, 'Auteurs'], [/^(publishers?|publisherName|editors?|[ée]diteurs?)$/i, 'Éditeurs'],
      [/^(date|year|dateIssued\w*|publicationDate|datePublished|dateOfPublication|pubDate|annee)$/i, 'Date'],
      [/^StockShelfmark$/i, 'Cote'],
      [/^(language|langues?)$/i, 'Langue'], [/^(subjects?|topics?|sujets?)$/i, 'Sujets'], [/^genres?$/i, 'Genre'],
      [/^collections?$/i, 'Collection'], [/^series$/i, 'Série'], [/^(summary|abstract|r[ée]sum[ée])$/i, 'Résumé'],
      [/^(physicalDescription|description)$/i, 'Description'], [/^edition$/i, 'Édition'], [/^(isbn\w*)$/i, 'ISBN'],
    ];
    const frLabel = (k) => FR.find(([re]) => re.test(k))?.[1] ?? null;
    const metaEntries = [...Object.entries(e.meta ?? {}), ...Object.entries(e).filter(([k]) => k.startsWith('meta.')).map(([k, v]) => [k.slice(5), v])];
    const topEntries = Object.entries(e).filter(([k]) => !k.startsWith('meta.') && k !== 'meta');
    const valuesOf = (arr) => flat(Array.isArray(arr) ? arr.map((x) => (x && typeof x === 'object' && 'value' in x ? x.value : x)) : arr);
    for (const [k, arr] of [...metaEntries, ...topEntries]) {
      const own = Array.isArray(arr) && typeof arr[0]?.label === 'string' ? arr[0].label.replace(/\s*:\s*$/, '').trim() : '';
      const label = frLabel(k) || (metaEntries.some(([mk]) => mk === k) && own && !/^[a-z_.]+$/i.test(own) && own.length < 40 ? own : null);
      if (!label) continue;
      let vals = valuesOf(arr);
      if (label === 'Auteurs') vals = vals.map(cleanAuthor);
      if (label === 'Date') vals = vals.map((v) => (/^\d{4}/.test(v) ? v.slice(0, 4) : v));
      add(label, vals);
    }
    const zType = flat((e.zmatDisplay ?? []).map?.((x) => x?.value ?? x)).join(', ');
    if (zType) add('Type de document', [zType]);
    const ORDER = ['Auteurs', 'Éditeurs', 'Date', 'Type de document'];
    fields.sort((x, y) => { const i = ORDER.indexOf(x[0]), j = ORDER.indexOf(y[0]); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
    // Disponibilité : « Document disponible dans un des établissements du réseau » sur le site.
    const st = e.physicalStock;
    let availability = '';
    const numv = (x) => (x != null && x !== '' && !isNaN(Number(x)) ? Number(x) : null);
    const stv = Array.isArray(st) ? st[0]?.value ?? st[0] : st?.value ?? st;
    if (stv && typeof stv === 'object') {
      const k = Object.keys(stv).find((x) => /avail|dispo/i.test(x));
      const n = k ? numv(stv[k]) : null;
      availability = n == null ? '' : n > 0 ? 'available' : 'unavailable';
    } else if (numv(stv) != null) availability = numv(stv) > 0 ? 'available' : 'unavailable';
    else if (typeof stv === 'string' && stv) availability = /^(true|available)$/i.test(stv) ? 'available' : /^(false|unavailable)$/i.test(stv) ? 'unavailable' : '';
    return {
      id,
      title: cleanTitle(first(e.title)) || 'Document',
      author: cleanAuthor(first(e.author)),
      year: '',
      type: '',
      availability,
      image: (() => { const v = first(e.imageSource_512) ?? first(e.imageSource_256) ?? first(e.imageSource_128); if (!v || typeof v !== 'string') return ''; const u = v.startsWith('http') ? v : v.startsWith('/') ? BASE + v : ''; return u && /^https:\/\//.test(u) ? u + (u.includes('rest/Thumb') && !u.includes('siteId=') ? (u.includes('?') ? '&' : '?') + 'siteId=mainSite' : '') : ''; })(),
      coverId: num ? id : '',
      isbn: String(first(e[Object.keys(e).find((k) => /isbn/i.test(k)) ?? 'isbn']) ?? first(e.isbn13) ?? first(e.isbn10) ?? first(e.meta?.isbn) ?? first(e.meta?.isbn13) ?? '').replace(/[^0-9Xx]/g, ''),
      fields,
      digital: String(first(e.IsPhysicalDocument) ?? '') === '0',
      kind: zType,
    };
  }).filter((r) => r.id);
}

// Disponibilité et « réservable » : on lit les exemplaires de chaque résultat (aspect Stock) et on suit les indicateurs du portail.
async function attachStock(c, token, results, max = 30) {
  await Promise.all(results.slice(0, max).map(async (r) => {
    if (r.digital) return; // podcasts, films et livres numériques : pas d'exemplaire en rayon
    try {
      const stock = failIfError(await c.get(token, 'notice', { id: r.id, locale: 'fr', aspect: 'Stock' }), 'Exemplaires');
      const copies = parseCopies(stock);
      r.copiesTotal = copies.length;
      r.copiesAvailable = copies.filter((x) => x.available && !x.held).length;
      r.nextReturn = copies.filter((x) => !x.available).map((x) => x.due).filter(Boolean).sort()[0] || '';
      r.copies = copies.slice(0, 60).map(({ branch, place, callNumber, status, available, due, stat, held }) => ({ branch, place, callNumber, status, available, due, stat, held }));
      r.reservable = stock?.canReserve !== false && copies.some((x) => x.canReserve);
      if (!copies.length && stock?.hasSerialHoldings) {
        const h = failIfError(await c.get(token, 'serialHoldings', { id: r.id, page: 1, locale: 'fr' }), 'Collection');
        const seen = new Set();
        r.holdings = (h.holdings ?? []).filter((x) => !x.isHeader && x.caption).map((x) => ({ branch: x.branch?.desc || '', place: x.subloca?.desc || '', callNumber: x.callNumber || '', caption: String(x.caption).replace(/^Etat de collection\s*:\s*/i, '') }))
          .filter((x) => { const k = x.branch + x.caption; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
        r.reservable = false;
      }
    } catch { r.reservable = null; }
  }));
}

export async function searchCatalogue(creds, query, fetchFn = fetch, debug = false, page = 1, queryId = '') {
  const q = String(query ?? '').trim().slice(0, 200);
  if (!q) throw new Error('Saisis un titre, un auteur ou un mot-clé');
  const { c, token } = await login(creds, fetchFn);
  const res = failIfError(await c.post(token, 'search', { query: [q], queryid: /^[0-9a-f-]{36}$/i.test(queryId) ? queryId : 'NONE', sf: '*', includeFacets: false, pageNo: Math.min(Math.max(Number(page) || 1, 1), 10), pageSize: 20, locale: 'fr' }), 'Recherche');
  const results = parseSearch(res);
  await attachStock(c, token, results);
  return debug ? { results, shape: shapeOf(res), firstKeys: Object.keys(res?.resultSet?.[0] ?? {}), metaKeys: Object.keys(res?.resultSet?.[0]?.meta ?? {}) } : { results, total: res.totalHits ?? res.total ?? results.length };
}

const ID_RE = /^[A-Za-z0-9_:.\-\/]{1,120}$/;
const check = (id) => { if (!ID_RE.test(id ?? '')) throw new Error('Document invalide'); };

// Exemplaires du document (aspect « Stock » de la notice) : le portail réserve toujours un exemplaire précis.
export function parseCopies(stock) {
  const out = [];
  const bool = (v) => v === true || String(v).toLowerCase() === 'true';
  for (const grp of stock?.monographicCopies ?? []) {
    const g = grp.data ?? {};
    for (const ch of grp.children ?? []) {
      const d = ch.data ?? {};
      const no = String(d.copyNumber ?? '').trim();
      if (!no) continue;
      const statDesc = String(d.stat_desc ?? d.statDesc ?? '');
      const dueKey = Object.keys(d).find((k) => /(^|_)(due|return)/i.test(k) && /date|due/i.test(k));
      out.push({
        no,
        branch: String(d.branch_desc ?? g.branch_desc ?? d.branchDesc ?? ''),
        branchCode: String(d.branch ?? g.branch ?? ''),
        place: String(d.subloca_desc ?? g.subloca_desc ?? ''),
        callNumber: String(d.callnumber ?? d.callNumber ?? ''),
        status: statDesc,
        available: String(d.stat ?? '').toUpperCase() === 'DI' || /^disponible/i.test(statDesc),
        canReserve: bool(d.copyCanReserve),
        stat: String(d.stat ?? '').toUpperCase(),
        held: Number(d.resv_cur) > 0 || bool(d.isReserved) || /\(r[ée]serv[ée]\)/i.test(statDesc),
        due: dueKey ? toISODate(d[dueKey], d.dateFormat) : null,
      });
    }
  }
  return out;
}

// Étape 1 d'une réservation : exemplaires, volumes éventuels, bibliothèques de retrait possibles, avertissements.
export async function reserveInfo(creds, id, fetchFn = fetch, debug = false) {
  check(id);
  const { c, token } = await login(creds, fetchFn);
  let stock = null; const errs = [];
  let useId = id;
  for (const cand of [...new Set([id, id.replace(/^[a-z]::/i, ''), id.replace(/^.*_0*/, '')])].filter(Boolean)) {
    try { stock = failIfError(await c.get(token, 'notice', { id: cand, locale: 'fr', aspect: 'Stock' }), 'Exemplaires'); useId = cand; break; } catch (e) { errs.push(`Stock ${cand}: ${e.message.slice(0, 70)}`); }
  }
  if (!stock) {
    try { const m = await c.get(token, 'notice', { id, locale: 'fr', aspect: 'Meta' }); errs.push(m?.errorReponse ? `Meta: ${String(m.error).slice(0, 60)}` : `Meta ok (${Object.keys(m).slice(0, 8).join(',')})`); } catch (e) { errs.push(`Meta: ${e.message.slice(0, 70)}`); }
  }
  const copies = parseCopies(stock);
  const vols = await c.get(token, 'reservationVolumes', { id, locale: 'fr' }).catch((e) => ({ errorReponse: true, error: e.message }));
  // Le portail réserve un exemplaire précis : on essaie d'abord ceux qui ne sont pas disponibles (déjà sortis), puis les autres, puis sans exemplaire.
  const candidates = [...copies.filter((x) => x.canReserve), ...copies.filter((x) => !x.canReserve)].slice(0, 4).map((x) => x.no);
  let choices, copyNo = '';
  for (const no of [...candidates, '']) {
    for (const [how, call] of [
      ['GET', () => c.get(token, 'reservationChoices', { id, ...(no ? { serialCopyNo: no } : {}), locale: 'fr' })],
      ['POST', () => c.post(token, 'reservationChoices', { id, ...(no ? { serialCopyNo: no } : {}), locale: 'fr' })],
    ]) {
      try { const r = await call(); if (!r?.errorReponse) { choices = r; copyNo = no; break; } errs.push(`${how} ${no}: ${String(r.error || r.code).slice(0, 80)}`); } catch (e) { errs.push(`${how} ${no}: ${e.message.replace(/^Portail: reservationChoices → /, '').slice(0, 60)}`); }
    }
    if (choices) break;
  }
  if (!choices) throw new Error(`Réservation : le portail ne propose pas de lieu de retrait pour ce document (${copies.length} exemplaire${copies.length > 1 ? 's' : ''} ; ${errs.join(' | ')})`);
  const volumes = Array.isArray(vols) ? vols.map((v) => String(v.volume ?? '')).filter(Boolean) : [];
  const branches = (choices.branchList ?? []).map((b) => ({ code: String(b.branchCode ?? ''), name: String(b.branchDesc_fre || b.branchDesc || b.branchCode || '').replace(new RegExp(`^${b.branchCode ?? ''}\\s*-\\s*`), '') }));
  const traps = (choices.trapList ?? []).map((t) => readable(String(t.trapMessage ?? ''))).filter(Boolean);
  const out = { copyNo, copies, volumes, branches, traps, blocked: choices.userTrapLevel === 'Error' && traps.length > 0 };
  return debug ? { ...out, shape: { stock: shapeOf(stock), volumes: shapeOf(vols), choices: shapeOf(choices) } } : out;
}

// Rang dans la file d'attente pour un choix donné.
export async function reserveRank(creds, { id, volume, branch, copyNo }, fetchFn = fetch) {
  check(id);
  const { c, token } = await login(creds, fetchFn);
  const rp = { id, volume: volume || null, branch, ...(copyNo ? { monographicCopyNo: copyNo } : {}) };
  const r = await c.get(token, 'reservationRankWithStatus', rp).catch(() => c.post(token, 'reservationRankWithStatus', rp));
  return { ok: r.status !== false, rank: r.rank ?? null };
}

// Réservation effective. Le portail garde en mémoire (dans la session) les étapes précédentes : on les rejoue donc dans la même
// session avant de réserver, comme le fait l'appli du portail (volumes, lieux de retrait, rang), puis on essaie quelques formes de requête.
export async function makeReservation(creds, { id, volume, branch, copyNo }, fetchFn = fetch) {
  check(id);
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(branch ?? '')) throw new Error('Bibliothèque de retrait invalide');
  if (copyNo && !/^[^\s"\\<>]{1,60}$/.test(String(copyNo))) throw new Error('Exemplaire invalide');
  const { c, token } = await login(creds, fetchFn);
  const vol = volume || null;
  await c.get(token, 'reservationVolumes', { id, locale: 'fr' }).catch(() => null);
  await c.get(token, 'reservationChoices', { id, ...(copyNo ? { serialCopyNo: copyNo } : {}), locale: 'fr' }).catch(() => null);
  await c.get(token, 'reservationRankWithStatus', { id, volume: vol, branch, ...(copyNo ? { monographicCopyNo: copyNo } : {}) }).catch(() => null);
  const errs = [];
  for (const [how, body] of [
    ['exemplaire', { id, volume: vol, branch, ...(copyNo ? { monographicCopyNo: copyNo } : {}), locale: 'fr' }],
    ['exemplaire+série', { id, volume: vol, branch, ...(copyNo ? { serialCopyNo: copyNo, monographicCopyNo: copyNo } : {}), locale: 'fr' }],
    ['sans exemplaire', { id, volume: vol, branch, locale: 'fr' }],
  ]) {
    try {
      // Le portail appelle makeReservation en GET (paramètres dans l'adresse) ; on garde le POST en secours.
      const r = failIfError(await c.get(token, 'makeReservation', body).catch((ge) => (/HTTP 5\d\d|InvalidRequest/.test(ge.message) ? c.post(token, 'makeReservation', body) : Promise.reject(ge))), 'Réservation');
      return { done: r.inSuccess === true };
    } catch (e) {
      if (e instanceof AuthError || !/HTTP 500|Fatal|InvalidRequest/.test(e.message)) throw e;
      errs.push(`${how}: ${e.message.replace(/^Portail: makeReservation → /, '').slice(0, 60)}`);
    }
  }
  throw new Error(`Réservation refusée par le portail (${errs.join(' | ')})`);
}


// ---------- Historique, messages, amendes, profil, favoris ----------
const FR_FIELDS = [
  [/^(loanDate|dateLoan|checkoutDate)$/i, 'Emprunté le'], [/^(returnDate|dateReturned|returnedDate|checkinDate)$/i, 'Rendu le'], [/^(dueDate|dateDue)$/i, 'À rendre le'],
  [/^(branch|library|branchDesc|location)$/i, 'Bibliothèque'], [/^(subject|messageSubject|object)$/i, 'Objet'],
  [/^(message|body|text|content|messageBody)$/i, 'Message'], [/^(sender|from|fromName)$/i, 'De'],
  [/^(amount|totalAmount|fineAmount|balance|fee|charge|totalCharge)$/i, 'Montant'], [/^(reason|fineReason|chargeReason)$/i, 'Motif'],
  [/^(status|statusDescription|state)$/i, 'État'], [/^(paid|isPaid)$/i, 'Payé'], [/^(type|messageType)$/i, 'Type'],
  [/^(expiryDate|expirationDate|subscriptionEnd|endDate)$/i, 'Expire le'], [/^(activationDate|subscriptionDate|startDate|beginDate)$/i, 'Début'],
  [/^(date|created|createdDate|creationDate|sentDate|dateIssued|resvDate)$/i, 'Date'],
  [/^(fullName|userName|name)$/i, 'Nom'], [/^firstName$/i, 'Prénom'], [/^(lastName|familyName)$/i, 'Nom de famille'],
  [/^(email|mail)$/i, 'E-mail'], [/^(phone|phoneNumber|mobile|tel)$/i, 'Téléphone'], [/^(address|street|address1)$/i, 'Adresse'],
  [/^city$/i, 'Ville'], [/^(zip|zipCode|postalCode)$/i, 'Code postal'], [/^(category|profileCategory|patronCategory|subscriptionType)$/i, 'Catégorie'],
  [/^(birthDate|birthDateYYYMMDD|dateOfBirth)$/i, 'Date de naissance'], [/^(cardNumber|barcode|userId|login|username)$/i, 'N° de carte'],
  [/^(volume)$/i, 'Volume'], [/^(issueCaption)$/i, 'Numéro'],
];
const frDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

function genericFields(d) {
  const out = []; const seen = new Set();
  for (const [k, v] of Object.entries(d)) {
    const label = FR_FIELDS.find(([re]) => re.test(k))?.[1];
    if (!label || v == null || typeof v === 'object' || v === '') continue;
    let val = typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!val) continue;
    if (/date|expir|created|issued|^(startDate|endDate|beginDate|subscriptionEnd)$/i.test(k)) val = frDate(toISODate(val, d.dateFormat)) || val;
    if (label === 'Montant' && /^-?\d+([.,]\d+)?$/.test(val)) val = `${val.replace('.', ',')} €`;
    if (!readable(val) && /^[\w.]+$/.test(val) && /[a-z]\.[A-Za-z]/.test(val)) continue; // clé de traduction technique
    if (seen.has(label + val)) continue;
    seen.add(label + val);
    out.push([label, val.slice(0, 600)]);
  }
  return out;
}

export function parseAccountItems(res) {
  const items = Array.isArray(res) ? res : res?.items ?? res?.messages ?? res?.fines ?? [];
  return items.map((raw, i) => {
    const d = raw?.data ?? raw;
    const seq = String(d.seqNo ?? '').trim();
    const title = cleanTitle(d.title ?? d.documentTitle ?? raw?.resultItem?.title?.[0]?.value ?? d.subject ?? d.messageSubject) || '';
    return {
      id: String(d.id ?? d.messageId ?? d.reservationId ?? seq ?? i),
      title,
      author: cleanAuthor(d.author),
      coverId: /^\d{1,10}$/.test(seq) ? `p::usmarcdef_${seq.padStart(10, '0')}` : '',
      isbn: String(d.isbn13 || d.isbn10 || d.isbn || '').replace(/[^0-9Xx]/g, ''),
      fields: genericFields(d).filter(([l]) => !(title && l === 'Objet' && false)),
    };
  });
}

const ACCOUNT_KINDS = { loanhistory: 'loanhistory', messages: 'messages', fines: 'fines' };

// Messages de la bibliothèque : le portail donne numéro, objet, date, heure et texte (pas d'état lu / non lu).
const htmlText = (h) => String(h ?? '').replace(/<\s*br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
export function parseMessages(res) {
  const items = Array.isArray(res) ? res : res?.items ?? res?.messages ?? [];
  return items.map((raw, i) => {
    const d = raw?.data ?? raw;
    const subject = htmlText(d.subject);
    const date = toISODate(d.date, d.dateFormat);
    const time = String(d.time ?? '').trim().replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1');
    const body = htmlText(d.body ?? d.message ?? d.text);
    const isSystem = (!subject || subject === 'SyracuseMessage');
    return {
      id: `${d.number ?? d.messageId ?? i}|${d.date ?? ''}|${d.time ?? ''}`,
      title: isSystem ? 'Message de la bibliothèque' : subject,
      author: '', coverId: '', isbn: '',
      date, time, from: htmlText(d.from), html: String(d.body ?? d.message ?? d.text ?? '').slice(0, 20000),
      fields: [date && ['Reçu le', frDate(date) + (time ? ` à ${time}` : '')], body && ['Message', body.slice(0, 2000)]].filter(Boolean),
    };
  });
}

export async function deleteMessage(creds, messageId, fetchFn = fetch) {
  const num = String(messageId ?? '').split('|')[0];
  if (!/^[A-Za-z0-9_.:-]{1,60}$/.test(num)) throw new Error('Message invalide');
  const { c, token } = await login(creds, fetchFn);
  const rawList = async () => {
    for (const [path, params] of [['messages', { locale: 'fr' }], ['accountPage', { type: 'messages', pageNo: 1, pageSize: 100, locale: 'fr' }]]) {
      try { const r = await c.get(token, path, params); const l = Array.isArray(r) ? r : r?.items ?? r?.messages ?? []; if (l.length) return l; } catch { /* suivant */ }
    }
    return [];
  };
  const list = await rawList();
  const hit = list.find((m) => String((m?.data ?? m)?.number ?? m?.number) === num);
  const d = hit?.data ?? hit ?? {};
  // Le portail attend l'identifiant propre au message : on essaie ceux que porte l'élément, puis le numéro.
  const cands = [...new Set([hit?.uniqueId, d.uniqueId, hit?.id, hit?.messageId, d.id, d.messageId, d.guid, d.uid, d.number, num].filter((v) => v != null && v !== '').map(String))];
  const errs = [];
  for (const cand of cands) {
    try {
      const r = await c.get(token, 'deleteMessage', { messageId: cand }).catch(() => c.post(token, 'deleteMessage', { messageId: cand }));
      if (r?.faultString || r?.errorReponse) { errs.push(`${cand}: ${String(r.faultString || r.error || r.code).slice(0, 80)}`); continue; }
      const left = (await rawList()).some((m) => String((m?.data ?? m)?.number ?? m?.number) === num);
      if (!left) return { ok: true };
      errs.push(`${cand}: sans effet`);
    } catch (e) { errs.push(`${cand}: ${String(e.message).replace(/^Portail: deleteMessage → /, '').slice(0, 80)}`); }
  }
  throw new Error(`Suppression refusée par le portail (${errs.join(' | ')} ; champs: ${Object.keys(hit ?? {}).join(',')}${hit?.data ? ' / data: ' + Object.keys(hit.data).join(',') : ''})`);
}

export async function fetchAccount(creds, kind, fetchFn = fetch, debug = false) {
  const { c, token } = await login(creds, fetchFn);
  if (kind === 'profile') {
    const p = failIfError(await c.get(token, 'profile', { locale: 'fr' }), 'Profil');
    // Le profil est une liste de propriétés { name, value: { Answer } } : on les traduit par mots-clés du nom.
    const PROP_FR = [
      [/first.?name|prenom|given/i, 'Prénom'], [/last.?name|family|surname|nom.?de.?famille/i, 'Nom de famille'], [/^(full.?name|name|nom)$/i, 'Nom'],
      [/e.?mail|courriel|mel/i, 'E-mail'], [/mobile|cell|portable/i, 'Téléphone mobile'], [/phone|tel/i, 'Téléphone'],
      [/zip|postal|post.?code/i, 'Code postal'], [/city|town|ville|locality/i, 'Ville'], [/country|pays/i, 'Pays'], [/address|adresse|street|rue/i, 'Adresse'],
      [/birth|naissance/i, 'Date de naissance'], [/expir|end.?date|valid/i, 'Expire le'], [/subscri|abonn|activation|start.?date/i, 'Abonnement'],
      [/card|barcode|login|user.?id|identifier|numero|number/i, 'N° de carte'], [/categor|profile.?type|type/i, 'Catégorie'],
      [/lang/i, 'Langue'], [/civil|title|gender|sex|salutation/i, 'Civilité'], [/branch|library|biblio/i, 'Bibliothèque'],
    ];
    const props = Array.isArray(p.properties) ? p.properties : [];
    const fields = []; const seenP = new Set();
    for (const pr of props) {
      const raw = pr?.value?.Answer ?? pr?.value;
      let v = raw == null || typeof raw === 'object' ? '' : String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!v || /^(null|undefined|false)$/i.test(v)) continue;
      const nm = String(pr.name ?? '');
      const label = PROP_FR.find(([re]) => re.test(nm))?.[1];
      if (!label) continue;
      if (/date|birth|naissance|expir/i.test(nm) || /^(Date de naissance|Expire le)$/.test(label)) v = frDate(toISODate(v)) || v;
      if (seenP.has(label + v)) continue;
      seenP.add(label + v);
      fields.push([label, v.slice(0, 300)]);
    }
    if (!fields.length) fields.push(...genericFields(Object.fromEntries(Object.entries(p).filter(([, x]) => typeof x !== 'object'))));
    const profile = organizeProfile(fields);
    const out = { items: [{ id: 'profil', title: '', fields: profile.sections.flatMap((x) => x.rows) }], profile };
    return debug ? { ...out, shape: shapeOf(p), propertyNames: props.map((x) => x.name) } : out;
  }
  const type = ACCOUNT_KINDS[kind];
  if (!type) throw new Error('Rubrique inconnue');
  // Selon la rubrique, le portail répond par la « page de compte » ou par l'aspect direct : on garde la première réponse non vide.
  let res, lastErr;
  for (const [path, params] of [[type, { locale: 'fr' }], ['accountPage', { type, pageNo: 1, pageSize: 100, locale: 'fr' }], [type, {}]]) {
    try {
      const r = failIfError(await c.get(token, path, params), 'Rubrique');
      const n = (Array.isArray(r) ? r : r?.items ?? r?.messages ?? r?.fines ?? []).length;
      if (!res) res = r;
      if (n > 0) { res = r; break; }
    } catch (e) { lastErr = e; }
  }
  if (!res) throw lastErr;
  const items = kind === 'messages' ? parseMessages(res) : parseAccountItems(res);
  return debug ? { items, shape: shapeOf(res) } : { items, total: res.total ?? items.length };
}

// Favoris (« listes » du portail).
export function parseBaskets(list) {
  const arr = Array.isArray(list) ? list : list?.items ?? list?.baskets ?? [];
  const str = (v) => (typeof v === 'string' ? v.trim() : v && typeof v === 'object' ? str(v.Answer ?? v.value ?? v.fr ?? v.fre ?? Object.values(v).find((x) => typeof x === 'string')) : '');
  const nameOf = (b) => {
    for (const k of ['title', 'name', 'label', 'nom', 'basketName', 'listName', 'description', 'desc']) { const v = str(b[k]); if (v) return v; }
    const pr = b.properties ?? b.props ?? b.data;
    if (Array.isArray(pr)) { const f = pr.find((x) => /title|name|label|nom/i.test(String(x?.name ?? x?.key ?? ''))); const v = str(f?.value ?? f); if (v) return v; }
    else if (pr && typeof pr === 'object') for (const k of Object.keys(pr)) if (/title|name|label|nom/i.test(k)) { const v = str(pr[k]); if (v) return v; }
    // dernier recours : tout texte lisible du portail (hors identifiants)
    for (const [k, v] of Object.entries(b)) if (typeof v === 'string' && v.trim() && !/id$|^id|owner|user|date|type|url/i.test(k)) return v.trim();
    return '';
  };
  const countOf = (b) => { const pr = b.properties; const cand = [b.size, b.count, b.nbItems, b.itemCount, b.numItems, pr?.size, pr?.count, Array.isArray(b.iids) ? b.iids.length : undefined, Array.isArray(b.items) ? b.items.length : undefined]; return Number(cand.find((x) => x != null && !isNaN(Number(x)))) || 0; };
  return arr.map((b) => {
    const id = String(b.id ?? b.basketId ?? '');
    const name = nameOf(b) || (/default/i.test(id) ? 'Mes favoris' : 'Liste sans nom');
    return { id, name, count: countOf(b), isDefault: /default|favou?rite|to.?read|later|^basket:[^:]*:[a-z_ -]+:$/i.test(id) };
  }).filter((b) => b.id);
}

export async function basketOp(creds, body, fetchFn = fetch, debug = false) {
  const { action } = body;
  const idOk = (v) => typeof v === 'string' && /^[A-Za-z0-9_:.\-]{1,160}$/.test(v);
  const { c, token } = await login(creds, fetchFn);
  const lists = async () => parseBaskets(failIfError(await c.get(token, 'basketlist', { locale: 'fr' }), 'Favoris'));
  switch (action) {
    case 'list': {
      if (!debug) return { baskets: await lists() };
      const raw = await c.get(token, 'basketlist', { locale: 'fr' });
      return { baskets: parseBaskets(raw), shape: shapeOf(raw) };
    }
    case 'create': {
      const title = String(body.title ?? '').trim().slice(0, 80);
      if (!title) throw new Error('Donne un nom à la liste');
      const iids = idOk(body.docId) ? [body.docId] : undefined;
      failIfError(await c.post(token, 'updateBasket', { title, ...(iids ? { iids } : {}) }), 'Favoris');
      return { baskets: await lists() };
    }
    case 'add': {
      if (!idOk(body.basketId) || !idOk(body.docId)) throw new Error('Liste ou document invalide');
      const r = failIfError(await c.post(token, 'addToBasket', { id: body.basketId, iids: [body.docId] }), 'Favoris');
      return { added: Array.isArray(r) ? r.length : 1 };
    }
    case 'remove': {
      if (!idOk(body.basketId) || !idOk(body.docId)) throw new Error('Liste ou document invalide');
      failIfError(await c.post(token, 'deleteFromBasket', { id: body.basketId, iids: [body.docId] }), 'Favoris');
      return { removed: true };
    }
    case 'rename': {
      if (!idOk(body.basketId)) throw new Error('Liste invalide');
      failIfError(await c.post(token, 'renameBasket', { id: body.basketId, name: String(body.name ?? '').trim().slice(0, 80) }), 'Favoris');
      return { baskets: await lists() };
    }
    case 'delete': {
      if (!idOk(body.basketId)) throw new Error('Liste invalide');
      const r = failIfError(await c.post(token, 'deleteBaskets', [body.basketId]), 'Favoris');
      const after = await lists();
      if (after.some((b) => b.id === body.basketId)) {
        const isDefault = /default/i.test(body.basketId);
        throw new Error(isDefault ? "Cette liste est la liste par défaut de la bibliothèque : elle ne peut pas être supprimée (vous pouvez la vider)." : `La bibliothèque n'a pas supprimé cette liste (réponse : ${JSON.stringify(r).slice(0, 120)}).`);
      }
      return { baskets: after };
    }
    case 'content': {
      if (!idOk(body.basketId)) throw new Error('Liste invalide');
      let res, lastErr;
      for (const q of [body.basketId, `basket:${body.basketId}`]) {
        try { res = failIfError(await c.post(token, 'search', { query: [q], queryid: 'NONE', sf: '*', includeFacets: false, pageNo: 1, pageSize: 100, locale: 'fr' }), 'Favoris'); if ((res.resultSet ?? []).length || q !== body.basketId) break; } catch (e) { lastErr = e; }
      }
      if (!res) throw lastErr;
      const results = parseSearch(res);
      await attachStock(c, token, results, 40); // plafond de sous-requêtes du relais
      return debug ? { results, shape: shapeOf(res) } : { results };
    }
    default: throw new Error('Action inconnue');
  }
}


// Profil rangé par rubriques, sans redites : chaque valeur n'apparaît qu'une fois, adresse regroupée sur une ligne.
export function organizeProfile(fields) {
  const norm = (v) => String(v).toLowerCase().replace(/[\s.\-()+]/g, '');
  const seen = new Set();
  const by = new Map();
  for (const [label, val] of fields) {
    const key = norm(val);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!by.has(label)) by.set(label, []);
    by.get(label).push(val);
  }
  const take = (...labels) => labels.flatMap((l) => by.get(l) ?? []);
  const once = (l) => by.get(l)?.[0];
  const first_ = once('Prénom'), last_ = once('Nom de famille') ?? once('Nom');
  const civ = once('Civilité');
  const fullName = [first_, last_].filter(Boolean).join(' ') || once('Nom') || '';
  const addr = [take('Adresse').join(', '), [once('Code postal'), once('Ville')].filter(Boolean).join(' '), once('Pays')].filter(Boolean).join(', ');
  const sections = [];
  const sec = (title, rows) => { const r = rows.filter(([, v]) => v); if (r.length) sections.push({ title, rows: r }); };
  sec('Coordonnées', [['E-mail', take('E-mail').join(' · ')], ['Téléphone', take('Téléphone mobile', 'Téléphone').join(' · ')], ['Adresse', addr]]);
  sec('Abonnement', [['Catégorie', once('Catégorie')], ['Bibliothèque', once('Bibliothèque')], ['Début', once('Début')], ['Abonnement', once('Abonnement')], ['Expire le', once('Expire le')]]);
  const used = new Set(['Prénom', 'Nom de famille', 'Nom', 'Civilité', 'E-mail', 'Téléphone mobile', 'Téléphone', 'Adresse', 'Code postal', 'Ville', 'Pays', 'Catégorie', 'Bibliothèque', 'Début', 'Abonnement', 'Expire le', 'N° de carte']);
  sec('Informations personnelles', [['Civilité', civ], ['Date de naissance', once('Date de naissance')], ['Langue', once('Langue')], ...[...by].filter(([l]) => !used.has(l) && l !== 'Date de naissance' && l !== 'Langue').map(([l, v]) => [l, v.join(' · ')])]);
  return { name: fullName, card: once('N° de carte') ?? '', subtitle: once('Catégorie') ?? '', sections };
}


// Onglet « Notice » du site : détail complet d'un document (aspect Meta de la notice).
function findSummary(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 5) return null;
  if (Array.isArray(node) && node.length && node.every((x) => x && typeof x === 'object' && 'name' in x)) return node;
  for (const v of Object.values(node)) { const r = findSummary(v, depth + 1); if (r) return r; }
  return null;
}
const NOTICE_FR = [
  [/author|auteur|creator/i, 'Auteur'], [/^title$|titre/i, 'Titre'], [/publication|publish|[ée]diteur/i, 'Publication'], [/dateIssued|^date/i, 'Date'], [/isbn/i, 'ISBN'], [/issn/i, 'ISSN'],
  [/description|physical/i, 'Description'], [/collection|series|s[ée]rie/i, 'Collection'], [/summary|abstract|r[ée]sum[ée]/i, 'Résumé'], [/subject|topic|sujet|keyword/i, 'Sujets'],
  [/language|langue/i, 'Langue'], [/^date|year/i, 'Date'], [/type|format/i, 'Type de document'], [/note/i, 'Notes'], [/edition/i, 'Édition'], [/genre/i, 'Genre'],
  [/callnumber|cote/i, 'Cote'], [/contributor|collaborat/i, 'Autres contributeurs'], [/audience|public/i, 'Public'],
];
// Aspect « Meta » d'une notice : { fields: [{ name, values: [{ qa: { Answer, DocumentCaption } }] }] }. C'est l'onglet « Notice » du site.
const NOTICE_FIELDS = [
  ['creator', 'Auteur', true], ['titleFull', 'Titre'], ['publicationStatement', 'Publication', true], ['isbn', 'ISBN'], ['descriptionPhysical', 'Description'],
  ['seriesGeneral', 'Collection', true], ['abstract', 'Résumé'], ['issn', 'ISSN'], ['subject', 'Sujets', true], ['language', 'Langue'], ['dateIssuedYear', 'Date'],
  // Documents en ligne : podcasts, films, livres numériques
  ['show', 'Émission'], ['description', 'Résumé'], ['longDescription', 'Présentation'], ['duration', 'Durée'], ['publisher', 'Éditeur', true], ['contributor', 'Participants'],
  ['pages', 'Pages'], ['DRMTypeLabel', 'Protection'], ['noteGeneral', 'Note'],
];
export function parseNotice(res) {
  const byName = new Map((res?.fields ?? []).map((f) => [f.name, f.values ?? []]));
  const out = [];
  for (const [name, label, caption] of NOTICE_FIELDS) {
    const vals = (byName.get(name) ?? []).map((v) => {
      const qa = v?.qa ?? v ?? {};
      const t = (caption && qa.DocumentCaption) || qa.Answer || qa.value || '';
      return String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
    if (vals.length) out.push([label, name === 'duration' ? vals[0] + ' min' : [...new Set(vals)].join(' · ').slice(0, name === 'longDescription' ? 3000 : 1500)]);
  }
  if (!out.some(([l]) => l === 'ISBN') && res?.firstISBN) out.splice(Math.min(3, out.length), 0, ['ISBN', String(res.firstISBN)]);
  if (!out.some(([l]) => l === 'Date')) { const d = byName.get('dateIssuedFormatted')?.[0]?.qa?.Answer; if (d) out.push(['Date', String(d)]); }
  return out;
}

// Liens utilisables d'une notice en ligne : écoute (mp3), film, extrait de livre numérique, accès externe. Uniquement du https.
export function noticeLinks(res) {
  const urls = [...new Set(JSON.stringify(res ?? {}).match(/https:[^"\\\s<>']+/g) ?? [])].map((u) => u.replace(/&amp;/g, '&'));
  const out = [];
  const add = (kind, label, url) => { if (!out.some((x) => x.kind === kind)) out.push({ kind, label, url }); };
  for (const u of urls) {
    if (/\.(jpe?g|png|gif|webp|svg)(\?|$)/i.test(u) || /ezproxy|[?&]url=|\/login\?|federation\./i.test(u) && !/on-tenk/i.test(u)) continue;
    if (/\.mp3(\?|$)/i.test(u)) add('audio', 'Écouter', u);
    else if (/on-tenk\.com/i.test(u)) add('film', 'Regarder en ligne', u);
    else if (/cantook\.net/i.test(u)) add('sample', 'Lire un extrait', u);
    else if (out.filter((x) => x.kind === 'web').length < 2) out.push({ kind: 'web', label: 'Accéder en ligne', url: u });
  }
  return out.slice(0, 4);
}

export async function fetchNotice(creds, id, fetchFn = fetch, debug = false) {
  check(id);
  const { c, token } = await login(creds, fetchFn);
  const res = failIfError(await c.get(token, 'notice', { id, locale: 'fr', aspect: 'Meta' }), 'Notice');
  const fields = parseNotice(res);
  const links = noticeLinks(res);
  return debug ? { fields, links, shape: shapeOf(res), keys: Object.keys(res ?? {}) } : { fields, links };
}

// Horaires et informations aux usagers : lus à chaque appel dans la page officielle des horaires (contenu public du portail).
const DAYS_FR = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
export function parseHours(graph) {
  const nodes = new Map();
  const collect = (v) => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') { if (v.tag && v.id != null && !nodes.has(String(v.id))) nodes.set(String(v.id), v); Object.values(v).forEach(collect); }
  };
  collect(graph);
  const txt = (n) => {
    let c = n.children; if (c && typeof c === 'object' && !Array.isArray(c)) c = c.fr;
    return typeof c === 'string' ? htmlText(c).replace(/ /g, ' ').trim() : '';
  };
  const TEXT = /^(TextBox|TextBoxInlineTagging|h[1-6])$/;
  const texts = (n, out = []) => {
    if (TEXT.test(n.tag)) { const t = txt(n); if (t) out.push(t); }
    if (Array.isArray(n.children)) for (const id of n.children) { const k = nodes.get(String(id)); if (k) texts(k, out); }
    return out;
  };
  let html = '';
  const rows = []; const seen = new Set();
  const walk = (n) => {
    if (TEXT.test(n.tag)) { let c = n.children; if (c && typeof c === 'object' && !Array.isArray(c)) c = c.fr; if (typeof c === 'string' && /PERTURBATIONS|INFORMATIONS AUX USAGERS/i.test(c) && c.length > html.length && c.length < 20000) html = c; }
    if (n.tag === 'Columns' && /_Columns$/.test(n.label || '') && Array.isArray(n.children)) {
      const cols = n.children.map((id) => nodes.get(String(id))).filter((k) => k && k.tag === 'Column');
      if (cols.length) {
        const cells = cols.map((col) => {
          const w = parseFloat(String(col.styleProps?.widthValue ?? '').replace('%', '')) || 12.5;
          return { slots: Math.max(1, Math.round(w / 12.5)), parts: texts(col) };
        });
        const key = (cells[0]?.parts[0] || '') + '|' + cells.slice(1).map((c) => c.parts.join('/')).join('|');
        if (cells[0]?.parts[0] && !seen.has(key)) { seen.add(key); rows.push(cells); }
      }
    }
    if (Array.isArray(n.children)) for (const id of n.children) { const k = nodes.get(String(id)); if (k) walk(k); }
  };
  const roots = [...nodes.values()].filter((n) => !nodes.has(String(n.parent)));
  roots.forEach(walk);
  const sections = []; let days = DAYS_FR;
  for (const cells of rows) {
    const first = cells[0].parts;
    const rest = cells.slice(1);
    const isHeader = rest.filter((c) => /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)$/i.test(c.parts[0] || '')).length >= 4;
    if (isHeader) { days = rest.map((c) => c.parts[0]).filter(Boolean).slice(0, 7); sections.push({ title: first[0], days, rows: [] }); continue; }
    if (!sections.length) sections.push({ title: 'Horaires', days, rows: [] });
    const slots = [];
    for (const c of rest) for (let i = 0; i < c.slots && slots.length < days.length; i++) slots.push(c.parts.join(' ').replace(/\s+/g, ' ').trim());
    while (slots.length < days.length) slots.push('');
    sections.at(-1).rows.push({ name: first[0].replace(/\s+/g, ' '), note: first.slice(1).join(' '), hours: slots });
  }
  return { html: html.slice(0, 12000), sections: sections.filter((x) => x.rows.length) };
}

export async function fetchHours(fetchFn = fetch) {
  const c = makeClient(fetchFn);
  await c.init();
  const r = await c.get(null, 'contentGraphByPath', { locale: 'fr', path: '/horaires-bibliotheques', depth: 6 });
  let g = r;
  if (!r?.content) g = await c.get(null, 'contentGraphByPath', { locale: 'fr', path: '/horaires-ete-bibliotheques', depth: 6 });
  return { ...parseHours(g), fetchedAt: new Date().toISOString() };
}

// Nouveautés : documents marqués « Nouveauté » par la bibliothèque (IsNovelty), du plus récent au plus ancien, sans compte requis.
const CODE_RE = /^[A-Za-z0-9_]{1,24}$/;
export async function fetchNouveautes({ branch, type, avail, page } = {}, fetchFn = fetch) {
  const c = makeClient(fetchFn);
  await c.init();
  const fq = ['IsNovelty:1'];
  if (branch && CODE_RE.test(branch)) fq.push(`StockHomeLocationCode:"${branch}"`);
  if (type && CODE_RE.test(type)) fq.push(`ZMAT:"${type}"`);
  if (avail === true) fq.push('IsAvailable:1');
  const pageNo = Math.min(Math.max(Number(page) || 1, 1), 10);
  const res = failIfError(await c.post(null, 'search', { query: ['*:*'], fq, queryid: 'NONE', sf: '*', includeFacets: pageNo === 1, pageNo, pageSize: 20, locale: 'fr', order: 'DateOfPublicationSearch_date_DESC' }), 'Nouveautés');
  const results = parseSearch(res);
  await attachStock(c, null, results, 20);
  const facet = (code) => (res.facets ?? []).find((f) => (f.code ?? f.name) === code)?.items?.map((i) => ({ value: String(i.value), label: String(i.caption ?? i.display ?? i.value), count: i.count })) ?? [];
  return { results, total: res.numHits ?? results.length, branches: facet('StockHomeLocationCode'), types: facet('ZMAT').slice(0, 10) };
}

// Recherches sauvegardées du compte (le portail les appelle « savedSearches »).
export async function savedSearches(creds, body, fetchFn = fetch) {
  const { c, token } = await login(creds, fetchFn);
  if (body.action === 'delete') {
    if (!ID_RE.test(body.id ?? '')) throw new Error('Recherche invalide');
    failIfError(await c.get(token, 'deleteSavedSearch', { id: body.id }), 'Suppression');
    return { ok: true };
  }
  if (body.action === 'save') {
    if (!ID_RE.test(body.queryId ?? '')) throw new Error('Recherche invalide');
    failIfError(await c.get(token, 'saveSearchById', { id: body.queryId }), 'Sauvegarde');
    return { ok: true };
  }
  const res = failIfError(await c.get(token, 'savedSearches', { locale: 'fr' }), 'Recherches sauvegardées');
  const arr = Array.isArray(res) ? res : res?.items ?? res?.searches ?? res?.savedSearches ?? res?.results ?? [];
  const str = (v) => (typeof v === 'string' ? v.trim() : Array.isArray(v) ? str(v[0]) : v && typeof v === 'object' ? str(v.value ?? v.display ?? v.label ?? v.fr ?? Object.values(v).find((x) => typeof x === 'string')) : '');
  const items = arr.map((s) => {
    const d = s?.data ?? s;
    const query = str(d.query ?? d.queryString ?? d.q ?? d.terms ?? d.text ?? d.label ?? d.title ?? d.name);
    return { id: String(d.id ?? d.queryId ?? d.queryid ?? d.iid ?? ''), query, label: str(d.title ?? d.label ?? d.name) || query, date: toISODate(d.date ?? d.creationDate ?? d.savedDate ?? d.lastModified) };
  }).filter((x) => x.id || x.query);
  return body.debug ? { items, shape: shapeOf(res) } : { items };
}

// Fiches complètes (comme les résultats de recherche) pour une liste d'identifiants de documents : sert l'historique des prêts.
export async function fetchDocuments(creds, ids, fetchFn = fetch) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((x) => ID_RE.test(x)).slice(0, 15);
  if (!list.length) return { results: [] };
  const { c, token } = await login(creds, fetchFn);
  const res = failIfError(await c.post(token, 'search', { query: ['*:*'], fq: [list.map((x) => `id:"${x}"`).join(' OR ')], queryid: 'NONE', sf: '*', includeFacets: false, pageNo: 1, pageSize: list.length, locale: 'fr' }), 'Documents');
  const results = parseSearch(res);
  await attachStock(c, token, results, 15);
  return { results };
}

// Services en ligne : lus à chaque appel dans la page officielle « En ligne » (presse, livres numériques, formation, cinéma…).
// Dans la page, chaque ressource suit le motif : liens, mention d'accès (« Accessible à distance »…), nom, description.
const ACCESS_RE = /^(Accessible [àa] distance|Accessible dans les biblioth[èe]ques|Acc[èe]s libre)$/i;
const SKIP_TEXT = /^(Voir les contenus|Vid[ée]o de pr[ée]sentation|Guide [àa] t[ée]l[ée]charger|En savoir plus)$/i;
const decode = (t) => String(t).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&rsquo;/g, '\u2019').replace(/\s+/g, ' ').trim();
// Services retenus par Tom (les autres de la page « En ligne » ne sont pas proposés).
const WANTED = [/^brief ?me$/i, /^retronews$/i, /^mangas\.io$/i, /^pr[êe]t de livres num/i, /^mozaik$/i, /^les yeux doc$/i, /^t[ëe]nk$/i, /^philharmonie/i, /^ma petite m[ée]diath/i, /^brief\.science$/i, /^openedition/i, /^brief\.eco$/i, /^podcasts radio france$/i, /^m[ée]diapart$/i, /^cafeyn$/i, /^marsactu$/i];
export function parseServices(graph) {
  const pages = Object.values(graph?.content ?? {}).filter((v) => v?.contentType === 'CMSPage');
  const page = pages.find((v) => v.properties?.title?.fr === 'En ligne') ?? pages[0];
  const data = page?.properties?.content?.data ?? [];
  const nodes = new Map(data.map((n) => [String(n.id), n]));
  const sections = []; let cur = null; let pending = []; let res = null; let expect = null; const seen = new Set(); const names = new Set();
  const flush = () => {
    if (!res) return;
    res.links = res.links.filter(Boolean);
    const isNotice = (u) => /^(\/|https:\/\/www\.bmvr\.marseille\.fr\/)(notice|permalink|bibliotheque-numerique)/.test(u);
    const main = res.links.find((u) => !isNotice(u)) ?? res.links[0] ?? '';
    const abs = main.startsWith('/') ? 'https://www.bmvr.marseille.fr' + main : main;
    if (res.name && !names.has(res.name) && /^https?:\/\//.test(abs)) {
      names.add(res.name);
      const external = new URL(abs).host !== 'www.bmvr.marseille.fr';
      const kind = isNotice(main) ? 'notice' : /^Acc[èe]s libre$/i.test(res.access) ? 'direct' : 'sso';
      if (!cur) { cur = { title: 'Services', items: [] }; sections.push(cur); }
      cur.items.push({ name: res.name, desc: res.desc || '', access: /distance/i.test(res.access) ? 'Accessible à distance' : /biblioth/i.test(res.access) ? 'Dans les bibliothèques' : 'Accès libre', url: abs, kind, external });
    }
    res = null; expect = null;
  };
  const walk = (n) => {
    if (seen.has(n.id)) return; seen.add(n.id);
    const link = n.props?.link?.options?.url; const lu = typeof link === 'object' ? link?.fr : link;
    if (n.tag === 'Link' && typeof lu === 'string' && lu.trim()) {
      let u = lu.trim().replace(/&amp;/g, '&').replace(/^https:\/\/www\.bmvr\.marseille\.fr(?=\/)/, '');
      const m = u.match(/^\/login\?backUrl=(.+)$/);
      if (m) { try { u = decodeURIComponent(m[1]); } catch { u = m[1]; } if (!/^(\/|https?:)/.test(u)) u = '/' + u; }
      if (!/^\/(account|en-ligne)/.test(u)) pending.push(u);
    }
    let c = n.children; if (c && typeof c === 'object' && !Array.isArray(c)) c = c.fr;
    if (/^TextBox/.test(n.tag) && typeof c === 'string') {
      const t = decode(c.replace(/<[^>]+>/g, ' '));
      if (t && !SKIP_TEXT.test(t)) {
        if (ACCESS_RE.test(t)) { flush(); res = { access: t, links: pending, name: '', desc: '' }; pending = []; expect = 'name'; }
        else if (res && expect === 'name') { res.name = t; expect = 'desc'; }
        else if (res && expect === 'desc') { res.desc = t.slice(0, 400); flush(); }
        else if (t.length < 40 && !res) { cur = { title: t, items: [] }; sections.push(cur); pending = []; }
      }
    }
    if (Array.isArray(n.children)) for (const id of n.children) { const k = nodes.get(String(id)); if (k) walk(k); }
  };
  for (const n of data.filter((x) => !nodes.has(String(x.parent)))) walk(n);
  flush();
  for (const x of sections) x.items = x.items.filter((i) => WANTED.some((re) => re.test(i.name)));
  return { sections: sections.filter((x) => x.items.length) };
}
export async function fetchServices(fetchFn = fetch) {
  const c = makeClient(fetchFn);
  await c.init();
  const g = await c.get(null, 'contentGraphByPath', { locale: 'fr', path: '/en-ligne', depth: 6 });
  return { ...parseServices(g), fetchedAt: new Date().toISOString() };
}
