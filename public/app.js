// Adresse du relais Cloudflare (à adapter après le déploiement).
const RELAY = 'https://appli-bmvr-relais.toolsmaker.workers.dev';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
// Plusieurs comptes sur le même appareil : chaque compte a ses propres identifiants et ses propres copies de données.
// Les clés « par compte » sont rangées sous p:<id>:<clé> ; 'profiles' liste les comptes et 'active' donne le compte courant.
const PER = new Set(['user', 'pass', 'cache', 'resaCache', 'msgCache', 'seenMsgs', 'pickup', 'lastTrace']);
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
  const list = getProfiles();
  let p = list.find((x) => x.user.toLowerCase() === user.toLowerCase());
  if (!p) { p = { id: 'a' + Date.now().toString(36), user }; list.push(p); raw.set('profiles', JSON.stringify(list)); }
  raw.set('active', p.id); store.set('user', user); store.set('pass', pass);
}
function switchProfile(id) { raw.set('active', id); location.hash = '#accueil'; location.reload(); }
function removeActiveProfile() {
  const id = activeId(); if (!id) return;
  for (const k of PER) raw.del(`p:${id}:${k}`);
  const rest = getProfiles().filter((x) => x.id !== id);
  raw.set('profiles', JSON.stringify(rest)); raw.set('active', rest[0]?.id || '');
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
  if (tab === 'accueil') renderSummary();
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
  t.append(el('h3', '', [l.title, l.volume && `(${l.volume})`, l.issueCaption].filter(Boolean).join(' ')));
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
  const li = el('li', 'card ' + (r.available ? 'soon' : ''));
  const head = el('div', 'card-head');
  const t = el('div', 'card-title');
  t.append(el('h3', '', [r.title, r.volume && `(${r.volume})`, r.issueCaption].filter(Boolean).join(' ')));
  if (r.author) t.append(el('p', '', r.author));
  t.append(el('span', 'due', r.available ? '✓ Disponible : à retirer' : r.rank ? `Vous êtes n° ${r.rank} dans la file` : r.status || 'En attente'));
  head.append(cover(r), t);
  li.append(head);
  const main = rows([
    ['État', r.status],
    ['Retrait', r.branch],
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
        store.set('pickup', brSel.value); store.del('resaCache');
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
function searchCard(item) {
  const li = el('li', 'card');
  const head = el('div', 'card-head');
  const t = el('div', 'card-title');
  t.append(el('h3', '', item.title));
  
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
  li.append(det);
  const row = el('div', 'btn-row');
  const fav = el('button', 'secondary small fav-btn', '♡ Favoris');
  fav.onclick = () => { fav.remove(); favSheet(item, li); };
  row.append(fav); li.append(row);
  if (item.reservable !== false && !item.digital && !item.holdings?.length) {
    const btn = el('button', 'primary small', 'Réserver');
    btn.onclick = () => { btn.remove(); reserveSheet(item, li); };
    row.append(btn);
  }
  return li;
}

// ---------- même auteur, même série ----------
function goSearch(q) {
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
  if (authors[0]) b('✍️ Autres livres de ' + authors[0].split(',').reverse().join(' ').trim(), authors[0]);
  if (serie || guess) b('📚 Même série', serie || guess);
  return row;
}

// ---------- recherche : filtres, tri, pagination, scan ----------
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
  tools.hidden = !SS.items.length; tools.replaceChildren();
  if (SS.items.length) {
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
  list.replaceChildren(...shown.map(searchCard));
  const filtered = shown.length !== SS.items.length;
  $('searchStatus').textContent = !SS.items.length ? (SS.q ? 'Aucun résultat.' : '') : `${shown.length} résultat${shown.length > 1 ? 's' : ''}${filtered ? ` sur ${SS.items.length} chargés` : ''}`;
  $('moreBtn').hidden = !SS.more;
  if (SS.items.length && !shown.length) list.append(emptyState('🔎', 'Aucun résultat avec ces filtres', 'Retirez un filtre ou chargez plus de résultats.'));
}
async function runSearch(more) {
  if (SS.busy) return;
  SS.busy = true;
  if (!more) { SS.q = $('q').value.trim(); SS.qid = crypto.randomUUID?.() || ''; SS.page = 1; SS.items = []; SS.avail = SS.resa = false; SS.type = SS.branch = ''; $('searchList').replaceChildren(); $('searchTools').hidden = true; }
  else SS.page += 1;
  $('searchStatus').textContent = more ? 'Chargement…' : 'Recherche…'; $('moreBtn').disabled = true;
  try {
    const data = await call('/search', { query: SS.q, page: SS.page, queryId: SS.qid });
    const known = new Set(SS.items.map((it) => it.id));
    SS.items.push(...data.results.filter((it) => !known.has(it.id)));
    SS.more = data.results.length >= 20 && SS.page < 10;
    renderSearch();
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
const ESPACE = { profile: 'Mon profil', favoris: 'Mes favoris', loanhistory: 'Historique des prêts', messages: 'Messages', fines: 'Amendes', bibliotheques: 'Bibliothèques', nouveautes: 'Nouveautés', aujourdhui: 'À emprunter aujourd’hui', recherches: 'Mes recherches' };
const MENU = [
  ['profile', '👤', 'Mon profil', 'Coordonnées et abonnement'],
  ['favoris', '♡', 'Mes favoris', 'Vos listes de documents'],
  ['loanhistory', '🕘', 'Historique des prêts', 'Tout ce que vous avez emprunté'],
  ['messages', '✉️', 'Messages', 'Avis de la bibliothèque'],
  ['fines', '💶', 'Amendes', 'Montants éventuels à régler'],
  ['aujourdhui', '🎯', 'À emprunter aujourd’hui', 'Livres de vos listes disponibles, bibliothèque ouverte'],
  ['nouveautes', '✨', 'Nouveautés', 'Derniers arrivages par bibliothèque'],
  ['recherches', '🔎', 'Mes recherches', 'Recherches sauvegardées'],
  ['bibliotheques', '🏛️', 'Bibliothèques', 'Infos du réseau, itinéraires, horaires'],
];
let espaceKind = store.get('espaceKind') || 'favoris';

function plainCard(it) {
  const li = el('li', 'card');
  if (it.title || it.coverId || it.isbn) {
    const head = el('div', 'card-head'); const t = el('div', 'card-title');
    if (it.title) t.append(el('h3', '', it.title));
    if (it.author) t.append(el('p', '', it.author));
    if (it.coverId || it.isbn) head.append(cover(it));
    head.append(t); li.append(head);
  }
  const r = rows(it.fields); if (r) li.append(r);
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
    body.append(back);
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
      F.items.push(...add); list.append(...add.map(searchCard));
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
      if (pr.id === activeId()) li.append(el('span', 'chip good', 'Actif'));
      else { li.classList.add('tap'); li.tabIndex = 0; li.setAttribute('role', 'button'); li.append(el('span', 'acc-go', 'Utiliser ›')); li.onclick = () => switchProfile(pr.id); li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchProfile(pr.id); } }; }
      ul.append(li);
    }
    box.append(ul);
    if (!addingAccount) { const add = el('button', 'secondary', '➕ Ajouter un autre compte'); add.onclick = () => { addingAccount = true; renderAccount(); }; box.append(add); }
  }
  $('diag').hidden = !on; $('diagSearch').hidden = !on; $('diagMars').hidden = !on;
}

$('save').onclick = () => {
  const u = $('user').value.trim(), p = $('pass').value;
  if (!u || !p) { $('err').textContent = 'Saisissez votre identifiant et votre mot de passe.'; return; }
  addProfile(u, p); addingAccount = false; renderUserChip();
  $('user').value = ''; $('pass').value = ''; $('err').textContent = '';
  location.hash = '#prets';
};
$('reset').onclick = () => { if (!confirm('Retirer ce compte de cet appareil ?')) return; signOut(); location.hash = '#accueil'; location.reload(); };
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
go();
