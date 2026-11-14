// Explicit database-owner operation from an approved private management environment.
import { readConfig } from '../backend/src/config.js';
import { postgresPool } from '../backend/src/postgres-store.js';
const config = readConfig();
if (
  config.DATABASE_DRIVER !== 'postgres' ||
  process.env.ALLOW_POSTGRES_PROVISION !== 'true'
)
  throw new Error('Select PostgreSQL and explicitly approve SQL provisioning.');
const password = process.env.POSTGRES_APP_PASSWORD;
if (!password || !/^[A-Za-z0-9_-]{32,128}$/.test(password))
  throw new Error(
    'Provide a private random POSTGRES_APP_PASSWORD (32-128 URL-safe characters).',
  );
const pool = postgresPool(config),
  client = await pool.connect();
try {
  await client.query('BEGIN');
  // No IF EXISTS password reset: abort if this app identity already exists.
  // Password alphabet is strictly checked; utility statements do not accept $1 parameters.
  await client.query(
    `CREATE ROLE cch_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`,
  );
  const database = decodeURIComponent(
    new URL(config.POSTGRES_URL!).pathname.slice(1),
  );
  const identifier = '"' + database.replaceAll('"', '""') + '"';
  await client.query(`GRANT CONNECT ON DATABASE ${identifier} TO cch_app`);
  await client.query('GRANT USAGE ON SCHEMA cch TO cch_app');
  await client.query(
    'GRANT SELECT,INSERT,UPDATE,DELETE ON cch.records,cch.summary TO cch_app',
  );
  await client.query('GRANT SELECT ON cch.schema_version TO cch_app');
  await client.query('COMMIT');
  console.log('Restricted SQL app role provisioned. Password was not printed.');
} catch {
  await client.query('ROLLBACK');
  throw new Error(
    'SQL app provisioning failed; inspect private database diagnostics. No credential printed.',
  );
} finally {
  client.release();
  await pool.end();
}
