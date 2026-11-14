import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { readConfig } from '../backend/src/config.js';
import { PostgresStore } from '../backend/src/postgres-store.js';
import { postgresSchema } from '../backend/src/postgres-schema.js';
import { SqliteStore } from '../backend/src/store.js';
import {
  createUser,
  login,
  sessionUser,
  tokenKey,
} from '../backend/src/auth.js';
import { createApp } from '../backend/src/app.js';
import type { Activity } from '../shared/types.js';
const enabled = process.env.RUN_POSTGRES_TESTS === 'true';
describe.skipIf(!enabled)(
  'PostgreSQL production contract on a disposable local database',
  () => {
    let a: PostgresStore, b: PostgresStore, admin: Pool;
    const config = () =>
      readConfig({
        NODE_ENV: 'test',
        DATABASE_DRIVER: 'postgres',
        POSTGRES_URL: process.env.POSTGRES_TEST_URL,
        APP_ORIGIN: 'http://localhost:3000',
      });
    beforeEach(async () => {
      const url = new URL(process.env.POSTGRES_TEST_URL!);
      if (
        !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        !/^\/cch_test_[a-f0-9]+$/.test(url.pathname)
      )
        throw new Error('Disposable local test database required.');
      admin = new Pool({ connectionString: url.href });
      await admin.query('TRUNCATE cch.records');
      await admin.query(
        'UPDATE cch.summary SET events=0,confirmed=0,waitlisted=0,"activePolls"=0',
      );
      a = new PostgresStore(config());
      b = new PostgresStore(config());
    });
    afterEach(async () => {
      await Promise.all([a?.close(), b?.close(), admin?.end()]);
    });
    it('rolls back earlier writes, audit indexes and summary on later CAS failure', async () => {
      await a.put('test', 'z', { value: 1 }, null);
      const activity: Activity = {
        id: 'audit',
        message: 'test',
        actorId: 'actor',
        actorName: 'Actor',
        resourceId: 'event',
        createdAt: new Date().toISOString(),
      };
      expect(
        await b.transact(
          [
            {
              kind: 'event',
              id: 'event',
              data: { registrations: [], organizerId: 'owner' },
              expected: null,
            },
            { kind: 'test', id: 'z', data: { value: 2 }, expected: 99 },
          ],
          activity,
        ),
      ).toBe(false);
      expect(await a.get('event', 'event')).toBeNull();
      expect(await a.get('activity', 'audit')).toBeNull();
      expect(await a.summary()).toEqual({
        events: 0,
        confirmed: 0,
        waitlisted: 0,
        activePolls: 0,
      });
    });
    it('allows exactly one creator and one version winner across pools', async () => {
      const creates = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          (i % 2 ? a : b).put('test', 'same', { n: i }, null),
        ),
      );
      expect(creates.filter(Boolean)).toHaveLength(1);
      const edits = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          (i % 2 ? a : b).put('test', 'same', { n: i }, 1),
        ),
      );
      expect(edits.filter(Boolean)).toHaveLength(1);
      expect((await a.get('test', 'same'))!.version).toBe(2);
    });
    it('commits actor/owner audit partitions and bounded deterministic pages', async () => {
      const activity: Activity = {
        id: 'audit',
        message: 'test',
        actorId: 'actor',
        actorName: 'Actor',
        resourceId: 'event',
        createdAt: new Date().toISOString(),
      };
      expect(
        await a.put(
          'event',
          'event',
          { registrations: [], organizerId: 'owner' },
          null,
          activity,
        ),
      ).toBe(true);
      expect((await b.page('activity-user:owner', 1)).items).toEqual([
        activity,
      ]);
      expect((await b.page('activity-user:actor', 1)).items).toEqual([
        activity,
      ]);
      for (const id of ['a', 'b', 'c']) await a.put('test', id, { id }, null);
      expect(await b.page('test', 2)).toEqual({
        items: [{ id: 'a' }, { id: 'b' }],
        nextCursor: 'b',
        examined: 3,
      });
      expect((await b.page('test', 2, 'b')).items).toEqual([{ id: 'c' }]);
      expect((await b.page('test', 2, '', true)).items).toEqual([
        { id: 'c' },
        { id: 'b' },
      ]);
      await expect(b.page('test', 51)).rejects.toMatchObject({ status: 400 });
    });
    it('shares logins across apps, rejects duplicate users, expires sessions and preserves a live session', async () => {
      const users = await Promise.allSettled(
        [a, b].map((s) =>
          createUser(s, 'same@example.test', 'Attendee', 'StrongPassword123'),
        ),
      );
      expect(users.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const signed = await login(a, 'same@example.test', 'StrongPassword123');
      expect((await sessionUser(b, signed.token))!.email).toBe(
        'same@example.test',
      );
      const response = await request(createApp(config(), b, false))
        .get('/api/auth/me')
        .set('Cookie', `hub_session=${signed.token}`);
      expect(response.status).toBe(200);
      expect(response.body.email).toBe('same@example.test');
      const session = (await a.get<{ email: string; expiresAt: number }>(
        'session',
        tokenKey(signed.token),
      ))!;
      await b.put(
        'session',
        tokenKey(signed.token),
        { ...session.data, expiresAt: 1 },
        session.version,
      );
      expect(await sessionUser(a, signed.token)).toBeNull();
      for (let i = 0; i < 501; i++)
        await a.put(
          'session',
          String(i),
          { email: 'expired@example.test', expiresAt: 1 },
          null,
        );
      const live = await login(b, 'same@example.test', 'StrongPassword123');
      expect(await a.cleanupSessions()).toBe(500);
      expect(await b.cleanupSessions()).toBe(1);
      expect((await sessionUser(a, live.token))!.email).toBe(
        'same@example.test',
      );
    });
    it('works with a restricted runtime SQL role and never needs schema ownership', async () => {
      const role = 'cch_app_' + randomUUID().replaceAll('-', ''),
        password = randomUUID();
      await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
      let runtime: PostgresStore | undefined;
      try {
        await admin.query(
          `GRANT USAGE ON SCHEMA cch TO "${role}"; GRANT SELECT,INSERT,UPDATE,DELETE ON cch.records,cch.summary TO "${role}"; GRANT SELECT ON cch.schema_version TO "${role}"`,
        );
        const url = new URL(process.env.POSTGRES_TEST_URL!);
        url.username = role;
        url.password = password;
        runtime = new PostgresStore(
          readConfig({ DATABASE_DRIVER: 'postgres', POSTGRES_URL: url.href }),
        );
        await runtime.ready();
        expect(
          await runtime.put('test', 'restricted', { ok: true }, null),
        ).toBe(true);
        const pool = new Pool({ connectionString: url.href });
        try {
          await expect(
            pool.query('CREATE TABLE cch.forbidden(id integer)'),
          ).rejects.toMatchObject({ code: '42501' });
        } finally {
          await pool.end();
        }
      } finally {
        await runtime?.close();
        await admin.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);
      }
    });
    it.skipIf(!process.env.POSTGRES_TEST_CA)(
      'verifies TLS certificates against the explicit CA and rejects an untrusted CA',
      async () => {
        const secure = new PostgresStore(
          readConfig({
            DATABASE_DRIVER: 'postgres',
            POSTGRES_URL: process.env.POSTGRES_TEST_URL,
            POSTGRES_SSL: 'verify-full',
            POSTGRES_CA_FILE: process.env.POSTGRES_TEST_CA,
          }),
        );
        try {
          await secure.ready();
          expect(await secure.get('test', 'missing')).toBeNull();
        } finally {
          await secure.close();
        }
        const dir = mkdtempSync(join(tmpdir(), 'cch-pg-bad-ca-')),
          bad = join(dir, 'bad.pem');
        writeFileSync(bad, 'not a CA');
        const rejected = new PostgresStore(
          readConfig({
            DATABASE_DRIVER: 'postgres',
            POSTGRES_URL: process.env.POSTGRES_TEST_URL,
            POSTGRES_SSL: 'verify-full',
            POSTGRES_CA_FILE: bad,
          }),
        );
        try {
          await expect(rejected.ready()).rejects.toThrow();
        } finally {
          await rejected.close();
          rmSync(dir, { recursive: true, force: true });
        }
      },
    );
    it('provisions the restricted SQL identity through the production CLI without printing its password', async () => {
      const password = randomUUID().replaceAll('-', '');
      const run = () =>
        spawnSync(
          process.execPath,
          ['--import', 'tsx', 'scripts/provision-postgres.ts'],
          {
            env: {
              ...process.env,
              NODE_ENV: 'test',
              DATABASE_DRIVER: 'postgres',
              POSTGRES_URL: process.env.POSTGRES_TEST_URL,
              ALLOW_POSTGRES_PROVISION: 'true',
              POSTGRES_APP_PASSWORD: password,
            },
            encoding: 'utf8',
          },
        );
      let runtime: PostgresStore | undefined;
      try {
        const result = run();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout + result.stderr).not.toContain(password);
        const url = new URL(process.env.POSTGRES_TEST_URL!);
        url.username = 'cch_app';
        url.password = password;
        runtime = new PostgresStore(
          readConfig({ DATABASE_DRIVER: 'postgres', POSTGRES_URL: url.href }),
        );
        await runtime.ready();
        expect(
          await runtime.put('test', 'provisioned', { ok: true }, null),
        ).toBe(true);
        expect(run().status).not.toBe(0); // Existing role is never silently reset.
      } finally {
        await runtime?.close();
        await admin.query('DROP OWNED BY cch_app; DROP ROLE cch_app');
      }
    });
    it('schema setup is idempotent and preserves existing records', async () => {
      await a.put('test', 'preserved', { value: 1 }, null);
      await admin.query(postgresSchema);
      expect((await b.get('test', 'preserved'))!.data).toEqual({ value: 1 });
      await b.ready();
    });
    it('imports a SQLite snapshot by comparison then conditional insert, without overwrites', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'cch-pg-migration-')),
        source = join(dir, 'source.sqlite'),
        backup = join(dir, 'backup.json');
      const sqlite = new SqliteStore(source);
      const run = (args: string[], apply = false) =>
        spawnSync(
          process.execPath,
          ['--import', 'tsx', 'scripts/migrate-database.ts', ...args],
          {
            env: {
              ...process.env,
              DATABASE_DRIVER: 'postgres',
              POSTGRES_URL: process.env.POSTGRES_TEST_URL,
              ALLOW_AWS: 'false',
              ALLOW_DATA_IMPORT: apply ? 'true' : 'false',
            },
            encoding: 'utf8',
          },
        );
      try {
        await sqlite.put(
          'event',
          'imported',
          { registrations: [], organizerId: 'owner' },
          null,
        );
        expect(run(['export', source, backup]).status).toBe(0);
        expect(run(['import', backup]).status).toBe(0);
        expect(await a.get('event', 'imported')).toBeNull();
        const applied = run(['import', backup, '--apply'], true);
        expect(applied.status, applied.stderr).toBe(0);
        expect(run(['import', backup, '--apply'], true).status).toBe(0);
        expect((await a.summary()).events).toBe(1);
        await a.put(
          'event',
          'imported',
          { registrations: [], organizerId: 'changed' },
          1,
        );
        expect(run(['import', backup, '--apply'], true).status).not.toBe(0);
        expect(
          (await sqlite.get<{ organizerId: string }>('event', 'imported'))!.data
            .organizerId,
        ).toBe('owner');
      } finally {
        sqlite.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);
describe('PostgreSQL configuration safety', () => {
  it('requires explicit connection settings and fails closed on remote/plaintext/TLS overrides', () => {
    expect(() => readConfig({ DATABASE_DRIVER: 'postgres' })).toThrow(
      /POSTGRES_URL/,
    );
    for (const extra of [
      {},
      { ALLOW_AWS: 'true' },
      { ALLOW_AWS: 'true', POSTGRES_SSL: 'verify-full' },
      {
        ALLOW_AWS: 'true',
        POSTGRES_SSL: 'verify-full',
        POSTGRES_CA_FILE: 'ca.pem',
        POSTGRES_URL:
          'postgresql://app:secret@db.example.test/hub?sslmode=no-verify',
      },
    ])
      expect(() =>
        readConfig({
          DATABASE_DRIVER: 'postgres',
          POSTGRES_URL: 'postgresql://app:secret@db.example.test/hub',
          ...extra,
        }),
      ).toThrow();
    expect(
      readConfig({
        DATABASE_DRIVER: 'postgres',
        DEPLOYMENT_MODE: 'aws-multi',
        ALLOW_AWS: 'true',
        POSTGRES_SSL: 'verify-full',
        POSTGRES_CA_FILE: 'ca.pem',
        POSTGRES_URL: 'postgresql://app:secret@db.example.test/hub',
      }).DEPLOYMENT_MODE,
    ).toBe('aws-multi');
  });
});
