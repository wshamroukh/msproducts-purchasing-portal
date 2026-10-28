'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { getActiveProducts, invalidateProducts } = require('../src/productCache');

function fakePool() {
  const pool = { calls: 0, request: () => ({ query: async () => { pool.calls++; return { recordset: [{ ProductId: pool.calls }] }; } }) };
  return pool;
}

test('serves repeated and concurrent reads from one query', async () => {
  invalidateProducts();
  const pool = fakePool();
  await Promise.all([getActiveProducts(pool), getActiveProducts(pool), getActiveProducts(pool)]);
  await getActiveProducts(pool);
  assert.strictEqual(pool.calls, 1);
});

test('reloads after invalidation', async () => {
  invalidateProducts();
  const pool = fakePool();
  await getActiveProducts(pool);
  invalidateProducts();
  const data = await getActiveProducts(pool);
  assert.strictEqual(pool.calls, 2);
  assert.strictEqual(data[0].ProductId, 2);
});
