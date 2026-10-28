'use strict';
/*
  Entra ID (Azure AD) access-token validation using only Node.js built-ins.
  - Downloads and caches the tenant signing keys (JWKS)
  - Verifies RS256 signature, issuer, audience, expiry and tenant
  - Requires the delegated scope (access_as_user) exposed by the API app registration
  - Admin endpoints additionally require the app role (default: Store.Admin)
*/
const crypto = require('crypto');
const config = require('./config');

const CLOCK_SKEW_SEC = 300;
const JWKS_TTL_MS = 6 * 60 * 60 * 1000;
let jwksCache = { keys: new Map(), fetchedAt: 0 };

class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

const b64urlJson = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

async function fetchJwks(tenantId) {
  const url = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  const res = await fetch(url);
  if (!res.ok) throw new AuthError(`Unable to download signing keys (${res.status})`, 503);
  const body = await res.json();
  const keys = new Map();
  for (const jwk of body.keys || []) {
    if (jwk.kty === 'RSA' && jwk.kid) keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
  }
  jwksCache = { keys, fetchedAt: Date.now() };
}

async function getSigningKey(kid, tenantId, fetchKeys = fetchJwks) {
  const stale = Date.now() - jwksCache.fetchedAt > JWKS_TTL_MS;
  if (stale || !jwksCache.keys.has(kid)) await fetchKeys(tenantId); // refresh on rollover
  const key = jwksCache.keys.get(kid);
  if (!key) throw new AuthError('Unknown token signing key');
  return key;
}

/**
 * Validates a JWT and returns its claims.
 * opts: { tenantId, clientId, getKey?(kid) } - getKey can be injected for tests.
 */
async function verifyToken(token, opts) {
  const { tenantId, clientId } = opts;
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new AuthError('Malformed token');

  let header, claims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    throw new AuthError('Malformed token');
  }
  if (header.alg !== 'RS256') throw new AuthError('Unsupported token algorithm');

  const key = opts.getKey ? await opts.getKey(header.kid) : await getSigningKey(header.kid, tenantId);
  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2], 'base64url')
  );
  if (!valid) throw new AuthError('Invalid token signature');

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SEC < now) throw new AuthError('Token expired');
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SEC > now) throw new AuthError('Token not yet valid');

  const issuers = [`https://login.microsoftonline.com/${tenantId}/v2.0`, `https://sts.windows.net/${tenantId}/`];
  if (!issuers.includes(claims.iss)) throw new AuthError('Invalid token issuer');

  const audiences = [clientId, `api://${clientId}`];
  if (!audiences.includes(claims.aud)) throw new AuthError('Invalid token audience');

  if (claims.tid && claims.tid.toLowerCase() !== tenantId.toLowerCase()) throw new AuthError('Invalid tenant');
  return claims;
}

function userFromClaims(claims) {
  return {
    oid: claims.oid,
    name: claims.name || claims.preferred_username || 'Unknown user',
    email: claims.preferred_username || claims.upn || claims.email || null,
    roles: Array.isArray(claims.roles) ? claims.roles : [],
    scopes: typeof claims.scp === 'string' ? claims.scp.split(' ') : [],
  };
}

/** Express middleware - every /api route except /api/health uses this. */
function requireUser(req, res, next) {
  if (config.auth.mode === 'dev') {
    const name = req.get('x-dev-user') || 'Dev User';
    req.user = {
      oid: 'dev-' + Buffer.from(name).toString('hex').slice(0, 24),
      name,
      email: `${name.replace(/\s+/g, '.').toLowerCase()}@contoso.example`,
      roles: req.get('x-dev-admin') === 'true' ? [config.auth.adminRole] : [],
      scopes: [config.auth.scopeName],
    };
    return next();
  }

  const header = req.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Missing bearer token' });

  verifyToken(m[1], { tenantId: config.auth.tenantId, clientId: config.auth.clientId })
    .then((claims) => {
      const user = userFromClaims(claims);
      if (!user.oid) throw new AuthError('Token has no user (oid) claim', 403);
      if (!user.scopes.includes(config.auth.scopeName)) {
        throw new AuthError(`Token is missing the '${config.auth.scopeName}' scope`, 403);
      }
      req.user = user;
      next();
    })
    .catch((err) => {
      const status = err.status || 401;
      if (status >= 500) console.error('[auth]', err.message);
      res.status(status).json({ error: err.message });
    });
}

function isAdmin(user) {
  return !!user && user.roles.includes(config.auth.adminRole);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: `This operation requires the '${config.auth.adminRole}' app role.` });
  }
  next();
}

module.exports = { requireUser, requireAdmin, isAdmin, verifyToken, userFromClaims, AuthError, _getSigningKey: getSigningKey };
