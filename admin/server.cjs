'use strict';
/*
  Zero-dependency static web server for the SPA (used on Azure App Service).
  - serves the Vite build output from ./dist
  - generates /config.json from App Settings (environment variables) so the
    same build can run in any environment without rebuilding
  - falls back to index.html for client-side routes
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const DIST = path.join(__dirname, 'dist');
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
    apiBaseUrl: pick('API_BASE_URL', fileCfg.apiBaseUrl),
    devAdmin: pick('DEV_ADMIN', String(fileCfg.devAdmin || false)) === 'true',
  };
}

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

http.createServer((req, res) => {
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
}).listen(PORT, () => console.log(`SPA server listening on ${PORT}`));
