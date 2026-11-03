import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, seal, unseal, b64u, manage, status, validSubscription, configured } from './src/push.js';

const NOW = Date.parse('2026-11-03T18:30:00Z'); // 19:30 à Paris
const rec = (extra = {}) => ({ prefs: { loans: true, resa: true, messages: true, events: true }, state: null, events: [], ...extra });

test('prêts : une alerte par étape, groupée, jamais répétée', () => {
  const data = { loans: [{ id: 'a', title: 'Dune', dueDate: '2026-11-04' }, { id: 'b', title: 'Fondation', dueDate: '2026-11-04' }, { id: 'c', title: 'Loin', dueDate: '2026-12-01' }, { id: 'd', title: 'Retard', dueDate: '2026-11-01' }] };
  const r1 = detect(rec(), data, NOW);
  assert.equal(r1.notes.length, 2);
  assert.match(r1.notes.map((n) => n.title).join('|'), /retard.*demain|demain.*retard/i);
  assert.match(r1.notes.find((n) => /demain/.test(n.title)).body, /Dune.*Fondation/);
  const r2 = detect(rec({ state: r1.state }), data, NOW);
  assert.equal(r2.notes.length, 0);
});

test('réservations : silence au premier passage, puis alerte à la disponibilité et quand le rang avance', () => {
  const d1 = { reservations: [{ id: 'r1', title: 'Livre A', rank: 3, available: false }, { id: 'r2', title: 'Livre B', rank: 1, available: false }] };
  const first = detect(rec(), d1, NOW);
  assert.equal(first.notes.length, 0);
  const d2 = { reservations: [{ id: 'r1', title: 'Livre A', rank: 2, available: false }, { id: 'r2', title: 'Livre B', rank: 1, available: true }] };
  const second = detect(rec({ state: first.state }), d2, NOW);
  assert.equal(second.notes.length, 2);
  assert.ok(second.notes.some((n) => /à retirer/i.test(n.title) && n.body === 'Livre B'));
  assert.ok(second.notes.some((n) => /avance/i.test(n.title) && /2e/.test(n.body)));
});

test('messages : seuls les nouveaux déclenchent une alerte', () => {
  const first = detect(rec(), { messages: [{ id: 'm1', title: 'Rappel' }] }, NOW);
  assert.equal(first.notes.length, 0);
  const second = detect(rec({ state: first.state }), { messages: [{ id: 'm2', title: 'Réservation prête' }, { id: 'm1', title: 'Rappel' }] }, NOW);
  assert.equal(second.notes.length, 1);
  assert.equal(second.notes[0].body, 'Réservation prête');
});

test('événements : veille en soirée et matin du jour, une seule fois, passés retirés', () => {
  const events = [{ id: 'h::e1', date: '2026-11-04', title: 'Éveil musical', hour: '10:00', library: 'Castellane' }, { id: 'h::e2', date: '2026-11-03', title: 'Conte', hour: '21:00', library: 'Alcazar' }, { id: 'h::old', date: '2026-10-01', title: 'Vieux', hour: '10:00', library: '' }];
  const r1 = detect(rec({ events }), {}, NOW);
  assert.equal(r1.notes.length, 2);
  assert.equal(r1.events.length, 2);
  assert.ok(r1.notes.some((n) => /Demain/.test(n.title)) && r1.notes.some((n) => /Aujourd’hui/.test(n.title)));
  const r2 = detect(rec({ events, state: r1.state }), {}, NOW);
  assert.equal(r2.notes.length, 0);
});

test('préférences : un type désactivé ne notifie pas', () => {
  const r = detect(rec({ prefs: { loans: false, resa: true, messages: true, events: true } }), { loans: [{ id: 'a', title: 'Dune', dueDate: '2026-11-03' }] }, NOW);
  assert.equal(r.notes.length, 0);
});

test('chiffrement au repos : aller-retour et texte illisible', async () => {
  const env = { NOTIF_KEY: b64u(crypto.getRandomValues(new Uint8Array(32))) };
  const s = await seal(env, { username: '2100123456', password: 'Secret!42' });
  assert.ok(!s.includes('Secret') && !s.includes('2100123456'));
  assert.deepEqual(await unseal(env, s), { username: '2100123456', password: 'Secret!42' });
  await assert.rejects(() => unseal({ NOTIF_KEY: b64u(crypto.getRandomValues(new Uint8Array(32))) }, s));
});

test('abonnement : seuls les services de notification connus sont acceptés', () => {
  const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
  assert.ok(validSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }));
  assert.ok(validSubscription({ endpoint: 'https://web.push.apple.com/xyz', keys }));
  assert.ok(!validSubscription({ endpoint: 'https://evil.example/x', keys }));
  assert.ok(!validSubscription({ endpoint: 'http://fcm.googleapis.com/x', keys }));
});

test('sans configuration, la fonction est désactivée', () => {
  assert.equal(configured({}), false);
  assert.deepEqual(status({}), { enabled: false });
});

test('gestion : un téléphone, plusieurs comptes ; refus des mauvais identifiants ; effacement ; reprise de l\'ancien format', async () => {
  const store = new Map();
  const env = { NOTIF_KEY: b64u(crypto.getRandomValues(new Uint8Array(32))), VAPID_PUBLIC: 'x', VAPID_PRIVATE: 'y', NOTIF: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } } };
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
  const h = async (str) => b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))).slice(0, 32);
  const idNew = await h(`${endpoint}\u0000u1`);
  store.set(`sub:${idNew}`, JSON.stringify({ cred: await seal(env, { username: 'u1', password: 'p1' }), prefs: {}, events: [], user: '••u1' }));
  assert.equal((await manage(env, { endpoint, username: 'u1', password: 'bad' }, 'status')).subscribed, false);
  assert.equal((await manage(env, { endpoint, username: 'u2', password: 'p2' }, 'status')).subscribed, false); // autre compte du même téléphone
  await assert.rejects(() => manage(env, { endpoint, username: 'u1', password: 'bad' }, 'unsubscribe'));
  assert.equal((await manage(env, { endpoint, username: 'u1', password: 'p1' }, 'status')).subscribed, true);
  await manage(env, { endpoint, username: 'u1', password: 'p1' }, 'unsubscribe');
  assert.equal(store.size, 0);
  // ancien format : identifié par l'abonnement seul
  store.set(`sub:${await h(endpoint)}`, JSON.stringify({ cred: await seal(env, { username: 'u1', password: 'p1' }), prefs: {}, events: [] }));
  assert.equal((await manage(env, { endpoint, username: 'u1', password: 'p1' }, 'status')).subscribed, true);
  assert.ok(store.has(`sub:${idNew}`) && !store.has(`sub:${await h(endpoint)}`));
});
test('contrôle : pas la nuit, et pas avant la fin de l\'intervalle', async () => {
  const { runChecks } = await import('./src/push.js');
  let listed = 0;
  const env = { NOTIF_KEY: 'x', VAPID_PUBLIC: 'x', VAPID_PRIVATE: 'x', NOTIF: { list: async () => { listed++; return { keys: [{ name: 'sub:a', metadata: { checkedAt: Date.parse('2026-11-03T16:00:00Z') } }] }; }, get: async () => null } };
  assert.equal((await runChecks(env, Date.parse('2026-11-03T02:00:00Z'))).night, true); // 03h à Paris
  assert.equal(listed, 0);
  assert.equal((await runChecks(env, Date.parse('2026-11-03T17:00:00Z'))).checked, 0); // 18h, dernier contrôle 17h : trop tôt
  assert.equal((await runChecks(env, Date.parse('2026-11-03T19:30:00Z'))).checked, 1); // 20h30 : plus de 3 h
});
