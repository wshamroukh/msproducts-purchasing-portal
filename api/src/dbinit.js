'use strict';
const fs = require('fs');
const path = require('path');

function splitBatches(script) {
  return script
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

async function runFile(pool, file) {
  const script = fs.readFileSync(path.join(__dirname, '..', 'db', file), 'utf8');
  for (const batch of splitBatches(script)) {
    await pool.request().batch(batch);
  }
}

/** Creates tables (idempotent) and optionally loads the sample stores & products. */
async function initDatabase(pool, { seed = true } = {}) {
  await runFile(pool, 'schema.sql');
  console.log('[db] schema ready');
  if (seed) {
    await runFile(pool, 'seed.sql');
    console.log('[db] sample data ready');
  }
}

/** Local dev only: creates the database itself on a fresh SQL Server container. */
async function ensureDatabaseExists() {
  const config = require('./config');
  const { sql, buildSqlConfig } = require('./db');
  if (config.sql.authType !== 'password') return; // Azure SQL databases are created by the deployment script
  const master = new sql.ConnectionPool(buildSqlConfig({ ...config.sql, database: 'master' }));
  await master.connect();
  try {
    await master.request().input('db', sql.NVarChar(128), config.sql.database).query(`
      IF DB_ID(@db) IS NULL
      BEGIN
        DECLARE @stmt NVARCHAR(300) = N'CREATE DATABASE ' + QUOTENAME(@db);
        EXEC sp_executesql @stmt;
      END`);
  } finally {
    await master.close();
  }
}

module.exports = { initDatabase, ensureDatabaseExists, splitBatches };
