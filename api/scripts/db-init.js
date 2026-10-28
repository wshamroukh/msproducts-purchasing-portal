#!/usr/bin/env node
'use strict';
/*
  Database bootstrap tool.

  node scripts/db-init.js [--seed] [--grant <managed-identity-name> --grant-client-id <appId>]

  --seed               create the schema and load sample stores/products
  --grant NAME         create a contained database user for an Entra principal
                       (e.g. the API web app's system-assigned managed identity)
                       and give it read/write access.
  --grant-client-id    the appId (client id) of that principal. When provided the user is
                       created WITH SID (no Microsoft Graph lookup needed by SQL).

  Connection settings come from the same environment variables as the API
  (SQL_SERVER, SQL_DATABASE, SQL_AUTH=password|access-token|managed-identity ...).
*/
const { getPool, sql } = require('../src/db');
const { initDatabase, ensureDatabaseExists } = require('../src/dbinit');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

(async () => {
  await ensureDatabaseExists();
  const pool = await getPool();
  try {
    const seed = process.argv.includes('--seed');
    await initDatabase(pool, { seed });

    const grantName = arg('--grant');
    if (grantName) {
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(grantName)) throw new Error('Invalid principal name');
      const clientId = arg('--grant-client-id');
      if (clientId && !/^[0-9a-fA-F-]{36}$/.test(clientId)) throw new Error('Invalid client id');

      const r = pool.request();
      r.input('name', sql.NVarChar(128), grantName);
      r.input('clientId', sql.NVarChar(36), clientId || null);
      await r.query(`
        DECLARE @q NVARCHAR(300) = QUOTENAME(@name);
        DECLARE @stmt NVARCHAR(MAX);
        IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @name)
        BEGIN
          IF @clientId IS NOT NULL
          BEGIN
            DECLARE @sid NVARCHAR(100) = CONVERT(NVARCHAR(100), CAST(CAST(@clientId AS UNIQUEIDENTIFIER) AS VARBINARY(16)), 1);
            SET @stmt = N'CREATE USER ' + @q + N' WITH SID = ' + @sid + N', TYPE = E';
          END
          ELSE
            SET @stmt = N'CREATE USER ' + @q + N' FROM EXTERNAL PROVIDER';
          EXEC sp_executesql @stmt;
        END
        SET @stmt = N'ALTER ROLE db_datareader ADD MEMBER ' + @q;
        EXEC sp_executesql @stmt;
        SET @stmt = N'ALTER ROLE db_datawriter ADD MEMBER ' + @q;
        EXEC sp_executesql @stmt;
      `);
      console.log(`[db] granted read/write access to ${grantName}`);
    }
    console.log('[db] done');
    await pool.close();
    process.exit(0);
  } catch (err) {
    console.error('[db] FAILED:', err.message);
    process.exit(1);
  }
})();
