// Notifications téléphone (Web Push). Fonction optionnelle : inactive tant que le stockage KV (NOTIF) et les trois secrets
// (VAPID_PUBLIC, VAPID_PRIVATE, NOTIF_KEY) ne sont pas configurés dans Cloudflare.
// Pour les personnes qui l'activent, l'identifiant et le mot de passe BMVR sont gardés CHIFFRÉS (AES-GCM, clé NOTIF_KEY) afin que
// le relais puisse interroger le compte quelques fois par jour (toutes les 3 heures environ, jamais la nuit) ; « Désactiver » efface tout. Rien n'est journalisé.
import { fetchLoans, fetchReservations, fetchAccount, AuthError } from './portal.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
export const b64u = (buf) => { let s = ''; for (const x of new Uint8Array(buf)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64u = (s) => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4)); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };

export const configured = (env) => !!(env?.NOTIF && env.VAPID_PUBLIC && env.VAPID_PRIVATE && env.NOTIF_KEY);

// ---- chiffrement au repos ----
async function aesKey(env) { return crypto.subtle.importKey('raw', unb64u(env.NOTIF_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']); }
export async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(JSON.stringify(obj)));
  return `${b64u(iv)}.${b64u(ct)}`;
}
export async function unseal(env, str) {
  const [iv, ct] = String(str).split('.');
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aesKey(env), unb64u(ct))));
}

// ---- Web Push : chiffrement du message (RFC 8291, aes128gcm) et signature VAPID (RFC 8292) ----
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
export async function encryptPayload(sub, payload, fixed = {}) {
  const uaPub = unb64u(sub.keys.p256dh); const authSecret = unb64u(sub.keys.auth);
  const asKeys = fixed.keys ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
  const salt = fixed.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  return concat(salt, new Uint8Array([0, 0, 0x10, 0, 65]), asPub, body);
}
async function vapidHeader(env, endpoint, now = Date.now()) {
  const pub = unb64u(env.VAPID_PUBLIC);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'https://toolsmaker2099.github.io/appli-bmvr/' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}
// Renvoie 'ok', 'gone' (abonnement supprimé côté téléphone) ou 'error'.
export async function sendPush(env, sub, message, fetchFn = fetch) {
  try {
    const body = await encryptPayload(sub, JSON.stringify(message));
    const r = await fetchFn(sub.endpoint, { method: 'POST', headers: { Authorization: await vapidHeader(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' }, body });
    if (r.status === 404 || r.status === 410) return 'gone';
    return r.ok ? 'ok' : 'error';
  } catch { return 'error'; }
}

// ---- abonnements ----
const HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
export function validSubscription(s) {
  try {
    const u = new URL(s.endpoint);
    return u.protocol === 'https:' && s.endpoint.length < 600 && HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h)) && /^[A-Za-z0-9_-]{80,100}$/.test(s.keys?.p256dh ?? '') && /^[A-Za-z0-9_-]{16,32}$/.test(s.keys?.auth ?? '');
  } catch { return false; }
}
// Un même téléphone (un abonnement) peut servir plusieurs comptes : l'enregistrement est identifié par l'abonnement ET le compte.
const idOf = async (endpoint, username) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(username == null ? endpoint : `${endpoint}\u0000${String(username).trim().toLowerCase()}`))).slice(0, 32);
const cleanLabel = (v) => String(v ?? '').replace(/[\r\n]/g, ' ').trim().slice(0, 24);
const DEFAULT_PREFS = { loans: true, resa: true, messages: true, events: true };
const cleanPrefs = (p) => Object.fromEntries(Object.keys(DEFAULT_PREFS).map((k) => [k, p?.[k] === undefined ? DEFAULT_PREFS[k] : !!p[k]]));
const cleanEvents = (list) => (Array.isArray(list) ? list : []).slice(0, 60).map((e) => ({ id: String(e?.id ?? '').slice(0, 80), date: String(e?.date ?? ''), title: String(e?.title ?? '').slice(0, 120), hour: /^\d{1,2}:\d{2}$/.test(e?.hour ?? '') ? e.hour : '', library: String(e?.library ?? '').slice(0, 80) })).filter((e) => e.id && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
const parisParts = (now = Date.now()) => { const d = new Date(now); return { day: d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }), time: d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }) }; };
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const same = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

async function find(env, endpoint, username) {
  const id = await idOf(endpoint, username); const rec = await load(env, id);
  if (rec) return { id, rec };
  // Reprise d'un enregistrement de la première version (identifié par l'abonnement seul).
  const oldId = await idOf(endpoint); const old = await load(env, oldId);
  if (old && await owner(env, old, { username, password: undefined, skipPassword: true })) { await env.NOTIF.delete(`sub:${oldId}`); await save(env, id, old); return { id, rec: old }; }
  return { id, rec: null };
}
async function load(env, id) { const raw = await env.NOTIF.get(`sub:${id}`); return raw ? JSON.parse(raw) : null; }
const save = (env, id, rec) => env.NOTIF.put(`sub:${id}`, JSON.stringify(rec), { metadata: { checkedAt: rec.checkedAt || 0 } });
async function owner(env, rec, body) {
  if (!rec?.cred) return false;
  try { const c = await unseal(env, rec.cred); return same(c.username.trim().toLowerCase(), String(body.username).trim().toLowerCase()) && (body.skipPassword || same(c.password, String(body.password))); } catch { return false; }
}

const withLabel = (rec, title) => (rec.label ? `${title} · ${rec.label}` : title);
export function status(env) { return configured(env) ? { enabled: true, publicKey: env.VAPID_PUBLIC } : { enabled: false }; }

export async function subscribe(env, body) {
  if (!configured(env)) throw new Error('Notifications non configurées sur le relais');
  if (!validSubscription(body.subscription ?? {})) throw new Error('Abonnement du téléphone invalide');
  await fetchLoans({ username: body.username, password: body.password }); // vérifie les identifiants (lève AuthError sinon)
  const sub = { endpoint: body.subscription.endpoint, keys: { p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth } };
  const id = await idOf(sub.endpoint, body.username);
  const rec = { label: cleanLabel(body.label),  sub, cred: await seal(env, { username: body.username, password: body.password }), user: String(body.username).slice(0, 40).replace(/.(?=.{4})/g, '•'), prefs: cleanPrefs(body.prefs), events: cleanEvents(body.events), state: null, checkedAt: 0, fails: 0, created: Date.now() };
  await save(env, id, rec);
  if (body.silent === true) return { ok: true, prefs: rec.prefs }; // réparation automatique : pas de message de bienvenue
  await sendPush(env, sub, { title: withLabel(rec, 'Notifications activées'), body: 'Vous serez prévenu ici des retours, réservations et événements.', tag: 'welcome', url: '#accueil' });
  return { ok: true, prefs: rec.prefs };
}
export async function manage(env, body, action) {
  if (!configured(env)) throw new Error('Notifications non configurées sur le relais');
  const endpoint = String(body.endpoint ?? '');
  if (!endpoint) throw new Error('Abonnement manquant');
  const { id, rec } = await find(env, endpoint, body.username);
  if (!rec) return action === 'status' ? { subscribed: false } : action === 'unsubscribe' ? { ok: true } : (() => { throw new Error('Notifications non activées sur cet appareil'); })();
  if (!(await owner(env, rec, body))) { if (action === 'status') return { subscribed: false }; throw new Error('Identifiants incorrects pour ces notifications'); }
  if (action === 'unsubscribe') { await env.NOTIF.delete(`sub:${id}`); return { ok: true }; }
  if (action === 'status') return { subscribed: true, prefs: rec.prefs, user: rec.user };
  if (action === 'test') { const r = await sendPush(env, rec.sub, { title: withLabel(rec, 'Notification de test'), body: 'Tout fonctionne : vous recevrez vos alertes ici.', tag: 'test', url: '#accueil' }); if (r === 'gone') await env.NOTIF.delete(`sub:${id}`); return { ok: r === 'ok' }; }
  if (action === 'update') { if (body.label !== undefined) rec.label = cleanLabel(body.label); if (body.prefs) rec.prefs = cleanPrefs(body.prefs); if (body.events) rec.events = cleanEvents(body.events); await save(env, id, rec); return { ok: true, prefs: rec.prefs }; }
  throw new Error('Action inconnue');
}

// ---- contrôle périodique (cron horaire ; chaque abonné n'est contrôlé que toutes les 3 heures environ, jamais la nuit) ----
export function detect(rec, data, now = Date.now()) {
  const { day, time } = parisParts(now);
  const prefs = rec.prefs ?? DEFAULT_PREFS; const st = rec.state ?? {}; const baseline = !rec.state;
  const notes = []; const next = { loansSent: [], resa: {}, msgSeen: [], eventsSent: [] };
  // prêts : 3 jours avant, la veille, le jour même, en retard (une alerte par prêt et par étape)
  const fresh = { late: [], j0: [], j1: [], j3: [] };
  for (const l of data.loans ?? []) {
    if (!l.dueDate) continue;
    const d = dayDiff(day, l.dueDate); const stage = d < 0 ? 'late' : d === 0 ? 'j0' : d === 1 ? 'j1' : d <= 3 ? 'j3' : '';
    if (!stage) continue;
    const key = `${l.id}|${l.dueDate}|${stage}`; next.loansSent.push(key);
    if (!(st.loansSent ?? []).includes(key)) fresh[stage].push(l.title);
  }
  if (prefs.loans) {
    const list = (a) => a.slice(0, 3).join(', ') + (a.length > 3 ? ` et ${a.length - 3} autre${a.length > 4 ? 's' : ''}` : '');
    const S = { late: ['⚠️ Prêt en retard', ' à rendre au plus vite'], j0: ['⏰ À rendre aujourd’hui', ''], j1: ['⏰ À rendre demain', ''], j3: ['📚 À rendre dans 3 jours', ''] };
    for (const k of ['late', 'j0', 'j1', 'j3']) if (fresh[k].length) notes.push({ title: S[k][0], body: list(fresh[k]) + S[k][1], tag: 'loans-' + k, url: '#prets' });
  }
  // réservations : disponible à retirer, ou rang qui avance (rien au premier passage : on mémorise seulement l'état)
  for (const r of data.reservations ?? []) {
    next.resa[r.id] = { rank: r.rank ?? null, avail: !!r.available };
    const prev = (st.resa ?? {})[r.id];
    if (baseline || !prefs.resa) continue;
    if (r.available && !prev?.avail) notes.push({ title: '🔖 Réservation à retirer', body: r.title, tag: 'resa-' + r.id, url: '#resa' });
    else if (!r.available && prev && prev.rank && r.rank && r.rank < prev.rank) notes.push({ title: '🔖 Votre réservation avance', body: `${r.title} : vous êtes ${r.rank === 1 ? '1er' : r.rank + 'e'}`, tag: 'resa-' + r.id, url: '#resa' });
  }
  // messages de la bibliothèque
  const seen = new Set(st.msgSeen ?? []); const newMsgs = [];
  for (const m of data.messages ?? []) { next.msgSeen.push(m.id); if (!seen.has(m.id)) newMsgs.push(m); }
  next.msgSeen = next.msgSeen.slice(0, 60);
  if (!baseline && prefs.messages && newMsgs.length) notes.push({ title: newMsgs.length > 1 ? `✉️ ${newMsgs.length} nouveaux messages` : '✉️ Nouveau message', body: newMsgs[0].title, tag: 'messages', url: '#espace/messages' });
  // événements de « Mes événements » : la veille en soirée, et le jour même le matin
  const events = (rec.events ?? []).filter((e) => e.date >= day);
  if (prefs.events) for (const e of events) {
    const k1 = `${e.id}|${e.date}|veille`, k2 = `${e.id}|${e.date}|jour`;
    const sent = new Set(st.eventsSent ?? []);
    if (e.date === addDays(day, 1) && time >= '17:00' && !sent.has(k1)) { notes.push({ title: '📅 Demain : ' + e.title, body: [e.hour, e.library].filter(Boolean).join(' · '), tag: k1, url: '#espace/mesevenements' }); next.eventsSent.push(k1); }
    if (e.date === day && time >= '07:00' && (!e.hour || e.hour > time) && !sent.has(k2)) { notes.push({ title: '📅 Aujourd’hui : ' + e.title, body: [e.hour, e.library].filter(Boolean).join(' · '), tag: k2, url: '#espace/mesevenements' }); next.eventsSent.push(k2); }
  }
  next.eventsSent = [...new Set([...(st.eventsSent ?? []).filter((k) => events.some((e) => k.startsWith(e.id + '|' + e.date + '|'))), ...next.eventsSent])];
  return { notes: notes.slice(0, 4), state: next, events };
}

async function checkOne(env, id, rec, now) {
  const creds = { ...(await unseal(env, rec.cred)), cache: true };
  const prefs = rec.prefs ?? DEFAULT_PREFS;
  const data = {};
  try {
    if (prefs.loans) data.loans = (await fetchLoans(creds)).loans;
    if (prefs.resa) data.reservations = (await fetchReservations(creds, fetch, false, true)).reservations;
    if (prefs.messages) data.messages = (await fetchAccount(creds, 'messages')).items;
  } catch (e) {
    if (e instanceof AuthError) {
      // Un refus passager du portail ne doit pas effacer l'abonnement : on n'abandonne qu'après 3 refus étalés sur plus de 24 h.
      rec.fails = (rec.fails || 0) + 1; rec.failSince = rec.failSince || now;
      if (rec.fails >= 3 && now - rec.failSince > 24 * 3600 * 1000) { await sendPush(env, rec.sub, { title: 'Notifications arrêtées', body: 'Le mot de passe a été refusé. Réactivez les notifications dans l’appli.', tag: 'auth', url: '#compte' }); await env.NOTIF.delete(`sub:${id}`); return; }
    }
    rec.checkedAt = now; await save(env, id, rec); return; // erreur passagère : on réessaiera
  }
  rec.fails = 0; rec.failSince = 0;
  // un type désactivé ne doit pas vider l'état mémorisé
  const { notes, state, events } = detect(rec, data, now);
  if (!prefs.loans) state.loansSent = rec.state?.loansSent ?? [];
  if (!prefs.resa) state.resa = rec.state?.resa ?? {};
  if (!prefs.messages) state.msgSeen = rec.state?.msgSeen ?? [];
  rec.state = state; rec.events = events; rec.checkedAt = now;
  for (const n of notes) { if ((await sendPush(env, rec.sub, { ...n, title: withLabel(rec, n.title) })) === 'gone') { await env.NOTIF.delete(`sub:${id}`); return; } }
  await save(env, id, rec);
}

// Traite les abonnés les moins récemment contrôlés (quelques-uns par passage : limite de sous-requêtes de Cloudflare).
export async function runChecks(env, now = Date.now(), batch = Number(env?.NOTIF_BATCH) || 3) {
  if (!configured(env)) return { checked: 0 };
  const hour = Number(parisParts(now).time.slice(0, 2));
  if (hour < 7 || hour >= 22) return { checked: 0, night: true }; // pas de contrôle la nuit
  const every = Math.max(30, Number(env?.NOTIF_EVERY_MIN) || 180) * 60 * 1000; // par défaut : toutes les 3 heures
  const listed = await env.NOTIF.list({ prefix: 'sub:', limit: 1000 });
  const due = listed.keys.map((k) => ({ id: k.name.slice(4), at: k.metadata?.checkedAt ?? 0 })).filter((k) => now - k.at > every - 10 * 60 * 1000).sort((a, b) => a.at - b.at).slice(0, batch);
  for (const k of due) {
    const rec = await load(env, k.id); if (!rec) continue;
    try { await checkOne(env, k.id, rec, now); } catch { /* un abonné défaillant ne bloque pas les autres */ }
  }
  return { checked: due.length };
}
