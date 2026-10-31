// Adresse du relais Cloudflare (à adapter après le déploiement).
const RELAY = 'https://appli-bmvr-relais.toolsmaker.workers.dev';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};
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
function renderSummary() {
  const box = $('summary');
  box.replaceChildren();
  const data = readCache();
  if (!hasCreds()) {
    box.append(el('strong', '', 'Bienvenue'), el('p', '', 'Connectez votre compte BMVR pour retrouver vos prêts et accéder aux services en ligne.'));
    const a = el('a', '', 'Se connecter →'); a.href = '#compte'; box.append(a);
    $('msgCard').hidden = true;
    return;
  }
  if (!data) { const a = el('a', '', 'Voir mes prêts →'); a.href = '#prets'; box.append(el('strong', '', 'Vos prêts'), a); renderMsgLine(); return; }
  const n = data.loans.length;
  const late = data.loans.filter((l) => daysLeft(l.dueDate) < 0).length;
  box.append(el('strong', '', n ? `${n} prêt${n > 1 ? 's' : ''} en cours` : 'Aucun prêt en cours'));
  if (n) {
    const next = data.loans[0];
    box.append(el('p', '', late ? `⚠ ${late} en retard · ${rel(daysLeft(next.dueDate))}` : `Prochain retour : ${rel(daysLeft(next.dueDate)).toLowerCase().replace('à rendre ', '')} (${shortDate(next.dueDate)})`));
  }
  const a = el('a', '', 'Voir mes prêts →'); a.href = '#prets'; box.append(a);
  renderMsgLine();
}
function renderMsgLine() {
  const line = $('msgCard');
  const draw = () => {
    const c = readMsgCache(); if (!c || !hasCreds()) { line.hidden = true; return; }
    line.hidden = false;
    const n = c.items.length, u = unseenCount(c.items);
    line.replaceChildren();
    const a = el('a', u ? 'new' : '', n ? `✉️ ${n} message${n > 1 ? 's' : ''}${u ? ` · ${u} nouveau${u > 1 ? 'x' : ''}` : ''}` : '✉️ Aucun message'); a.href = '#espace/messages';
    line.append(a);
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
      const li = plainCard(it);
      if (seen && !seen.has(it.id)) { li.classList.add('unread'); const h = li.querySelector('h3'); if (h) h.before(el('span', 'chip good new-chip', 'Nouveau')); }
      if (espaceKind === 'messages') {
        const del = el('button', 'link danger', 'Supprimer ce message');
        del.onclick = async () => {
          if (!confirm('Supprimer ce message définitivement ?')) return;
          del.disabled = true; del.textContent = 'Suppression…';
          try {
            await call('/delete-message', { id: it.id });
            li.remove();
            const c = readMsgCache(); if (c) { c.items = c.items.filter((m) => m.id !== it.id); store.set('msgCache', JSON.stringify(c)); }
            updateEspaceBadge();
          } catch (e) { del.disabled = false; del.textContent = 'Supprimer ce message'; alert(e.message); }
        };
        li.append(del);
      }
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
function signOut() { ['user', 'pass', 'cache', 'resaCache', 'msgCache', 'seenMsgs', 'lastTrace'].forEach(store.del); updateBadge(); }

function renderAccount() {
  const on = hasCreds();
  $('loginBox').hidden = on;
  $('accountBox').hidden = !on;
  $('who').textContent = store.get('user');
  $('diag').hidden = !on; $('diagSearch').hidden = !on;
}

$('save').onclick = () => {
  const u = $('user').value.trim(), p = $('pass').value;
  if (!u || !p) { $('err').textContent = 'Saisissez votre identifiant et votre mot de passe.'; return; }
  store.set('user', u); store.set('pass', p);
  $('pass').value = ''; $('err').textContent = '';
  location.hash = '#prets';
};
$('reset').onclick = () => { signOut(); go(); };
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
