import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
} from '@aws-sdk/client-dynamodb';
import { SqliteStore, DynamoStore } from '../backend/src/store.js';
import { readConfig } from '../backend/src/config.js';
const run = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/migrate-database.ts', ...args],
    { env, encoding: 'utf8' },
  );
describe('Non-destructive database migration', () => {
  it('exports a consistent source and refuses to replace an existing backup', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hub-export-'));
    const path = join(directory, 'source.sqlite'),
      backup = join(directory, 'backup.json');
    const store = new SqliteStore(path);
    try {
      await store.put(
        'event',
        'preserved',
        { title: 'Original', registrations: [{ userId: 'student' }] },
        null,
      );
      const result = run(['export', path, backup]);
      expect(result.status, result.stderr).toBe(0);
      expect(
        JSON.parse(readFileSync(backup, 'utf8')).records[0].data.registrations,
      ).toHaveLength(1);
      expect(run(['export', path, backup]).status).not.toBe(0);
      expect(
        (await store.get<{ title: string }>('event', 'preserved'))!.data.title,
      ).toBe('Original');
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.skipIf(process.env.RUN_DYNAMODB_TESTS !== 'true')(
    'compares read-only, imports idempotently, and preserves conflicting target data',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'hub-import-')),
        table = `hub-migration-${randomUUID()}`;
      const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000';
      const client = new DynamoDBClient({
        endpoint,
        region: 'us-east-1',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      });
      const source = new SqliteStore(join(directory, 'source.sqlite'));
      const target = new DynamoStore(
        readConfig({
          DATABASE_DRIVER: 'dynamodb',
          DYNAMODB_ENDPOINT: endpoint,
          DYNAMODB_TABLE: table,
        }),
      );
      try {
        await client.send(
          new CreateTableCommand({
            TableName: table,
            BillingMode: 'PAY_PER_REQUEST',
            AttributeDefinitions: [
              { AttributeName: 'pk', AttributeType: 'S' },
              { AttributeName: 'sk', AttributeType: 'S' },
            ],
            KeySchema: [
              { AttributeName: 'pk', KeyType: 'HASH' },
              { AttributeName: 'sk', KeyType: 'RANGE' },
            ],
          }),
        );
        await source.put(
          'event',
          'preserved',
          { title: 'Original', registrations: [{ userId: 'student' }] },
          null,
        );
        const backup = join(directory, 'backup.json');
        expect(
          run(['export', join(directory, 'source.sqlite'), backup]).status,
        ).toBe(0);
        const env = {
          ...process.env,
          DATABASE_DRIVER: 'dynamodb',
          DYNAMODB_ENDPOINT: endpoint,
          DYNAMODB_TABLE: table,
          ALLOW_AWS: 'false',
          ALLOW_DATA_IMPORT: 'true',
        };
        expect(run(['import', backup], env).status).toBe(0);
        expect(await target.get('event', 'preserved')).toBeNull();
        const imported = run(['import', backup, '--apply'], env);
        expect(imported.status, imported.stderr).toBe(0);
        expect(run(['import', backup, '--apply'], env).status).toBe(0);
        expect((await target.get('event', 'preserved'))!.version).toBe(1);
        await target.put('event', 'preserved', { title: 'New live data' }, 1);
        expect(run(['import', backup, '--apply'], env).status).not.toBe(0);
        expect(
          (await target.get<{ title: string }>('event', 'preserved'))!.data
            .title,
        ).toBe('New live data');
      } finally {
        source.close();
        target.close();
        await client.send(new DeleteTableCommand({ TableName: table }));
        client.destroy();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
