'use strict';
const express = require('express');
const { getPool } = require('../db');
const { getActiveProducts } = require('../productCache');
const { CATEGORIES } = require('../constants');
const v = require('../validation');

const router = express.Router();

// GET /api/products?category=Hardware&q=surface   (served from the in-memory catalog cache)
router.get('/', async (req, res, next) => {
  try {
    const category = v.oneOf(req.query.category, 'category', CATEGORIES);
    const q = (v.str(req.query.q, 'q', { max: 100 }) || '').toLowerCase();
    let products = await getActiveProducts(await getPool());
    if (category) products = products.filter((p) => p.Category === category);
    if (q) products = products.filter((p) => `${p.Name} ${p.Description || ''} ${p.Sku}`.toLowerCase().includes(q));
    res.json(products);
  } catch (err) {
    next(err);
  }
});

router.get('/categories', (_req, res) => res.json(CATEGORIES));

// GET /api/products/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = v.int(req.params.id, 'id', { required: true, min: 1 });
    const product = (await getActiveProducts(await getPool())).find((p) => p.ProductId === id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
