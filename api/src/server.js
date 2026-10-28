'use strict';
const express = require('express');
const config = require('./config');
const { getPool } = require('./db');
const { initDatabase, ensureDatabaseExists } = require('./dbinit');
const { requireUser, requireAdmin, isAdmin } = require('./auth');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '100kb' }));

// --- security headers ---
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  next();
});

// --- CORS (only the two SPAs are allowed) ---
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && (config.corsOrigins.includes(origin) || config.corsOrigins.includes('*'))) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-dev-user, x-dev-admin',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Max-Age': '600',
    });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- request log ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path !== '/api/health') console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// --- public endpoints ---
app.get('/', (_req, res) => res.json({ service: 'msstore-api', status: 'ok', docs: '/api/health' }));
app.get('/api/health', async (_req, res) => {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    if (!dbState.initialized) {
      return res.status(503).json({ status: 'starting', database: 'initializing', error: dbState.lastError });
    }
    res.json({ status: 'healthy', database: 'connected', authMode: config.auth.mode });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', database: 'unreachable', error: err.message });
  }
});

// --- authenticated endpoints ---
app.use('/api', requireUser);
app.get('/api/me', (req, res) => res.json({ ...req.user, isAdmin: isAdmin(req.user) }));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', requireAdmin, require('./routes/admin'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// --- error handler ---
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server' : err.message });
});

// Database initialisation (schema + sample data). Retries in the background until it succeeds,
// e.g. while the private endpoint DNS or the managed identity token is still propagating.
const dbState = { initialized: !config.dbAutoInit, lastError: null };

async function initWithRetry(attempt = 1) {
  try {
    await ensureDatabaseExists();
    await initDatabase(await getPool(), { seed: true });
    dbState.initialized = true;
    dbState.lastError = null;
  } catch (err) {
    dbState.lastError = err.message;
    const delay = Math.min(10000 * attempt, 60000);
    console.error(`[db] auto-init attempt ${attempt} failed: ${err.message} - retrying in ${delay / 1000}s`);
    setTimeout(() => initWithRetry(attempt + 1), delay);
  }
}

function start() {
  app.listen(config.port, () => console.log(`msstore-api listening on port ${config.port} (auth: ${config.auth.mode})`));
  if (config.dbAutoInit) initWithRetry();
}

if (require.main === module) start();

module.exports = app;
