'use strict';
const sql = require('mssql');
const config = require('./config');

function buildSqlConfig(c = config.sql) {
  const base = {
    server: c.server,
    port: c.port,
    database: c.database,
    options: { encrypt: c.encrypt, trustServerCertificate: c.trustServerCertificate },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 30000,
    requestTimeout: 30000,
  };
  switch (c.authType) {
    case 'password':
      return { ...base, user: c.user, password: c.password };
    case 'access-token':
      // Used by the deployment script (token of the signed-in az cli user)
      return { ...base, authentication: { type: 'azure-active-directory-access-token', options: { token: c.accessToken } } };
    case 'managed-identity':
    case 'default':
      // Uses DefaultAzureCredential -> the App Service managed identity in Azure,
      // or your az cli / VS Code login when running locally.
      return {
        ...base,
        authentication: {
          type: 'azure-active-directory-default',
          options: c.managedIdentityClientId ? { clientId: c.managedIdentityClientId } : {},
        },
      };
    default:
      throw new Error(`Unsupported SQL_AUTH value: ${c.authType}`);
  }
}

let poolPromise = null;

async function getPool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      let lastErr;
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          const pool = new sql.ConnectionPool(buildSqlConfig());
          pool.on('error', (err) => console.error('[db] pool error', err.message));
          await pool.connect();
          console.log(`[db] connected to ${config.sql.server}/${config.sql.database}`);
          return pool;
        } catch (err) {
          lastErr = err;
          console.error(`[db] connection attempt ${attempt} failed: ${err.message}`);
          await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 10000)));
        }
      }
      throw lastErr;
    })().catch((err) => {
      poolPromise = null; // allow a retry on the next request
      throw err;
    });
  }
  return poolPromise;
}

// SQL Server errors that are safe to retry: 1205 deadlock victim, 1222 lock request timeout
const TRANSIENT = new Set([1205, 1222]);
const isTransient = (err) => !!err && (TRANSIENT.has(err.number) || TRANSIENT.has(err.originalError && err.originalError.info && err.originalError.info.number));

/**
 * Runs fn(tx) in a transaction and commits. On a deadlock / lock timeout the whole
 * transaction is rolled back and retried (up to `retries` times, with jittered back-off).
 */
async function withTransaction(pool, fn, { retries = 3, isolationLevel } = {}) {
  for (let attempt = 0; ; attempt++) {
    const tx = new sql.Transaction(pool);
    await (isolationLevel !== undefined ? tx.begin(isolationLevel) : tx.begin());
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback().catch(() => {});
      if (attempt < retries && isTransient(err)) {
        console.warn(`[db] transient error ${err.number} (${err.message}) - retry ${attempt + 1}/${retries}`);
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt + Math.random() * 100));
        continue;
      }
      throw err;
    }
  }
}

module.exports = { sql, getPool, buildSqlConfig, withTransaction, isTransient };
