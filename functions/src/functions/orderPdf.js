'use strict';
/*
  Queue-triggered function: the API puts an order snapshot on the "order-pdf-requests" queue whenever
  an order is placed or changes status (and when a requester asks for a PDF that does not exist yet).
  This function renders the PDF and writes it to   order-pdfs/<orderId>/<version>.pdf
  where <version> is the order's UpdatedAt timestamp, so every status change gets its own PDF and the
  API always serves the PDF that matches the current state of the order.

  Connections are identity based (managed identity, no keys):
    PdfStorage__queueServiceUri / PdfStorage__blobServiceUri
*/
const { app, output } = require('@azure/functions');
const { renderOrderPdf } = require('../orderPdf');

const QUEUE = 'order-pdf-requests';
const CONTAINER = 'order-pdfs';

const pdfBlob = output.storageBlob({
  path: `${CONTAINER}/{orderId}/{version}.pdf`,
  connection: 'PdfStorage',
});

async function handler(message, context) {
  const msg = typeof message === 'string' ? JSON.parse(message) : message;
  if (!msg || !Number.isInteger(msg.orderId) || !/^\d{1,16}$/.test(String(msg.version)) || !msg.order) {
    // Malformed messages are not retried - log and drop them
    context.error('Invalid order-pdf message, ignoring it:', JSON.stringify(msg).slice(0, 300));
    return;
  }
  if (msg.order.OrderId !== msg.orderId) {
    context.error(`Order id mismatch (${msg.orderId} vs ${msg.order.OrderId}), ignoring message`);
    return;
  }
  const started = Date.now();
  const pdf = renderOrderPdf(msg.order, { generatedAt: new Date() });
  context.extraOutputs.set(pdfBlob, pdf);
  context.log(`Rendered ${msg.order.OrderNumber} (${msg.order.Status}, version ${msg.version}): ` +
    `${pdf.length} bytes in ${Date.now() - started} ms -> ${CONTAINER}/${msg.orderId}/${msg.version}.pdf`);
}

app.storageQueue('orderPdf', {
  queueName: QUEUE,
  connection: 'PdfStorage',
  extraOutputs: [pdfBlob],
  handler,
});

module.exports = { handler, pdfBlob };
