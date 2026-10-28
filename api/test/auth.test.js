'use strict';
// Unit tests for token validation: run with `npm test` (no network or database needed)
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { verifyToken } = require('../src/auth');

const TENANT = '11111111-1111-1111-1111-111111111111';
const CLIENT = '22222222-2222-2222-2222-222222222222';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function sign(claims, key = privateKey) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg: 'RS256', typ: 'JWT', kid: 'k1' })}.${enc(claims)}`;
  return `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), key).toString('base64url')}`;
}
const now = Math.floor(Date.now() / 1000);
const good = { iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: CLIENT, tid: TENANT, oid: 'abc', exp: now + 600, nbf: now - 10, scp: 'access_as_user', roles: ['Store.Admin'] };
const opts = { tenantId: TENANT, clientId: CLIENT, getKey: async () => publicKey };

test('accepts a valid token', async () => {
  const c = await verifyToken(sign(good), opts);
  assert.strictEqual(c.oid, 'abc');
});
test('rejects wrong audience', async () => {
  await assert.rejects(verifyToken(sign({ ...good, aud: 'other' }), opts), /audience/);
});
test('rejects wrong issuer', async () => {
  await assert.rejects(verifyToken(sign({ ...good, iss: 'https://evil/' }), opts), /issuer/);
});
test('rejects expired token', async () => {
  await assert.rejects(verifyToken(sign({ ...good, exp: now - 3600 }), opts), /expired/);
});
test('rejects bad signature', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(verifyToken(sign(good, other), opts), /signature/);
});
