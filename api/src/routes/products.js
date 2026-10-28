'use strict';
const express = require('express');
const { getPool, sql } = require('../db');
const { CATEGORIES } = require('../constants');
const v = require('../validation');

const router = express.Router();

// GET /api/products?category=Hardware&q=surface
router.get('/', async (req, res, next) => {
  try {
    const category = v.oneOf(req.query.category, 'category', CATEGORIES);
    const q = v.str(req.query.q, 'q', { max: 100 });
    const pool = await getPool();
    const r = pool.request();
    let where = 'IsActive = 1';
    if (category) {
      r.input('category', sql.NVarChar(50), category);
      where += ' AND Category = @category';
    }
    if (q) {
      r.input('q', sql.NVarChar(400), `%${q.replace(/[%_[]/g, '[$&]')}%`);
      where += ' AND (Name LIKE @q OR Description LIKE @q OR Sku LIKE @q)';
    }
    const result = await r.query(`
      SELECT ProductId, Sku, Name, Category, Description, Price, ImageUrl, Stock
      FROM dbo.Products WHERE ${where}
      ORDER BY CASE Category WHEN 'Hardware' THEN 1 WHEN 'Software' THEN 2 ELSE 3 END, Name;`);
    res.json(result.recordset);
  } catch (err) {
    next(err);
  }
});

router.get('/categories', (_req, res) => res.json(CATEGORIES));

// GET /api/products/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = v.int(req.params.id, 'id', { required: true, min: 1 });
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, id).query(`
      SELECT ProductId, Sku, Name, Category, Description, Price, ImageUrl, Stock
      FROM dbo.Products WHERE ProductId = @id AND IsActive = 1;`);
    if (!result.recordset[0]) return res.status(404).json({ error: 'Product not found' });
    res.json(result.recordset[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
