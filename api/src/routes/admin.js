'use strict';
const express = require('express');
const { getPool, sql } = require('../db');
const v = require('../validation');
const { CATEGORIES, STATUSES, TRANSITIONS } = require('../constants');
const { getOrderDetail, restoreStock, addHistory } = require('../orderService');

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/* ------------------------------ Dashboard ------------------------------ */

router.get('/stats', wrap(async (_req, res) => {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT Status, COUNT(*) AS Count, SUM(Total) AS Amount FROM dbo.Orders GROUP BY Status;

    SELECT COUNT(*) AS Orders, ISNULL(SUM(CASE WHEN Status <> 'Cancelled' THEN Total END), 0) AS Revenue,
           COUNT(DISTINCT UserOid) AS Customers
    FROM dbo.Orders;

    SELECT TOP 5 i.ProductId, i.ProductName, SUM(i.Quantity) AS Units, SUM(i.Quantity * i.UnitPrice) AS Amount
    FROM dbo.OrderItems i JOIN dbo.Orders o ON o.OrderId = i.OrderId
    WHERE o.Status <> 'Cancelled'
    GROUP BY i.ProductId, i.ProductName ORDER BY Units DESC;

    SELECT ProductId, Name, Stock FROM dbo.Products WHERE IsActive = 1 AND Stock < 10 ORDER BY Stock;
  `);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, { count: 0, amount: 0 }]));
  for (const row of r.recordsets[0]) byStatus[row.Status] = { count: row.Count, amount: Number(row.Amount) };
  res.json({ byStatus, totals: r.recordsets[1][0], topProducts: r.recordsets[2], lowStock: r.recordsets[3] });
}));

/* ------------------------------- Orders -------------------------------- */

// GET /api/admin/orders?status=Submitted&q=ORD-001000
router.get('/orders', wrap(async (req, res) => {
  const status = v.oneOf(req.query.status, 'status', STATUSES);
  const q = v.str(req.query.q, 'q', { max: 100 });
  const pool = await getPool();
  const r = pool.request();
  let where = '1 = 1';
  if (status) {
    r.input('status', sql.NVarChar(30), status);
    where += ' AND o.Status = @status';
  }
  if (q) {
    r.input('q', sql.NVarChar(400), `%${q.replace(/[%_[]/g, '[$&]')}%`);
    where += ' AND (o.OrderNumber LIKE @q OR o.UserName LIKE @q OR o.UserEmail LIKE @q OR o.CostCenter LIKE @q)';
  }
  const result = await r.query(`
    SELECT TOP 500 o.OrderId, o.OrderNumber, o.UserName, o.UserEmail, o.ShipToCity, o.ShipToCountry, o.CostCenter,
           o.Status, o.Total, o.CreatedAt, o.UpdatedAt, s.Name AS StoreName,
           (SELECT SUM(Quantity) FROM dbo.OrderItems i WHERE i.OrderId = o.OrderId) AS ItemCount
    FROM dbo.Orders o LEFT JOIN dbo.Stores s ON s.StoreId = o.StoreId
    WHERE ${where}
    ORDER BY o.CreatedAt DESC, o.OrderId DESC;`);
  res.json(result.recordset);
}));

router.get('/orders/:id', wrap(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const order = await getOrderDetail(await getPool(), id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ ...order, allowedTransitions: TRANSITIONS[order.Status] || [] });
}));

// PATCH /api/admin/orders/:id/status  { status, storeId?, trackingNumber?, note? }
router.patch('/orders/:id/status', wrap(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const body = req.body || {};
  const status = v.oneOf(body.status, 'status', STATUSES, { required: true });
  const storeId = v.int(body.storeId, 'storeId', { min: 1 });
  const trackingNumber = v.str(body.trackingNumber, 'Tracking number', { max: 100 });
  const note = v.str(body.note, 'Note', { max: 1000 });

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const o = (await new sql.Request(tx).input('id', sql.Int, id)
      .query('SELECT OrderId, Status, StoreId FROM dbo.Orders WITH (UPDLOCK) WHERE OrderId = @id;')).recordset[0];
    if (!o) throw Object.assign(new Error('Order not found'), { status: 404 });
    if (!(TRANSITIONS[o.Status] || []).includes(status)) {
      throw new v.ValidationError(`An order cannot move from "${o.Status}" to "${status}"`);
    }

    let newStoreId = o.StoreId;
    let historyNote = note;
    if (status === 'SentToStore') {
      if (!storeId) throw new v.ValidationError('Choose the store that will deliver this order');
      const store = (await new sql.Request(tx).input('sid', sql.Int, storeId)
        .query('SELECT StoreId, Name, City FROM dbo.Stores WHERE StoreId = @sid AND IsActive = 1;')).recordset[0];
      if (!store) throw new v.ValidationError('Store not found or inactive');
      newStoreId = store.StoreId;
      historyNote = `Dispatched to ${store.Name} (${store.City})${note ? ' - ' + note : ''}`;
    }

    await new sql.Request(tx)
      .input('id', sql.Int, id)
      .input('status', sql.NVarChar(30), status)
      .input('storeId', sql.Int, newStoreId)
      .input('tracking', sql.NVarChar(100), trackingNumber)
      .query(`UPDATE dbo.Orders
              SET Status = @status, StoreId = @storeId,
                  TrackingNumber = COALESCE(@tracking, TrackingNumber),
                  UpdatedAt = SYSUTCDATETIME()
              WHERE OrderId = @id;`);
    if (status === 'Cancelled') await restoreStock(tx, id);
    await addHistory(tx, id, status, historyNote, req.user.email || req.user.name);
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
  const order = await getOrderDetail(pool, id);
  res.json({ ...order, allowedTransitions: TRANSITIONS[order.Status] || [] });
}));

/* ------------------------------ Products ------------------------------- */

function readProduct(body) {
  return {
    sku: v.str(body.sku, 'SKU', { required: true, max: 50 }),
    name: v.str(body.name, 'Name', { required: true, max: 200 }),
    category: v.oneOf(body.category, 'Category', CATEGORIES, { required: true }),
    description: v.str(body.description, 'Description', { max: 2000 }),
    price: v.money(body.price, 'Price', { required: true }),
    imageUrl: v.url(body.imageUrl, 'Image URL'),
    stock: v.int(body.stock, 'Stock', { required: true, min: 0, max: 1000000 }),
    isActive: body.isActive === undefined ? true : !!body.isActive,
  };
}

function bindProduct(r, p) {
  return r
    .input('sku', sql.NVarChar(50), p.sku)
    .input('name', sql.NVarChar(200), p.name)
    .input('category', sql.NVarChar(50), p.category)
    .input('description', sql.NVarChar(2000), p.description)
    .input('price', sql.Decimal(10, 2), p.price)
    .input('imageUrl', sql.NVarChar(500), p.imageUrl)
    .input('stock', sql.Int, p.stock)
    .input('isActive', sql.Bit, p.isActive);
}

const isDuplicate = (err) => err && (err.number === 2627 || err.number === 2601);

router.get('/categories', (_req, res) => res.json(CATEGORIES));

router.get('/products', wrap(async (_req, res) => {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT p.*, (SELECT ISNULL(SUM(i.Quantity),0) FROM dbo.OrderItems i JOIN dbo.Orders o ON o.OrderId = i.OrderId
                 WHERE i.ProductId = p.ProductId AND o.Status <> 'Cancelled') AS UnitsSold
    FROM dbo.Products p ORDER BY p.Category, p.Name;`);
  res.json(r.recordset);
}));

router.get('/products/:id', wrap(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const r = await (await getPool()).request().input('id', sql.Int, id).query('SELECT * FROM dbo.Products WHERE ProductId = @id;');
  if (!r.recordset[0]) return res.status(404).json({ error: 'Product not found' });
  res.json(r.recordset[0]);
}));

router.post('/products', wrap(async (req, res) => {
  const p = readProduct(req.body || {});
  try {
    const r = await bindProduct((await getPool()).request(), p).query(`
      INSERT INTO dbo.Products (Sku, Name, Category, Description, Price, ImageUrl, Stock, IsActive)
      OUTPUT INSERTED.*
      VALUES (@sku, @name, @category, @description, @price, @imageUrl, @stock, @isActive);`);
    res.status(201).json(r.recordset[0]);
  } catch (err) {
    if (isDuplicate(err)) throw new v.ValidationError(`A product with SKU "${p.sku}" already exists`);
    throw err;
  }
}));

router.put('/products/:id', wrap(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const p = readProduct(req.body || {});
  try {
    const r = await bindProduct((await getPool()).request(), p).input('id', sql.Int, id).query(`
      UPDATE dbo.Products
      SET Sku = @sku, Name = @name, Category = @category, Description = @description, Price = @price,
          ImageUrl = @imageUrl, Stock = @stock, IsActive = @isActive, UpdatedAt = SYSUTCDATETIME()
      OUTPUT INSERTED.*
      WHERE ProductId = @id;`);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Product not found' });
    res.json(r.recordset[0]);
  } catch (err) {
    if (isDuplicate(err)) throw new v.ValidationError(`A product with SKU "${p.sku}" already exists`);
    throw err;
  }
}));

/* ------------------------------- Stores -------------------------------- */

router.get('/stores', wrap(async (_req, res) => {
  const r = await (await getPool()).request().query(`
    SELECT s.*, (SELECT COUNT(*) FROM dbo.Orders o WHERE o.StoreId = s.StoreId AND o.Status = 'SentToStore') AS OpenDeliveries
    FROM dbo.Stores s ORDER BY s.Name;`);
  res.json(r.recordset);
}));

function readStore(body) {
  return {
    name: v.str(body.name, 'Store name', { required: true, max: 100 }),
    city: v.str(body.city, 'City', { required: true, max: 100 }),
    country: v.str(body.country, 'Country', { required: true, max: 100 }),
    email: v.str(body.email, 'Email', { max: 256 }),
    phone: v.str(body.phone, 'Phone', { max: 50 }),
    isActive: body.isActive === undefined ? true : !!body.isActive,
  };
}
const bindStore = (r, s) => r
  .input('name', sql.NVarChar(100), s.name)
  .input('city', sql.NVarChar(100), s.city)
  .input('country', sql.NVarChar(100), s.country)
  .input('email', sql.NVarChar(256), s.email)
  .input('phone', sql.NVarChar(50), s.phone)
  .input('isActive', sql.Bit, s.isActive);

router.post('/stores', wrap(async (req, res) => {
  const s = readStore(req.body || {});
  const r = await bindStore((await getPool()).request(), s).query(`
    INSERT INTO dbo.Stores (Name, City, Country, Email, Phone, IsActive) OUTPUT INSERTED.*
    VALUES (@name, @city, @country, @email, @phone, @isActive);`);
  res.status(201).json(r.recordset[0]);
}));

router.put('/stores/:id', wrap(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const s = readStore(req.body || {});
  const r = await bindStore((await getPool()).request(), s).input('id', sql.Int, id).query(`
    UPDATE dbo.Stores SET Name = @name, City = @city, Country = @country, Email = @email, Phone = @phone, IsActive = @isActive
    OUTPUT INSERTED.* WHERE StoreId = @id;`);
  if (!r.recordset[0]) return res.status(404).json({ error: 'Store not found' });
  res.json(r.recordset[0]);
}));

module.exports = router;
