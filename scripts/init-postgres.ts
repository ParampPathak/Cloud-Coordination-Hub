import { readConfig } from '../backend/src/config.js';
import { postgresPool } from '../backend/src/postgres-store.js';
import { postgresSchema } from '../backend/src/postgres-schema.js';
if (process.env.ALLOW_POSTGRES_SCHEMA !== 'true')
  throw new Error(
    'Explicit schema-owner operation: set ALLOW_POSTGRES_SCHEMA=true after target/backup review.',
  );
const config = readConfig();
if (config.DATABASE_DRIVER !== 'postgres')
  throw new Error('Select DATABASE_DRIVER=postgres explicitly.');
const pool = postgresPool(config),
  client = await pool.connect();
try {
  await client.query('BEGIN');
  // Serialize concurrent initializers; not taken by ordinary app transactions.
  await client.query('SELECT pg_advisory_xact_lock(204310,1)');
  await client.query(postgresSchema);
  await client.query('COMMIT');
  console.log(
    'PostgreSQL schema version 1 initialized. No SQLite files changed.',
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
