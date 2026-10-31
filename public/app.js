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
    const info = document.createElement('div');
    const t = document.createElement('strong'); t.textContent = l.title;
    const a = document.createElement('small'); a.textContent = l.author;
    info.append(t, a);
    const b = document.createElement('div'); b.className = 'badge';
    const s = document.createElement('small'); s.textContent = new Date(l.dueDate + 'T00:00:00').toLocaleDateString('fr-FR');
    b.append(label(d), s);
    li.append(info, b);
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
