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
  const relay = store.get('relay'), token = store.get('token');
  if (!relay || !token) { $('setup').hidden = false; $('loans').hidden = true; return; }
  $('setup').hidden = true;
  const cached = store.get('cache');
  if (cached) render(JSON.parse(cached), ' (copie enregistrée)');
  else { $('loans').hidden = false; $('status').textContent = 'Chargement…'; }
  try {
    const r = await fetch(relay.replace(/\/$/, '') + '/loans', { headers: { Authorization: 'Bearer ' + token } });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
    store.set('cache', JSON.stringify(data));
    render(data);
  } catch (e) {
    $('loans').hidden = false;
    $('foot').hidden = false;
    $('status').textContent = (cached ? $('status').textContent + ' · ' : '') + 'Actualisation impossible : ' + e.message;
  }
}

$('save').onclick = () => {
  store.set('relay', $('relay').value.trim());
  store.set('token', $('token').value.trim());
  refresh();
};
$('sync').onclick = refresh;
$('reset').onclick = () => { store.del('relay'); store.del('token'); store.del('cache'); refresh(); };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
refresh();
