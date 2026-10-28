'use strict';
const express = require('express');
const { getPool, sql } = require('../db');
const v = require('../validation');
const { getOrderDetail, restoreStock, addHistory } = require('../orderService');
const { invalidateProducts } = require('../productCache');

const router = express.Router();

// POST /api/orders  - checkout the cart
router.post('/', async (req, res, next) => {
  const body = req.body || {};
  let tx;
  try {
    // ---- validate input ----
    if (!Array.isArray(body.items) || body.items.length === 0) throw new v.ValidationError('Your cart is empty');
    if (body.items.length > 50) throw new v.ValidationError('An order can contain at most 50 different products');
    const lines = new Map();
    for (const item of body.items) {
      const productId = v.int(item && item.productId, 'productId', { required: true, min: 1 });
      const quantity = v.int(item && item.quantity, 'quantity', { required: true, min: 1, max: 100 });
      lines.set(productId, (lines.get(productId) || 0) + quantity);
    }
    const ship = body.shipping || {};
    const order = {
      shipToName: v.str(ship.name, 'Recipient name', { required: true, max: 200 }),
      shipToAddress: v.str(ship.address, 'Address', { required: true, max: 500 }),
      shipToCity: v.str(ship.city, 'City', { required: true, max: 100 }),
      shipToCountry: v.str(ship.country, 'Country', { required: true, max: 100 }),
      phone: v.str(ship.phone, 'Phone', { max: 50 }),
      costCenter: v.str(body.costCenter, 'Cost center', { required: true, max: 50 }),
      justification: v.str(body.justification, 'Business justification', { max: 1000 }),
    };

    const pool = await getPool();
    tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    // ---- price the cart on the server (never trust client prices) ----
    const priced = [];
    let total = 0;
    for (const [productId, quantity] of lines) {
      const p = (
        await new sql.Request(tx).input('id', sql.Int, productId).query(
          'SELECT ProductId, Sku, Name, Price, Stock, IsActive FROM dbo.Products WITH (UPDLOCK, ROWLOCK) WHERE ProductId = @id;'
        )
      ).recordset[0];
      if (!p || !p.IsActive) throw new v.ValidationError(`Product ${productId} is no longer available`);
      if (p.Stock < quantity) throw new v.ValidationError(`Only ${p.Stock} unit(s) of "${p.Name}" left in stock`);
      priced.push({ ...p, quantity });
      total += Number(p.Price) * quantity;
    }
    total = Math.round(total * 100) / 100;

    // ---- create order ----
    const created = (
      await new sql.Request(tx)
        .input('userOid', sql.NVarChar(64), req.user.oid)
        .input('userName', sql.NVarChar(200), req.user.name)
        .input('userEmail', sql.NVarChar(256), req.user.email)
        .input('shipToName', sql.NVarChar(200), order.shipToName)
        .input('shipToAddress', sql.NVarChar(500), order.shipToAddress)
        .input('shipToCity', sql.NVarChar(100), order.shipToCity)
        .input('shipToCountry', sql.NVarChar(100), order.shipToCountry)
        .input('phone', sql.NVarChar(50), order.phone)
        .input('costCenter', sql.NVarChar(50), order.costCenter)
        .input('justification', sql.NVarChar(1000), order.justification)
        .input('total', sql.Decimal(12, 2), total)
        .query(`
          INSERT INTO dbo.Orders (UserOid, UserName, UserEmail, ShipToName, ShipToAddress, ShipToCity, ShipToCountry, Phone, CostCenter, Justification, Total)
          OUTPUT INSERTED.OrderId, INSERTED.OrderNumber
          VALUES (@userOid, @userName, @userEmail, @shipToName, @shipToAddress, @shipToCity, @shipToCountry, @phone, @costCenter, @justification, @total);`)
    ).recordset[0];

    for (const p of priced) {
      await new sql.Request(tx)
        .input('orderId', sql.Int, created.OrderId)
        .input('productId', sql.Int, p.ProductId)
        .input('sku', sql.NVarChar(50), p.Sku)
        .input('name', sql.NVarChar(200), p.Name)
        .input('price', sql.Decimal(10, 2), p.Price)
        .input('qty', sql.Int, p.quantity)
        .query(`
          INSERT INTO dbo.OrderItems (OrderId, ProductId, Sku, ProductName, UnitPrice, Quantity)
          VALUES (@orderId, @productId, @sku, @name, @price, @qty);
          UPDATE dbo.Products SET Stock = Stock - @qty, UpdatedAt = SYSUTCDATETIME() WHERE ProductId = @productId;`);
    }
    await addHistory(tx, created.OrderId, 'Submitted', 'Order placed from the purchasing portal', req.user.email || req.user.name);
    await tx.commit();
    tx = null;
    invalidateProducts(); // stock changed

    res.status(201).json({ orderId: created.OrderId, orderNumber: created.OrderNumber, total });
  } catch (err) {
    if (tx) await tx.rollback().catch(() => {});
    next(err);
  }
});

// GET /api/orders  - my orders
router.get('/', async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().input('oid', sql.NVarChar(64), req.user.oid).query(`
      SELECT o.OrderId, o.OrderNumber, o.Status, o.Total, o.CreatedAt, o.UpdatedAt,
             (SELECT SUM(Quantity) FROM dbo.OrderItems i WHERE i.OrderId = o.OrderId) AS ItemCount
      FROM dbo.Orders o WHERE o.UserOid = @oid ORDER BY o.CreatedAt DESC, o.OrderId DESC;`);
    res.json(result.recordset);
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/:id  - one of my orders
router.get('/:id', async (req, res, next) => {
  try {
    const id = v.int(req.params.id, 'id', { required: true, min: 1 });
    const pool = await getPool();
    const order = await getOrderDetail(pool, id, { userOid: req.user.oid });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:id/cancel  - requester can cancel while still "Submitted"
router.post('/:id/cancel', async (req, res, next) => {
  let tx;
  try {
    const id = v.int(req.params.id, 'id', { required: true, min: 1 });
    const pool = await getPool();
    tx = new sql.Transaction(pool);
    await tx.begin();
    const o = (
      await new sql.Request(tx)
        .input('id', sql.Int, id)
        .input('oid', sql.NVarChar(64), req.user.oid)
        .query('SELECT OrderId, Status FROM dbo.Orders WITH (UPDLOCK) WHERE OrderId = @id AND UserOid = @oid;')
    ).recordset[0];
    if (!o) {
      await tx.rollback();
      tx = null;
      return res.status(404).json({ error: 'Order not found' });
    }
    if (o.Status !== 'Submitted') throw new v.ValidationError('Only orders that are still "Submitted" can be cancelled');
    await new sql.Request(tx).input('id', sql.Int, id)
      .query("UPDATE dbo.Orders SET Status = 'Cancelled', UpdatedAt = SYSUTCDATETIME() WHERE OrderId = @id;");
    await restoreStock(tx, id);
    await addHistory(tx, id, 'Cancelled', 'Cancelled by requester', req.user.email || req.user.name);
    await tx.commit();
    tx = null;
    invalidateProducts(); // stock returned
    res.json(await getOrderDetail(pool, id, { userOid: req.user.oid }));
  } catch (err) {
    if (tx) await tx.rollback().catch(() => {});
    next(err);
  }
});

module.exports = router;
