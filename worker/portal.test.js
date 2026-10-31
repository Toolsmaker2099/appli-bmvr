import test from 'node:test';
import assert from 'node:assert/strict';
import { checksum, fetchLoans, parseLoans } from './src/portal.js';

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
    if (url.includes('/authenticate')) return ok({ token: 'SESS' });
    if (url.includes('/loans')) return ok({ items: [{ seqNo: 'x7', data: { dateDue: 1793000000000 } }] });
    if (url.includes('/resolveBySeqNo')) return ok({ resultSet: [{ id: [{ value: 'x7' }], title: ['Dune'], author: ['Herbert'] }] });
    throw new Error('inattendu ' + url);
  };
  const { loans } = await fetchLoans({ username: 'u', password: 'p' }, fake);
  assert.deepEqual(loans.map((l) => [l.title, l.author]), [['Dune', 'Herbert']]);
  const auth = calls.find(([u]) => u.includes('/loans'))[1].headers['X-InMedia-Authorization'];
  assert.equal(auth, `Bearer SESS TOK ${checksum('?locale=fr')}`);
  assert.equal(calls.find(([u]) => u.includes('/loans'))[1].headers.Cookie, 'JSESSIONID=abc');
});

test('parseLoans ignore les lignes sans date', () => {
  assert.equal(parseLoans({ items: [{ seqNo: 1 }] }).length, 0);
});
