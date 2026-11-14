// Requires a real local PostgreSQL server; creates/removes only its own random test DB.
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const source = process.env.POSTGRES_TEST_URL;
if (!source)
  throw new Error(
    'Set POSTGRES_TEST_URL to a local PostgreSQL admin URL (see docs/plan-b-preparation.md).',
  );
const url = new URL(source);
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
  url.search ||
  url.hash
)
  throw new Error(
    'Integration runner permits loopback PostgreSQL only, without URL query options.',
  );
const name = 'cch_test_' + randomUUID().replaceAll('-', '');
const admin = new Pool({ connectionString: source, ssl: false, max: 1 });
const childUrl = new URL(url);
childUrl.pathname = '/' + name;
let created = false;
const run = (args, extra = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        DATABASE_DRIVER: 'postgres',
        POSTGRES_URL: childUrl.href,
        POSTGRES_TEST_URL: childUrl.href,
        NODE_ENV: 'test',
        ALLOW_AWS: 'false',
        ...extra,
      },
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
let code;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  if (
    (await run(['node_modules/tsx/dist/cli.mjs', 'scripts/init-postgres.ts'], {
      ALLOW_POSTGRES_SCHEMA: 'true',
    })) !== 0
  )
    throw new Error('Schema initialization failed.');
  mkdirSync('artifacts/postgres', { recursive: true });
  code = await run(
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      'tests/postgres.test.ts',
      'tests/postgres-contract.test.ts',
      'tests/coordination.test.ts',
      '--no-file-parallelism',
      '--reporter=default',
      '--reporter=json',
      '--outputFile=artifacts/postgres/integration-results.json',
    ],
    { RUN_POSTGRES_TESTS: 'true' },
  );
  const version = (await admin.query('SHOW server_version')).rows[0]
    .server_version;
  writeFileSync(
    'artifacts/postgres/environment.json',
    JSON.stringify(
      {
        serverVersion: version,
        localOnly: true,
        temporaryDatabase: true,
        exitCode: code,
        observedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  // Never target the caller's database; only the UUID name created above.
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
process.exitCode = code;
