'use strict';
const { sql } = require('./db');

/** Loads an order with its items, status history and assigned store. Returns null if not found. */
async function getOrderDetail(pool, orderId, { userOid } = {}) {
  const r = pool.request().input('orderId', sql.Int, orderId);
  let filter = 'o.OrderId = @orderId';
  if (userOid) {
    r.input('userOid', sql.NVarChar(64), userOid);
    filter += ' AND o.UserOid = @userOid';
  }
  const result = await r.query(`
    SELECT o.*, s.Name AS StoreName, s.City AS StoreCity, s.Country AS StoreCountry, s.Email AS StoreEmail, s.Phone AS StorePhone
    FROM dbo.Orders o LEFT JOIN dbo.Stores s ON s.StoreId = o.StoreId
    WHERE ${filter};

    SELECT i.OrderItemId, i.ProductId, i.Sku, i.ProductName, i.UnitPrice, i.Quantity,
           (i.UnitPrice * i.Quantity) AS LineTotal, p.Category, p.ImageUrl
    FROM dbo.OrderItems i JOIN dbo.Products p ON p.ProductId = i.ProductId
    WHERE i.OrderId = @orderId ORDER BY i.OrderItemId;

    SELECT HistoryId, Status, Note, ChangedBy, ChangedAt
    FROM dbo.OrderHistory WHERE OrderId = @orderId ORDER BY ChangedAt, HistoryId;
  `);
  const order = result.recordsets[0][0];
  if (!order) return null;
  return { ...order, items: result.recordsets[1], history: result.recordsets[2] };
}

/** Puts the stock of a cancelled order back (inside an existing transaction). */
async function restoreStock(tx, orderId) {
  await new sql.Request(tx).input('orderId', sql.Int, orderId).query(`
    UPDATE p SET p.Stock = p.Stock + i.Quantity, p.UpdatedAt = SYSUTCDATETIME()
    FROM dbo.Products p JOIN dbo.OrderItems i ON i.ProductId = p.ProductId
    WHERE i.OrderId = @orderId;
  `);
}

async function addHistory(tx, orderId, status, note, changedBy) {
  await new sql.Request(tx)
    .input('orderId', sql.Int, orderId)
    .input('status', sql.NVarChar(30), status)
    .input('note', sql.NVarChar(1000), note || null)
    .input('changedBy', sql.NVarChar(256), changedBy)
    .query('INSERT INTO dbo.OrderHistory (OrderId, Status, Note, ChangedBy) VALUES (@orderId, @status, @note, @changedBy);');
}

module.exports = { getOrderDetail, restoreStock, addHistory };
