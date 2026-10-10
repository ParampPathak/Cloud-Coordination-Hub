import { spawnSync } from 'node:child_process';
if (!process.env.DYNAMODB_ENDPOINT)
  process.env.DYNAMODB_ENDPOINT = 'http://127.0.0.1:8000';
const initialized = spawnSync(
  process.execPath,
  ['scripts/init-local-dynamodb.mjs'],
  { stdio: 'inherit', env: process.env },
);
if (initialized.status !== 0) process.exit(1);
const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/dynamodb.test.ts'],
  { stdio: 'inherit', env: { ...process.env, RUN_DYNAMODB_TESTS: 'true' } },
);
process.exit(result.status ?? 1);
