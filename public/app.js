// Adresse du relais Cloudflare (à adapter après le déploiement).
const RELAY = 'https://appli-bmvr-relais.toolsmaker.workers.dev';
const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

const daysLeft = (iso) => Math.round((new Date(iso + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
const label = (d) => (d < 0 ? `En retard de ${-d} j` : d === 0 ? "Aujourd'hui" : d === 1 ? 'Demain' : `Dans ${d} j`);

// Couverture : image du portail BMVR d'abord (la même que sur le site) ; si le portail n'a qu'une vignette générique
// (256×256), on essaie Open Library via l'ISBN ; sinon rien n'est affiché.
function cover(l) {
  const img = document.createElement('img');
  img.className = 'cover';
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  const sources = [];
  if (l.coverId) sources.push({ url: 'https://www.bmvr.marseille.fr/in/rest/Thumb/image?id=' + encodeURIComponent(l.coverId), generic: true });
  if (l.isbn) sources.push({ url: `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(l.isbn)}-M.jpg?default=false`, generic: false });
  let i = 0;
  const next = () => { if (i < sources.length) img.src = sources[i++].url; else img.remove(); };
  img.onerror = next;
  img.onload = () => { if (sources[i - 1]?.generic && img.naturalWidth === 256 && img.naturalHeight === 256) next(); };
  next();
  return img;
}

function render({ loans, fetchedAt }, note = '') {
  $('loans').hidden = false;
  $('diag').hidden = false;
  $('foot').hidden = false;
  const list = $('list');
  list.replaceChildren();
  for (const l of loans) {
    const d = daysLeft(l.dueDate);
    const li = document.createElement('li');
    li.className = d < 0 ? 'late' : d <= 3 ? 'soon' : '';
    if (l.coverId || l.isbn) li.append(cover(l));
    const info = document.createElement('div');
    const t = document.createElement('strong'); t.textContent = l.title;
    const a = document.createElement('small'); a.textContent = l.author;
    info.append(t, a);
    const b = document.createElement('div'); b.className = 'badge';
    const s = document.createElement('small'); s.textContent = new Date(l.dueDate + 'T00:00:00').toLocaleDateString('fr-FR');
    b.append(label(d), s);
    li.append(info, b);
    info.style.flex = '1';
    list.append(li);
  }
  $('status').textContent = `${loans.length} prêt(s) · mis à jour ${new Date(fetchedAt).toLocaleString('fr-FR')}${note}`;
}

async function refresh() {
  const user = store.get('user'), pass = store.get('pass');
  if (!user || !pass) { $('setup').hidden = false; $('loans').hidden = true; $('foot').hidden = true; return; }
  $('setup').hidden = true;
  const cached = store.get('cache');
  if (cached) render(JSON.parse(cached), ' (copie enregistrée)');
  else { $('loans').hidden = false; $('status').textContent = 'Chargement…'; }
  try {
    const r = await fetch(RELAY + '/loans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) });
    const data = await r.json();
    if (r.status === 401) { signOut(); $('loans').hidden = true; $('foot').hidden = true; $('setup').hidden = false; $('err').textContent = data.error || 'Identifiants refusés par la BMVR.'; return; }
    if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
    store.set('cache', JSON.stringify(data));
    render(data);
  } catch (e) {
    $('loans').hidden = false;
    $('foot').hidden = false;
    $('status').textContent = (cached ? $('status').textContent + ' · ' : '') + 'Actualisation impossible : ' + e.message;
    $('diag').hidden = false;
  }
}

function signOut() { ['user', 'pass', 'cache'].forEach(store.del); }

$('save').onclick = () => {
  store.set('user', $('user').value.trim());
  store.set('pass', $('pass').value);
  $('pass').value = '';
  $('err').textContent = '';
  refresh();
};
$('sync').onclick = refresh;

// Services en ligne : le relais se connecte à la BMVR avec vos identifiants et renvoie l'adresse d'entrée du service
// (avec un ticket à usage unique) ; on l'ouvre aussitôt dans un nouvel onglet.
document.querySelectorAll('.service').forEach((btn) => {
  btn.onclick = async () => {
    const user = store.get('user'), pass = store.get('pass');
    $('svcErr').textContent = '';
    if (!user || !pass) { $('svcErr').textContent = "Connectez-vous d'abord avec votre compte BMVR."; $('setup').hidden = false; return; }
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = label + '…';
    try {
      const r = await fetch(RELAY + '/service', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass, service: btn.dataset.service }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
      // Même fenêtre : depuis une appli installée, un nouvel onglet partirait dans le navigateur par défaut du téléphone.
      location.assign(data.url);
    } catch (e) {
      $('svcErr').textContent = label + ' : ' + e.message;
    } finally { btn.disabled = false; btn.textContent = label; }
  };
});
$('diag').onclick = async () => {
  $('diagOut').hidden = false;
  $('diagOut').textContent = 'Diagnostic en cours…';
  try {
    const r = await fetch(RELAY + '/loans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: store.get('user'), password: store.get('pass'), diagnostic: true }) });
    $('diagOut').textContent = JSON.stringify(await r.json(), null, 1);
  } catch (e) { $('diagOut').textContent = 'Erreur : ' + e.message; }
};
$('reset').onclick = () => { signOut(); refresh(); };

// Mise à jour automatique : à chaque ouverture ou retour sur l'appli, on cherche une nouvelle version ;
// si elle existe, elle s'installe seule et la page se recharge une fois.
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
refresh();
