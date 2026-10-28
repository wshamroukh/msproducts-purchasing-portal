'use strict';
/*
  Zero-dependency static web server for the SPA (used on Azure App Service).
  - serves the Vite build output from ./dist
  - optional reverse proxy: when API_PROXY_TARGET is set, /api/* is forwarded to the
    backend API (e.g. a private-endpoint-only App Service reached through VNet integration),
    and the SPA calls the API on its own origin (no CORS, API never exposed publicly)
  - generates /config.json from App Settings (environment variables) so the
    same build can run in any environment without rebuilding
  - falls back to index.html for client-side routes
*/
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const DIST = path.join(__dirname, 'dist');
const PROXY_TARGET = process.env.API_PROXY_TARGET ? new URL(process.env.API_PROXY_TARGET) : null;
// Re-use connections to the API (keep-alive) instead of a new TCP + TLS handshake per request
const PROXY_AGENT = PROXY_TARGET
  ? new (PROXY_TARGET.protocol === 'https:' ? https : http).Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30000 })
  : null;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

function runtimeConfig() {
  let fileCfg = {};
  try { fileCfg = JSON.parse(fs.readFileSync(path.join(DIST, 'config.json'), 'utf8')); } catch { /* optional */ }
  const env = process.env;
  const pick = (k, d) => (env[k] !== undefined && env[k] !== '' ? env[k] : d);
  return {
    ...fileCfg,
    appTitle: pick('APP_TITLE', fileCfg.appTitle),
    authMode: pick('AUTH_MODE', fileCfg.authMode || 'entra'),
    tenantId: pick('TENANT_ID', fileCfg.tenantId),
    clientId: pick('CLIENT_ID', fileCfg.clientId),
    apiScope: pick('API_SCOPE', fileCfg.apiScope),
    apiBaseUrl: PROXY_TARGET ? '/' : pick('API_BASE_URL', fileCfg.apiBaseUrl),
    devAdmin: pick('DEV_ADMIN', String(fileCfg.devAdmin || false)) === 'true',
  };
}

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// Headers that must not be forwarded by a proxy (RFC 7230 section 6.1)
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host'];

function proxyToApi(req, res) {
  const headers = { ...req.headers };
  for (const h of HOP_BY_HOP) delete headers[h];
  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  headers['x-forwarded-for'] = clientIp;
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = 'https';
  headers.host = PROXY_TARGET.host;

  const client = PROXY_TARGET.protocol === 'https:' ? https : http;
  const upstream = client.request(
    {
      protocol: PROXY_TARGET.protocol,
      hostname: PROXY_TARGET.hostname,
      port: PROXY_TARGET.port || (PROXY_TARGET.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
      agent: PROXY_AGENT,
      timeout: 60000,
    },
    (up) => {
      const out = { ...up.headers };
      for (const h of HOP_BY_HOP) delete out[h];
      res.writeHead(up.statusCode || 502, out);
      up.pipe(res);
    }
  );
  upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
  upstream.on('error', (err) => {
    console.error('[proxy]', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'The API is not reachable from the web server', detail: err.message }));
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream);
}

http.createServer((req, res) => {
  if (PROXY_TARGET && (req.url === '/api' || req.url.startsWith('/api/'))) return proxyToApi(req, res);

  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }

  if (pathname === '/config.json') {
    res.writeHead(200, { ...securityHeaders, 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(runtimeConfig()));
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  let file = path.normalize(path.join(DIST, pathname));
  if (!file.startsWith(DIST)) { res.writeHead(400); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(pathname)) { res.writeHead(404); return res.end('Not found'); }
    file = path.join(DIST, 'index.html'); // SPA fallback
  }
  const ext = path.extname(file);
  const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { ...securityHeaders, 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`SPA server listening on ${PORT}${PROXY_TARGET ? ` (proxying /api to ${PROXY_TARGET.origin})` : ''}`));
