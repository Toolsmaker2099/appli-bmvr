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

// ---------- dates ----------
const today = () => new Date(new Date().toDateString());
const parse = (iso) => new Date(iso + 'T00:00:00');
const daysLeft = (iso) => Math.round((parse(iso) - today()) / 86400000);
const longDate = (iso) => parse(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (iso) => parse(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const rel = (d) => (d < 0 ? `En retard de ${-d} jour${d < -1 ? 's' : ''}` : d === 0 ? "À rendre aujourd'hui" : d === 1 ? 'À rendre demain' : `À rendre dans ${d} jours`);

// ---------- navigation par onglets ----------
const TITLES = { accueil: 'Accueil', prets: 'Mes prêts', resa: 'Mes réservations', chercher: 'Chercher et réserver', compte: 'Compte' };
function go() {
  const tab = TITLES[location.hash.slice(1)] ? location.hash.slice(1) : 'accueil';
  for (const t of Object.keys(TITLES)) $('view-' + t).hidden = t !== tab;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  $('title').textContent = TITLES[tab];
  $('sync').hidden = !['prets', 'resa'].includes(tab) || !hasCreds();
  window.scrollTo(0, 0);
  if (tab === 'accueil') renderSummary();
  if (tab === 'compte') renderAccount();
  if (tab === 'prets') openLoans(); // les prêts ne sont lus que lorsqu'on ouvre leur onglet
  if (tab === 'resa') openReservations();
  if (tab === 'chercher') openSearch();
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
    return;
  }
  if (!data) { const a = el('a', '', 'Voir mes prêts →'); a.href = '#prets'; box.append(el('strong', '', 'Vos prêts'), a); return; }
  const n = data.loans.length;
  const late = data.loans.filter((l) => daysLeft(l.dueDate) < 0).length;
  box.append(el('strong', '', n ? `${n} prêt${n > 1 ? 's' : ''} en cours` : 'Aucun prêt en cours'));
  if (n) {
    const next = data.loans[0];
    box.append(el('p', '', late ? `⚠ ${late} en retard · ${rel(daysLeft(next.dueDate))}` : `Prochain retour : ${rel(daysLeft(next.dueDate)).toLowerCase().replace('à rendre ', '')} (${shortDate(next.dueDate)})`));
  }
  const a = el('a', '', 'Voir mes prêts →'); a.href = '#prets'; box.append(a);
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
  if (!l.coverId && !l.isbn) return el('div', 'cover-ph', '📕');
  const img = el('img', 'cover');
  img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
  const sources = [];
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
  return li;
}

// ---------- prêts ----------
function renderLoans(data, note = '') {
  const list = $('list');
  list.replaceChildren();
  if (!data.loans.length) {
    const li = el('li', 'hero'); li.append(el('strong', '', 'Aucun prêt en cours'), el('p', '', 'Vos emprunts apparaîtront ici.')); list.append(li);
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
        await call('/cancel', { reservationId: r.reservationId });
        li.replaceChildren(el('p', 'hint ok', `✓ Réservation de « ${r.title} » annulée.`));
        store.del('resaCache');
      } catch (e) { msg.textContent = e.message; msg.className = 'hint msg err'; btn.disabled = false; btn.textContent = 'Annuler la réservation'; }
    };
    row.append(btn); li.append(row, msg);
  }
  return li;
}

function renderResa(data, note = '') {
  const list = $('resaList');
  list.replaceChildren();
  if (!data.reservations.length) { const li = el('li', 'hero'); li.append(el('strong', '', 'Aucune réservation'), el('p', '', 'Cherchez un document dans l’onglet Chercher pour le réserver.')); list.append(li); }
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
  if (item.author) t.append(el('p', '', item.author));
  const meta = [item.type, item.year].filter(Boolean).join(' · ');
  if (meta) t.append(el('span', 'due', meta));
  head.append(cover(item), t);
  li.append(head);
  const main = rows(item.fields.slice(0, 6));
  if (main) li.append(main);
  if (item.fields.length > 6) {
    const det = el('details');
    det.append(el('summary', '', 'Plus de détails'), rows(item.fields.slice(6)));
    li.append(det);
  }
  const row = el('div', 'btn-row');
  const btn = el('button', 'primary small', 'Réserver');
  btn.onclick = () => { btn.remove(); reserveSheet(item, li); };
  row.append(btn); li.append(row);
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

// ---------- compte ----------
function signOut() { ['user', 'pass', 'cache', 'resaCache', 'lastTrace'].forEach(store.del); updateBadge(); }

function renderAccount() {
  const on = hasCreds();
  $('loginBox').hidden = on;
  $('accountBox').hidden = !on;
  $('who').textContent = store.get('user');
  $('diag').hidden = !on;
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
go();
