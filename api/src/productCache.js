'use strict';
/*
  In-memory cache of the active catalog. The catalog is small and read on every page view,
  so the API answers from memory instead of querying SQL each time.
  The cache is cleared whenever products or stock change (admin edits, orders, cancellations)
  and expires after CACHE_TTL_SECONDS (default 60) as a safety net when running several instances.
*/
const TTL_MS = parseInt(process.env.CACHE_TTL_SECONDS || '60', 10) * 1000;
let cache = null;
let loading = null;

async function getActiveProducts(pool) {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (!loading) {
    loading = pool.request().query(`
        SELECT ProductId, Sku, Name, Category, Description, Price, ImageUrl, Stock
        FROM dbo.Products WHERE IsActive = 1
        ORDER BY CASE Category WHEN 'Hardware' THEN 1 WHEN 'Software' THEN 2 ELSE 3 END, Name;`)
      .then((r) => {
        cache = { at: Date.now(), data: r.recordset };
        return cache.data;
      })
      .finally(() => { loading = null; });
  }
  return loading;
}

function invalidateProducts() {
  cache = null;
}

module.exports = { getActiveProducts, invalidateProducts };
