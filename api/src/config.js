'use strict';
const fs = require('fs');
const path = require('path');

// Minimal .env loader (no dependency) - only used for local development.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes)$/i.test(v));

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  auth: {
    mode: (process.env.AUTH_MODE || 'entra').toLowerCase(),
    tenantId: process.env.TENANT_ID || '',
    clientId: process.env.API_CLIENT_ID || '',
    scopeName: process.env.API_SCOPE_NAME || 'access_as_user',
    adminRole: process.env.ADMIN_ROLE || 'Store.Admin',
  },
  sql: {
    server: process.env.SQL_SERVER || 'localhost',
    port: parseInt(process.env.SQL_PORT || '1433', 10),
    database: process.env.SQL_DATABASE || 'msstoredb',
    authType: (process.env.SQL_AUTH || 'password').toLowerCase(),
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    accessToken: process.env.SQL_ACCESS_TOKEN,
    managedIdentityClientId: process.env.SQL_MI_CLIENT_ID || undefined,
    encrypt: bool(process.env.SQL_ENCRYPT, true),
    trustServerCertificate: bool(process.env.SQL_TRUST_SERVER_CERTIFICATE, false),
  },
  dbAutoInit: bool(process.env.DB_AUTO_INIT, false),
};

if (config.auth.mode === 'entra' && (!config.auth.tenantId || !config.auth.clientId)) {
  console.warn('[config] AUTH_MODE=entra but TENANT_ID / API_CLIENT_ID are not set - all API calls will be rejected.');
}
if (config.auth.mode === 'dev') {
  console.warn('[config] AUTH_MODE=dev - tokens are NOT validated. Never use this mode in Azure.');
}

module.exports = config;
