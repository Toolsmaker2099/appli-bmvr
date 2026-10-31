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
      if (!res.ok) throw new Error(`Portail: ${path} → HTTP ${res.status}`);
      return res.json();
    },
    // Suit les redirections d'un service en ligne (CAS) avec la session de la personne, et s'arrête juste avant d'ouvrir
    // l'adresse finale du service : elle contient un ticket à usage unique que le navigateur de la personne utilisera.
    async serviceUrl(startUrl) {
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
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
      const signed = `?${qs}`;
      const res = await fetchFn(`${API}/api/${path}${signed}&_=${Date.now()}`, {
        headers: { ...base, 'X-InMedia-Authorization': `Bearer ${token} ${apiToken} ${checksum(signed)}`, Cookie: cookieHeader() },
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

// Le portail renvoie la liste directement : [{ title, author, returnDate, dateFormat, seqNo, isLate, isRenewable, … }].
export function parseLoans(loans) {
  const items = Array.isArray(loans) ? loans : loans?.items ?? [];
  return items
    .map((it, i) => ({
      id: String(it.seqNo ?? it.documentNumber ?? i),
      title: String(it.title ?? it.documentTitle ?? 'Document').trim(),
      author: String(it.author ?? '').trim(),
      dueDate: toISODate(it.returnDate ?? it.dateDue ?? it.dueDate, it.dateFormat),
      renewable: it.isRenewable ?? null,
      // Identifiant de notice du portail (même règle que son appli web) → image de couverture publique du portail.
      coverId: /^\d{1,10}$/.test(String(it.seqNo ?? '')) ? `p::usmarcdef_${String(it.seqNo).padStart(10, '0')}` : '',
      isbn: String(it.isbn13 || it.isbn10 || it.isbn || '').replace(/[^0-9Xx]/g, ''),
    }))
    .filter((l) => l.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export async function fetchLoans({ username, password }, fetchFn = fetch, debug = false) {
  const c = makeClient(fetchFn);
  await c.init();
  const session = await c.post(null, 'authenticate', { username: username.includes('@') ? username.toLowerCase() : username, password, locale: 'fr' });
  if (!session.token) throw new AuthError(`Connexion refusée : ${session.error || 'identifiants incorrects ?'}`);
  await c.connect();
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
  marsactu: 'https://www.bmvr.marseille.fr/mars-actu-connexion-referer',
  cafeyn: 'https://www.cafeyn.co/loginexternal/648',
};

// Connexion à la BMVR puis adresse d'entrée (avec ticket) du service demandé.
export async function fetchServiceUrl({ username, password }, service, fetchFn = fetch) {
  const start = SERVICES[service];
  if (!start) throw new Error('Service inconnu');
  const c = makeClient(fetchFn);
  await c.init();
  const session = await c.post(null, 'authenticate', { username: username.includes('@') ? username.toLowerCase() : username, password, locale: 'fr' });
  if (!session.token) throw new AuthError(`Connexion refusée : ${session.error || 'identifiants incorrects ?'}`);
  await c.connect();
  return c.serviceUrl(start);
}
