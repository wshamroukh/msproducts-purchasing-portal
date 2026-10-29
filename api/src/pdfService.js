'use strict';
/*
  Order PDFs: the API never renders PDFs itself. It
    - puts an order snapshot on the "order-pdf-requests" queue when an order is placed or changes
      (the Function App renders it into  order-pdfs/<orderId>/<version>.pdf),
    - serves the PDF for the CURRENT version of an order from Blob Storage (through the private
      endpoint, with the API's managed identity), or answers 202 "generating" and queues it on demand.
  Disabled (503) when PDF_STORAGE_ACCOUNT is not configured, e.g. in local development.
*/
const config = require('./config');
const { getOrderDetail } = require('./orderService');

const settings = {
  account: process.env.PDF_STORAGE_ACCOUNT || '',
  queue: process.env.PDF_QUEUE || 'order-pdf-requests',
  container: process.env.PDF_CONTAINER || 'order-pdfs',
};
const enabled = () => !!settings.account;

let clients = null;
function getClients() {
  if (!clients) {
    // Loaded lazily so local development works without Azure Storage configured
    const { DefaultAzureCredential } = require('@azure/identity');
    const { QueueClient } = require('@azure/storage-queue');
    const { BlobServiceClient } = require('@azure/storage-blob');
    const credential = new DefaultAzureCredential(
      config.sql.managedIdentityClientId ? { managedIdentityClientId: config.sql.managedIdentityClientId } : {});
    clients = {
      queue: new QueueClient(`https://${settings.account}.queue.core.windows.net/${settings.queue}`, credential),
      container: new BlobServiceClient(`https://${settings.account}.blob.core.windows.net`, credential)
        .getContainerClient(settings.container),
    };
  }
  return clients;
}

/** The PDF "version" of an order = its last update time in ms. Every change gets a new PDF. */
const versionOf = (order) => new Date(order.UpdatedAt || order.CreatedAt).getTime();
const blobName = (order) => `${order.OrderId}/${versionOf(order)}.pdf`;

/** Strips the order detail down to what the PDF needs (queue messages are limited to 64 KB). */
function snapshot(order) {
  const keep = ['OrderId', 'OrderNumber', 'UserName', 'UserEmail', 'ShipToName', 'ShipToAddress', 'ShipToCity',
    'ShipToCountry', 'Phone', 'CostCenter', 'Justification', 'Status', 'StoreName', 'StoreCity', 'StoreCountry',
    'TrackingNumber', 'Total', 'CreatedAt', 'UpdatedAt'];
  const s = Object.fromEntries(keep.map((k) => [k, order[k] ?? null]));
  s.items = (order.items || []).map(({ Sku, ProductName, UnitPrice, Quantity, LineTotal }) => ({ Sku, ProductName, UnitPrice, Quantity, LineTotal }));
  s.history = (order.history || []).map(({ Status, Note, ChangedBy, ChangedAt }) => ({ Status, Note, ChangedBy, ChangedAt }));
  return s;
}

const recentlyQueued = new Map(); // `${orderId}:${version}` -> time; avoids re-queuing while the client polls
async function requestPdf(order) {
  if (!enabled()) return false;
  const key = `${order.OrderId}:${versionOf(order)}`;
  const last = recentlyQueued.get(key);
  if (last && Date.now() - last < 30000) return true;
  let body = JSON.stringify({ orderId: order.OrderId, version: versionOf(order), order: snapshot(order) });
  if (Buffer.byteLength(body) > 45000) { // base64 adds 33%; keep well under 64 KB
    const s = snapshot(order);
    s.history = s.history.slice(-10);
    body = JSON.stringify({ orderId: order.OrderId, version: versionOf(order), order: s });
  }
  await getClients().queue.sendMessage(Buffer.from(body).toString('base64'));
  recentlyQueued.set(key, Date.now());
  if (recentlyQueued.size > 5000) recentlyQueued.clear();
  return true;
}

/**
 * Fire-and-forget: loads the order and queues its PDF. Never throws - placing or updating an order
 * must not fail because the PDF pipeline is unavailable.
 */
function queueOrderPdf(pool, orderId) {
  if (!enabled()) return;
  getOrderDetail(pool, orderId)
    .then((order) => order && requestPdf(order))
    .catch((err) => console.error(`[pdf] could not queue PDF for order ${orderId}: ${err.message}`));
}

/** Express helper: streams the PDF of the order's current version, or 202 while it is generated. */
async function sendOrderPdf(res, order) {
  if (!enabled()) return res.status(503).json({ error: 'PDF generation is not configured for this environment' });
  const blob = getClients().container.getBlockBlobClient(blobName(order));
  try {
    const buf = await blob.downloadToBuffer();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${order.OrderNumber}.pdf"`,
      'Content-Length': buf.length,
    });
    return res.send(buf);
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
  await requestPdf(order);
  res.set('Retry-After', '2');
  return res.status(202).json({ status: 'generating', message: 'The PDF is being generated - try again in a few seconds.' });
}

module.exports = { enabled, versionOf, blobName, snapshot, requestPdf, queueOrderPdf, sendOrderPdf, _settings: settings };
