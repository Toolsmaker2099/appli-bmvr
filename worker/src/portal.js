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

function makeClient(apiToken, fetchFn) {
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

export function toISODate(v) {
  if (v == null || v === '') return null;
  const d = new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

export function parseLoans(loans, resolved = {}) {
  return (loans?.items ?? [])
    .map((it, i) => {
      const dueDate = toISODate(findText(it, ['dateDue', 'dueDate', 'returnDate']) ?? it.dateDue ?? it.data?.dateDue);
      const seq = String(it.seqNo ?? it.data?.seqNo ?? i);
      const rec = resolved[seq] ?? it.resultItem;
      const title = findText(rec, ['title', 'Title', 'recordTitle', 'name']) ?? findText(it, ['title', 'documentTitle']) ?? 'Document';
      const author = findText(rec, ['author', 'Author', 'creator']) ?? '';
      return { id: seq, title, author, dueDate, renewable: it.renewable ?? it.canRenew ?? null };
    })
    .filter((l) => l.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export async function fetchLoans({ username, password }, fetchFn = fetch, debug = false) {
  const apiToken = await getApiToken(fetchFn);
  const c = makeClient(apiToken, fetchFn);
  const session = await c.post(null, 'authenticate', { username: username.includes('@') ? username.toLowerCase() : username, password, locale: 'fr' });
  if (!session.token) throw new AuthError(`Connexion refusée : ${session.error || 'identifiants incorrects ?'}`);
  // Le portail attend parfois la langue, parfois non : on essaie les deux et on garde la première réponse valide.
  let loans, lastErr;
  for (const params of [{ locale: 'fr' }, {}, { locale: 'fr', id: '' }]) {
    try { loans = await c.get(session.token, 'loans', params); break; } catch (e) { lastErr = e; }
  }
  if (!loans) throw lastErr;
  const seqNos = (loans.items ?? []).map((it) => it.seqNo ?? it.data?.seqNo ?? it.data?.seq_no ?? it.bacNo ?? it.data?.bacNo).filter((x) => x != null);
  const resolved = {};
  let rs = null;
  if (seqNos.length) {
    rs = await c.post(session.token, 'resolveBySeqNo', `locale=fr&ids=${seqNos.join(',')}`, { binary: true, contentType: 'application/x-www-form-urlencoded' });
    for (const r of rs.resultSet ?? []) {
      const id = r.id?.[0]?.value;
      if (id != null) resolved[String(id)] = r;
    }
  }
  const parsed = parseLoans(loans, resolved);
  return debug ? { loans: parsed, shape: shapeOf({ loans, resolved: rs }) } : { loans: parsed };
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
  const apiToken = await getApiToken(fetchFn);
  const c = makeClient(apiToken, fetchFn);
  const session = await c.post(null, 'authenticate', { username: username.includes('@') ? username.toLowerCase() : username, password, locale: 'fr' });
  if (!session.token) throw new AuthError(`Connexion refusée : ${session.error || 'identifiants incorrects ?'}`);
  const out = { sessionKeys: Object.keys(session).sort(), steps: [] };
  const step = async (label, fn) => {
    try { const r = await fn(); out.steps.push({ label, ok: true, shape: shapeOf(r) }); return r; } catch (e) { out.steps.push({ label, ok: false, error: e.message.slice(0, 250) }); }
  };
  for (const aspect of ['loans', 'accountSummary', 'rights', 'profile']) {
    await step(`${aspect} locale=fr`, () => c.get(session.token, aspect, { locale: 'fr' }));
    await step(`${aspect} sans paramètre`, () => c.get(session.token, aspect, {}));
  }
  return out;
}
