import test from 'node:test';
import assert from 'node:assert/strict';
import { checksum, fetchLoans, fetchServiceUrl, parseLoans, toISODate } from './src/portal.js';

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
