// Run only in the approved private management environment with an owner-only bundle.
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { readConfig } from '../dist/backend/backend/src/config.js';
import { PostgresStore } from '../dist/backend/backend/src/postgres-store.js';
import {
  createUser,
  verifyPassword,
} from '../dist/backend/backend/src/auth.js';
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw Error('Private setup input and result paths required.');
const data = JSON.parse(readFileSync(input, 'utf8'));
const ca = resolve('rds-ca.pem');
writeFileSync(ca, data.caPem, { mode: 0o600 });
chmodSync(ca, 0o600);
const base = {
  ...process.env,
  NODE_ENV: 'production',
  DEPLOYMENT_MODE: 'aws-multi',
  DATABASE_DRIVER: 'postgres',
  POSTGRES_SSL: 'verify-full',
  POSTGRES_CA_FILE: ca,
  APP_ORIGIN: data.applicationOrigin,
  ALLOW_AWS: 'true',
};
let stage = 'schema',
  owner,
  app;
try {
  const init = spawnSync(
    process.execPath,
    ['dist/backend/scripts/init-postgres.js'],
    {
      env: {
        ...base,
        POSTGRES_URL: data.ownerUrl,
        ALLOW_POSTGRES_SCHEMA: 'true',
      },
      encoding: 'utf8',
    },
  );
  if (init.status !== 0)
    throw Object.assign(Error('Schema setup failed'), {
      code: 'SCHEMA_SETUP_FAILED',
    });
  stage = 'runtime-role';
  owner = new Pool({
    connectionString: data.ownerUrl,
    ssl: { ca: data.caPem, rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const exists = await owner.query(
    "SELECT 1 FROM pg_roles WHERE rolname='cch_app'",
  );
  if (!exists.rowCount) {
    const provision = spawnSync(
      process.execPath,
      ['dist/backend/scripts/provision-postgres.js'],
      {
        env: {
          ...base,
          POSTGRES_URL: data.ownerUrl,
          ALLOW_POSTGRES_PROVISION: 'true',
          POSTGRES_APP_PASSWORD: data.appPassword,
        },
        encoding: 'utf8',
      },
    );
    if (provision.status !== 0)
      throw Object.assign(Error('SQL identity setup failed'), {
        code: 'RUNTIME_ROLE_SETUP_FAILED',
      });
  }
  app = new PostgresStore(readConfig({ ...base, POSTGRES_URL: data.appUrl }));
  await app.ready();
  stage = 'demo-accounts';
  for (const account of data.accounts) {
    const existing = await app.get('user', account.email.toLowerCase());
    if (existing) {
      if (
        existing.data.role !== account.role ||
        !(await verifyPassword(account.password, existing.data.passwordHash))
      )
        throw Object.assign(
          Error('Existing account differs; no password reset performed'),
          { code: 'ACCOUNT_CONFLICT' },
        );
    } else
      await createUser(
        app,
        account.email,
        account.name,
        account.password,
        account.role,
      );
  }
  writeFileSync(
    output,
    JSON.stringify(
      {
        success: true,
        schema: 1,
        database: 'PostgreSQL',
        runtimeIdentity: 'cch_app',
        accounts: data.accounts.map((a) => ({ email: a.email, role: a.role })),
        observedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log(
    'Private PostgreSQL setup verified; organizer and attendee provisioned. No credentials printed.',
  );
} catch (error) {
  writeFileSync(
    output,
    JSON.stringify(
      {
        success: false,
        stage,
        code: typeof error.code === 'string' ? error.code : 'SETUP_FAILED',
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.error(
    'Private PostgreSQL setup failed at ' +
      stage +
      '; credentials and SQL were withheld.',
  );
  process.exitCode = 1;
} finally {
  await app?.close();
  await owner?.end();
}
