import test from 'node:test';
import assert from 'node:assert/strict';
import { checksum, fetchLoans, fetchServiceUrl, renewLoan, parseLoans, toISODate, cleanTitle, cleanAuthor, parseAgenda, htmlToText, buildSearch } from './src/portal.js';

test('somme de contrôle identique à celle du portail', () => {
  // 305419896 + 'a'(97)*1 + 'b'(98)*2
  assert.equal(checksum('ab'), String(305419896 + 97 + 196));
  assert.equal(checksum('é'), String(305419896 + 233));
});

test('connexion + prêts avec un portail simulé', async () => {
  const calls = [];
  const fake = async (url, opts = {}) => {
    calls.push([url, opts]);
    const ok = (b, h = {}) => ({ ok: true, status: 200, headers: { getSetCookie: () => ['JSESSIONID=abc; Path=/'], ...h }, json: async () => b, text: async () => b });
    if (url.endsWith('settings.js')) return ok('var s = {"apiToken":"TOK"}');
    if (url.includes('connect.xhtml')) return { ok: true, status: 200, headers: { getSetCookie: () => [] } };
    if (url.includes('/authenticate')) return ok({ token: 'SESS' });
    if (url.includes('/loans')) return ok([{ seqNo: '7', title: 'Dune', author: 'Herbert', returnDate: '14/11/2026', dateFormat: 'dd/MM/yyyy', isRenewable: true, branch: { desc: 'Alcazar' }, loanDate: '01/11/2026', returnHour: '18:00', prolongation: '0', prolongationMax: '1', isbn13: '978-2-07-036822-5' }]);
    throw new Error('inattendu ' + url);
  };
  const { loans } = await fetchLoans({ username: 'u', password: 'p' }, fake);
  assert.deepEqual(loans.map((l) => [l.title, l.author, l.isbn]), [['Dune', 'Herbert', '9782070368225']]);
  assert.equal(loans[0].coverId, 'p::usmarcdef_0000000007');
  assert.equal(loans[0].branch, 'Alcazar');
  assert.equal(loans[0].loanDate, '2026-11-01');
  assert.equal(loans[0].returnHour, '18:00');
  const auth = calls.find(([u]) => u.includes('/loans'))[1].headers['X-InMedia-Authorization'];
  assert.equal(auth, `Bearer SESS TOK ${checksum('?locale=fr')}`);
  assert.equal(calls.find(([u]) => u.includes('/loans'))[1].headers.Cookie, 'JSESSIONID=abc');
});

test('parseLoans ignore les lignes sans date', () => {
  assert.equal(parseLoans([{ seqNo: 1, title: 'x' }]).length, 0);
});

test('dates : format du portail, ISO, compact', () => {
  assert.equal(toISODate('14/11/2026', 'dd/MM/yyyy'), '2026-11-14');
  assert.equal(toISODate('2026-11-14', 'dd/MM/yyyy'), '2026-11-14');
  assert.equal(toISODate('20261114'), '2026-11-14');
  assert.equal(toISODate('03/11/2026'), '2026-11-03');
  assert.equal(toISODate('11/14/26', 'MM/dd/yy'), '2026-11-14');
  assert.equal(toISODate(''), null);
});

test('service : suit le CAS et renvoie l\'adresse du service avec son ticket sans l\'ouvrir', async () => {
  const seen = [];
  const fake = async (url, opts = {}) => {
    seen.push(url);
    const head = (status, loc) => ({ ok: false, status, headers: { get: (h) => (h === 'Location' ? loc : null), getSetCookie: () => [] } });
    const ok = (b) => ({ ok: true, status: 200, headers: { getSetCookie: () => ['JSESSIONID=abc; Path=/'], get: () => null }, json: async () => b, text: async () => b });
    if (url.endsWith('settings.js')) return ok('{"apiToken":"TOK"}');
    if (url.includes('/authenticate')) return ok({ token: 'SESS' });
    if (url.includes('connect.xhtml')) return head(201, null);
    if (url.startsWith('https://www.cafeyn.co/loginexternal')) return head(302, 'https://api.cafeyn.co/users/login/external/648');
    if (url.startsWith('https://api.cafeyn.co/users')) return head(302, 'https://www.bmvr.marseille.fr/in/rest/cas/login?service=x');
    if (url.includes('/cas/login')) { assert.equal(opts.headers.Cookie, 'JSESSIONID=abc'); return head(302, 'https://api.cafeyn.co/users/login/external/648?ticket=ST-1'); }
    throw new Error('inattendu ' + url);
  };
  const u = await fetchServiceUrl({ username: 'u', password: 'p' }, 'cafeyn', fake);
  assert.equal(u, 'https://api.cafeyn.co/users/login/external/648?ticket=ST-1');
  assert.ok(!seen.some((x) => x.includes('ticket=')), 'le ticket ne doit pas être consommé par le relais');
});

test('titres et auteurs nettoyés', () => {
  assert.equal(cleanTitle('Les étoiles du football[ Texte imprimé : les meilleurs joueurs de la planète foot / Rodolphe Gaudin'), 'Les étoiles du football : les meilleurs joueurs de la planète foot');
  assert.equal(cleanTitle("L'encyclopédie du taekwondo. I Toutes les techniques[ Texte imprimé / G. M. Rémi Mollet"), "L'encyclopédie du taekwondo. I Toutes les techniques");
  assert.equal(cleanTitle('Dune'), 'Dune');
  assert.equal(cleanAuthor('Gaudin, Rodolphe 1975-....'), 'Rodolphe Gaudin');
  assert.equal(cleanAuthor('Mollet, Rémi 1960-....'), 'Rémi Mollet');
  assert.equal(cleanAuthor('Hugo, Victor (1802-1885)'), 'Victor Hugo');
});

test('règle de prolongation et message technique masqué', () => {
  const [a, b] = parseLoans([
    { seqNo: '1', title: 'A', returnDate: '2026-11-26', renewalCondition: 'OK', renewalConditionMessage: 'globalErrorLeg_list.OK', returnHour: '19:00:00', userRenewed: false },
    { seqNo: '2', title: 'B', returnDate: '2026-11-27', renewalCondition: 'OK', userRenewed: true },
  ]);
  assert.equal(a.canRenew, true);
  assert.equal(a.renewalMessage, '');
  assert.equal(a.returnHour, '19:00');
  assert.equal(b.canRenew, false);
});

test('prolongation : appel renewLoan avec le numéro de document', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    const ok = (b) => ({ ok: true, status: 200, headers: { getSetCookie: () => [], get: () => null }, json: async () => b, text: async () => b });
    if (url.endsWith('settings.js')) return ok('{"apiToken":"TOK"}');
    if (url.includes('/authenticate')) return ok({ token: 'SESS' });
    if (url.includes('connect.xhtml')) return { ok: true, status: 201, headers: { getSetCookie: () => [] } };
    if (url.includes('/renewLoan')) return ok({ extended: true, newReturnDate: '2026-12-24' });
    throw new Error('inattendu ' + url);
  };
  const r = await renewLoan({ username: 'u', password: 'p' }, 'DX2029', fake);
  assert.deepEqual([r.extended, r.newReturnDate], [true, '2026-12-24']);
  assert.ok(calls.some((u) => u.includes('renewLoan?documentId=DX2029')));
  await assert.rejects(() => renewLoan({ username: 'u', password: 'p' }, '../x', fake));
});

test('parseReservations et parseSearch', async () => {
  const { parseReservations, parseSearch } = await import('./src/portal.js');
  const r = parseReservations([{ data: { reservationId: 'R12', seqNo: '123', title: 'Dune [Texte imprimé] / Herbert', author: 'Herbert, Frank 1920-1986', rank: '2', canCancel: true, resvDate: '30/10/2026', dateFormat: 'dd/MM/yyyy', branch: { branchCode: 'ALC', desc: 'Alcazar' }, statusCode: 'ReservationCard.RESV_WAITING' } }]);
  assert.equal(r[0].title, 'Dune');
  assert.equal(r[0].reservedOn, '2026-10-30');
  assert.equal(r[0].rank, 2);
  assert.equal(r[0].branch, 'Alcazar');
  assert.ok(r[0].canCancel && !r[0].available);
  const s = parseSearch({ resultSet: [{ id: [{ value: 'p::usmarcdef_0000000123' }], title: [{ value: 'Dune' }], author: [{ value: 'Herbert, Frank' }] }] });
  assert.equal(s[0].author, 'Frank Herbert');
  assert.equal(s[0].coverId, 'p::usmarcdef_0000000123');
});

test('agenda : dates passées écartées, doublons fusionnés, notice sans id ignorée', () => {
  const res = { resultSet: [
    { id: [{ value: 'h::a' }], title: [{ value: 'Éveil' }], CalenderEventFacet: [{ value: '2026-11-05' }, { value: '2026-11-05' }, { value: '2026-10-01' }], meta: { startHour: [{ value: '10:00' }], libraryRelation: [{ value: 'Alcazar', relatedId: 'x' }] } },
    { id: [{ value: 'h::b' }], title: [{ value: 'Passé' }], CalenderEventFacet: [{ value: '2026-10-01' }] },
    { title: [{ value: 'Sans id' }], CalenderEventFacet: [{ value: '2026-11-05' }] },
  ] };
  const out = parseAgenda(res, '2026-11-02');
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].dates, ['2026-11-05']);
  assert.equal(out[0].hour, '10:00'); assert.equal(out[0].library, 'Alcazar');
});

test('htmlToText garde les paragraphes et retire les balises', () => {
  assert.equal(htmlToText('<p>Un &amp; deux</p><p>Trois<br>quatre</p><script>x()</script>'), 'Un & deux\n\nTrois\nquatre');
});

test('recherche avancée : champ, filtres et années validés', () => {
  const b = buildSearch('Hugo', { field: 'author', filters: { CodeLanguage: 'eng', evil: 'x', subject_s: ['A"B'] }, yearFrom: 1990, yearTo: '2000', order: 'SortkeyTitle_ASC' });
  assert.equal(b.query, 'author_t:"Hugo"');
  assert.deepEqual(b.fq, ['CodeLanguage:"eng"', 'subject_s:"A B"', 'DateOfPublication:[1990 TO 2000]']);
  assert.equal(b.order, 'SortkeyTitle_ASC');
  const c = buildSearch('x', { field: 'zzz', order: 'DROP', yearFrom: 5 });
  assert.equal(c.query, 'x'); assert.deepEqual(c.fq, []); assert.equal(c.order, undefined);
});
