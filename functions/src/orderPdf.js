'use strict';
/*
  Zero-dependency PDF renderer for purchase orders (A4, Helvetica, WinAnsi encoding).
  Kept dependency-free on purpose: no native modules, no fonts to ship, fast cold start.

  renderOrderPdf(order, { generatedAt }) -> Buffer
  `order` is the order snapshot the API puts on the queue (same shape as GET /api/orders/:id).
*/
const zlib = require('zlib');

const WIDTHS = {
  'Helvetica': [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,556,222,556,333,1000,556,556,333,1000,667,333,1000,556,611,556,556,222,222,333,333,350,556,1000,333,1000,500,333,944,556,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500],
  'Helvetica-Bold': [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,611,278,556,500,1000,556,556,333,1000,667,333,1000,611,611,611,611,278,278,500,500,350,556,1000,333,1000,556,333,944,611,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556],
};

// ----------------------------------------------------------------- text encoding
const CP1252_EXTRA = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
function toWinAnsi(str) {
  const out = [];
  for (const ch of String(str ?? '')) {
    const c = ch.codePointAt(0);
    if (c === 0x09 || c === 0x0a || c === 0x0d) out.push(0x20);
    else if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else if (CP1252_EXTRA[c]) out.push(CP1252_EXTRA[c]);
    else out.push(0x3f); // '?'
  }
  return Buffer.from(out);
}
function textWidth(str, font, size) {
  const w = WIDTHS[font];
  let total = 0;
  for (const b of toWinAnsi(str)) total += b >= 32 ? w[b - 32] : 0;
  return (total * size) / 1000;
}
function fit(str, font, size, maxWidth) {
  let s = String(str ?? '');
  if (textWidth(s, font, size) <= maxWidth) return s;
  while (s.length > 1 && textWidth(`${s}…`, font, size) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
function wrap(str, font, size, maxWidth, maxLines = 50) {
  const words = String(str ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, font, size) <= maxWidth) { line = next; continue; }
    if (line) lines.push(line);
    line = textWidth(word, font, size) <= maxWidth ? word : fit(word, font, size, maxWidth);
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(`${kept[maxLines - 1]} …`, font, size, maxWidth);
    return kept;
  }
  return lines;
}

// ----------------------------------------------------------------- formatting
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0));
function utcDate(d) {
  if (!d) return '';
  const s = typeof d === 'string' && !/[zZ]|[+-]\d\d:\d\d$/.test(d) ? `${d}Z` : d;
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return String(d);
  return `${dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC`;
}
const STATUS_LABELS = { Submitted: 'Submitted', Processing: 'Processing', SentToStore: 'Sent to store', Delivered: 'Delivered', Cancelled: 'Cancelled' };
const STATUS_COLORS = {
  Submitted: [0.0, 0.31, 0.55], Processing: [0.54, 0.33, 0.0], SentToStore: [0.36, 0.18, 0.57],
  Delivered: [0.04, 0.42, 0.04], Cancelled: [0.64, 0.15, 0.17],
};

// ----------------------------------------------------------------- page drawing
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 42; // margin
const BRAND = [0.0, 0.40, 0.72];
const INK = [0.11, 0.11, 0.12];
const MUTED = [0.37, 0.39, 0.41];
const RULE = [0.89, 0.90, 0.91];
const F = { reg: 'Helvetica', bold: 'Helvetica-Bold' };
const FONT_KEY = { Helvetica: 'F1', 'Helvetica-Bold': 'F2' };
const n = (x) => (Math.round(x * 100) / 100).toString();

class Page {
  constructor() { this.ops = []; }
  color(rgb, stroke = false) { this.ops.push(`${rgb.map(n).join(' ')} ${stroke ? 'RG' : 'rg'}`); return this; }
  rect(x, y, w, h, rgb) { this.color(rgb).ops.push(`${n(x)} ${n(PAGE_H - y - h)} ${n(w)} ${n(h)} re f`); return this; }
  line(x1, y1, x2, y2, rgb = RULE, width = 0.75) {
    this.color(rgb, true).ops.push(`${n(width)} w ${n(x1)} ${n(PAGE_H - y1)} m ${n(x2)} ${n(PAGE_H - y2)} l S`);
    return this;
  }
  // y = baseline measured from the top of the page
  text(str, x, y, { font = F.reg, size = 10, rgb = INK, align = 'left', maxWidth } = {}) {
    let s = String(str ?? '');
    if (maxWidth) s = fit(s, font, size, maxWidth);
    const w = textWidth(s, font, size);
    const tx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.color(rgb).ops.push(`BT /${FONT_KEY[font]} ${n(size)} Tf ${n(tx)} ${n(PAGE_H - y)} Td <${toWinAnsi(s).toString('hex')}> Tj ET`);
    return this;
  }
}

// ----------------------------------------------------------------- PDF file assembly
function buildPdf(pages, info) {
  const objects = []; // index = object number - 1
  const add = (body) => { objects.push(body); return objects.length; };
  const catalogId = add(null);
  const pagesId = add(null);
  const f1 = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  const f2 = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
  const kids = [];
  for (const p of pages) {
    const data = zlib.deflateSync(Buffer.from(p.ops.join('\n'), 'latin1'));
    const contentId = add(Buffer.concat([
      Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`), data, Buffer.from('\nendstream'),
    ]));
    kids.push(add(Buffer.from(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] ` +
      `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`)));
  }
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const pdfStr = (s) => `<FEFF${Buffer.from(String(s), 'utf16le').swap16().toString('hex')}>`;
  const d = info.createdAt;
  const pdfDate = `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}` +
    `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`;
  const infoId = add(Buffer.from(
    `<< /Title ${pdfStr(info.title)} /Author ${pdfStr(info.author)} /Producer (msstore order-pdf function) /CreationDate (${pdfDate}) >>`));

  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = parts[0].length;
  const offsets = [];
  objects.forEach((body, i) => {
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    offsets.push(offset);
    offset += chunk.length;
    parts.push(chunk);
  });
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `)].join('\n');
  parts.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return Buffer.concat(parts);
}

// ----------------------------------------------------------------- order layout
function renderOrderPdf(order, { generatedAt = new Date(), appTitle = 'Microsoft Products Purchasing Portal' } = {}) {
  if (!order || !order.OrderNumber) throw new Error('renderOrderPdf: order snapshot is missing');
  const items = Array.isArray(order.items) ? order.items : [];
  const history = Array.isArray(order.history) ? order.history : [];
  const pages = [];
  let page;
  let y;
  const bottom = PAGE_H - 60;

  const newPage = (continued) => {
    page = new Page();
    pages.push(page);
    // header band
    page.rect(0, 0, PAGE_W, continued ? 56 : 92, BRAND);
    const sq = [[0.95, 0.31, 0.13], [0.5, 0.73, 0.0], [0.0, 0.64, 0.94], [1.0, 0.73, 0.0]];
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([cx, cy], i) => page.rect(M + cx * 9, 20 + cy * 9, 8, 8, sq[i]));
    page.text(appTitle, M + 26, 33, { font: F.bold, size: 11, rgb: [1, 1, 1] });
    if (continued) {
      page.text(`Purchase order ${order.OrderNumber} (continued)`, PAGE_W - M, 33, { size: 10, rgb: [1, 1, 1], align: 'right' });
      y = 86;
    } else {
      page.text('PURCHASE ORDER', M, 70, { font: F.bold, size: 20, rgb: [1, 1, 1] });
      page.text(order.OrderNumber, PAGE_W - M, 70, { font: F.bold, size: 20, rgb: [1, 1, 1], align: 'right' });
      y = 120;
    }
  };
  const ensure = (h) => { if (y + h > bottom) newPage(true); };
  const heading = (label) => {
    ensure(40);
    y += 8;
    page.text(label.toUpperCase(), M, y, { font: F.bold, size: 9, rgb: BRAND });
    page.line(M, y + 6, PAGE_W - M, y + 6, BRAND, 1);
    y += 22;
  };

  newPage(false);

  // ---- status + summary row
  const status = order.Status || 'Submitted';
  const label = STATUS_LABELS[status] || status;
  const sw = textWidth(label, F.bold, 10) + 20;
  page.rect(M, y - 13, sw, 19, STATUS_COLORS[status] || MUTED);
  page.text(label, M + sw / 2, y, { font: F.bold, size: 10, rgb: [1, 1, 1], align: 'center' });
  page.text(`Placed ${utcDate(order.CreatedAt)}`, M + sw + 12, y, { size: 10, rgb: MUTED });
  page.text(money(order.Total), PAGE_W - M, y + 2, { font: F.bold, size: 16, align: 'right' });
  y += 30;

  // ---- three info columns
  const colW = (PAGE_W - 2 * M - 30) / 3;
  const cols = [
    ['Requester', [order.UserName, order.UserEmail, '', `Cost center: ${order.CostCenter || '-'}`]],
    ['Deliver to', [order.ShipToName, ...wrap(order.ShipToAddress, F.reg, 9.5, colW, 3), `${order.ShipToCity || ''}, ${order.ShipToCountry || ''}`, order.Phone]],
    ['Fulfilment', order.StoreName
      ? [order.StoreName, `${order.StoreCity || ''}, ${order.StoreCountry || ''}`, order.TrackingNumber ? `Tracking: ${order.TrackingNumber}` : '']
      : ['Not yet assigned to a store']],
  ];
  let maxRows = 0;
  cols.forEach(([title, lines], i) => {
    const x = M + i * (colW + 15);
    page.text(title.toUpperCase(), x, y, { font: F.bold, size: 8, rgb: MUTED });
    const clean = lines.filter((l) => l !== undefined && l !== null);
    clean.forEach((l, r) => page.text(l, x, y + 15 + r * 13, { size: 9.5, font: r === 0 ? F.bold : F.reg, maxWidth: colW }));
    maxRows = Math.max(maxRows, clean.length);
  });
  y += 15 + maxRows * 13 + 8;

  // ---- items table
  heading(`Items (${items.reduce((s, i) => s + Number(i.Quantity || 0), 0)})`);
  const cx = { sku: M + 6, name: M + 92, qty: PAGE_W - M - 170, unit: PAGE_W - M - 82, total: PAGE_W - M - 6 };
  const tableHeader = () => {
    page.rect(M, y - 12, PAGE_W - 2 * M, 18, [0.96, 0.97, 0.98]);
    page.text('SKU', cx.sku, y, { font: F.bold, size: 8, rgb: MUTED });
    page.text('PRODUCT', cx.name, y, { font: F.bold, size: 8, rgb: MUTED });
    page.text('QTY', cx.qty, y, { font: F.bold, size: 8, rgb: MUTED, align: 'right' });
    page.text('UNIT PRICE', cx.unit, y, { font: F.bold, size: 8, rgb: MUTED, align: 'right' });
    page.text('LINE TOTAL', cx.total, y, { font: F.bold, size: 8, rgb: MUTED, align: 'right' });
    y += 20;
  };
  tableHeader();
  items.forEach((it, idx) => {
    if (y + 18 > bottom) { newPage(true); tableHeader(); }
    if (idx % 2 === 1) page.rect(M, y - 12, PAGE_W - 2 * M, 18, [0.985, 0.985, 0.99]);
    const lineTotal = it.LineTotal ?? Number(it.UnitPrice || 0) * Number(it.Quantity || 0);
    page.text(it.Sku, cx.sku, y, { size: 8.5, rgb: MUTED, maxWidth: cx.name - cx.sku - 8 });
    page.text(it.ProductName, cx.name, y, { size: 9.5, maxWidth: cx.qty - cx.name - 40 });
    page.text(String(it.Quantity), cx.qty, y, { size: 9.5, align: 'right' });
    page.text(money(it.UnitPrice), cx.unit, y, { size: 9.5, align: 'right' });
    page.text(money(lineTotal), cx.total, y, { size: 9.5, align: 'right', font: F.bold });
    y += 18;
  });
  ensure(30);
  page.line(M, y - 8, PAGE_W - M, y - 8, INK, 1);
  page.text('Total', cx.unit, y + 8, { font: F.bold, size: 11, align: 'right' });
  page.text(money(order.Total), cx.total, y + 8, { font: F.bold, size: 11, align: 'right' });
  y += 30;

  // ---- justification
  if (order.Justification) {
    heading('Business justification');
    for (const l of wrap(order.Justification, F.reg, 9.5, PAGE_W - 2 * M, 12)) {
      ensure(14);
      page.text(l, M, y, { size: 9.5 });
      y += 13;
    }
    y += 6;
  }

  // ---- history
  if (history.length) {
    heading('Status history');
    for (const h of history) {
      const note = h.Note ? wrap(h.Note, F.reg, 9, PAGE_W - 2 * M - 120, 3) : [];
      ensure(16 + note.length * 12);
      page.text(STATUS_LABELS[h.Status] || h.Status, M, y, { font: F.bold, size: 9.5, rgb: STATUS_COLORS[h.Status] || INK });
      page.text(`${utcDate(h.ChangedAt)}  ·  ${h.ChangedBy || ''}`, M + 120, y, { size: 9, rgb: MUTED, maxWidth: PAGE_W - 2 * M - 120 });
      y += 13;
      note.forEach((l) => { page.text(l, M + 120, y, { size: 9 }); y += 12; });
      y += 5;
    }
  }

  // ---- footer on every page
  pages.forEach((p, i) => {
    p.line(M, PAGE_H - 40, PAGE_W - M, PAGE_H - 40, RULE, 0.75);
    p.text(`Generated ${utcDate(generatedAt)}  ·  reflects the order as of ${utcDate(order.UpdatedAt || order.CreatedAt)}`, M, PAGE_H - 26, { size: 7.5, rgb: MUTED });
    p.text(`Page ${i + 1} of ${pages.length}`, PAGE_W - M, PAGE_H - 26, { size: 7.5, rgb: MUTED, align: 'right' });
  });

  return buildPdf(pages, { title: `Purchase order ${order.OrderNumber}`, author: appTitle, createdAt: generatedAt });
}

module.exports = { renderOrderPdf, _internal: { toWinAnsi, textWidth, wrap, fit } };
