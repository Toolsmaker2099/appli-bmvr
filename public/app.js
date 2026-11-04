// Adresse du relais Cloudflare (à adapter après le déploiement).
const RELAY = 'https://appli-bmvr-relais.toolsmaker.workers.dev';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
// Plusieurs comptes sur le même appareil : chaque compte a ses propres identifiants et ses propres copies de données.
// Les clés « par compte » sont rangées sous p:<id>:<clé> ; 'profiles' liste les comptes et 'active' donne le compte courant.
const PER = new Set(['svcPins', 'svcCache', 'user', 'pass', 'cache', 'resaCache', 'msgCache', 'seenMsgs', 'pickup', 'lastTrace', 'agendaList', 'notifOn']);
const raw = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};
const getProfiles = () => { try { return JSON.parse(raw.get('profiles') || '[]'); } catch { return []; } };
// Reprise d'un compte enregistré par une version précédente de l'appli.
if (!raw.get('profiles') && raw.get('user')) {
  raw.set('profiles', JSON.stringify([{ id: 'a1', user: raw.get('user') }])); raw.set('active', 'a1');
  for (const k of PER) { const v = raw.get(k); if (v) { raw.set(`p:a1:${k}`, v); raw.del(k); } }
}
const activeId = () => { const a = raw.get('active'); return getProfiles().some((x) => x.id === a) ? a : ''; };
const storeKey = (k) => (PER.has(k) && activeId() ? `p:${activeId()}:${k}` : k);
const store = {
  get: (k) => raw.get(storeKey(k)),
  set: (k, v) => raw.set(storeKey(k), v),
  del: (k) => raw.del(storeKey(k)),
};
function addProfile(user, pass) {
  if (isRestricted()) return;
  const list = getProfiles();
  let p = list.find((x) => x.user.toLowerCase() === user.toLowerCase());
  if (!p) { p = { id: 'a' + Date.now().toString(36), user }; list.push(p); raw.set('profiles', JSON.stringify(list)); }
  raw.set('active', p.id); store.set('user', user); store.set('pass', pass);
}
function switchProfile(id) { raw.set('active', id); location.hash = '#accueil'; location.reload(); }
function removeActiveProfile() {
  const id = activeId(); if (!id || isRestricted()) return;
  for (const k of PER) raw.del(`p:${id}:${k}`);
  const rest = getProfiles().filter((x) => x.id !== id);
  raw.set('profiles', JSON.stringify(rest)); raw.set('active', rest[0]?.id || '');
}
// ---------- accès restreint et code PIN (par compte) ----------
// Garde-fou de l'appli, pas un coffre-fort : les identifiants restent dans le navigateur de l'appareil.
const curProfile = () => getProfiles().find((x) => x.id === activeId());
const isRestricted = () => curProfile()?.mode === 'restricted';
function patchProfile(id, patch) {
  if (isRestricted()) return; // un compte restreint ne modifie aucun compte
  raw.set('profiles', JSON.stringify(getProfiles().map((p) => (p.id === id ? { ...p, ...patch } : p)))); }
async function pinHash(id, pin) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`bmvr:${id}:${pin}`)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
const unlockedId = () => { try { return sessionStorage.getItem('unlocked') || ''; } catch { return ''; } };
const setUnlocked = (id) => { try { if (id) sessionStorage.setItem('unlocked', id); else sessionStorage.removeItem('unlocked'); } catch {} };
const isLocked = () => { const p = curProfile(); return !!(p?.pin && unlockedId() !== p.id); };
const WRITE_PATHS = ['/renew', '/renew-many', '/reserve', '/cancel', '/delete-message', '/notif-subscribe', '/notif-update', '/notif-unsubscribe', '/notif-test'];
function guard(path, extra = {}) {
  if (isLocked()) throw new Error('Application verrouillée : saisissez le code.');
  if (!isRestricted()) return;
  const write = WRITE_PATHS.includes(path) || (path === '/basket' && extra.action && !['list', 'content'].includes(extra.action)) || (path === '/saved-searches' && extra.action && extra.action !== 'list');
  if (write) throw new Error('Accès restreint : ce compte ne peut pas modifier le compte BMVR (réservation, prolongation, listes…).');
}
const hasCreds = () => !!(store.get('user') && store.get('pass'));
const readCache = () => { try { return JSON.parse(store.get('cache') || 'null'); } catch { return null; } };

// ---------- messages : « nouveau » = pas encore ouvert dans l'appli (le portail ne donne pas d'état lu / non lu) ----------
const seenSet = () => { try { return new Set(JSON.parse(store.get('seenMsgs') || '[]')); } catch { return new Set(); } };
const saveSeen = (set) => store.set('seenMsgs', JSON.stringify([...set].slice(-300)));
const readMsgCache = () => { try { return JSON.parse(store.get('msgCache') || 'null'); } catch { return null; } };
function unseenCount(items) { const s = seenSet(); return items.filter((m) => !s.has(m.id)).length; }
async function refreshMessages() {
  if (!hasCreds()) return null;
  try { const d = await call('/account', { kind: 'messages' }); store.set('msgCache', JSON.stringify({ at: Date.now(), items: d.items.map((m) => ({ id: m.id, title: m.title, date: m.date })) })); updateEspaceBadge(); return d.items; } catch { return null; }
}
function updateEspaceBadge() {
  const c = readMsgCache(); const n = c ? unseenCount(c.items) : 0;
  const b = $('badgeEspace'); if (b) { b.hidden = !n; b.textContent = n; }
}

// ---------- état vide : discret et compact ----------
function emptyState(icon, title, text) {
  const li = el('li', 'empty');
  li.append(el('span', 'empty-ico', icon), el('strong', '', title));
  if (text) li.append(el('p', '', text));
  return li;
}
const EMPTY = {
  fines: ['✅', 'Aucune amende', 'Votre compte est à jour.'],
  messages: ['✉️', 'Aucun message', 'Les avis de la bibliothèque apparaîtront ici.'],
  loanhistory: ['🕘', 'Historique vide', 'Vos prêts terminés apparaîtront ici.'],
};

// ---------- dates ----------
const today = () => new Date(new Date().toDateString());
const parse = (iso) => new Date(iso + 'T00:00:00');
const daysLeft = (iso) => Math.round((parse(iso) - today()) / 86400000);
const longDate = (iso) => parse(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (iso) => parse(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const rel = (d) => (d < 0 ? `En retard de ${-d} jour${d < -1 ? 's' : ''}` : d === 0 ? "À rendre aujourd'hui" : d === 1 ? 'À rendre demain' : `À rendre dans ${d} jours`);

// ---------- navigation par onglets ----------
const TITLES = { accueil: 'Accueil', prets: 'Mes prêts', resa: 'Mes réservations', chercher: 'Chercher et réserver', espace: 'Mon espace', compte: 'Compte et connexion' };
// Couleur propre à chaque compte, pour savoir d'un coup d'œil lequel est actif.
const userColor = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 45% 38%)`; };
const initials = (name) => String(name || '?').replace(/[^A-Za-zÀ-ÿ0-9]/g, '').slice(0, 2).toUpperCase() || '?';
function paintAvatar(node, name) { node.textContent = initials(name); node.style.background = userColor(name); node.style.color = '#fff'; }
function renderUserChip() {
  const c = $('userChip'); const name = store.get('user');
  c.hidden = !hasCreds(); if (c.hidden) return;
  c.replaceChildren(); const av = el('span', 'chip-av'); paintAvatar(av, name);
  c.append(av, el('span', 'chip-name', name));
  if (isRestricted()) c.append(el('span', 'chip-lock', '🔒'));
  c.setAttribute('aria-label', 'Compte actif : ' + name + ' — changer de compte');
}
function go() {
  const [h1, sub] = location.hash.slice(1).split('/');
  const tab = TITLES[h1] ? h1 : 'accueil';
  for (const t of Object.keys(TITLES)) $('view-' + t).hidden = t !== tab;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === (tab === 'compte' ? 'espace' : tab)));
  $('title').textContent = tab === 'espace' && ESPACE[sub] ? ESPACE[sub] : TITLES[tab];
  $('sync').hidden = !['prets', 'resa'].includes(tab) || !hasCreds();
  renderUserChip();
  window.scrollTo(0, 0);
  if (tab === 'accueil') { renderSummary(); renderServicesHome(); }
  if (tab === 'compte') renderAccount();
  if (tab === 'prets') openLoans(); // les prêts ne sont lus que lorsqu'on ouvre leur onglet
  if (tab === 'resa') openReservations();
  if (tab === 'chercher') openSearch();
  if (tab === 'espace') openEspace(ESPACE[sub] ? sub : '');
}
addEventListener('hashchange', go);

// ---------- accueil ----------
function statCard(href, ico, big, label, sub, tone) {
  const a = el('a', 'stat ' + (tone || '')); a.href = href;
  const i = el('span', 'stat-ico', ico);
  const t = el('span', 'stat-txt');
  t.append(el('span', 'stat-label', label), el('strong', 'stat-big', big));
  if (sub) t.append(el('span', 'stat-sub', sub));
  a.append(i, t, el('span', 'stat-go', '›'));
  return a;
}
function renderSummary() {
  const box = $('summary');
  box.replaceChildren();
  const data = readCache();
  if (!hasCreds()) {
    const w = el('div', 'hero');
    w.append(el('strong', '', 'Bienvenue'), el('p', '', 'Connectez votre compte BMVR pour retrouver vos prêts et accéder aux services en ligne.'));
    const a = el('a', '', 'Se connecter →'); a.href = '#compte'; w.append(a);
    box.append(w);
    $('msgCard').hidden = true;
    return;
  }
  if (!data) box.append(statCard('#prets', '📚', 'Voir mes prêts', 'Mes prêts', ''));
  else {
    const n = data.loans.length;
    const late = data.loans.filter((l) => daysLeft(l.dueDate) < 0).length;
    const soon = data.loans.some((l) => daysLeft(l.dueDate) <= 3);
    let sub = 'Rien à rendre pour le moment';
    if (n) { const next = data.loans[0]; sub = late ? `⚠ ${late} en retard · ${rel(daysLeft(next.dueDate))}` : `Prochain retour : ${rel(daysLeft(next.dueDate)).toLowerCase().replace('à rendre ', '')} (${shortDate(next.dueDate)})`; }
    box.append(statCard('#prets', '📚', n ? `${n} en cours` : 'Aucun', 'Mes prêts', sub, late ? 'late' : soon ? 'soon' : ''));
  }
  renderMsgLine();
  renderReminder(data);
  renderNextEvent();
}
// Prochain événement de « Mes événements » (liste locale, aucun appel réseau).
function renderNextEvent() {
  const box = $('nextEvent'); if (!box) return;
  box.replaceChildren(); box.hidden = true;
  if (!hasCreds()) return;
  const list = agList(); if (!list.length) return;
  const today = parisNow().day; const x = list[0];
  box.hidden = false; box.className = 'card reminder next-event';
  const go = () => { location.hash = '#espace/mesevenements'; };
  box.onclick = go; box.tabIndex = 0; box.setAttribute('role', 'link'); box.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  box.append(el('h4', '', '⭐ Prochain événement'));
  const a = el('a', 'rem-ev'); a.href = '#espace/mesevenements';
  a.append(el('strong', '', x.title), el('span', 'rem-d', [dayLabel(x.date, today), x.hour && (x.end ? `${x.hour}–${x.end}` : x.hour), x.library].filter(Boolean).join(' · ')));
  box.append(a);
  if (list.length > 1) box.append(el('p', 'muted', `+ ${list.length - 1} autre${list.length > 2 ? 's' : ''} dans votre liste`));
}
function renderReminder(data) {
  const box = $('reminder'); if (!box) return;
  box.replaceChildren(); box.hidden = true;
  if (!data || !hasCreds()) return;
  const due = data.loans.filter((l) => daysLeft(l.dueDate) <= 3).sort((a, b) => daysLeft(a.dueDate) - daysLeft(b.dueDate));
  if (!due.length) return;
  box.hidden = false;
  const late = due.some((l) => daysLeft(l.dueDate) < 0);
  box.className = 'card reminder ' + (late ? 'late' : 'soon');
  box.append(el('h4', '', late ? '⚠️ À rendre en priorité' : '⏰ À rendre bientôt'));
  const ul = el('ul', 'rem-list');
  for (const l of due) { const li = el('li'); li.append(el('span', 'rem-t', l.title), el('span', 'rem-d', rel(daysLeft(l.dueDate)) + ' · ' + shortDate(l.dueDate))); ul.append(li); }
  box.append(ul);
  const ren = due.filter((l) => l.canRenew && l.documentNumber);
  const row = el('div', 'btn-row');
  if (ren.length) {
    const b = el('button', 'primary small', `Prolonger ${ren.length > 1 ? 'les ' + ren.length + ' prêts' : 'ce prêt'}`);
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Prolongation en cours…';
      try {
        const { results } = await call('/renew-many', { documentIds: ren.map((l) => l.documentNumber) });
        const lines = results.map((r) => { const l = ren.find((x) => x.documentNumber === r.documentId); return `${r.extended ? '✓' : '✗'} ${l?.title || r.documentId}${r.extended ? (r.newReturnDate ? ' · jusqu’au ' + shortDate(r.newReturnDate) : '') : ' · ' + (r.message || 'refusé par la bibliothèque (document réservé par un autre lecteur ?)')}`; });
        alert(lines.join('\n')); store.del('cache'); location.hash = '#prets'; openLoans();
      } catch (e) { alert(e.message); b.disabled = false; b.textContent = 'Réessayer'; }
    };
    row.append(b);
  }
  const rest = due.length - ren.length;
  if (rest) row.append(el('span', 'hint', `${rest} non prolongeable${rest > 1 ? 's' : ''} : à rapporter.`));
  box.append(row);
}
function renderMsgLine() {
  const line = $('msgCard');
  const draw = () => {
    const c = readMsgCache(); if (!c || !hasCreds()) { line.hidden = true; return; }
    line.hidden = false;
    const n = c.items.length, u = unseenCount(c.items);
    line.replaceChildren(statCard('#espace/messages', '✉️', n ? `${n} message${n > 1 ? 's' : ''}` : 'Aucun', 'Mes messages', u ? `${u} nouveau${u > 1 ? 'x' : ''}` : n ? 'Tout est lu' : 'Votre boîte est vide', u ? 'soon' : ''));
  };
  draw();
  if (!readMsgCache() || Date.now() - readMsgCache().at > 120000) refreshMessages().then(draw);
}

function updateBadge() {
  const data = readCache();
  const urgent = data ? data.loans.filter((l) => daysLeft(l.dueDate) <= 3).length : 0;
  $('badge').hidden = !urgent;
  $('badge').textContent = urgent;
}

// ---------- couverture ----------
// Image du portail BMVR d'abord (la même que sur le site) ; si le portail n'a qu'une vignette générique (256×256),
// on essaie Open Library via l'ISBN ; sinon un pictogramme.
function cover(l) {
  if (!l.coverId && !l.isbn && !l.image) return el('div', 'cover-ph', '📕');
  const img = el('img', 'cover');
  img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
  const sources = [];
  if (l.image) sources.push({ url: l.image, generic: false });
  if (l.coverId) sources.push({ url: 'https://www.bmvr.marseille.fr/in/rest/Thumb/image?id=' + encodeURIComponent(l.coverId), generic: true });
  if (l.isbn) sources.push({ url: `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(l.isbn)}-M.jpg?default=false`, generic: false });
  let i = 0;
  const next = () => { if (i < sources.length) img.src = sources[i++].url; else img.replaceWith(el('div', 'cover-ph', '📕')); };
  img.onerror = next;
  img.onload = () => { if (sources[i - 1]?.generic && img.naturalWidth === 256 && img.naturalHeight === 256) next(); };
  next();
  return img;
}

// ---------- prolongation ----------
const RENEW_WARNINGS = {
  IMPOSSIBLE_TO_RENEW_PRIOR_TO_DUEDATE: 'Impossible de prolonger : la nouvelle date serait antérieure à la date de retour actuelle.',
  IMPOSSIBLE_TO_RENEW_ACCOUNT_EXPIRED: "Impossible de prolonger : l'abonnement est expiré.",
};

function renewButton(l) {
  const wrap = el('div', 'actions');
  const btn = el('button', 'primary renew', 'Prolonger ce prêt');
  const msg = el('p', 'hint renew-msg');
  btn.onclick = async () => {
    if (!confirm(`Prolonger « ${l.title} » ?\nCette action modifie votre compte à la bibliothèque.`)) return;
    btn.disabled = true; btn.textContent = 'Prolongation…'; msg.textContent = '';
    try {
      guard('/renew');
      const r = await fetch(RELAY + '/renew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: store.get('user'), password: store.get('pass'), documentId: l.documentNumber }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
      if (data.extended) {
        msg.textContent = data.newReturnDate ? `✓ Prolongé : nouvelle date de retour le ${longDate(data.newReturnDate)}.` : '✓ Prêt prolongé.';
        msg.className = 'hint renew-msg ok';
        store.del('cache');
        setTimeout(openLoans, 1500);
      } else {
        throw new Error(data.warnings.map((w) => RENEW_WARNINGS[w]).filter(Boolean).join(' ') || data.message || 'La bibliothèque a refusé la prolongation.');
      }
    } catch (e) {
      msg.textContent = e.message; msg.className = 'hint renew-msg err';
      btn.disabled = false; btn.textContent = 'Prolonger ce prêt';
    }
  };
  wrap.append(btn, msg);
  return wrap;
}

// ---------- carte de prêt ----------
function rows(entries) {
  const dl = el('dl');
  for (const [k, v] of entries) if (v) dl.append(el('dt', '', k), el('dd', '', v));
  return dl.children.length ? dl : null;
}
const yesNo = (b) => (b ? 'Oui' : 'Non');

function card(l) {
  const d = daysLeft(l.dueDate);
  const li = el('li', 'card ' + (d < 0 ? 'late' : d <= 3 ? 'soon' : ''));

  const head = el('div', 'card-head');
  const t = el('div', 'card-title');
  t.append(docTitle([l.title, l.volume && `(${l.volume})`, l.issueCaption].filter(Boolean).join(' '), l));
  if (l.author) t.append(el('p', '', l.author));
  t.append(el('span', 'due', `${rel(d)} · ${shortDate(l.dueDate)}`));
  head.append(cover(l), t);
  li.append(head);

  const chips = el('div', 'chips');
  const chip = (txt, cls = '') => chips.append(el('span', 'chip ' + cls, txt));
  if (l.late && d >= 0) chip('Marqué en retard', 'bad');
  if (l.recalled) chip('Rappelé par la bibliothèque', 'bad');
  if (l.lost) chip('Déclaré perdu', 'bad');
  if (l.canRenew) chip('✓ Prolongeable', 'good');
  else if (l.userRenewed) chip('Déjà prolongé', '');
  else chip('Non prolongeable', 'warn');
  if (l.reserved) chip('Réservé par un autre lecteur', 'warn');
  if (l.hasCharge) chip('Frais en cours', 'bad');
  if (l.copyProblem) chip("Problème d'exemplaire", 'warn');
  if (chips.children.length) li.append(chips);

  const prol = l.prolongation && l.prolongationMax && /^\d+$/.test(l.prolongation + l.prolongationMax)
    ? `${l.prolongation} sur ${l.prolongationMax}` : [l.prolongation, l.prolongationMax && `max ${l.prolongationMax}`].filter(Boolean).join(' · ');
  const main = rows([
    ['Emprunté le', l.loanDate && longDate(l.loanDate)],
    ['À rendre le', longDate(l.dueDate) + (l.returnHour ? ` à ${l.returnHour}` : '')],
    ['Bibliothèque', l.branch],
    ['Prolongations', prol],
  ]);
  if (main) li.append(main);
  if (l.canRenew) li.append(renewButton(l));

  const more = rows([
    ['Prolongation', l.renewalMessage || l.renewalCondition],
    ['Date modifiable', l.canChangeDueDate ? yesNo(true) : ''],
    ['Avis de retard', l.lateNotices ? `${l.lateNotices} envoyé${l.lateNotices > 1 ? 's' : ''}${l.lateNoticeDates?.length ? ' (' + l.lateNoticeDates.map(shortDate).join(', ') + ')' : ''}` : ''],
    ['N° de document', l.documentNumber],
    ['ISBN', l.isbn],
    ['Notice', l.id],
  ]);
  if (more) {
    const det = el('details');
    det.append(el('summary', '', 'Plus de détails'), more);
    li.append(det);
  }
  addFavButton(li, l);
  watchResa(li, l.coverId);
  return li;
}

// ---------- prêts ----------
function renderLoans(data, note = '') {
  const list = $('list');
  list.replaceChildren();
  if (!data.loans.length) {
    list.append(emptyState('📚', 'Aucun prêt en cours', 'Vos emprunts apparaîtront ici.'));
  }
  const byLi = new Map();
  for (const l of data.loans) { const li = card(l); byLi.set(l.documentNumber, li); list.append(li); }
  setupSelection(data, byLi);
  $('status').textContent = `${data.loans.length} prêt${data.loans.length > 1 ? 's' : ''} · mis à jour ${new Date(data.fetchedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${note}`;
  updateBadge();
}

// ---------- prolongation en masse : sélection de prêts ----------
const LSEL = { on: false, picked: new Set() };
function setupSelection(data, byLi) {
  const tools = $('loanTools'), bar = $('selBar');
  const renewable = data.loans.filter((l) => l.canRenew && l.documentNumber);
  tools.replaceChildren(); bar.replaceChildren(); tools.hidden = renewable.length < 2; bar.hidden = true;
  if (renewable.length < 2) { LSEL.on = false; LSEL.picked.clear(); return; }
  LSEL.picked = new Set([...LSEL.picked].filter((id) => renewable.some((l) => l.documentNumber === id)));
  const paint = () => {
    for (const l of renewable) {
      const li = byLi.get(l.documentNumber); if (!li) continue;
      li.classList.toggle('selectable', LSEL.on); li.classList.toggle('picked', LSEL.on && LSEL.picked.has(l.documentNumber));
      let cb = li.querySelector('.sel-box');
      if (LSEL.on && !cb) { cb = el('span', 'sel-box'); li.prepend(cb); li.onclick = (e) => { if (e.target.closest('button,a,summary')) return; toggle(l.documentNumber); }; }
      if (cb) cb.textContent = LSEL.picked.has(l.documentNumber) ? '✓' : '';
      if (!LSEL.on) { cb?.remove(); li.onclick = null; }
    }
    tools.replaceChildren();
    if (!LSEL.on) { const b = el('button', 'fchip', '☑ Prolonger plusieurs prêts'); b.onclick = () => { LSEL.on = true; paint(); }; tools.append(b); bar.hidden = true; return; }
    const all = el('button', 'fchip', LSEL.picked.size === renewable.length ? 'Tout désélectionner' : 'Tout sélectionner');
    all.onclick = () => { if (LSEL.picked.size === renewable.length) LSEL.picked.clear(); else renewable.forEach((l) => LSEL.picked.add(l.documentNumber)); paint(); };
    const cancel = el('button', 'fchip', 'Annuler'); cancel.onclick = () => { LSEL.on = false; LSEL.picked.clear(); paint(); };
    tools.append(all, cancel);
    bar.hidden = false; bar.replaceChildren();
    const go = el('button', 'primary', LSEL.picked.size ? `Prolonger la sélection (${LSEL.picked.size})` : 'Choisissez des prêts à prolonger'); go.disabled = !LSEL.picked.size;
    go.onclick = () => renewSelected(renewable, go);
    bar.append(go);
  };
  const toggle = (id) => { if (LSEL.picked.has(id)) LSEL.picked.delete(id); else LSEL.picked.add(id); paint(); };
  paint();
}
async function renewSelected(renewable, btn) {
  const ids = [...LSEL.picked]; if (!ids.length) return;
  const names = ids.map((id) => renewable.find((l) => l.documentNumber === id)?.title).filter(Boolean);
  if (!confirm(`Prolonger ${ids.length} prêt${ids.length > 1 ? 's' : ''} ?\n\n${names.map((n) => '• ' + n).join('\n')}\n\nCette action modifie votre compte à la bibliothèque.`)) return;
  btn.disabled = true; btn.textContent = 'Prolongation en cours…';
  try {
    const { results } = await call('/renew-many', { documentIds: ids });
    const ok = results.filter((r) => r.extended).length;
    const lines = results.map((r) => { const l = renewable.find((x) => x.documentNumber === r.documentId); return `${r.extended ? '✓' : '✗'} ${l?.title || r.documentId}${r.extended ? (r.newReturnDate ? ` · nouveau retour le ${longDate(r.newReturnDate)}` : '') : ' : ' + (r.warnings.map((w) => RENEW_WARNINGS[w]).filter(Boolean).join(' ') || r.message || 'refusé')}`; });
    alert(`${ok} prêt${ok > 1 ? 's' : ''} prolongé${ok > 1 ? 's' : ''} sur ${results.length}.\n\n${lines.join('\n')}`);
    LSEL.on = false; LSEL.picked.clear(); store.del('cache'); openLoans();
  } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = `Prolonger la sélection (${ids.length})`; }
}

let loading = false;
async function openLoans() {
  const status = $('status');
  if (!hasCreds()) {
    $('list').replaceChildren();
    status.textContent = '';
    const a = el('a', '', 'Connectez-vous dans l’onglet Compte pour voir vos prêts.'); a.href = '#compte';
    status.append(a);
    return;
  }
  const cached = readCache();
  if (cached) renderLoans(cached, ' · mise à jour…');
  else { $('list').replaceChildren(); status.textContent = 'Chargement de vos prêts…'; }
  if (loading) return;
  loading = true; $('sync').classList.add('spin');
  try {
    const r = await fetch(RELAY + '/loans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: store.get('user'), password: store.get('pass') }) });
    const data = await r.json();
    if (r.status === 401) { signOut(); location.hash = '#compte'; $('err').textContent = data.error || 'Identifiants refusés par la BMVR.'; return; }
    if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
    store.set('cache', JSON.stringify(data));
    renderLoans(data);
  } catch (e) {
    status.textContent = (cached ? status.textContent + ' · ' : '') + 'Actualisation impossible : ' + e.message;
  } finally { loading = false; $('sync').classList.remove('spin'); }
}


// ---------- appels au relais ----------
async function call(path, extra = {}) {
  guard(path, extra);
  const r = await fetch(RELAY + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: store.get('user'), password: store.get('pass'), ...extra }) });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { signOut(); location.hash = '#compte'; $('err').textContent = data.error || 'Identifiants refusés par la BMVR.'; throw new Error(data.error || 'Identifiants refusés'); }
  if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
  return data;
}
const needLogin = (box, status) => {
  box.replaceChildren(); status.textContent = '';
  const a = el('a', '', 'Connectez-vous dans l’onglet Compte.'); a.href = '#compte'; status.append(a);
};
const readResaCache = () => { try { return JSON.parse(store.get('resaCache') || 'null'); } catch { return null; } };

// ---------- mes réservations ----------
function resaCard(r) {
  const li = el('li', 'card ' + (r.available ? '' : 'soon')); // vert = disponible, orange = pas encore
  const head = el('div', 'card-head');
  const t = el('div', 'card-title');
  t.append(docTitle([r.title, r.volume && `(${r.volume})`, r.issueCaption].filter(Boolean).join(' '), r));
  if (r.author) t.append(el('p', '', r.author));
  t.append(el('span', 'due', r.available ? '✓ Disponible : à retirer' : (r.rank ? `N° ${r.rank} dans la file` : r.status || 'En attente')));
  head.append(cover(r), t);
  li.append(head);
  const main = rows([
    ['État', r.status],
    ['Retrait', r.branch],
    ['Retour prévu du document', !r.available && r.nextReturn ? longDate(r.nextReturn) : ''],
    ['Réservé le', r.reservedOn && longDate(r.reservedOn)],
    ['À retirer avant le', r.pickupDeadline && longDate(r.pickupDeadline)],
    ['Réservation valable jusqu’au', r.expiryDate && longDate(r.expiryDate)],
    ['Rang dans la file', r.rank ? String(r.rank) : ''],
  ]);
  if (main) li.append(main);
  if (r.canCancel) {
    const row = el('div', 'btn-row');
    const btn = el('button', 'secondary small danger', 'Annuler la réservation');
    const msg = el('p', 'hint msg');
    btn.onclick = async () => {
      if (!confirm(`Annuler la réservation de « ${r.title} » ?\nCette action modifie votre compte à la bibliothèque.`)) return;
      btn.disabled = true; btn.textContent = 'Annulation…'; msg.textContent = '';
      try {
        await call('/cancel', { reservationId: r.reservationId, ilsType: r.ilsType, seqNo: r.seqNo, volume: r.volume, omnidexId: r.omnidexId, pickupBranch: r.pickupBranch });
        li.replaceChildren(el('p', 'hint ok', `✓ Réservation de « ${r.title} » annulée.`));
        store.del('resaCache');
      } catch (e) { msg.textContent = e.message; msg.className = 'hint msg err'; btn.disabled = false; btn.textContent = 'Annuler la réservation'; }
    };
    row.append(btn); li.append(row, msg);
  }
  addFavButton(li, r);
  return li;
}

function renderResa(data, note = '') {
  const list = $('resaList');
  list.replaceChildren();
  if (!data.reservations.length) { list.append(emptyState('🔖', 'Aucune réservation', 'Cherchez un document dans l’onglet Chercher pour le réserver.')); }
  for (const r of data.reservations) list.append(resaCard(r));
  loadResaIndex(); decorateAll();
  $('resaStatus').textContent = `${data.reservations.length} réservation${data.reservations.length > 1 ? 's' : ''}${note}`;
}

let loadingResa = false;
async function openReservations() {
  if (!hasCreds()) return needLogin($('resaList'), $('resaStatus'));
  const cached = readResaCache();
  if (cached) renderResa(cached, ' · mise à jour…'); else { $('resaList').replaceChildren(); $('resaStatus').textContent = 'Chargement de vos réservations…'; }
  if (loadingResa) return;
  loadingResa = true; $('sync').classList.add('spin');
  try {
    const data = await call('/reservations');
    store.set('resaCache', JSON.stringify(data));
    renderResa(data);
  } catch (e) { $('resaStatus').textContent = (cached ? $('resaStatus').textContent.replace(' · mise à jour…', '') + ' · ' : '') + 'Actualisation impossible : ' + e.message; }
  finally { loadingResa = false; $('sync').classList.remove('spin'); }
}

// ---------- recherche et réservation ----------
function openSearch() { if (!hasCreds()) needLogin($('searchList'), $('searchStatus')); }

function reserveSheet(item, li) {
  const sheet = el('div', 'sheet');
  const msg = el('p', 'hint msg', 'Chargement des options de retrait…');
  sheet.append(msg);
  li.append(sheet);
  call('/reserve-info', { id: item.id }).then((info) => {
    sheet.replaceChildren();
    if (info.blocked || !info.branches.length) {
      sheet.append(el('p', 'hint err', info.traps[0] || "La bibliothèque n'autorise pas la réservation de ce document pour le moment."));
      if (!info.traps[0] && info.notes?.length) sheet.append(el('p', 'hint', 'Détail technique : ' + info.notes.join(' · ') + (info.copies?.length ? ` · ${info.copies.length} exemplaire(s)` : '')));
      return;
    }
    if (info.copies.length) {
      const det = el('details'); det.open = true;
      det.append(el('summary', '', `${info.copies.length} exemplaire${info.copies.length > 1 ? 's' : ''} (${info.copies.filter((c) => c.available).length} disponible${info.copies.filter((c) => c.available).length > 1 ? 's' : ''})`));
      const ul = el('ul', 'copies');
      for (const c of info.copies) ul.append(el('li', '', [c.branch, c.place, c.callNumber, c.available ? 'Disponible' : c.status || 'Sorti', c.due && !c.available ? `retour le ${shortDate(c.due)}` : ''].filter(Boolean).join(' · ')));
      det.append(ul); sheet.append(det);
    }
    let volSel = null;
    if (info.volumes.length > 1) {
      const l = el('label', '', 'Volume'); volSel = el('select');
      info.volumes.forEach((v) => volSel.append(new Option(v, v)));
      l.append(volSel); sheet.append(l);
    }
    const bl = el('label', '', 'Lieu de retrait'); const brSel = el('select');
    const pref = store.get('pickup');
    info.branches.forEach((b) => brSel.append(new Option(b.name || b.code, b.code, false, b.code === pref)));
    bl.append(brSel); sheet.append(bl);
    const rank = el('p', 'hint msg');
    const refresh = async () => {
      rank.textContent = '';
      try {
        const r = await call('/reserve-rank', { id: item.id, volume: volSel?.value, branch: brSel.value, copyNo: info.copyNo });
        rank.textContent = r.ok ? (r.rank ? `Vous seriez n° ${r.rank} dans la file d’attente.` : 'Disponible ou sans file d’attente.') : "Ce choix n'est pas réservable.";
      } catch {}
    };
    brSel.onchange = refresh; if (volSel) volSel.onchange = refresh; refresh();
    const ok = el('button', 'primary small', 'Confirmer la réservation');
    ok.style.marginTop = '12px';
    const out = el('p', 'hint msg');
    ok.onclick = async () => {
      const name = brSel.selectedOptions[0].textContent;
      if (!confirm(`Réserver « ${item.title} » pour un retrait à ${name} ?\nCette action modifie votre compte à la bibliothèque.`)) return;
      ok.disabled = true; ok.textContent = 'Réservation…'; out.textContent = '';
      try {
        const r = await call('/reserve', { id: item.id, volume: volSel?.value, branch: brSel.value, copyNo: info.copyNo });
        if (!r.done) throw new Error('La bibliothèque a refusé la réservation.');
        store.set('pickup', brSel.value); store.del('resaCache'); refreshResaIndex(true);
        sheet.replaceChildren(el('p', 'hint ok', `✓ Réservé. Retrait à ${name}. Retrouvez-la dans l’onglet Réservations.`));
      } catch (e) { out.textContent = e.message; out.className = 'hint msg err'; ok.disabled = false; ok.textContent = 'Confirmer la réservation'; }
    };
    sheet.append(rank, ok, out);
  }).catch((e) => { msg.textContent = e.message; msg.className = 'hint msg err'; });
}

function accSummary(ico, text) {
  const sm = el('summary', 'acc');
  sm.append(el('span', 'acc-ico', ico), el('span', 'acc-txt', text), el('span', 'acc-chev', '›'));
  return sm;
}
function noticeFields(entries) {
  const g = el('div', 'nf-grid');
  for (const [k, v] of entries) if (v) { const d = el('div', 'nf' + (String(v).length > 90 ? ' wide' : '')); d.append(el('small', '', k), el('p', '', v)); g.append(d); }
  return g.children.length ? g : null;
}
// Avis des lecteurs et documents proches (même sujet, thème ou genre) : chargés à l'ouverture.
function extraPanel(item) {
  const det = el('details', 'notice extra');
  det.append(accSummary('💬', 'Avis des lecteurs et documents proches'));
  const body = el('div', 'notice-body'); det.append(body);
  let loaded = false;
  det.ontoggle = async () => {
    if (!det.open || loaded) return;
    loaded = true; body.textContent = 'Chargement…';
    try {
      const d = await call('/doc-extra', { id: item.id });
      body.replaceChildren();
      const sec = (t) => { const h = el('h4', 'extra-h', t); body.append(h); };
      sec('Avis des lecteurs');
      if (d.rating) body.append(el('p', 'extra-rate', `⭐ ${String(Math.round(d.rating.average * 10) / 10).replace('.', ',')} / 10 · ${d.rating.count} note${d.rating.count > 1 ? 's' : ''}`));
      for (const c of d.comments || []) { const q = el('blockquote', 'extra-com'); if (c.title) q.append(el('strong', '', c.title)); q.append(el('p', '', c.text)); const who = [c.author, c.date && shortDate(c.date)].filter(Boolean).join(' · '); if (who) q.append(el('small', '', who)); body.append(q); }
      if (!d.rating && !(d.comments || []).length) body.append(el('p', 'hint', 'Aucune note ni aucun avis pour ce document.'));
      body.append(el('p', 'hint', 'Noter ou commenter se fait pour l’instant sur le site officiel.'));
      sec('Documents proches');
      if (d.topics?.length) { const row = el('div', 'more-like'); for (const t of d.topics) { const b = el('button', 'fchip', `${t.kind === 'Genre' ? '🎭' : '🏷️'} ${t.kind} : ${t.label}`); b.onclick = () => goSearch(t.query); row.append(b); } body.append(row); }
      else body.append(el('p', 'hint', 'Aucun sujet ni thème renseigné pour ce document.'));
    } catch (e) { loaded = false; body.textContent = 'Impossible de charger : ' + e.message; }
  };
  return det;
}
function searchCard(item, inSearch = false) {
  const li = el('li', 'card');
  const head = el('div', 'card-head');
  const t = el('div', 'card-title');
  t.append(inSearch ? el('h3', '', item.title) : docTitle(item.title, item));
  
  head.append(cover(item), t);
  li.append(head);
  // Sur la carte : l'essentiel (comme le site officiel). Le reste est dans « Détails » (onglet Notice du site), chargé à l'ouverture.
  const MAIN = ['Auteurs', 'Éditeurs', 'Date', 'Type de document'];
  const main = rows(item.fields.filter(([l]) => MAIN.includes(l)));
  if (main) li.append(main);
  const chips = el('div', 'chips');
  const chip = (txt, cls) => chips.append(el('span', 'chip ' + cls, txt));
  if (item.digital) {
    const K = { 'Podcast': ['🎧', 'Podcast à écouter en ligne'], 'Film en ligne': ['▶️', 'Film à regarder en ligne'], 'Livre numérique': ['📱', 'Livre numérique'] };
    const [ico, txt] = K[item.kind] || ['💻', (item.kind || 'Document') + ' en ligne'];
    chip(`${ico} ${txt}`, 'good');
  } else if (item.holdings?.length) chip('📰 Consultation sur place', 'good');
  else if (item.copiesTotal) {
    if (item.copiesAvailable > 0) chip(`✓ ${item.copiesAvailable} exemplaire${item.copiesAvailable > 1 ? 's' : ''} disponible${item.copiesAvailable > 1 ? 's' : ''} sur ${item.copiesTotal}`, 'good');
    else chip(`Aucun exemplaire disponible actuellement (${item.copiesTotal})${item.nextReturn ? ` · retour le plus proche : ${shortDate(item.nextReturn)}` : ''}`, 'warn');
    chip(item.reservable ? '🔖 Réservable' : 'Non réservable', item.reservable ? 'good' : '');
  } else if (item.copiesTotal === 0) chip('Aucun exemplaire en rayon', 'warn');
  else if (item.availability) chip(item.availability === 'available' ? '✓ Document disponible dans un des établissements du réseau' : 'Aucun exemplaire disponible actuellement', item.availability === 'available' ? 'good' : 'warn');
  if (chips.children.length) li.append(chips);
  if (item.holdings?.length) {
    const ex = el('details', 'notice where');
    ex.append(accSummary('📍', 'Où le consulter · collection conservée'));
    const box = el('div', 'copy-list');
    for (const h of item.holdings) { const r = el('div', 'copy-row'); r.append(el('span', 'copy-what', [h.branch, h.place, h.callNumber].filter(Boolean).join(' · ')), el('span', 'copy-st wait', h.caption)); box.append(r); }
    ex.append(box); li.append(ex);
  }
  if (item.copies?.length) {
    const ex = el('details', 'notice where');
    const by = new Map();
    for (const c of item.copies) { const k = c.branch || 'Bibliothèque'; if (!by.has(k)) by.set(k, []); by.get(k).push(c); }
    const free = (x) => x.available && !x.held; // seul « Disponible » (non réservé) est vert
    const tone = (x) => (free(x) ? 'ok' : x.available || ['PR', 'AT', 'TR'].includes(x.stat) ? 'wait' : 'no');
    const nb = [...by.values()].filter((l) => l.some(free)).length;
    ex.append(accSummary('📍', nb ? `Où l'emprunter · disponible dans ${nb} bibliothèque${nb > 1 ? 's' : ''}` : 'Où le trouver · aucun exemplaire disponible'));
    const box = el('div', 'copy-list');
    for (const [name, list] of [...by].sort((a, b) => b[1].filter(free).length - a[1].filter(free).length || a[0].localeCompare(b[0], 'fr'))) {
      const n = list.filter(free).length;
      const g = el('div', 'copy-branch');
      const h = el('div', 'copy-h'); h.append(el('strong', '', name), el('span', 'chip ' + (n ? 'good' : 'warn'), n ? `${n} disponible${n > 1 ? 's' : ''}` : 'Aucun disponible'));
      g.append(h);
      for (const c of list) {
        const r = el('div', 'copy-row');
        r.append(el('span', 'copy-what', [c.place, c.callNumber].filter(Boolean).join(' · ') || 'Exemplaire'));
        r.append(el('span', 'copy-st ' + tone(c), (free(c) ? '✓ ' : '') + (c.status || (c.available ? 'Disponible' : 'Indisponible')) + (!free(c) && c.due ? ` · retour le ${shortDate(c.due)}` : '')));
        g.append(r);
      }
      box.append(g);
    }
    ex.append(box); li.append(ex);
  }
  const more = moreLikeThis(item);
  if (more) li.append(more);
  const det = el('details', 'notice');
  det.append(accSummary(item.digital ? (item.kind === 'Podcast' ? '🎧' : '📖') : '📖', item.digital && item.kind === 'Podcast' ? 'Écouter et détails' : item.digital && item.kind === 'Film en ligne' ? 'Regarder et détails' : 'Détails du document'));
  const body = el('div', 'notice-body');
  det.append(body);
  let loaded = false;
  det.ontoggle = async () => {
    if (!det.open || loaded) return;
    loaded = true; body.textContent = 'Chargement…';
    try {
      const d = await call('/notice', { id: item.id });
      body.replaceChildren();
      for (const l of d.links || []) {
        if (l.kind === 'audio') { const a = el('audio'); a.controls = true; a.preload = 'none'; a.src = l.url; a.className = 'player'; body.append(a); continue; }
        const a = el('a', 'primary small linkbtn', ({ film: '▶️ ', sample: '📖 ', web: '🔗 ' }[l.kind] || '') + l.label); a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.margin = '0 8px 8px 0'; body.append(a);
      }
      const extra = d.fields.length ? d.fields : item.fields.filter(([l]) => !MAIN.includes(l));
      const r = noticeFields(extra);
      if (r) body.append(r); else body.append(el('p', 'hint', 'Aucun détail supplémentaire.'));
      if (!d.fields.length) {
        const b = el('button', 'link', 'Détails manquants : envoyer un diagnostic'); const pre = el('pre'); pre.hidden = true;
        b.onclick = async () => { pre.hidden = false; pre.textContent = '…'; try { const g = await call('/notice', { id: item.id, debug: true }); pre.textContent = JSON.stringify({ keys: g.keys, shape: g.shape }, null, 1); } catch (e) { pre.textContent = e.message; } };
        body.append(b, pre);
      }
    } catch (e) { loaded = false; body.textContent = 'Impossible de charger les détails : ' + e.message; }
  };
  if (item.id) li.append(extraPanel(item));
  li.append(det);
  const row = el('div', 'btn-row');
  const fav = el('button', 'secondary small fav-btn', '♡ Favoris');
  fav.onclick = () => { fav.remove(); favSheet(item, li); };
  row.append(fav); li.append(row);
  if (item.reservable !== false && !item.digital && !item.holdings?.length) {
    const btn = el('button', 'primary small reserve-btn', 'Réserver');
    btn.onclick = () => { btn.remove(); reserveSheet(item, li); };
    row.append(btn);
  }
  watchResa(li, item.id);
  return li;
}

// Titre de document cliquable : ouvre la fiche dans l'onglet Chercher (sauf déjà dans la recherche).
function docTitle(text, item) {
  const h3 = el('h3');
  if (!text || !(item.coverId || item.id || item.title)) { h3.textContent = text || ''; return h3; }
  const a = el('a', 'doc-link', text); a.href = '#chercher'; a.title = 'Voir la fiche du document';
  a.onclick = (ev) => { ev.preventDefault(); openDocument(item); };
  h3.append(a); return h3;
}
// ---------- « déjà réservé » sur toutes les cartes de documents ----------
const RESA = { map: new Map(), at: 0, busy: false };
function loadResaIndex() { const c = readResaCache(); RESA.map = new Map((c?.reservations || []).filter((r) => r.coverId).map((r) => [r.coverId, r])); }
async function refreshResaIndex(force) {
  if (!hasCreds() || RESA.busy || (!force && Date.now() - RESA.at < 120000)) return;
  RESA.busy = true;
  try { const d = await call('/reservations'); store.set('resaCache', JSON.stringify(d)); RESA.at = Date.now(); loadResaIndex(); decorateAll(); } catch { /* facultatif */ }
  finally { RESA.busy = false; }
}
function decorate(li, docId) {
  li.querySelector(':scope > .resa-tag')?.remove();
  const r = docId && RESA.map.get(docId);
  li.querySelectorAll('.reserve-btn').forEach((b) => { b.hidden = !!r; });
  if (!r) return;
  const tag = el('div', 'resa-tag' + (r.available ? ' ready' : ''));
  tag.append(el('span', '', r.available ? '🔖 Vous avez réservé ce document : prêt à retirer' : `🔖 Vous avez déjà réservé ce document${r.rank ? ` · n° ${r.rank} dans la file` : ''}`));
  const go = el('a', 'secondary small linkbtn', 'Voir mes réservations'); go.href = '#resa'; tag.append(go);
  const head = li.querySelector('.card-head'); if (head) head.after(tag); else li.prepend(tag);
}
function decorateAll() { document.querySelectorAll('[data-doc]').forEach((li) => decorate(li, li.dataset.doc)); }
function watchResa(li, docId) {
  if (!docId || !hasCreds()) return;
  if (!RESA.at && !RESA.map.size) loadResaIndex();
  li.dataset.doc = docId; decorate(li, docId); refreshResaIndex(false);
}
// Ouvre la fiche d'un document dans l'onglet Chercher, telle qu'un résultat de recherche.
async function resolveDocId(item) {
  if (item.coverId) return item.coverId;
  if (/^p::/.test(item.id || '')) return item.id;
  const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const { results } = await call('/search', { query: [item.title, item.author].filter(Boolean).join(' ').slice(0, 120) });
  const want = norm(item.title);
  return (results.find((r) => norm(r.title) === want) || results.find((r) => norm(r.title).startsWith(want.slice(0, 20))) || results[0])?.id || '';
}
async function openDocument(item) {
  location.hash = '#chercher';
  Object.assign(SS, { items: [], more: false, q: '', qid: '', single: true });
  $('q').value = ''; $('searchList').replaceChildren(); $('searchTools').hidden = true; $('moreBtn').hidden = true;
  $('searchStatus').textContent = 'Ouverture du document…';
  try {
    const id = await resolveDocId(item); if (!id) throw new Error('Document introuvable dans le catalogue.');
    const { results } = await call('/documents', { ids: [id] });
    if (!results.length) throw new Error('Document introuvable dans le catalogue.');
    SS.items = results; renderSearch();
    $('searchStatus').textContent = 'Fiche du document';
  } catch (e) { $('searchStatus').textContent = 'Impossible d’ouvrir le document : ' + e.message; }
}

// ---------- même auteur, même série ----------
function goSearch(q) {
  Object.assign(ADV, { field: '', order: '', yearFrom: '', yearTo: '', filters: {} });
  $('q').value = q;
  if (location.hash !== '#chercher') { location.hash = '#chercher'; setTimeout(() => runSearch(false), 60); } else runSearch(false);
}
function moreLikeThis(item) {
  const authors = fieldOf(item, 'Auteurs').split(' · ').map((a) => a.replace(/\s*[\[(].*$/, '').replace(/\s*\d{3,4}\b.*$/, '').replace(/[,\s]+$/, '').trim()).filter(Boolean);
  const serie = fieldOf(item, 'Série').split(' · ')[0].replace(/\s*;.*$/, '').trim();
  const title = item.title || '';
  const guess = !serie && /^(.{3,60}?)\s*[.:]\s*\d+\s*$/.exec(title)?.[1]; // « Titre. 6 » → série « Titre »
  if (!authors.length && !serie && !guess) return null;
  const row = el('div', 'more-like');
  const b = (txt, q) => { const x = el('button', 'fchip', txt); x.onclick = () => goSearch(q); row.append(x); };
  if (authors[0]) b('✍️ Autres documents de ' + authors[0].split(',').reverse().join(' ').trim(), authors[0]);
  if (serie || guess) b('📚 Même série', serie || guess);
  return row;
}

// ---------- recherche : filtres, tri, pagination, scan ----------
const ADV = { open: false, field: '', order: '', yearFrom: '', yearTo: '', filters: {}, facets: [] };
const SS = { qid: '', q: '', page: 1, items: [], more: false, avail: false, resa: false, type: '', branch: '', sort: 'pertinence', busy: false };
const fieldOf = (it, label) => (it.fields.find(([l]) => l === label) || [])[1] || '';
const yearOf = (it) => Number((fieldOf(it, 'Date').match(/\d{4}/) || [0])[0]);
function applySearch() {
  let l = SS.items.slice();
  if (SS.avail) l = l.filter((it) => it.copiesAvailable > 0);
  if (SS.resa) l = l.filter((it) => it.reservable);
  if (SS.type) l = l.filter((it) => fieldOf(it, 'Type de document') === SS.type);
  if (SS.branch) l = l.filter((it) => (it.copies || []).some((c) => c.branch === SS.branch && c.available && !c.held));
  if (SS.sort === 'titre') l.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  if (SS.sort === 'recent') l.sort((a, b) => yearOf(b) - yearOf(a));
  return l;
}
function renderSearch() {
  const tools = $('searchTools'), list = $('searchList');
  tools.hidden = !SS.items.length || !!SS.single; tools.replaceChildren();
  if (SS.items.length && !SS.single) {
    const chip = (txt, on, fn) => { const b = el('button', 'fchip' + (on ? ' on' : ''), txt); b.onclick = fn; return b; };
    const row1 = el('div', 'frow');
    row1.append(chip('✓ Disponible', SS.avail, () => { SS.avail = !SS.avail; renderSearch(); }), chip('🔖 Réservable', SS.resa, () => { SS.resa = !SS.resa; renderSearch(); }));
    const select = (label, value, opts, fn) => { const sel = el('select', 'fsel'); sel.append(new Option(label, '')); for (const o of opts) sel.append(new Option(o, o)); sel.value = value; sel.onchange = () => fn(sel.value); return sel; };
    const types = [...new Set(SS.items.map((it) => fieldOf(it, 'Type de document')).filter(Boolean))].sort();
    const branches = [...new Set(SS.items.flatMap((it) => (it.copies || []).filter((c) => c.available && !c.held).map((c) => c.branch)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    const row2 = el('div', 'frow');
    if (types.length > 1) row2.append(select('Tous les types', SS.type, types, (v) => { SS.type = v; renderSearch(); }));
    if (branches.length) row2.append(select('Toutes les bibliothèques', SS.branch, branches, (v) => { SS.branch = v; renderSearch(); }));
    const sort = el('select', 'fsel'); for (const [v, t] of [['pertinence', 'Tri : pertinence'], ['titre', 'Tri : titre A→Z'], ['recent', 'Tri : plus récent']]) sort.append(new Option(t, v));
    sort.value = SS.sort; sort.onchange = () => { SS.sort = sort.value; renderSearch(); }; row2.append(sort);
    const save = chip('💾 Sauvegarder cette recherche', false, async () => {
      save.disabled = true;
      try { await call('/saved-searches', { action: 'save', queryId: SS.qid }); save.textContent = '✓ Recherche sauvegardée'; }
      catch (e) { save.disabled = false; $('searchStatus').textContent = 'Sauvegarde impossible : ' + e.message; }
    });
    if (SS.qid) row1.append(save);
    tools.append(row1, row2);
  }
  const shown = applySearch();
  list.replaceChildren(...shown.map((it) => searchCard(it, true)));
  const filtered = shown.length !== SS.items.length;
  $('searchStatus').textContent = !SS.items.length ? (SS.q ? 'Aucun résultat.' : '') : `${shown.length} résultat${shown.length > 1 ? 's' : ''}${filtered ? ` sur ${SS.items.length} chargés` : ''}`;
  $('moreBtn').hidden = !SS.more;
  if (SS.items.length && !shown.length) list.append(emptyState('🔎', 'Aucun résultat avec ces filtres', 'Retirez un filtre ou chargez plus de résultats.'));
}
function renderAdv() {
  const box = $('advBox'); if (!box) return;
  box.replaceChildren();
  const nb = Object.keys(ADV.filters).length + (ADV.field ? 1 : 0) + (ADV.order ? 1 : 0) + (ADV.yearFrom || ADV.yearTo ? 1 : 0);
  const tog = el('button', 'fchip' + (nb ? ' on' : ''), `⚙️ Recherche avancée${nb ? ` (${nb})` : ''}`); tog.type = 'button';
  tog.onclick = () => { ADV.open = !ADV.open; renderAdv(); };
  box.append(tog);
  if (!ADV.open) return;
  const panel = el('div', 'ag-form adv');
  const fld = (label, ctl) => { const w = el('label', 'ag-fld'); w.append(el('span', '', label), ctl); return w; };
  const sel = (opts, value, fn) => { const x = el('select', 'fsel'); for (const [v, t] of opts) x.append(new Option(t, v)); x.value = value; x.onchange = () => fn(x.value); return x; };
  panel.append(
    fld('🔤 Chercher dans', sel([['', 'Partout'], ['title', 'Le titre'], ['author', 'L’auteur'], ['subject', 'Le sujet'], ['isbn', 'L’ISBN']], ADV.field, (v) => { ADV.field = v; renderAdv(); })),
    fld('↕️ Trier tous les résultats', sel([['', 'Pertinence'], ['SortkeyTitle_ASC', 'Titre A → Z'], ['SortkeyTitle_DESC', 'Titre Z → A'], ['SortkeyAuthor_ASC', 'Auteur A → Z'], ['DateOfPublicationSearch_date_DESC', 'Plus récent d’abord'], ['DateOfPublicationSearch_date_ASC', 'Plus ancien d’abord']], ADV.order, (v) => { ADV.order = v; renderAdv(); })),
  );
  const yr = el('div', 'ag-years'); const mk = (ph, key) => { const i = el('input', 'fsel'); i.type = 'number'; i.inputMode = 'numeric'; i.min = 1000; i.max = 2100; i.placeholder = ph; i.value = ADV[key]; i.onchange = () => { ADV[key] = i.value.trim(); renderAdv(); }; return i; };
  yr.append(mk('de (année)', 'yearFrom'), el('span', '', '→'), mk('à (année)', 'yearTo')); panel.append(fld('📅 Année de publication', yr));
  if (SS.items.length && ADV.facets.length) {
    panel.append(el('p', 'hint adv-h', 'Affiner les résultats'));
    for (const f of ADV.facets) {
      const cur = ADV.filters[f.code]?.[0] || '';
      const opts = [['', `Tous (${f.label.toLowerCase()})`], ...f.items.map((i) => [i.value, `${i.label} (${i.count})`])];
      if (cur && !f.items.some((i) => i.value === cur)) opts.push([cur, cur]);
      panel.append(fld(f.label, sel(opts, cur, (v) => { if (v) ADV.filters[f.code] = [v]; else delete ADV.filters[f.code]; if ($('q').value.trim()) runSearch(false, true); })));
    }
  }
  const row = el('div', 'btn-row');
  const go = el('button', 'primary small', 'Lancer la recherche'); go.type = 'button'; go.onclick = () => { if ($('q').value.trim()) runSearch(false, true); };
  const clr = el('button', 'secondary small', 'Tout effacer'); clr.type = 'button'; clr.onclick = () => { Object.assign(ADV, { field: '', order: '', yearFrom: '', yearTo: '', filters: {} }); renderAdv(); if (SS.q) runSearch(false, true); };
  row.append(go, clr); panel.append(row); box.append(panel);
}
async function runSearch(more, keep) {
  if (SS.busy) return;
  SS.busy = true;
  if (!more) { SS.single = false; SS.q = $('q').value.trim(); SS.qid = crypto.randomUUID?.() || ''; SS.page = 1; SS.items = []; SS.avail = SS.resa = false; SS.type = SS.branch = ''; if (!keep) { ADV.filters = {}; ADV.facets = []; } $('searchList').replaceChildren(); $('searchTools').hidden = true; }
  else SS.page += 1;
  $('searchStatus').textContent = more ? 'Chargement…' : 'Recherche…'; $('moreBtn').disabled = true;
  try {
    const data = await call('/search', { query: SS.q, page: SS.page, queryId: SS.qid, field: ADV.field, order: ADV.order, yearFrom: ADV.yearFrom, yearTo: ADV.yearTo, filters: ADV.filters });
    if (!more && data.facets) ADV.facets = data.facets;
    const known = new Set(SS.items.map((it) => it.id));
    SS.items.push(...data.results.filter((it) => !known.has(it.id)));
    SS.more = data.results.length >= 20 && SS.page < 10;
    renderSearch(); renderAdv();
  } catch (e) { if (more) SS.page -= 1; $('searchStatus').textContent = 'Recherche impossible : ' + e.message; }
  finally { SS.busy = false; $('moreBtn').disabled = false; }
}
$('searchForm').onsubmit = (ev) => {
  ev.preventDefault();
  if (!hasCreds()) return needLogin($('searchList'), $('searchStatus'));
  if (!$('q').value.trim()) return;
  $('q').blur(); runSearch(false);
};
$('moreBtn').onclick = () => runSearch(true);
renderAdv();

// Scan du code-barres d'un livre : détecteur du navigateur s'il existe, sinon bibliothèque ZXing chargée à la demande.
let scanStop = null;
async function startScan() {
  const box = $('scanBox'), video = $('scanVideo');
  let stream, stopped = false;
  const finish = (code) => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); box.hidden = true; scanStop = null; if (code) { $('q').value = code; $('searchForm').requestSubmit(); } };
  scanStop = () => finish('');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch { alert("Impossible d'ouvrir l'appareil photo : autorisez-le dans les réglages du navigateur."); scanStop = null; return; }
  box.hidden = false; video.srcObject = stream; await video.play().catch(() => {});
  const ok = (v) => /^(97[89]\d{10}|\d{13}|\d{8}|\d{10})$/.test(String(v).replace(/[^0-9Xx]/g, '')) ? String(v).replace(/[^0-9Xx]/g, '') : '';
  if ('BarcodeDetector' in window) {
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'code_128'] });
    const loop = async () => { if (stopped) return; try { const r = await det.detect(video); const code = r.map((x) => ok(x.rawValue)).find(Boolean); if (code) return finish(code); } catch {} setTimeout(loop, 250); };
    loop();
  } else {
    try {
      if (!window.ZXing) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js'; sc.onload = res; sc.onerror = rej; document.head.append(sc); });
      const reader = new ZXing.BrowserMultiFormatReader();
      const loop = async () => { if (stopped) return; try { const r = await reader.decodeFromVideoElement(video); const code = ok(r.getText()); if (code) return finish(code); } catch {} setTimeout(loop, 250); };
      loop();
    } catch { finish(''); alert('Le scan n’est pas disponible sur cet appareil : saisissez le numéro ISBN à la main.'); }
  }
}
$('scanBtn').onclick = () => { if (!hasCreds()) return needLogin($('searchList'), $('searchStatus')); startScan(); };
$('scanClose').onclick = () => scanStop?.();

// ---------- favoris ----------
function favSheet(item, li, row) {
  const sheet = el('div', 'sheet');
  const msg = el('p', 'hint msg', 'Chargement de vos listes…');
  sheet.append(msg); li.append(sheet);
  call('/basket', { action: 'list' }).then(({ baskets }) => {
    sheet.replaceChildren();
    const sel = el('select');
    baskets.forEach((b) => sel.append(new Option(b.name, b.id)));
    sel.append(new Option('➕ Nouvelle liste…', '__new'));
    const lab = el('label', '', 'Ajouter à la liste'); lab.append(sel); sheet.append(lab);
    const nameBox = el('input'); nameBox.placeholder = 'Nom de la nouvelle liste'; nameBox.hidden = baskets.length > 0;
    if (!baskets.length) sel.value = '__new';
    sel.onchange = () => { nameBox.hidden = sel.value !== '__new'; };
    sheet.append(nameBox);
    const ok = el('button', 'primary small', 'Ajouter'); ok.style.marginTop = '12px';
    const out = el('p', 'hint msg');
    ok.onclick = async () => {
      ok.disabled = true; out.textContent = '';
      try {
        if (sel.value === '__new') {
          if (!nameBox.value.trim()) throw new Error('Donnez un nom à la liste.');
          await call('/basket', { action: 'create', title: nameBox.value.trim(), docId: item.id });
        } else await call('/basket', { action: 'add', basketId: sel.value, docId: item.id });
        sheet.replaceChildren(el('p', 'hint ok', '✓ Ajouté aux favoris.'));
      } catch (e) { out.textContent = e.message; out.className = 'hint msg err'; ok.disabled = false; }
    };
    sheet.append(ok, out);
  }).catch((e) => { msg.textContent = e.message; msg.className = 'hint msg err'; });
}

// Historique des prêts : la carte se complète (exemplaires, détails, réservation, favoris…) comme un résultat de recherche,
// à mesure qu'elle apparaît à l'écran. Les documents sont lus par lots pour ménager le relais.
const HQ = { queue: [], timer: null, io: null };
function enrichHistory(li, it) {
  if (!it.coverId) return; // sans identifiant : le bouton « Favoris » retrouve le document par son titre
  HQ.io ||= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { HQ.io.unobserve(e.target); HQ.queue.push(e.target); }
    clearTimeout(HQ.timer); HQ.timer = setTimeout(flushHistory, 200);
  }, { rootMargin: '300px' });
  li._hist = it; HQ.io.observe(li);
}
async function flushHistory() {
  const cards = HQ.queue.splice(0, 12); if (!cards.length) return;
  try {
    const { results } = await call('/documents', { ids: cards.map((c) => c._hist.coverId) });
    const by = new Map(results.map((r) => [r.id, r]));
    for (const li of cards) {
      const res = by.get(li._hist.coverId); if (!res || !li.isConnected) continue;
      const full = searchCard(res);
      const mine = rows(li._hist.fields.filter(([l]) => !/^(titre|auteurs?|objet)$/i.test(l)));
      if (mine) { mine.classList.add('hist-rows'); full.querySelector('.card-head')?.after(mine); }
      li.replaceWith(full);
    }
  } catch { /* la carte simple reste affichée */ }
  if (HQ.queue.length) setTimeout(flushHistory, 100);
}
function addFavButton(li, item) {
  if (!item.coverId && !item.title) return;
  const row = el('div', 'btn-row');
  const fav = el('button', 'secondary small fav-btn', '♡ Favoris');
  fav.onclick = async () => {
    let id = item.coverId;
    if (!id) {
      // Pas d'identifiant du document (historique) : on le retrouve dans le catalogue d'après son titre et son auteur.
      fav.disabled = true; fav.textContent = 'Recherche du document…';
      try {
        const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
        const { results } = await call('/search', { query: [item.title, item.author].filter(Boolean).join(' ').slice(0, 120) });
        const want = norm(item.title);
        const hit = results.find((r) => norm(r.title) === want) || results.find((r) => norm(r.title).startsWith(want.slice(0, 20))) || results[0];
        id = hit?.id;
      } catch { /* géré ci-dessous */ }
      if (!id) { fav.disabled = false; fav.textContent = '♡ Favoris'; alert('Document introuvable dans le catalogue.'); return; }
    }
    fav.remove(); favSheet({ id }, li);
  };
  row.append(fav); li.append(row);
}

// ---------- mon espace ----------
const ESPACE = { profile: 'Mon profil', favoris: 'Mes favoris', loanhistory: 'Historique des prêts', messages: 'Messages', fines: 'Amendes', bibliotheques: 'Bibliothèques', nouveautes: 'Nouveautés', agenda: 'Agenda des bibliothèques', mesevenements: 'Mes événements', aujourdhui: 'À emprunter aujourd’hui', recherches: 'Mes recherches' };
const MENU = [
  ['profile', '👤', 'Mon profil', 'Coordonnées et abonnement'],
  ['favoris', '♡', 'Mes favoris', 'Vos listes de documents'],
  ['loanhistory', '🕘', 'Historique des prêts', 'Tout ce que vous avez emprunté'],
  ['messages', '✉️', 'Messages', 'Avis de la bibliothèque'],
  ['fines', '💶', 'Amendes', 'Montants éventuels à régler'],
  ['aujourdhui', '🎯', 'À emprunter aujourd’hui', 'Livres de vos listes disponibles, bibliothèque ouverte'],
  ['agenda', '📅', 'Agenda', 'Événements à venir dans les bibliothèques'],
  ['mesevenements', '⭐', 'Mes événements', 'Ceux auxquels vous voulez participer'],
  ['nouveautes', '✨', 'Nouveautés', 'Derniers arrivages par bibliothèque'],
  ['recherches', '🔎', 'Mes recherches', 'Recherches sauvegardées'],
  ['bibliotheques', '🏛️', 'Bibliothèques', 'Infos du réseau, itinéraires, horaires'],
];
let espaceKind = store.get('espaceKind') || 'favoris';

function plainCard(it) {
  const li = el('li', 'card');
  if (it.title || it.coverId || it.isbn) {
    const head = el('div', 'card-head'); const t = el('div', 'card-title');
    if (it.title) t.append(docTitle(it.title, it));
    if (it.author) t.append(el('p', '', it.author));
    if (it.coverId || it.isbn) head.append(cover(it));
    head.append(t); li.append(head);
  }
  const r = rows(it.fields); if (r) li.append(r);
  watchResa(li, it.coverId);
  return li;
}

// ---------- messages : texte riche nettoyé (liste blanche de balises), puces et liens reconnus ----------
const SAFE_URL = /^(https?:|mailto:)/i;
function richNodes(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const out = document.createDocumentFragment();
  const linkify = (txt, parent) => {
    const re = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g; let last = 0, m;
    while ((m = re.exec(txt))) {
      if (m.index > last) parent.append(txt.slice(last, m.index));
      const url = m[0].replace(/[.,;:)]+$/, ''); const a = el('a', '', url); a.href = url.startsWith('www.') ? 'https://' + url : url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      parent.append(a); last = m.index + url.length; re.lastIndex = last;
    }
    if (last < txt.length) parent.append(txt.slice(last));
  };
  const walk = (node, parent) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { linkify(n.nodeValue.replace(/\u00a0/g, ' '), parent); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|FORM|HEAD)$/.test(t)) continue;
      let tag = null;
      if (/^(P|DIV|H[1-6]|BLOCKQUOTE|TR)$/.test(t)) tag = /^H/.test(t) ? 'h4' : 'p';
      else if (/^(STRONG|B)$/.test(t)) tag = 'strong'; else if (/^(EM|I)$/.test(t)) tag = 'em'; else if (t === 'U') tag = 'u';
      else if (/^(UL|OL)$/.test(t)) tag = 'ul'; else if (t === 'LI') tag = 'li'; else if (t === 'BR') { parent.append(document.createElement('br')); continue; }
      else if (t === 'A') {
        const href = n.getAttribute('href') || '';
        if (SAFE_URL.test(href)) { const a = el('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; walk(n, a); parent.append(a); continue; }
      }
      const style = (n.getAttribute('style') || '');
      if (!tag && /underline/.test(style)) tag = 'u'; else if (!tag && /font-weight:\s*(bold|[6-9]00)/.test(style)) tag = 'strong';
      if (!tag) { walk(n, parent); continue; }
      const e = document.createElement(tag); walk(n, e); parent.append(e);
    }
  };
  walk(doc.body, out);
  return out;
}
// Texte « à l'ancienne » (retours à la ligne sans balises de bloc) : on le structure en paragraphes et en listes à puces.
function structureText(html) {
  if (/<(p|div|br|ul|ol|li|table|h[1-6])\b/i.test(html)) return html;
  const out = []; let para = [], list = [];
  const flush = () => { if (para.length) out.push('<p>' + para.join('<br>') + '</p>'); if (list.length) out.push('<ul>' + list.join('') + '</ul>'); para = []; list = []; };
  for (const line of String(html).replace(/\r/g, '').split('\n')) {
    const t = line.trim();
    if (!t) { flush(); continue; }
    if (/^[*•·-]\s+\S/.test(t.replace(/<[^>]+>/g, ''))) { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } list.push('<li>' + t.replace(/^((<[^>]+>)*\s*)[*•·-]\s+/, '$1') + '</li>'); }
    else { if (list.length) { out.push('<ul>' + list.join('') + '</ul>'); list = []; } para.push(t); }
  }
  flush();
  return out.join('');
}
function richBody(html, plain) {
  const box = el('div', 'rich');
  const src = /[<][a-z!/]/i.test(html || '') ? html : String(plain || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  box.append(richNodes(structureText(src)));
  // lignes « * texte » ou « • texte » : de vraies puces
  for (const p of [...box.querySelectorAll(':scope > p, :scope > ul > li')]) {
    const t = p.textContent;
    if (/^\s*[*•·-]\s+\S/.test(t) && p.tagName === 'P') {
      const lines = p.innerHTML.split(/<br\s*\/?>/i);
      if (lines.every((l) => /^\s*[*•·-]\s+/.test(l.replace(/<[^>]+>/g, '')))) {
        const ul = el('ul'); for (const l of lines) { const li = document.createElement('li'); li.innerHTML = l.replace(/^(\s*(<[^>]+>)*\s*)[*•·-]\s+/, '$1'); ul.append(li); }
        p.replaceWith(ul);
      } else { p.classList.add('bullet'); p.innerHTML = p.innerHTML.replace(/^(\s*(<[^>]+>)*\s*)[*•·-]\s+/, '$1'); }
    }
  }
  for (const ul of box.querySelectorAll('ul')) { const prev = ul.previousElementSibling; if (prev && prev.classList.contains('bullet')) { /* regroupe */ } }
  // regroupe les paragraphes à puce consécutifs
  let run = null;
  for (const n of [...box.children]) {
    if (n.classList?.contains('bullet')) { if (!run) { run = el('ul'); n.before(run); } const li = document.createElement('li'); li.innerHTML = n.innerHTML; run.append(li); n.remove(); } else run = null;
  }
  return box;
}
function messageCard(it, unread) {
  const li = el('li', 'card msg' + (unread ? ' unread' : ''));
  const head = el('div', 'msg-head');
  head.append(el('span', 'msg-av', 'M'));
  const t = el('div', 'msg-title');
  t.append(el('strong', '', it.title || 'Message de la bibliothèque'));
  const when = it.date ? `${longDate(it.date)}${it.time ? ' · ' + it.time : ''}` : '';
  if (when) t.append(el('small', '', when));
  head.append(t);
  if (unread) head.append(el('span', 'chip good new-chip', 'Nouveau'));
  li.append(head, richBody(it.html, (it.fields.find((f) => f[0] === 'Message') || [])[1]));
  const foot = el('div', 'msg-foot');
  const del = el('button', 'msg-del', '🗑 Supprimer');
  const ask = el('span', 'msg-ask'); ask.hidden = true;
  const yes = el('button', 'msg-yes', 'Oui, supprimer'), no = el('button', 'msg-no', 'Annuler');
  ask.append(el('span', '', 'Supprimer définitivement ?'), yes, no);
  del.onclick = () => { del.hidden = true; ask.hidden = false; };
  no.onclick = () => { ask.hidden = true; del.hidden = false; };
  const err = el('p', 'hint err'); err.hidden = true;
  yes.onclick = async () => {
    yes.disabled = no.disabled = true; yes.textContent = 'Suppression…'; err.hidden = true;
    try {
      await call('/delete-message', { id: it.id });
      li.classList.add('gone'); setTimeout(() => li.remove(), 250);
      const c = readMsgCache(); if (c) { c.items = c.items.filter((m) => m.id !== it.id); store.set('msgCache', JSON.stringify(c)); }
      updateEspaceBadge();
    } catch (e) { yes.disabled = no.disabled = false; yes.textContent = 'Oui, supprimer'; err.textContent = e.message; err.hidden = false; }
  };
  foot.append(del, ask); li.append(foot, err);
  return li;
}

// Pictogramme : propre à chacune des 3 listes standard (d'après leur titre), identique pour toutes les listes personnalisées.
const DEFAULT_ICONS = [[/favori|c[œo]eur|pr[ée]f[ée]r/i, '❤️'], [/lire|lecture|plus tard|voir|envie|attente/i, '⏳'], [/lu\b|lus\b|d[ée]j[àa]|termin|fini|emprunt|historique/i, '✅']];
const DEFAULT_FALLBACK = ['❤️', '⏳', '✅'];
function listIcon(name, isDefault, rank = 0) {
  if (!isDefault) return '📚';
  return DEFAULT_ICONS.find(([re]) => re.test(name))?.[1] ?? DEFAULT_FALLBACK[rank % DEFAULT_FALLBACK.length];
}
async function showBaskets(body, status) {
  const render = (baskets) => {
    body.replaceChildren();
    const add = el('button', 'primary small', '➕ Nouvelle liste'); add.style.margin = '0 0 12px';
    add.onclick = async () => {
      const name = prompt('Nom de la nouvelle liste ?'); if (!name || !name.trim()) return;
      try { render((await call('/basket', { action: 'create', title: name.trim() })).baskets); } catch (e) { status.textContent = e.message; }
    };
    body.append(add);
    const ul = el('ul', 'cards');
    if (!baskets.length) { ul.append(emptyState('♡', 'Aucune liste', 'Créez une liste, ou ajoutez un document depuis Chercher avec le bouton ♡.')); }
    let defRank = 0;
    for (const b of baskets) {
      const li = el('li', 'list-card');
      const main = el('div', 'list-main'); main.tabIndex = 0; main.setAttribute('role', 'button');
      const ico = el('span', 'list-ico', listIcon(b.name, b.isDefault, b.isDefault ? defRank++ : 0)); ico.style.background = 'color-mix(in srgb, var(--accent) 14%, var(--card))';
      const t = el('span', 'list-txt');
      t.append(el('strong', '', b.name), el('small', '', b.count ? `${b.count} document${b.count > 1 ? 's' : ''}` : 'Liste vide'));
      main.append(ico, t, el('span', 'stat-go', '›'));
      const openIt = () => showBasket(body, status, b);
      main.onclick = openIt; main.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); } };
      li.append(main);
      if (!b.isDefault) {
        const more = el('button', 'list-more', '⋯'); more.setAttribute('aria-label', 'Modifier la liste');
        const acts = el('div', 'list-acts'); acts.hidden = true;
        const ren = el('button', 'secondary small', 'Renommer');
        const del = el('button', 'secondary small danger', 'Supprimer');
        more.onclick = (e) => { e.stopPropagation(); acts.hidden = !acts.hidden; };
        ren.onclick = async () => { const n = prompt('Nouveau nom ?', b.name); if (!n || !n.trim()) return; try { render((await call('/basket', { action: 'rename', basketId: b.id, name: n.trim() })).baskets); } catch (e) { status.textContent = e.message; } };
        del.onclick = async () => { if (!confirm(`Supprimer la liste « ${b.name} » ?`)) return; try { render((await call('/basket', { action: 'delete', basketId: b.id })).baskets); } catch (e) { status.textContent = e.message; } };
        acts.append(ren, del); main.after(more); li.append(acts); li.classList.add('has-more');
      }
      ul.append(li);
    }
    body.append(ul); status.textContent = '';
    if (baskets.some((b) => b.name === 'Liste sans nom')) {
      const d = el('button', 'link', 'Noms manquants : envoyer un diagnostic'); const pre = el('pre'); pre.hidden = true;
      d.onclick = async () => { pre.hidden = false; pre.textContent = '…'; try { const g = await call('/basket', { action: 'list', debug: true }); pre.textContent = JSON.stringify(g.shape, null, 1); } catch (e) { pre.textContent = e.message; } };
      body.append(d, pre);
    }
  };
  status.textContent = 'Chargement de vos favoris…';
  try { render((await call('/basket', { action: 'list' })).baskets); } catch (e) { status.textContent = 'Impossible de charger les favoris : ' + e.message; }
}

async function showBasket(body, status, b) {
  body.replaceChildren(); status.textContent = `Chargement de « ${b.name} »…`;
  const back = el('button', 'secondary small', '← Mes listes'); back.style.margin = '0 0 12px';
  back.onclick = () => showBaskets(body, status);
  try {
    const { results } = await call('/basket', { action: 'content', basketId: b.id });
    const top = el('div', 'frow'); top.style.margin = '0 0 12px'; back.style.margin = '0';
    top.append(back);
    if (results.length) {
      const sh = el('button', 'primary small', '📤 Partager la liste');
      sh.onclick = async () => {
        const lines = results.map((it) => { const au = fieldOf(it, 'Auteurs').split(' · ')[0].replace(/\s*[\[(].*$/, '').replace(/\s*\d{3,4}\b.*$/, '').trim(); return `• ${it.title}${au ? ' — ' + au : ''}${it.ark ? '\n  https://www.bmvr.marseille.fr/ark:/' + it.ark : ''}`; });
        const text = `Ma liste « ${b.name} » (Bibliothèques de Marseille)\n\n${lines.join('\n')}`;
        try { if (navigator.share) { await navigator.share({ title: `Liste « ${b.name} »`, text }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
        try { await navigator.clipboard.writeText(text); sh.textContent = '✓ Liste copiée'; setTimeout(() => { sh.textContent = '📤 Partager la liste'; }, 2500); }
        catch { prompt('Copiez le texte de la liste :', text); }
      };
      top.append(sh);
    }
    body.append(top);
    const ul = el('ul', 'cards');
    if (!results.length) { ul.append(emptyState('📭', 'Liste vide', 'Ajoutez des documents avec le bouton ♡.')); }
    for (const it of results) {
      const li = searchCard(it);
      const row = el('div', 'btn-row');
      const rm = el('button', 'secondary small danger', 'Retirer de la liste');
      rm.onclick = async () => { rm.disabled = true; try { await call('/basket', { action: 'remove', basketId: b.id, docId: it.id }); li.remove(); } catch (e) { rm.disabled = false; status.textContent = e.message; } };
      row.append(rm); li.append(row); ul.append(li);
    }
    body.append(ul); status.textContent = `${b.name} · ${results.length} document${results.length > 1 ? 's' : ''}`;
  } catch (e) { body.append(back); status.textContent = 'Impossible de charger la liste : ' + e.message; }
}

function espaceMenu(body, status) {
  body.replaceChildren(); status.textContent = '';
  const who = el('div', 'menu-who');
  const mav = el('span', 'avatar'); paintAvatar(mav, store.get('user') || '?');
  who.append(mav, el('span', '', hasCreds() ? `Connecté · ${store.get('user')}` : 'Non connecté'));
  body.append(who);
  const ul = el('ul', 'menu');
  const item = (href, ico, title, sub) => { const li = el('li'); const a = el('a'); a.href = href; a.append(el('span', 'm-ico', ico)); const t = el('span', 'm-txt'); t.append(el('strong', '', title), el('small', '', sub)); a.append(t, el('span', 'm-go', '›')); li.append(a); ul.append(li); };
  if (hasCreds()) for (const [k, ico, title, sub] of MENU) item('#espace/' + k, ico, title, sub);
  item('#compte', '🔐', 'Compte et connexion', hasCreds() ? 'Se déconnecter, à propos, diagnostic' : 'Se connecter à votre compte BMVR');
  body.append(ul);
}

const LIBRARIES = [
  ['Bibliothèque de l\u2019Alcazar', 'Bibliothèque de l\u2019Alcazar Marseille', 'Centre-ville'],
  ['Bibliothèque de Bonneveine', 'Bibliothèque de Bonneveine Marseille', '8e'],
  ['Bibliothèque des Cinq-Avenues', 'Bibliothèque des Cinq-Avenues Marseille', '4e'],
  ['Bibliothèque du Merlan', 'Bibliothèque du Merlan Marseille', '14e'],
  ['Bibliothèque de la Grognarde', 'Bibliothèque de la Grognarde Marseille', ''],
  ['Bibliothèque du Panier (Maison Diamantée)', 'Bibliothèque du Panier Maison Diamantée Marseille', '2e'],
  ['Bibliothèque de Castellane', 'Bibliothèque de Castellane Marseille', '6e'],
  ['Bibliothèque de Saint-André', 'Bibliothèque de Saint-André Marseille', '16e'],
  ['Bibliothèque Salim-Hatubou', 'Bibliothèque Salim Hatubou Marseille', ''],
  ['Ludothèque Simone de Beauvoir', 'Ludothèque Simone de Beauvoir Marseille', ''],
];
function hourRanges(cell) {
  const out = []; const re = /(\d{1,2})h(\d{2})?\s*(?:-|–|à)\s*(\d{1,2})h(\d{2})?/gi; let m;
  while ((m = re.exec(cell))) out.push([+m[1] * 60 + (+m[2] || 0), +m[3] * 60 + (+m[4] || 0)]);
  return out;
}
function openState(cell, now) {
  const r = hourRanges(cell || '');
  if (/rdv/i.test(cell || '')) return ['rdv', 'Sur rendez-vous'];
  if (!r.length) return ['closed', 'Fermée aujourd’hui'];
  const min = now.getHours() * 60 + now.getMinutes();
  const cur = r.find(([a, b]) => min >= a && min < b);
  const fmt = (x) => Math.floor(x / 60) + 'h' + (x % 60 ? String(x % 60).padStart(2, '0') : '');
  if (cur) return ['open', 'Ouverte jusqu’à ' + fmt(cur[1])];
  const next = r.find(([a]) => min < a);
  return next ? ['soon', 'Ouvre à ' + fmt(next[0])] : ['closed', 'Fermée pour aujourd’hui'];
}
function fmtCell(c) {
  c = c || '';
  const m = c.match(/\d{1,2}\s*h(?:\d{2})?\s*(?:-|–|à)\s*\d{1,2}\s*h(?:\d{2})?/gi);
  if (!m || /rdv/i.test(c)) return c || '—';
  return m.map((x) => x.replace(/\s*(?:-|–|à)\s*/, ' – ').replace(/\s+/g, ' ')).join(' · ');
}
function hoursCard(row, days, di, now) {
  const li = el('li', 'card libcard hours');
  const head = el('div', 'lib-h');
  const t = el('div', 'lib-t'); t.append(el('strong', '', row.name));
  const [kind, label] = di < 0 ? ['closed', 'Fermée le dimanche'] : openState(row.hours[di], now);
  const allClosed = row.hours.every((h) => !h || /^ferm/i.test(h));
  const badge = allClosed ? el('span', 'ostate closed', 'Fermée') : el('span', 'ostate ' + kind, label);
  head.append(t, badge); li.append(head);
  if (row.note) li.append(el('p', 'lib-note', row.note));
  if (!allClosed) {
    const tbl = el('div', 'week');
    days.forEach((d, i) => {
      const r = el('div', 'wd' + (i === di ? ' today' : ''));
      r.append(el('span', 'wd-n', d.slice(0, 3) + '.'), el('span', 'wd-h', fmtCell(row.hours[i])));
      tbl.append(r);
    });
    li.append(tbl);
  }
  const a = el('a', 'secondary small linkbtn', '📍 Itinéraire'); a.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(row.name + ' Marseille'); a.target = '_blank'; a.rel = 'noopener noreferrer';
  li.append(a);
  return li;
}
async function showLibraries(body, status) {
  status.textContent = 'Lecture des horaires sur le site officiel…';
  const infos = el('div', 'card infos'); infos.hidden = true; body.append(infos);
  const box = el('div'); body.append(box);
  const foot = el('p', 'hint'); body.append(foot);
  const top = el('a', 'secondary small linkbtn', '🕒 Voir la page officielle des horaires'); top.href = 'https://www.bmvr.marseille.fr/horaires-bibliotheques'; top.target = '_blank'; top.rel = 'noopener noreferrer';
  body.append(top);
  try {
    const d = await call('/horaires');
    status.textContent = '';
    const now = new Date(); const di = (now.getDay() + 6) % 7; const di2 = di > 5 ? -1 : di;
    if (d.html) { infos.hidden = false; const rb = richBody(d.html.replace(/PERTURBATIONS ET INFORMATIONS AUX USAGERS/gi, ''), ''); infos.append(el('h4', '', '⚠️ Informations aux usagers'), rb); }
    if (!d.sections?.length) throw new Error('vide');
    for (const sec of d.sections) {
      box.append(el('h3', 'sec-t', sec.title));
      const ul = el('ul', 'cards');
      for (const row of sec.rows) ul.append(hoursCard(row, sec.days, di2, now));
      box.append(ul);
    }
    foot.textContent = 'Horaires lus sur le site officiel de la BMVR à ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '. Ils peuvent changer (saison, travaux) : en cas de doute, voir la page officielle.';
  } catch {
    status.textContent = '';
    foot.textContent = 'Impossible de lire les horaires pour le moment. Consultez la page officielle ci-dessous.';
    const ul = el('ul', 'cards');
    for (const [name, q, area] of LIBRARIES) {
      const li = el('li', 'card libcard');
      const t = el('div', 'lib-t'); t.append(el('strong', '', name)); if (area) t.append(el('small', '', area));
      const a = el('a', 'secondary small linkbtn', '📍 Itinéraire'); a.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q); a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.append(t, a); ul.append(li);
    }
    box.append(ul);
  }
}

// Services en ligne : lus à chaque ouverture sur la page officielle « En ligne ».
const SVC_ICON = { Presse: '📰', 'Livres numériques': '📱', 'Se former en ligne': '🎓', Cinéma: '🎬', Musique: '🎵', Jeunesse: '🧒', Encyclopédies: '📚', Sciences: '🔬', 'Sciences humaines': '🏛️', Podcasts: '🎧' };
// Accueil : services en ligne par thème, avec épinglage (les épinglés remontent en haut).
const SVC_KEYS = { 'Médiapart': 'mediapart', Cafeyn: 'cafeyn' };
const DEFAULT_PINS = ['Médiapart', 'Cafeyn', 'Marsactu'];
const readPins = () => { try { const v = JSON.parse(store.get('svcPins') || 'null'); return Array.isArray(v) ? v : DEFAULT_PINS; } catch { return DEFAULT_PINS; } };
const writePins = (a) => store.set('svcPins', JSON.stringify(a));
const shortDesc = (t) => { t = t || ''; return t.length > 46 ? t.slice(0, 44).replace(/\s+\S*$/, '') + '…' : t; };
async function openServiceItem(it, tile) {
  const err = $('svcErr'); err.textContent = '';
  const open = (u) => window.open(u, '_blank', 'noopener');
  if (it.name === 'Marsactu') return open('https://www.bmvr.marseille.fr/en-ligne'); // accès par clic depuis le site de la BMVR
  // Retronews ne reconnaît la bibliothèque que si le clic part d'une page de bmvr.marseille.fr (contrôle du site d'origine) : même principe que Marsactu.
  if (it.name === 'Retronews') return open(/^https:\/\/www\.bmvr\.marseille\.fr\/notice\?id=/.test(it.url) ? it.url : 'https://www.bmvr.marseille.fr/en-ligne');
  if (it.kind !== 'sso') return open(it.url);
  if (!hasCreds()) { location.hash = '#compte'; return; }
  const strong = tile.querySelector('strong'), label = strong.textContent; tile.disabled = true; strong.textContent = label + '…';
  try {
    const r = await fetch(RELAY + '/service', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: store.get('user'), password: store.get('pass'), ...(SVC_KEYS[it.name] ? { service: SVC_KEYS[it.name] } : { url: it.url }) }) });
    const data = await r.json();
    if (r.status === 401) { signOut(); location.hash = '#compte'; $('err').textContent = data.error || 'Identifiants refusés par la BMVR.'; return; }
    if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
    location.assign(data.url);
  } catch (e) {
    // Connexion automatique impossible : on ouvre la page du service (ou celle de la BMVR) pour se connecter comme sur le site.
    err.textContent = `${it.name} : connexion automatique impossible (${e.message}). Ouverture de la page du service.`;
    open(it.external ? it.url : 'https://www.bmvr.marseille.fr/en-ligne');
  } finally { tile.disabled = false; strong.textContent = label; }
}
function drawServices(data) {
  const box = $('svcHome'); box.replaceChildren();
  const pins = readPins();
  const all = data.sections.flatMap((x) => x.items.map((it) => ({ ...it, theme: x.title })));
  const tileOf = (it) => {
    const wrap = el('div', 'tile-wrap');
    const t = el('button', 'tile service'); t.append(el('span', 'ico', SVC_ICON[it.theme] || '🌐'), el('strong', '', it.name), el('small', '', it.name === 'Marsactu' ? 'Journal local · via le site BMVR' : it.name === 'Retronews' ? 'Presse ancienne · via le site BMVR' : shortDesc(it.desc)));
    t.onclick = () => openServiceItem(it, t);
    const on = pins.includes(it.name);
    const pin = el('button', 'pin' + (on ? ' on' : ''), on ? '★' : '☆'); pin.setAttribute('aria-label', (on ? 'Désépingler ' : 'Épingler ') + it.name); pin.setAttribute('aria-pressed', String(on));
    pin.onclick = (e) => { e.stopPropagation(); writePins(on ? pins.filter((n) => n !== it.name) : [...pins, it.name]); drawServices(data); };
    wrap.append(t, pin); return wrap;
  };
  const section = (title, items) => { if (!items.length) return; box.append(el('h3', 'sec-t', title)); const g = el('div', 'tiles'); g.append(...items.map(tileOf)); box.append(g); };
  section('⭐ Épinglés', pins.map((n) => all.find((it) => it.name === n)).filter(Boolean));
  for (const sec of data.sections) section(`${SVC_ICON[sec.title] || '🌐'} ${sec.title}`, all.filter((it) => it.theme === sec.title && !pins.includes(it.name)));
}
async function renderServicesHome() {
  const box = $('svcHome'); if (!box) return;
  if (!hasCreds()) { box.replaceChildren(); return; }
  let cached = null; try { cached = JSON.parse(store.get('svcCache') || 'null'); } catch {}
  if (cached?.sections) drawServices(cached); else box.textContent = 'Chargement des services…';
  try {
    const d = await call('/services'); store.set('svcCache', JSON.stringify(d)); drawServices(d);
  } catch (e) { if (!cached) box.textContent = 'Services indisponibles pour le moment : ' + e.message; }
}

// Nouveautés : documents marqués comme nouveautés par les bibliothèques.
async function showNouveautes(body, status) {
  const F = { branch: '', type: '', avail: false, page: 1, items: [], busy: false };
  const bar = el('div', 'tools'); const list = el('ul', 'cards'); const more = el('button', 'secondary', 'Voir plus de nouveautés'); more.hidden = true;
  body.append(bar, list, more);
  let facets = null;
  const load = async (append) => {
    if (F.busy) return; F.busy = true;
    if (!append) { F.page = 1; F.items = []; list.replaceChildren(); } else F.page += 1;
    status.textContent = 'Chargement des nouveautés…'; more.disabled = true;
    try {
      const d = await call('/nouveautes', { branch: F.branch, type: F.type, avail: F.avail, page: F.page });
      if (d.branches?.length && !facets) { facets = d; paintBar(); }
      const known = new Set(F.items.map((x) => x.id)); const add = d.results.filter((x) => !known.has(x.id));
      F.items.push(...add); list.append(...add.map((it) => searchCard(it)));
      more.hidden = !(d.results.length >= 20 && F.page < 10);
      status.textContent = F.items.length ? `${d.total} nouveauté${d.total > 1 ? 's' : ''} · du plus récent au plus ancien` : 'Aucune nouveauté avec ces filtres.';
    } catch (e) { if (append) F.page -= 1; status.textContent = 'Impossible de charger les nouveautés : ' + e.message; }
    finally { F.busy = false; more.disabled = false; }
  };
  const paintBar = () => {
    bar.replaceChildren();
    const row1 = el('div', 'frow'); const row2 = el('div', 'frow');
    const ch = el('button', 'fchip' + (F.avail ? ' on' : ''), '✓ Disponible'); ch.onclick = () => { F.avail = !F.avail; paintBar(); load(false); }; row1.append(ch);
    const sel = (label, value, opts, fn) => { const x = el('select', 'fsel'); x.append(new Option(label, '')); for (const o of opts) x.append(new Option(o.label + (o.count ? ` (${o.count})` : ''), o.value)); x.value = value; x.onchange = () => fn(x.value); return x; };
    const br = (facets?.branches || []).filter((b) => b.label && b.label.length < 40);
    const ty = facets?.types || [];
    if (br.length) row2.append(sel('Toutes les bibliothèques', F.branch, br, (v) => { F.branch = v; load(false); }));
    if (ty.length) row2.append(sel('Tous les types', F.type, ty, (v) => { F.type = v; load(false); }));
    bar.append(row1, row2);
  };
  paintBar(); more.onclick = () => load(true); await load(false);
}


// ---------- Agenda des bibliothèques ----------
const AG_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const AG_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const isoUTC = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const isoAdd = (iso, n) => { const t = isoUTC(iso); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dayLabel = (iso, today) => {
  const t = isoUTC(iso); const name = AG_DAYS[t.getUTCDay()];
  const lab = `${name[0].toUpperCase()}${name.slice(1)} ${t.getUTCDate()} ${AG_MONTHS[t.getUTCMonth()]}${iso.slice(0, 4) !== today.slice(0, 4) ? ' ' + iso.slice(0, 4) : ''}`;
  return iso === today ? `Aujourd’hui · ${lab}` : iso === isoAdd(today, 1) ? `Demain · ${lab}` : lab;
};
const agNorm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function icsDownload(ev, date, start, end) {
  const d = date.replace(/-/g, ''); const t = (h) => (h && /^\d{1,2}:\d{2}$/.test(h) ? h.padStart(5, '0').replace(':', '') + '00' : '');
  const esc = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const s = t(start), e = t(end) || s;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//appli-bmvr//FR', 'BEGIN:VEVENT', `UID:${d}-${Math.abs([...ev.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7))}@appli-bmvr`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}`, s ? `DTSTART:${d}T${s}` : `DTSTART;VALUE=DATE:${d}`, s ? `DTEND:${d}T${e}` : `DTEND;VALUE=DATE:${isoAdd(date, 1).replace(/-/g, '')}`,
    `SUMMARY:${esc(ev.title)}`, `LOCATION:${esc([ev.library, ev.address].filter(Boolean).join(' – '))}`, `DESCRIPTION:${esc((ev.description || '').slice(0, 600))}`, 'END:VEVENT', 'END:VCALENDAR'];
  const a = el('a'); a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' })); a.download = 'evenement.ics';
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}


// ---------- Mes événements (liste personnelle, stockée sur l'appareil) ----------
const parisNow = () => {
  const n = new Date();
  return { day: n.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }), time: n.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }) };
};
// Un événement est fini quand sa date est passée, ou, le jour même, quand son heure de fin est passée (par défaut : début + 2 h).
const agFinished = (x, now = parisNow()) => {
  if (x.date < now.day) return true;
  if (x.date > now.day) return false;
  let end = x.end;
  if (!/^\d{1,2}:\d{2}$/.test(end || '')) { const m = /^(\d{1,2}):(\d{2})$/.exec(x.hour || ''); end = m ? `${String(Math.min(23, Number(m[1]) + 2)).padStart(2, '0')}:${m[2]}` : '23:59'; }
  return now.time > end.padStart(5, '0');
};
const agKey = (x) => `${x.id}|${x.date}`;
function agList() {
  let all = []; try { all = JSON.parse(store.get('agendaList') || '[]'); } catch { all = []; }
  const now = parisNow(); const live = all.filter((x) => x && x.id && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') && !agFinished(x, now));
  if (live.length !== all.length) store.set('agendaList', JSON.stringify(live));
  return live.sort((a, b) => a.date.localeCompare(b.date) || (a.hour || '').localeCompare(b.hour || ''));
}
const agHas = (id, date) => agList().some((x) => agKey(x) === `${id}|${date}`);
function agToggle(e, date) {
  const list = agList(); const k = `${e.id}|${date}`;
  if (list.some((x) => agKey(x) === k)) { store.set('agendaList', JSON.stringify(list.filter((x) => agKey(x) !== k))); syncNotifEvents(); return false; }
  list.push({ id: e.id, date, title: e.title, library: e.library || '', hour: e.hour || '', end: e.endHour || e.end || '', kind: e.kind || '', audience: e.audience || '', image: e.image || '' });
  store.set('agendaList', JSON.stringify(list)); syncNotifEvents(); return true;
}
function starBtn(e, date, onChange) {
  const b = el('button', 'ag-star'); const paint = () => { const on = agHas(e.id, date); b.textContent = on ? '★' : '☆'; b.classList.toggle('on', on); b.title = b.ariaLabel = on ? 'Retirer de ma liste' : 'Ajouter à ma liste'; };
  paint(); b.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); agToggle(e, date); paint(); onChange?.(); }; return b;
}

function showMyEvents(body, status) {
  const today = parisNow().day;
  const draw = () => {
    body.replaceChildren();
    const list = agList();
    const go = el('button', 'secondary', '📅 Parcourir l’agenda'); go.onclick = () => { location.hash = '#espace/agenda'; }; body.append(go);
    if (!list.length) { body.append(emptyState('⭐', 'Aucun événement dans votre liste', 'Dans l’agenda, touchez l’étoile d’un événement pour l’ajouter. Il disparaît de la liste quand il est terminé.')); status.textContent = ''; return; }
    status.textContent = `${list.length} événement${list.length > 1 ? 's' : ''} à venir`;
    let cur = '', ul = null;
    for (const x of list) {
      if (x.date !== cur) { cur = x.date; body.append(el('h3', 'ag-day', dayLabel(cur, today))); ul = el('ul', 'cards'); body.append(ul); }
      const li = el('li', 'card ag-card');
      if (x.image) { const im = el('img', 'ag-thumb'); im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.src = x.image; im.onerror = () => im.remove(); li.append(im); }
      const t = el('div', 'ag-body');
      const h = el('h3'); const a = el('a', 'doc-link', x.title); a.href = '#espace'; a.onclick = (ev) => { ev.preventDefault(); showAgendaEvent(body, status, x, draw, today); }; h.append(a);
      t.append(h, el('p', 'ag-meta', [x.hour && (x.end ? `${x.hour}–${x.end}` : x.hour), x.library].filter(Boolean).join(' · ')));
      const ka = [x.kind, x.audience].filter(Boolean).join(' · '); if (ka) t.append(el('p', 'ag-ka', ka));
      const rm = el('button', 'ag-rm', 'Retirer de ma liste'); rm.onclick = () => { agToggle(x, x.date); draw(); }; t.append(rm);
      li.append(t); ul.append(li);
    }
  };
  draw();
}

async function showAgendaEvent(body, status, item, back, today) {
  body.replaceChildren(); status.textContent = 'Chargement de l’événement…';
  const b = el('button', 'secondary', '← Retour à l’agenda'); b.onclick = back; body.append(b);
  try {
    const ev = await call('/agenda-event', { id: item.id });
    status.textContent = '';
    const card = el('div', 'card ag-detail');
    const img = ev.image || item.image;
    if (img) { const im = el('img', 'ag-img'); im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.src = img; im.onerror = () => im.remove(); card.append(im); }
    const pad = el('div', 'ag-pad'); card.append(pad);
    pad.append(el('h2', 'ag-title', ev.title || item.title));
    const rowsEl = el('dl', 'ag-rows');
    const add = (k, v) => { if (!v) return null; const dt = el('dt', '', k); const dd = el('dd'); if (typeof v === 'string') dd.textContent = v; else dd.append(v); rowsEl.append(dt, dd); return dd; };
    const up = (ev.dates || []).filter((d) => d.date >= today);
    const dl = el('div');
    for (const d of up.slice(0, 8)) { const row = el('div', 'ag-dateRow'); row.append(el('span', '', `${dayLabel(d.date, today)}${d.start ? ' · ' + d.start + (d.end ? '–' + d.end : '') : ''}`), starBtn({ ...ev, id: item.id, hour: d.start || ev.hour, endHour: d.end || ev.endHour, image: ev.image || item.image }, d.date)); dl.append(row); }
    if (up.length > 8) dl.append(el('div', 'muted', `… et ${up.length - 8} autre${up.length - 8 > 1 ? 's' : ''} date${up.length - 8 > 1 ? 's' : ''}`));
    add(up.length > 1 ? 'Dates' : 'Quand', up.length ? dl : (ev.when ? ev.when + (ev.hour ? ' · ' + ev.hour : '') : ''));
    const where = el('div'); if (ev.library) where.append(el('div', '', ev.library + (ev.espace ? ' · ' + ev.espace : '')));
    if (ev.address) { const a = el('a', '', ev.address); a.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${ev.library} ${ev.address}`); a.target = '_blank'; a.rel = 'noopener noreferrer'; where.append(a); }
    add('Où', where.childNodes.length ? where : '');
    add('Type', ev.kind); add('Public', ev.audience); add('Pôle', ev.department); add('Condition', ev.condition);
    const ct = el('div');
    if (ev.phone) { const a = el('a', '', ev.phone); a.href = 'tel:' + ev.phone.replace(/[^\d+]/g, ''); ct.append(a); }
    if (ev.email) { const a = el('a', '', ev.email); a.href = 'mailto:' + ev.email; ct.append(a); }
    add('Inscription / contact', ct.childNodes.length ? ct : '');
    pad.append(rowsEl);
    if (ev.description) for (const para of ev.description.split(/\n{2,}/)) { const p = el('p', 'ag-desc'); p.textContent = para; pad.append(p); }
    const btns = el('div', 'btn-row');
    if (up.length) { const c = el('button', 'secondary', '📅 Ajouter au calendrier'); c.onclick = () => icsDownload(ev, up[0].date, up[0].start || ev.hour, up[0].end || ev.endHour); btns.append(c); }
    if (navigator.share) { const sh = el('button', 'secondary', 'Partager'); sh.onclick = () => navigator.share({ title: ev.title, text: `${ev.title} – ${ev.when || ''} ${ev.hour || ''} – ${ev.library || ''}`.replace(/\s+/g, ' ') }).catch(() => {}); btns.append(sh); }
    pad.append(btns); body.append(card);
  } catch (e) { status.textContent = 'Impossible de charger l’événement : ' + e.message; }
}

async function showAgenda(body, status) {
  status.textContent = 'Chargement de l’agenda…';
  let data;
  try { data = await call('/agenda'); } catch (e) { status.textContent = 'Impossible de charger l’agenda : ' + e.message; return; }
  const today = data.from;
  const F = { period: 'all', day: '', lib: '', kind: '', aud: '', dep: '', q: '', regular: false, days: 14, detail: false };
  const REG = 10; // au-delà de 10 dates à venir : « rendez-vous régulier »
  const draw = () => {
    body.replaceChildren();
    const bar = el('div', 'tools'); const r1 = el('div', 'frow'); const r2 = el('div', 'frow');
    const wd = isoUTC(today).getUTCDay(); const sat = isoAdd(today, wd === 0 ? 0 : 6 - wd);
    const PERIODS = [['all', 'Tout'], ['today', 'Aujourd’hui'], ['tomorrow', 'Demain'], ['weekend', 'Ce week-end'], ['week', '7 jours'], ['month', '30 jours']];
    for (const [k, l] of PERIODS) { const c = el('button', 'fchip' + (F.period === k ? ' on' : ''), l); c.onclick = () => { F.period = k; F.day = ''; F.days = 14; draw(); }; r1.append(c); }
    const fld = (label, ctl) => { const w = el('label', 'ag-fld'); w.append(el('span', '', label), ctl); return w; };
    const mine = el('button', 'fchip', `⭐ Ma liste (${agList().length})`); mine.id = 'agMine'; mine.onclick = () => { location.hash = '#espace/mesevenements'; }; r1.append(mine);
    const di = el('input', 'fsel'); di.type = 'date'; di.min = today; di.value = F.day;
    di.onchange = () => { F.day = di.value; F.period = di.value ? 'day' : 'all'; F.days = 14; draw(); };
    const sel = (label, value, opts, fn) => { const x = el('select', 'fsel'); x.append(new Option(label, '')); for (const o of opts) x.append(new Option(o, o)); x.value = value; x.onchange = () => fn(x.value); return x; };
    const q = el('input', 'fsel'); q.type = 'search'; q.placeholder = 'Titre, lieu, mot-clé…'; q.value = F.q;
    q.onkeydown = (e) => { if (e.key === 'Enter') { F.q = q.value.trim(); F.days = 14; draw(); } };
    q.onchange = () => { F.q = q.value.trim(); F.days = 14; draw(); };
    r2.className = 'ag-form';
    r2.append(fld('📅 Choisir un jour précis', di), fld('🏛️ Bibliothèque', sel('Toutes les bibliothèques', F.lib, data.libraries, (v) => { F.lib = v; F.days = 14; draw(); })), fld('🎭 Type d’événement', sel('Tous les types', F.kind, data.kinds || [], (v) => { F.kind = v; F.days = 14; draw(); })), fld('👥 Public', sel('Tous les publics', F.aud, data.audiences || [], (v) => { F.aud = v; F.days = 14; draw(); })), fld('🗂️ Pôle', sel('Tous les pôles', F.dep, data.departments || [], (v) => { F.dep = v; F.days = 14; draw(); })), fld('🔎 Recherche', q));
    if (F.day) { const x = el('button', 'fchip', `Jour choisi : ${dayLabel(F.day, today)} ✕`); x.onclick = () => { F.day = ''; F.period = 'all'; draw(); }; r1.append(x); }
    bar.append(r1, r2); body.append(bar);

    const [from, to] = F.period === 'today' ? [today, today] : F.period === 'tomorrow' ? [isoAdd(today, 1), isoAdd(today, 1)] : F.period === 'weekend' ? [wd === 0 ? today : sat, wd === 0 ? today : isoAdd(sat, 1)] : F.period === 'week' ? [today, isoAdd(today, 6)] : F.period === 'month' ? [today, isoAdd(today, 29)] : F.period === 'day' && F.day ? [F.day, F.day] : [today, '9999-12-31'];
    const nq = agNorm(F.q);
    const ok = (e) => (!F.lib || e.library === F.lib) && (!F.kind || e.kind === F.kind) && (!F.aud || e.audience === F.aud) && (!F.dep || e.department === F.dep) && (!nq || agNorm(`${e.title} ${e.library} ${e.espace} ${e.kind || ''} ${e.audience || ''} ${e.department || ''}`).includes(nq));
    const evs = data.events.filter(ok);
    const regular = evs.filter((e) => e.dates.length > REG);
    const occ = [];
    for (const e of evs) { if (e.dates.length > REG && !F.regular) continue; for (const d of e.dates) if (d >= from && d <= to) occ.push({ d, e }); }
    occ.sort((a, b) => a.d.localeCompare(b.d) || (a.e.hour || '99').localeCompare(b.e.hour || '99') || a.e.title.localeCompare(b.e.title, 'fr'));
    const days = [...new Set(occ.map((o) => o.d))];
    const list = el('div', 'ag-list'); body.append(list);
    const open = (e) => { F.detail = true; showAgendaEvent(body, status, e, () => { F.detail = false; status.textContent = ''; draw(); }, today); };
    for (const d of days.slice(0, F.days)) {
      list.append(el('h3', 'ag-day', dayLabel(d, today)));
      const ul = el('ul', 'cards');
      for (const { e } of occ.filter((o) => o.d === d)) {
        const li = el('li', 'card ag-card');
        if (e.image) { const im = el('img', 'ag-thumb'); im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.src = e.image; im.onerror = () => im.remove(); li.append(im); }
        const t = el('div', 'ag-body');
        const h = el('h3'); const a = el('a', 'doc-link', e.title); a.href = '#espace'; a.onclick = (ev) => { ev.preventDefault(); open(e); }; h.append(a);
        t.append(h, el('p', 'ag-meta', [e.hour, e.library, e.espace].filter(Boolean).join(' · ')));
        const more = e.dates.filter((x) => x > d).length;
        const ka = [e.kind, e.audience].filter(Boolean).join(' · '); if (ka) t.append(el('p', 'ag-ka', ka));
        if (e.dates.length > REG) t.append(el('p', 'ag-tag', 'Rendez-vous régulier'));
        else if (more) t.append(el('p', 'ag-tag', `+ ${more} autre${more > 1 ? 's' : ''} date${more > 1 ? 's' : ''}`));
        li.append(t, starBtn(e, d, () => { const c = document.getElementById('agMine'); if (c) c.textContent = `⭐ Ma liste (${agList().length})`; })); ul.append(li);
      }
      list.append(ul);
    }
    if (days.length > F.days) { const m = el('button', 'secondary', `Voir les jours suivants (${days.length - F.days} de plus)`); m.onclick = () => { F.days += 14; draw(); }; body.append(m); }
    if (regular.length && !F.regular) { const m = el('button', 'secondary', `Afficher les rendez-vous réguliers (${regular.length})`); m.onclick = () => { F.regular = true; draw(); }; body.append(m); }
    else if (F.regular) { const m = el('button', 'secondary', 'Masquer les rendez-vous réguliers'); m.onclick = () => { F.regular = false; draw(); }; body.append(m); }
    const n = new Set(occ.map((o) => o.e.id)).size;
    status.textContent = (occ.length ? `${n} événement${n > 1 ? 's' : ''} · ${days.length} jour${days.length > 1 ? 's' : ''}` : 'Aucun événement avec ces filtres.') + (data.pending ? ` · types et publics en cours de chargement (${data.total - data.pending}/${data.total})` : '');
  };
  draw();
  // Types, publics et pôles arrivent par paquets : on rafraîchit sans déranger (pas pendant la lecture d'une fiche).
  for (let i = 0; data.pending && i < 8 && body.isConnected; i++) {
    try { data = await call('/agenda'); } catch { break; }
    if (!body.isConnected || F.detail) { if (F.detail) { i--; await new Promise((r) => setTimeout(r, 1500)); } continue; }
    const y = window.scrollY; draw(); window.scrollTo(0, y);
  }
}

// Normalisation des noms de bibliothèque (« Bibliothèque de l'Alcazar » ≈ « Alcazar »).
const normBranch = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/biblioth[a-z]*|ludoth[a-z]*|\b(de|la|le|les|du|des|l|d)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
const sameBranch = (a, b) => { const x = normBranch(a), y = normBranch(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

// Où aller aujourd'hui : livres de vos listes (hors « Déjà lu ») disponibles, et bibliothèques ouvertes.
async function showAujourdhui(body, status) {
  status.textContent = 'Lecture de vos listes…';
  try {
    const { baskets } = await call('/basket', { action: 'list' });
    const defaults = baskets.filter((b) => b.isDefault);
    const skip = new Set(defaults.length >= 3 ? [defaults[2].id] : []); // 3e liste standard = Déjà lu
    const lists = baskets.filter((b) => b.count && !skip.has(b.id)).slice(0, 6);
    if (!lists.length) { status.textContent = ''; body.append(emptyState('♡', 'Aucune liste à parcourir', 'Ajoutez des livres à vos favoris ou à « À lire plus tard » avec le bouton ♡.')); return; }
    const seen = new Map();
    for (const [i, b] of lists.entries()) {
      status.textContent = `Stock de « ${b.name} » (${i + 1}/${lists.length})…`;
      try { for (const it of (await call('/basket', { action: 'content', basketId: b.id })).results) if (!seen.has(it.id)) seen.set(it.id, { ...it, list: b.name }); } catch { /* une liste en échec n'arrête pas les autres */ }
    }
    const items = [...seen.values()];
    const avail = items.filter((it) => it.copiesAvailable > 0);
    let hours = null; try { hours = await call('/horaires'); } catch { /* sans horaires, on classe par nombre de livres */ }
    const now = new Date(); const di = (now.getDay() + 6) % 7;
    const rowsH = hours?.sections?.flatMap((x) => x.rows) || [];
    const stateOf = (branch) => { const r = rowsH.find((x) => sameBranch(x.name, branch)); if (!r || di > 5) return null; return openState(r.hours[di], now); };
    const byBranch = new Map();
    for (const it of avail) for (const c of it.copies || []) if (c.available && !c.held) { const k = c.branch || 'Bibliothèque'; if (!byBranch.has(k)) byBranch.set(k, new Map()); byBranch.get(k).set(it.id, it); }
    const ranked = [...byBranch].map(([name, m]) => ({ name, items: [...m.values()], st: stateOf(name) })).sort((a, b) => ({ open: 0, soon: 1 }[a.st?.[0]] ?? 2) - ({ open: 0, soon: 1 }[b.st?.[0]] ?? 2) || b.items.length - a.items.length);
    status.textContent = `${avail.length} livre${avail.length > 1 ? 's' : ''} de vos listes disponible${avail.length > 1 ? 's' : ''} sur ${items.length}`;
    if (!avail.length) { body.append(emptyState('⏳', 'Rien de disponible pour le moment', 'Aucun livre de vos listes n’est en rayon. Réservez-les depuis la liste pour passer en priorité.')); return; }
    const best = ranked.find((r) => r.st && (r.st[0] === 'open' || r.st[0] === 'soon'));
    if (best) { const hint = el('div', 'card infos'); hint.append(el('strong', '', `🎯 ${best.name}`), el('p', '', `${best.items.length} livre${best.items.length > 1 ? 's' : ''} de vos listes en rayon · ${best.st[1]}.`)); body.append(hint); }
    for (const r of ranked) {
      const sec = el('div'); const h = el('h3', 'sec-t', r.name);
      const meta = el('div', 'frow'); meta.append(el('span', 'chip good', `${r.items.length} disponible${r.items.length > 1 ? 's' : ''}`)); if (r.st) meta.append(el('span', 'ostate ' + r.st[0], r.st[1]));
      const ul = el('ul', 'cards'); for (const it of r.items) ul.append(searchCard(it));
      sec.append(h, meta, ul); body.append(sec);
    }
  } catch (e) { status.textContent = 'Impossible de lire vos listes : ' + e.message; }
}

// Recherches sauvegardées du compte.
async function showSavedSearches(body, status) {
  status.textContent = 'Chargement de vos recherches…';
  try {
    const { items } = await call('/saved-searches', { action: 'list' });
    status.textContent = ''; body.replaceChildren();
    if (!items.length) { body.append(emptyState('🔎', 'Aucune recherche sauvegardée', 'Lancez une recherche puis touchez « Sauvegarder cette recherche ».')); return; }
    const ul = el('ul', 'cards');
    for (const it of items) {
      const li = el('li', 'card'); li.append(el('h3', '', it.label || it.query || 'Recherche'));
      if (it.date) li.append(el('p', 'hint', 'Enregistrée le ' + longDate(it.date)));
      const row = el('div', 'btn-row');
      const run = el('button', 'primary small', 'Relancer'); run.onclick = () => goSearch(it.query || it.label);
      const del = el('button', 'secondary small danger', 'Supprimer');
      del.onclick = async () => { if (!confirm('Supprimer cette recherche sauvegardée ?')) return; del.disabled = true; try { await call('/saved-searches', { action: 'delete', id: it.id }); li.remove(); } catch (e) { del.disabled = false; status.textContent = e.message; } };
      if (it.query || it.label) row.append(run); if (it.id) row.append(del); li.append(row); ul.append(li);
    }
    body.append(ul);
  } catch (e) { status.textContent = 'Impossible de charger les recherches : ' + e.message; }
}

async function openEspace(kind) {
  const body = $('espaceBody'), status = $('espaceStatus');
  $('back').hidden = !kind;
  if (!kind) return espaceMenu(body, status);
  espaceKind = kind;
  body.replaceChildren(); status.textContent = '';
  if (!hasCreds()) return needLogin(body, status);
  if (espaceKind === 'favoris') return showBaskets(body, status);
  if (espaceKind === 'bibliotheques') return showLibraries(body, status);
  if (espaceKind === 'nouveautes') return showNouveautes(body, status);
  if (espaceKind === 'agenda') return showAgenda(body, status);
  if (espaceKind === 'mesevenements') return showMyEvents(body, status);
  if (espaceKind === 'aujourdhui') return showAujourdhui(body, status);
  if (espaceKind === 'recherches') return showSavedSearches(body, status);
  status.textContent = 'Chargement…';
  try {
    const d = await call('/account', { kind: espaceKind });
    if (espaceKind === 'profile' && d.profile && (d.profile.name || d.profile.sections.length)) {
      const pr = d.profile;
      const hero = el('div', 'profile-hero');
      const initials = (pr.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
      hero.append(el('div', 'avatar', initials));
      const info = el('div', 'profile-id'); info.append(el('h3', '', pr.name || 'Mon profil'));
      if (pr.subtitle) info.append(el('p', '', pr.subtitle));
      if (pr.card) info.append(el('p', 'hint', 'Carte n° ' + pr.card));
      hero.append(info); body.append(hero);
      for (const sec of pr.sections) {
        const card = el('div', 'card profile-sec'); card.append(el('h4', '', sec.title));
        const r = rows(sec.rows); if (r) card.append(r);
        body.append(card);
      }
      status.textContent = '';
      return;
    }
    const ul = el('ul', 'cards');
    const items = d.items.filter((it) => it.title || it.fields.length);
    if (!items.length) { ul.append(EMPTY[espaceKind] ? emptyState(...EMPTY[espaceKind]) : emptyState('📭', 'Rien à afficher', '')); }
    const seen = espaceKind === 'messages' ? seenSet() : null;
    for (const it of items) {
      const li = espaceKind === 'messages' ? messageCard(it, !seen.has(it.id)) : plainCard(it);
      if (espaceKind === 'loanhistory') { addFavButton(li, it); enrichHistory(li, it); }
      if (seen && !seen.has(it.id) && espaceKind !== 'messages') { li.classList.add('unread'); const h = li.querySelector('h3'); if (h) h.before(el('span', 'chip good new-chip', 'Nouveau')); }
      ul.append(li);
    }
    if (seen) { items.forEach((it) => seen.add(it.id)); saveSeen(seen); store.set('msgCache', JSON.stringify({ at: Date.now(), items: items.map((m) => ({ id: m.id, title: m.title, date: m.date })) })); updateEspaceBadge(); }
    body.append(ul); status.textContent = ESPACE[espaceKind];
    if (!items.length || items.every((it) => !it.fields.length)) {
      const b = el('button', 'link', 'Rien de lisible : envoyer un diagnostic'); const pre = el('pre'); pre.hidden = true;
      b.onclick = async () => { pre.hidden = false; pre.textContent = 'Diagnostic en cours…'; try { const g = await call('/account', { kind: espaceKind, debug: true }); pre.textContent = JSON.stringify({ shape: g.shape, propertyNames: g.propertyNames }, null, 1); } catch (e) { pre.textContent = 'Erreur : ' + e.message; } };
      body.append(b, pre);
    }
  } catch (e) { status.textContent = 'Impossible de charger : ' + e.message; }
}

// ---------- compte ----------
function signOut() { removeActiveProfile(); updateBadge(); updateEspaceBadge(); }

let addingAccount = false;
function renderAccount() {
  const on = hasCreds();
  $('loginBox').hidden = on && !addingAccount;
  $('accountBox').hidden = !on;
  $('who').textContent = store.get('user');
  const box = $('profilesBox'); box.replaceChildren();
  const list = getProfiles();
  if (list.length) {
    box.append(el('h2', '', list.length > 1 ? 'Comptes sur cet appareil' : 'Compte'));
    const ul = el('ul', 'accounts');
    for (const pr of list) {
      const li = el('li', pr.id === activeId() ? 'on' : '');
      const av = el('span', 'avatar'); paintAvatar(av, pr.user);
      li.append(av, el('span', 'acc-name', pr.user));
      if (pr.mode === 'restricted') li.append(el('span', 'chip warn', 'Restreint'));
      if (pr.pin) li.append(el('span', 'chip', '🔑 Code'));
      if (pr.id === activeId()) li.append(el('span', 'chip good', 'Actif'));
      else { li.classList.add('tap'); li.tabIndex = 0; li.setAttribute('role', 'button'); li.append(el('span', 'acc-go', 'Utiliser ›')); li.onclick = () => switchProfile(pr.id); li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchProfile(pr.id); } }; }
      ul.append(li);
    }
    box.append(ul);
    if (isRestricted()) box.append(el('p', 'hint', '🔒 Compte à accès restreint : seul un compte à accès complet peut ajouter, modifier ou retirer des comptes.'));
    else if (!addingAccount) {
      const act = list.find((x) => x.id === activeId()); if (act) box.append(accessPanel(act));
      const others = list.filter((x) => x.id !== activeId());
      if (others.length) { const d = el('details', 'others'); d.append(el('summary', 'acc-sum', `Gérer l’accès des autres comptes (${others.length})`)); for (const pr of others) d.append(accessPanel(pr)); box.append(d); }
    }
    if (!addingAccount && !isRestricted()) { const add = el('button', 'secondary', '➕ Ajouter un autre compte'); add.onclick = () => { addingAccount = true; renderAccount(); }; box.append(add); }
  }
  if (on && !addingAccount) notifPanel().then((c) => { if (c && !box.querySelector('.notif')) box.append(c); });
  $('diag').hidden = !on; $('diagSearch').hidden = !on; $('diagMars').hidden = !on;
  $('reset').hidden = isRestricted();
  if (isRestricted()) { addingAccount = false; $('loginBox').hidden = on; }
}

{ const pi = $('pass'); if (pi && !$('passEye')) { const b = el('button', 'pw-eye', '👁️'); b.id = 'passEye'; b.type = 'button'; b.title = b.ariaLabel = 'Afficher le mot de passe'; b.onclick = () => { const on = pi.type === 'password'; pi.type = on ? 'text' : 'password'; b.textContent = on ? '🙈' : '👁️'; }; pi.parentElement.append(b); } }
$('save').onclick = () => {
  if (isRestricted()) { $('err').textContent = 'Accès restreint : impossible d’ajouter un compte.'; return; }
  const u = $('user').value.trim(), p = $('pass').value;
  if (!u || !p) { $('err').textContent = 'Saisissez votre identifiant et votre mot de passe.'; return; }
  addProfile(u, p); addingAccount = false; renderUserChip();
  $('user').value = ''; $('pass').value = ''; $('err').textContent = '';
  location.hash = '#prets';
};
$('reset').onclick = () => { if (isRestricted()) return; if (!confirm('Retirer ce compte de cet appareil ?')) return; signOut(); location.hash = '#accueil'; location.reload(); };
$('sync').onclick = () => (location.hash === '#resa' ? openReservations() : openLoans());
$('diagSearch').onclick = async () => {
  $('diagOut').hidden = false; $('diagOut').textContent = 'Diagnostic en cours…';
  try { const d = await call('/search', { query: 'histoire de Marseille', debug: true }); $('diagOut').textContent = JSON.stringify({ firstKeys: d.firstKeys, metaKeys: d.metaKeys, shape: d.shape }, null, 1); } catch (e) { $('diagOut').textContent = 'Erreur : ' + e.message; }
};
$('diag').onclick = async () => {
  $('diagOut').hidden = false;
  $('diagOut').textContent = 'Diagnostic en cours…';
  try {
    const r = await fetch(RELAY + '/loans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: store.get('user'), password: store.get('pass'), diagnostic: true }) });
    $('diagOut').textContent = JSON.stringify(await r.json(), null, 1);
  } catch (e) { $('diagOut').textContent = 'Erreur : ' + e.message; }
};

// ---------- services en ligne ----------
// Le relais se connecte à la BMVR avec vos identifiants et renvoie l'adresse d'entrée du service (avec un ticket à usage
// unique) ; on l'ouvre aussitôt, dans la même fenêtre.
$('diagMars').onclick = async () => {
  $('diagOut').hidden = false; $('diagOut').textContent = 'Diagnostic Marsactu en cours…';
  try {
    const r = await fetch(RELAY + '/service', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: store.get('user'), password: store.get('pass'), service: 'marsactu', follow: true }) });
    const d = await r.json(); $('diagOut').textContent = (d.trace || []).join('\n') + (d.error ? '\nErreur : ' + d.error : '');
  } catch (e) { $('diagOut').textContent = 'Erreur : ' + e.message; }
};
document.querySelectorAll('.service').forEach((btn) => {
  btn.onclick = async () => {
    $('svcErr').textContent = '';
    // Marsactu n'ouvre son accès « bibliothèque » que pour un clic venant du site de la BMVR lui-même : on y envoie la personne,
    // elle touche Marsactu sur la page « En ligne » (connexion à la BMVR conservée par le navigateur après la première fois).
    if (btn.dataset.service === 'marsactu') { window.open('https://www.bmvr.marseille.fr/en-ligne', '_blank', 'noopener'); return; }
    if (!hasCreds()) { location.hash = '#compte'; return; }
    const strong = btn.querySelector('strong'), label = strong.textContent;
    btn.disabled = true; strong.textContent = label + '…';
    try {
      const r = await fetch(RELAY + '/service', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: store.get('user'), password: store.get('pass'), service: btn.dataset.service }) });
      const data = await r.json();
      store.set('lastTrace', (data.trace || []).join('\n'));
      if (r.status === 401) { signOut(); location.hash = '#compte'; $('err').textContent = data.error || 'Identifiants refusés par la BMVR.'; return; }
      if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
      location.assign(data.url);
    } catch (e) {
      $('svcErr').textContent = label + ' : ' + e.message + (store.get('lastTrace') ? '\n' + store.get('lastTrace') : '');
    } finally { btn.disabled = false; strong.textContent = label; }
  };
});

// ---------- mise à jour automatique ----------
// À chaque ouverture ou retour sur l'appli, on cherche une nouvelle version ; si elle existe, elle s'installe seule
// et la page se recharge une fois.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.update();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
  });
}

updateBadge();
updateEspaceBadge();
// Réglages d'accès du compte actif : complet ou restreint, code à 4 chiffres.

// ---------- notifications téléphone (Web Push, optionnelles) ----------
let notifCfg;
async function notifConfig() {
  if (notifCfg !== undefined) return notifCfg;
  try { const r = await fetch(RELAY + '/notif-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); notifCfg = r.ok ? await r.json() : { enabled: false }; } catch { notifCfg = { enabled: false }; }
  return notifCfg;
}
const notifSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
async function pushSub() { const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }
let syncTimer;
function syncNotifEvents() {
  if (store.get('notifOn') !== '1' || !notifSupported()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => { try { const sub = await pushSub(); if (sub) await call('/notif-update', { endpoint: sub.endpoint, events: agList(), label: notifLabel() }); } catch { /* sera resynchronisé plus tard */ } }, 1500);
}
const urlB64 = (b) => { const t = (b + '='.repeat((4 - (b.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'); const r = atob(t); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
// Plusieurs comptes sur un même téléphone : le nom du compte est ajouté au titre des notifications pour savoir de qui il s'agit.
const notifLabel = () => (getProfiles().length > 1 ? String(store.get('user') || '').split('@')[0].slice(0, 20) : '');
const NOTIF_TYPES = [['loans', '📚 Prêts à rendre (3 jours avant, veille, jour J, retard)'], ['resa', '🔖 Réservations (à retirer, rang qui avance)'], ['messages', '✉️ Nouveaux messages de la bibliothèque'], ['events', '📅 Événements de « Mes événements » (la veille, le matin même)']];
async function notifPanel() {
  const cfg = await notifConfig();
  if (!cfg.enabled || isRestricted()) return null;
  const card = el('div', 'card access notif'); card.append(el('h4', '', `🔔 Notifications de ${store.get('user') || 'ce compte'}`));
  const msg = el('p', 'hint'); const box = el('div');
  card.append(box, msg);
  const draw = async () => {
    box.replaceChildren(); msg.textContent = ''; msg.className = 'hint';
    if (!notifSupported()) { box.append(el('p', 'hint', 'Ce navigateur ne gère pas les notifications.')); return; }
    if (isIOS() && !isStandalone()) { box.append(el('p', 'hint', 'Sur iPhone, ajoutez d’abord l’appli à l’écran d’accueil (Partager → Sur l’écran d’accueil), puis rouvrez-la depuis l’icône.')); return; }
    let sub = null, st = { subscribed: false };
    try { sub = await pushSub(); if (sub) st = await call('/notif-status', { endpoint: sub.endpoint }); } catch (e) { msg.textContent = e.message; }
    if (st.subscribed) {
      store.set('notifOn', '1');
      box.append(el('p', '', `✓ Activées pour ${store.get('user') || 'ce compte'}.`));
      for (const [k, label] of NOTIF_TYPES) {
        const lb = el('label', 'notif-opt'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = st.prefs?.[k] !== false;
        cb.onchange = async () => { try { const prefs = { ...st.prefs, [k]: cb.checked }; const r = await call('/notif-update', { endpoint: sub.endpoint, prefs, events: agList(), label: notifLabel() }); st.prefs = r.prefs; } catch (e) { cb.checked = !cb.checked; msg.textContent = e.message; } };
        lb.append(cb, el('span', '', label)); box.append(lb);
      }
      const row = el('div', 'btn-row');
      const test = el('button', 'secondary small', 'Envoyer une notification de test'); test.onclick = async () => { test.disabled = true; try { const r = await call('/notif-test', { endpoint: sub.endpoint }); msg.textContent = r.ok ? 'Test envoyé : il doit arriver dans quelques secondes.' : 'Le test n’a pas pu être envoyé.'; } catch (e) { msg.textContent = e.message; } test.disabled = false; };
      const off = el('button', 'secondary small danger', 'Désactiver et effacer mes données');
      off.onclick = async () => {
        if (!confirm('Désactiver les notifications ? Votre identifiant et votre mot de passe seront effacés du relais.')) return;
        try { await call('/notif-unsubscribe', { endpoint: sub.endpoint }); store.del('notifOn'); if (!getProfiles().some((p) => raw.get(`p:${p.id}:notifOn`) === '1')) await sub.unsubscribe(); draw(); msg.textContent = 'Notifications désactivées. Vos identifiants ont été effacés du relais.'; } catch (e) { msg.textContent = e.message; }
      };
      row.append(test, off); box.append(row);
      return;
    }
    store.del('notifOn');
    box.append(el('p', 'hint', 'Recevez une alerte sur ce téléphone, même appli fermée : réservation à retirer, prêt à rendre, nouveau message, événement de votre liste (vérifié toutes les 3 heures environ).'));
    const on = el('button', 'primary small', 'Activer pour ce compte');
    on.onclick = async () => {
      if (!confirm('Pour vous prévenir même quand l’appli est fermée, le relais doit garder votre identifiant et votre mot de passe BMVR sur un serveur (chiffrés) et consulter votre compte quelques fois par jour (toutes les 3 heures environ, jamais la nuit).\n\nVous pouvez tout effacer à tout moment avec « Désactiver ». Activer les notifications ?')) return;
      on.disabled = true; msg.textContent = 'Activation…';
      try {
        if ((await Notification.requestPermission()) !== 'granted') throw new Error('Autorisation refusée : autorisez les notifications pour ce site dans les réglages du navigateur.');
        const reg = await navigator.serviceWorker.ready;
        const ps = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(cfg.publicKey) });
        await call('/notif-subscribe', { subscription: ps.toJSON(), prefs: { loans: true, resa: true, messages: true, events: true }, events: agList(), label: notifLabel() });
        store.set('notifOn', '1'); await draw();
      } catch (e) { on.disabled = false; msg.textContent = e.message; }
    };
    box.append(on);
  };
  draw();
  return card;
}
function accessPanel(pr) {
  const self = pr.id === activeId(); const card = el('div', 'card access');
  card.append(el('h4', '', self ? '🔐 Accès à ce compte' : '🔐 Accès de ' + pr.user));
  const seg = el('div', 'seg');
  const mk = (mode, txt) => { const b = el('button', 'seg-b' + ((pr.mode || 'full') === mode ? ' on' : ''), txt); b.onclick = async () => { if ((pr.mode || 'full') === mode) return; if (!await askCurrentPin(pr, msg, cur)) return; if (mode === 'restricted' && self && !confirm('Ce compte ne pourra plus ajouter ni modifier de comptes (c’est un autre compte à accès complet qui pourra le rétablir). Continuer ?')) return; patchProfile(pr.id, { mode }); renderAccount(); renderUserChip(); }; return b; };
  seg.append(mk('full', 'Accès complet'), mk('restricted', 'Accès restreint'));
  card.append(seg);
  card.append(el('p', 'hint', (pr.mode === 'restricted' ? 'Lecture seule : on peut consulter prêts, réservations, recherche et services, mais ni réserver, ni prolonger, ni annuler, ni supprimer un message, ni modifier les listes.' : 'Toutes les actions sur le compte BMVR sont possibles.') + (pr.mode === 'restricted' && !pr.pin ? ' Sans code, n’importe qui peut repasser en accès complet : ajoutez un code.' : '')));
  const msg = el('p', 'hint err');
  const cur = el('input'); cur.type = 'password'; cur.inputMode = 'numeric'; cur.maxLength = 4; cur.placeholder = 'Code actuel'; cur.autocomplete = 'off'; cur.className = 'pin-in'; cur.hidden = !pr.pin || !self;
  const neu = el('input'); neu.type = 'password'; neu.inputMode = 'numeric'; neu.maxLength = 4; neu.placeholder = pr.pin ? 'Nouveau code' : 'Code à 4 chiffres'; neu.autocomplete = 'off'; neu.className = 'pin-in';
  const save = el('button', 'secondary small', pr.pin ? 'Changer le code' : 'Définir un code');
  save.onclick = async () => {
    if (!/^\d{4}$/.test(neu.value)) { msg.textContent = 'Le code doit comporter exactement 4 chiffres.'; return; }
    if (!await askCurrentPin(pr, msg, cur)) return;
    patchProfile(pr.id, { pin: await pinHash(pr.id, neu.value) }); if (self) setUnlocked(pr.id); renderAccount();
  };
  const row = el('div', 'pin-row'); row.append(cur, neu, save); card.append(row);
  if (pr.pin) {
    const del = el('button', 'secondary small danger', 'Supprimer le code');
    del.onclick = async () => { if (!await askCurrentPin(pr, msg, cur)) return; patchProfile(pr.id, { pin: '' }); if (self) setUnlocked(''); renderAccount(); };
    card.append(del);
  }
  // Voir le mot de passe BMVR enregistré sur cet appareil (code du compte demandé s'il y en a un ; masqué après 15 s).
  const pw = el('div', 'pw-row'); const show = el('button', 'secondary small', '👁️ Voir le mot de passe'); const val = el('code', 'pw-val'); val.hidden = true;
  show.onclick = async () => {
    if (!val.hidden) { val.hidden = true; val.textContent = ''; show.textContent = '👁️ Voir le mot de passe'; return; }
    if (pr.pin) { const v = prompt(`Code à 4 chiffres de ${pr.user} :`) || ''; if (!/^\d{4}$/.test(v) || await pinHash(pr.id, v) !== pr.pin) { msg.textContent = 'Code incorrect.'; return; } msg.textContent = ''; }
    const pass = raw.get(`p:${pr.id}:pass`); if (!pass) { msg.textContent = 'Aucun mot de passe enregistré pour ce compte.'; return; }
    val.textContent = pass; val.hidden = false; show.textContent = '🙈 Masquer';
    setTimeout(() => { val.hidden = true; val.textContent = ''; show.textContent = '👁️ Voir le mot de passe'; }, 15000);
  };
  pw.append(show, val); card.append(pw);
  card.append(msg);
  return card;
}
async function askCurrentPin(pr, msgEl, curEl) {
  if (!pr.pin || pr.id !== activeId()) return true; // un compte à accès complet peut réinitialiser les autres comptes
  const v = curEl?.value || '';
  if (!/^\d{4}$/.test(v) || await pinHash(pr.id, v) !== pr.pin) { msgEl.textContent = 'Saisissez le code actuel (4 chiffres) pour modifier ces réglages.'; return false; }
  msgEl.textContent = ''; return true;
}

// Verrouillage : écran de saisie du code à l'ouverture et après 5 minutes passées en arrière-plan.
let hiddenAt = 0;
function renderLock() {
  const box = $('lock'); if (!box) return;
  if (!isLocked()) { box.hidden = true; box.replaceChildren(); document.body.classList.remove('is-locked'); return; }
  const pr = curProfile(); box.hidden = false; document.body.classList.add('is-locked'); box.replaceChildren();
  const av = el('span', 'avatar big'); paintAvatar(av, pr.user);
  const inp = el('input', 'pin-big'); inp.type = 'password'; inp.inputMode = 'numeric'; inp.maxLength = 4; inp.autocomplete = 'off'; inp.placeholder = '••••'; inp.setAttribute('aria-label', 'Code à 4 chiffres');
  const err = el('p', 'hint err');
  const fails = () => { try { return JSON.parse(raw.get('pinFails') || '{}'); } catch { return {}; } };
  inp.oninput = async () => {
    inp.value = inp.value.replace(/\D/g, '').slice(0, 4);
    if (inp.value.length < 4) return;
    const f = fails(); const wait = (f.until || 0) - Date.now();
    if (wait > 0) { err.textContent = `Trop d’essais : réessayez dans ${Math.ceil(wait / 1000)} s.`; inp.value = ''; return; }
    if (await pinHash(pr.id, inp.value) === pr.pin) { raw.del('pinFails'); setUnlocked(pr.id); renderLock(); go(); return; }
    const n = (f.n || 0) + 1; raw.set('pinFails', JSON.stringify(n >= 5 ? { n: 0, until: Date.now() + 30000 } : { n, until: 0 }));
    err.textContent = n >= 5 ? 'Trop d’essais : attendez 30 secondes.' : 'Code incorrect.'; inp.value = '';
  };
  box.append(av, el('strong', '', pr.user), el('p', 'hint', 'Entrez votre code à 4 chiffres'), inp, err);
  const others = getProfiles().filter((x) => x.id !== pr.id);
  if (others.length) { box.append(el('p', 'hint', 'Autre compte :')); for (const o of others) { const b = el('button', 'secondary small', o.user); b.onclick = () => switchProfile(o.id); box.append(b); } }
  setTimeout(() => inp.focus(), 50);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000 && curProfile()?.pin) { setUnlocked(''); renderLock(); }
});

// Accès restreint : les boutons qui modifient le compte BMVR sont masqués (le relais refuse de toute façon côté appli).
const WRITE_BTN = /(Réserver|Prolonger|Annuler la réservation|Supprimer|Oui, supprimer|Retirer|Favoris|Nouvelle liste|Renommer|Sauvegarder cette recherche)/;
function hideWrites(root) {
  if (!isRestricted() || !root?.querySelectorAll) return;
  const list = root.matches?.('button') ? [root] : root.querySelectorAll('button');
  for (const b of list) if (!b.closest('#view-compte, #lock') && !b.dataset.ro && WRITE_BTN.test(b.textContent)) { b.hidden = true; b.dataset.ro = '1'; }
  for (const b of root.querySelectorAll?.('.list-more, #loanTools, #selBar') ?? []) b.hidden = true;
}
new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) hideWrites(n); }).observe(document.body, { childList: true, subtree: true });


renderLock();
go();
setTimeout(syncNotifEvents, 4000);


// ---------- installation de l'appli (écran d'accueil du téléphone ou de la tablette) ----------
// Bouton affiché seulement sur mobile ou tablette, dans un navigateur capable d'installer l'appli (Chrome Android, Safari et Chrome iOS/iPadOS),
// tant que l'appli n'est pas déjà installée. Explication adaptée à l'appareil et au navigateur.
let installPrompt = null;
function installEnv() {
  const ua = navigator.userAgent || '';
  const ipados = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const ios = /iphone|ipad|ipod/i.test(ua) || ipados;
  const android = /android/i.test(ua);
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Twitter|Snapchat|; wv\)|MicroMessenger|GSA\//i.test(ua);
  const tablet = /ipad/i.test(ua) || ipados || (android && !/mobile/i.test(ua));
  let browser = '';
  if (!inApp) {
    if (ios) browser = /CriOS\//.test(ua) ? 'chrome' : /FxiOS|EdgiOS|OPiOS|OPT\//.test(ua) ? '' : /Safari\//.test(ua) ? 'safari' : '';
    else if (android) browser = /Chrome\//.test(ua) && !/EdgA|OPR\/|SamsungBrowser|Firefox|UCBrowser|Vivaldi/.test(ua) ? 'chrome' : '';
  }
  return { ios, android, tablet, browser, device: tablet ? 'tablette' : 'téléphone' };
}
const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const installDismissed = () => { const t = Number(raw.get('installDismissed') || 0); return t && Date.now() - t < 14 * 86400000; };
function installSteps(env) {
  if (env.android) return { title: 'Installer sur ' + (env.tablet ? 'votre tablette' : 'votre téléphone') + ' (Chrome)', steps: ['Touchez le menu ⋮ (trois points) en haut à droite de Chrome.', 'Touchez « Installer l’application » (ou « Ajouter à l’écran d’accueil »).', 'Confirmez avec « Installer ». L’icône apparaît sur votre écran d’accueil.'] };
  if (env.browser === 'chrome') return { title: 'Installer sur ' + (env.tablet ? 'votre iPad' : 'votre iPhone') + ' (Chrome)', steps: ['Touchez l’icône Partager (carré avec une flèche vers le haut) à droite de la barre d’adresse, ou le menu ⋯.', 'Faites défiler et touchez « Sur l’écran d’accueil ».', 'Touchez « Ajouter ». Ouvrez ensuite l’appli depuis son icône.'], note: 'Si « Sur l’écran d’accueil » n’apparaît pas, ouvrez cette page dans Safari.' };
  return { title: 'Installer sur ' + (env.tablet ? 'votre iPad' : 'votre iPhone') + ' (Safari)', steps: [env.tablet ? 'Touchez l’icône Partager (carré avec une flèche vers le haut) en haut à droite de Safari.' : 'Touchez l’icône Partager (carré avec une flèche vers le haut) en bas de l’écran.', 'Faites défiler et touchez « Sur l’écran d’accueil ».', 'Touchez « Ajouter » en haut à droite. Ouvrez ensuite l’appli depuis son icône.'] };
}
function showInstallHelp(env) {
  const { title, steps, note } = installSteps(env);
  const back = el('div', 'inst-back'); back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true');
  const card = el('div', 'card inst-card');
  card.append(el('h3', '', '📲 ' + title));
  const ol = el('ol', 'inst-steps'); for (const t of steps) ol.append(el('li', '', t)); card.append(ol);
  if (note) card.append(el('p', 'hint', note));
  card.append(el('p', 'hint', 'Une fois installée, l’appli s’ouvre en plein écran, comme une appli normale' + (env.ios ? ', et les notifications deviennent possibles.' : '.')));
  const ok = el('button', 'primary', 'J’ai compris'); ok.onclick = () => back.remove();
  card.append(ok); back.append(card); back.onclick = (e) => { if (e.target === back) back.remove(); };
  document.body.append(back); ok.focus();
}
function renderInstall() {
  const box = $('installBox'); if (!box) return;
  box.replaceChildren(); box.hidden = true;
  const env = installEnv();
  if (!(env.ios || env.android) || !env.browser || isInstalled() || installDismissed()) return;
  box.hidden = false; box.className = 'card install';
  box.append(el('h4', '', `📲 Installer l’appli sur votre ${env.device}`), el('p', 'hint', 'Accès direct depuis l’écran d’accueil, en plein écran' + (env.ios ? ', et notifications possibles.' : '.')));
  const row = el('div', 'btn-row');
  const go = el('button', 'primary small', 'Installer');
  go.onclick = async () => {
    if (installPrompt) { try { installPrompt.prompt(); await installPrompt.userChoice; } catch { /* ignoré */ } installPrompt = null; renderInstall(); if (!isInstalled()) return; }
    else showInstallHelp(env);
  };
  const later = el('button', 'secondary small', 'Plus tard'); later.onclick = () => { raw.set('installDismissed', String(Date.now())); renderInstall(); };
  row.append(go, later); box.append(row);
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; renderInstall(); });
window.addEventListener('appinstalled', () => { installPrompt = null; renderInstall(); });
renderInstall();
