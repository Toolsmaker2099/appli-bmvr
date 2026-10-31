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
function go() {
  const [h1, sub] = location.hash.slice(1).split('/');
  const tab = TITLES[h1] ? h1 : 'accueil';
  for (const t of Object.keys(TITLES)) $('view-' + t).hidden = t !== tab;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === (tab === 'compte' ? 'espace' : tab)));
  $('title').textContent = tab === 'espace' && ESPACE[sub] ? ESPACE[sub] : TITLES[tab];
  $('sync').hidden = !['prets', 'resa'].includes(tab) || !hasCreds();
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
  for (const l of data.loans) list.append(card(l));
  $('status').textContent = `${data.loans.length} prêt${data.loans.length > 1 ? 's' : ''} · mis à jour ${new Date(data.fetchedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${note}`;
  updateBadge();
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
  if (cached) renderLoans(cached, ' (copie enregistrée)');
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
  if (cached) renderResa(cached, ' (copie enregistrée)'); else { $('resaList').replaceChildren(); $('resaStatus').textContent = 'Chargement de vos réservations…'; }
  if (loadingResa) return;
  loadingResa = true; $('sync').classList.add('spin');
  try {
    const data = await call('/reservations');
    store.set('resaCache', JSON.stringify(data));
    renderResa(data);
  } catch (e) { $('resaStatus').textContent = (cached ? $('resaStatus').textContent + ' · ' : '') + 'Actualisation impossible : ' + e.message; }
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
  if (item.copiesTotal) {
    if (item.copiesAvailable > 0) chip(`✓ ${item.copiesAvailable} exemplaire${item.copiesAvailable > 1 ? 's' : ''} disponible${item.copiesAvailable > 1 ? 's' : ''} sur ${item.copiesTotal}`, 'good');
    else chip(`Aucun exemplaire disponible actuellement (${item.copiesTotal})${item.nextReturn ? ` · retour le plus proche : ${shortDate(item.nextReturn)}` : ''}`, 'warn');
    chip(item.reservable ? '🔖 Réservable' : 'Non réservable', item.reservable ? 'good' : '');
  } else if (item.copiesTotal === 0) chip('Aucun exemplaire en rayon', 'warn');
  else if (item.availability) chip(item.availability === 'available' ? '✓ Document disponible dans un des établissements du réseau' : 'Aucun exemplaire disponible actuellement', item.availability === 'available' ? 'good' : 'warn');
  if (chips.children.length) li.append(chips);
  if (item.copies?.length) {
    const ex = el('details', 'notice copies');
    const by = new Map();
    for (const c of item.copies) { const k = c.branch || 'Bibliothèque'; if (!by.has(k)) by.set(k, []); by.get(k).push(c); }
    const nb = [...by.values()].filter((l) => l.some((x) => x.available)).length;
    ex.append(el('summary', '', nb ? `📍 Où l'emprunter · disponible dans ${nb} bibliothèque${nb > 1 ? 's' : ''}` : '📍 Où le trouver · aucun exemplaire disponible'));
    const box = el('div', 'copy-list');
    for (const [name, list] of [...by].sort((a, b) => b[1].filter((x) => x.available).length - a[1].filter((x) => x.available).length || a[0].localeCompare(b[0], 'fr'))) {
      const n = list.filter((x) => x.available).length;
      const g = el('div', 'copy-branch');
      const h = el('div', 'copy-h'); h.append(el('strong', '', name), el('span', 'chip ' + (n ? 'good' : 'warn'), n ? `${n} disponible${n > 1 ? 's' : ''}` : 'Aucun disponible'));
      g.append(h);
      for (const c of list) {
        const r = el('div', 'copy-row');
        r.append(el('span', 'copy-what', [c.place, c.callNumber].filter(Boolean).join(' · ') || 'Exemplaire'));
        r.append(el('span', 'copy-st ' + (c.available ? 'ok' : 'no'), (c.available ? '✓ ' : '') + (c.status || (c.available ? 'Disponible' : 'Indisponible')) + (!c.available && c.due ? ` · retour le ${shortDate(c.due)}` : '')));
        g.append(r);
      }
      box.append(g);
    }
    ex.append(box); li.append(ex);
  }
  const det = el('details', 'notice');
  det.append(el('summary', '', 'Détails'));
  const body = el('div', 'notice-body');
  det.append(body);
  let loaded = false;
  det.ontoggle = async () => {
    if (!det.open || loaded) return;
    loaded = true; body.textContent = 'Chargement…';
    try {
      const d = await call('/notice', { id: item.id });
      body.replaceChildren();
      const extra = d.fields.length ? d.fields : item.fields.filter(([l]) => !MAIN.includes(l));
      const r = rows(extra);
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
  if (item.reservable !== false) {
    const btn = el('button', 'primary small', 'Réserver');
    btn.onclick = () => { btn.remove(); reserveSheet(item, li); };
    row.append(btn);
  }
  return li;
}

$('searchForm').onsubmit = async (ev) => {
  ev.preventDefault();
  if (!hasCreds()) return needLogin($('searchList'), $('searchStatus'));
  const q = $('q').value.trim();
  if (!q) return;
  $('q').blur();
  $('searchStatus').textContent = 'Recherche…'; $('searchList').replaceChildren();
  try {
    const data = await call('/search', { query: q });
    $('searchStatus').textContent = data.results.length ? `${data.results.length} résultat${data.results.length > 1 ? 's' : ''}` : 'Aucun résultat.';
    for (const it of data.results) $('searchList').append(searchCard(it));
  } catch (e) { $('searchStatus').textContent = 'Recherche impossible : ' + e.message; }
};


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

function addFavButton(li, item) {
  if (!item.coverId) return;
  const row = el('div', 'btn-row');
  const fav = el('button', 'secondary small fav-btn', '♡ Favoris');
  fav.onclick = () => { fav.remove(); favSheet({ id: item.coverId }, li); };
  row.append(fav); li.append(row);
}

// ---------- mon espace ----------
const ESPACE = { profile: 'Mon profil', favoris: 'Mes favoris', loanhistory: 'Historique des prêts', messages: 'Messages', fines: 'Amendes' };
const MENU = [
  ['profile', '👤', 'Mon profil', 'Coordonnées et abonnement'],
  ['favoris', '♡', 'Mes favoris', 'Vos listes de documents'],
  ['loanhistory', '🕘', 'Historique des prêts', 'Tout ce que vous avez emprunté'],
  ['messages', '✉️', 'Messages', 'Avis de la bibliothèque'],
  ['fines', '💶', 'Amendes', 'Montants éventuels à régler'],
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
    for (const b of baskets) {
      const li = el('li', 'card');
      const head = el('div', 'card-head'); const t = el('div', 'card-title');
      t.append(el('h3', '', b.name)); if (b.count) t.append(el('p', '', `${b.count} document${b.count > 1 ? 's' : ''}`));
      head.append(t); li.append(head);
      const row = el('div', 'btn-row');
      const open = el('button', 'primary small', 'Ouvrir');
      const ren = el('button', 'secondary small', 'Renommer'); ren.hidden = !!b.isDefault;
      const del = el('button', 'secondary small danger', 'Supprimer'); del.hidden = !!b.isDefault;
      open.onclick = () => showBasket(body, status, b);
      ren.onclick = async () => { const n = prompt('Nouveau nom ?', b.name); if (!n || !n.trim()) return; try { render((await call('/basket', { action: 'rename', basketId: b.id, name: n.trim() })).baskets); } catch (e) { status.textContent = e.message; } };
      del.onclick = async () => { if (!confirm(`Supprimer la liste « ${b.name} » ?`)) return; try { render((await call('/basket', { action: 'delete', basketId: b.id })).baskets); } catch (e) { status.textContent = e.message; } };
      row.append(open, ren, del); li.append(row); ul.append(li);
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
  who.append(el('span', 'avatar', (store.get('user') || '?').slice(0, 2).toUpperCase()), el('span', '', hasCreds() ? `Connecté · ${store.get('user')}` : 'Non connecté'));
  body.append(who);
  const ul = el('ul', 'menu');
  const item = (href, ico, title, sub) => { const li = el('li'); const a = el('a'); a.href = href; a.append(el('span', 'm-ico', ico)); const t = el('span', 'm-txt'); t.append(el('strong', '', title), el('small', '', sub)); a.append(t, el('span', 'm-go', '›')); li.append(a); ul.append(li); };
  if (hasCreds()) for (const [k, ico, title, sub] of MENU) item('#espace/' + k, ico, title, sub);
  item('#compte', '🔐', 'Compte et connexion', hasCreds() ? 'Se déconnecter, à propos, diagnostic' : 'Se connecter à votre compte BMVR');
  body.append(ul);
}

async function openEspace(kind) {
  const body = $('espaceBody'), status = $('espaceStatus');
  $('back').hidden = !kind;
  if (!kind) return espaceMenu(body, status);
  espaceKind = kind;
  body.replaceChildren(); status.textContent = '';
  if (!hasCreds()) return needLogin(body, status);
  if (espaceKind === 'favoris') return showBaskets(body, status);
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
      li.append(el('span', 'avatar', pr.user.slice(0, 2).toUpperCase()), el('span', 'acc-name', pr.user));
      if (pr.id === activeId()) li.append(el('span', 'chip good', 'Actif'));
      else { const b = el('button', 'link', 'Utiliser'); b.onclick = () => switchProfile(pr.id); li.append(b); }
      ul.append(li);
    }
    box.append(ul);
    if (!addingAccount) { const add = el('button', 'secondary', '➕ Ajouter un autre compte'); add.onclick = () => { addingAccount = true; renderAccount(); }; box.append(add); }
  }
  $('diag').hidden = !on; $('diagSearch').hidden = !on;
}

$('save').onclick = () => {
  const u = $('user').value.trim(), p = $('pass').value;
  if (!u || !p) { $('err').textContent = 'Saisissez votre identifiant et votre mot de passe.'; return; }
  addProfile(u, p); addingAccount = false;
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
document.querySelectorAll('.service').forEach((btn) => {
  btn.onclick = async () => {
    $('svcErr').textContent = '';
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
