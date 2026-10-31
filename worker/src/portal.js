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
export async function fetchServiceUrl({ username, password }, service, fetchFn = fetch, trace = []) {
  const start = SERVICES[service];
  if (!start) throw new Error('Service inconnu');
  const c = makeClient(fetchFn);
  await c.init();
  const session = await c.post(null, 'authenticate', { username: username.includes('@') ? username.toLowerCase() : username, password, locale: 'fr' });
  if (!session.token) throw new AuthError(`Connexion refusée : ${session.error || 'identifiants incorrects ?'}`);
  await c.connect();
  trace.push(`session ${c.cookieNames().join('+')}`);
  return c.serviceUrl(start, trace);
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
async function login({ username, password }, fetchFn) {
  const c = makeClient(fetchFn);
  await c.init();
  const session = await c.post(null, 'authenticate', { username: username.includes('@') ? username.toLowerCase() : username, password, locale: 'fr' });
  if (!session.token) throw new AuthError(`Connexion refusée : ${session.error || 'identifiants incorrects ?'}`);
  await c.connect();
  return { c, token: session.token };
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
      id: text(it.reservationId) || seq || String(i),
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
      canCancel: it.canCancel !== false && !it.canceled && !!text(it.reservationId),
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

// Annulation d'une réservation (même appel que le bouton « Annuler » du portail).
export async function cancelReservation(creds, reservationId, fetchFn = fetch) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(reservationId ?? '')) throw new Error('Réservation invalide');
  const { c, token } = await login(creds, fetchFn);
  const r = await c.get(token, 'cancelReservation', { ilsType: 'Syracuse', reservationId });
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
    for (const [k, v] of Object.entries(e)) if (!SKIP.test(k) && k !== 'date' && k !== 'typeOfDocumentFacet') add(pretty(k), flat(v));
    for (const [k, v] of Object.entries(e.meta ?? {})) if (!SKIP.test(k)) add(pretty(k), flat(v));
    return {
      id,
      title: cleanTitle(first(e.title)) || 'Document',
      author: cleanAuthor(first(e.author)),
      year: String(first(e.date) ?? first(e.year) ?? '').slice(0, 10),
      type: flat(e.typeOfDocumentFacet ?? e.contentType ?? e.format).join(', '),
      coverId: num ? id : '',
      isbn: String(first(e.isbn) ?? '').replace(/[^0-9Xx]/g, ''),
      fields,
    };
  }).filter((r) => r.id);
}

export async function searchCatalogue(creds, query, fetchFn = fetch, debug = false) {
  const q = String(query ?? '').trim().slice(0, 200);
  if (!q) throw new Error('Saisis un titre, un auteur ou un mot-clé');
  const { c, token } = await login(creds, fetchFn);
  const res = failIfError(await c.post(token, 'search', { query: [q], queryid: 'NONE', sf: '*', includeFacets: false, pageNo: 1, pageSize: 20, locale: 'fr' }), 'Recherche');
  const results = parseSearch(res);
  return debug ? { results, shape: shapeOf(res) } : { results, total: res.totalHits ?? res.total ?? results.length };
}

const ID_RE = /^[A-Za-z0-9_:.\-]{1,80}$/;
const check = (id) => { if (!ID_RE.test(id ?? '')) throw new Error('Document invalide'); };

// Exemplaires du document (aspect « Stock » de la notice) : le portail réserve toujours un exemplaire précis.
export function parseCopies(stock) {
  const out = [];
  for (const grp of stock?.monographicCopies ?? []) {
    const g = grp.data ?? {};
    for (const ch of grp.children ?? []) {
      const d = ch.data ?? {};
      const no = String(d.copyNumber ?? '').trim();
      if (!no) continue;
      out.push({
        no,
        branch: String(g.branchDesc || d.branchDesc || g.branch || d.branch || ''),
        place: String(d.subloca || g.subloca || ''),
        callNumber: String(d.callNumber || d.cote || ''),
        status: String(d.statDesc || d.statusDescription || d.stat || ''),
        available: String(d.stat ?? '').toLowerCase() === 'available',
        due: toISODate(d.dueDate ?? d.returnDate, d.dateFormat),
        fields: Object.entries(d).filter(([k, v]) => typeof v !== 'object' && v !== '' && v != null && !/^(copyNumber|document|stat|dateFormat)$/.test(k)).map(([k, v]) => [pretty(k), String(v).slice(0, 200)]),
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
  try { stock = failIfError(await c.get(token, 'notice', { id, locale: 'fr', aspect: 'Stock' }), 'Exemplaires'); } catch (e) { errs.push(`Stock: ${e.message.slice(0, 80)}`); }
  const copies = parseCopies(stock);
  const vols = await c.post(token, 'reservationVolumes', { id, locale: 'fr' }).catch((e) => ({ errorReponse: true, error: e.message }));
  // Le portail réserve un exemplaire précis : on essaie d'abord ceux qui ne sont pas disponibles (déjà sortis), puis les autres, puis sans exemplaire.
  const candidates = [...copies.filter((x) => !x.available), ...copies.filter((x) => x.available)].slice(0, 4).map((x) => x.no);
  let choices, copyNo = '';
  for (const no of [...candidates, '']) {
    for (const [how, call] of [
      ['POST', () => c.post(token, 'reservationChoices', { id, ...(no ? { serialCopyNo: no } : {}), locale: 'fr' })],
      ...(no ? [] : [['GET', () => c.get(token, 'reservationChoices', { id, locale: 'fr' })]]),
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
  const r = await c.post(token, 'reservationRankWithStatus', { id, volume: volume || null, branch, ...(copyNo ? { serialCopyNo: copyNo, monographicCopyNo: copyNo } : {}) });
  return { ok: r.status !== false, rank: r.rank ?? null };
}

// Réservation effective.
export async function makeReservation(creds, { id, volume, branch, copyNo }, fetchFn = fetch) {
  check(id);
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(branch ?? '')) throw new Error('Bibliothèque de retrait invalide');
  const { c, token } = await login(creds, fetchFn);
  const r = await c.post(token, 'makeReservation', { id, volume: volume || null, branch, ...(copyNo ? { serialCopyNo: copyNo, monographicCopyNo: copyNo } : {}), locale: 'fr' });
  failIfError(r, 'Réservation');
  return { done: r.inSuccess === true };
}
