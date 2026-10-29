'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadTestUserFromClaims } = require('../src/auth');

const LT = '33333333-3333-3333-3333-333333333333';
const appToken = { idtyp: 'app', azp: LT, oid: 'sp-oid', sub: 'sp-oid', roles: [] };

test('allow-listed app-only token becomes a synthetic shopper', () => {
  const u = loadTestUserFromClaims(appToken, 'vu-42', [LT]);
  assert.strictEqual(u.oid, 'loadtest-vu-42');
  assert.deepStrictEqual(u.roles, []);
});
test('app-only token from another client is not accepted', () => {
  assert.strictEqual(loadTestUserFromClaims({ ...appToken, azp: 'other' }, 'vu-1', [LT]), null);
});
test('disabled when no client ids are configured', () => {
  assert.strictEqual(loadTestUserFromClaims(appToken, 'vu-1', []), null);
});
test('user (delegated) tokens are never treated as load-test tokens', () => {
  assert.strictEqual(loadTestUserFromClaims({ azp: LT, scp: 'access_as_user', oid: 'u', sub: 'x' }, 'vu-1', [LT]), null);
});
test('rejects a malformed synthetic user id', () => {
  assert.throws(() => loadTestUserFromClaims(appToken, "x'; DROP TABLE", [LT]), /x-loadtest-user/);
});
