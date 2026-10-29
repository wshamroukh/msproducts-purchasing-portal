'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderOrderPdf, _internal } = require('../src/orderPdf');

const order = {
  OrderId: 1, OrderNumber: 'ORD-000001', UserName: 'Test User', UserEmail: 't@contoso.com', ShipToName: 'Test User',
  ShipToAddress: 'Street 1', ShipToCity: 'Muscat', ShipToCountry: 'Oman', CostCenter: 'CC1', Status: 'Submitted',
  Total: 10, CreatedAt: '2026-10-29T10:00:00Z', UpdatedAt: '2026-10-29T10:00:00Z',
  items: [{ Sku: 'A', ProductName: 'Thing', UnitPrice: 5, Quantity: 2, LineTotal: 10 }], history: [],
};

test('renders a valid PDF document', () => {
  const pdf = renderOrderPdf(order);
  assert.ok(pdf.subarray(0, 8).toString().startsWith('%PDF-1.4'));
  assert.ok(pdf.subarray(-6).toString().includes('%%EOF'));
  assert.match(pdf.toString('latin1'), /\/Count 1 /);
});
test('adds pages for long orders', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ Sku: `S${i}`, ProductName: `P${i}`, UnitPrice: 1, Quantity: 1, LineTotal: 1 }));
  assert.match(renderOrderPdf({ ...order, items }).toString('latin1'), /\/Count [2-9] /);
});
test('encodes non-latin characters safely', () => {
  assert.deepStrictEqual([..._internal.toWinAnsi('é€—中')], [0xe9, 0x80, 0x97, 0x3f]);
});
test('rejects a missing order', () => {
  assert.throws(() => renderOrderPdf(null), /missing/);
});
