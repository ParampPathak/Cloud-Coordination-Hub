import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { createUser, login } from '../backend/src/auth.js';
import { createGuestSession } from '../backend/src/guests.js';
import { readConfig } from '../backend/src/config.js';
import { postgresPool, PostgresStore } from '../backend/src/postgres-store.js';
import { HubService } from '../backend/src/service.js';
import { SqliteStore, type Store } from '../backend/src/store.js';
import { PROJECT_WORKSPACE_ID } from '../shared/workspaces.js';
import type { HubEvent } from '../shared/types.js';

const origin = 'http://localhost:3000';
const ownerEmail = 'owner@example.test';
const password = 'Fixture9-' + randomBytes(8).toString('hex');
const date = () => new Date(Date.now() + 4 * 86400e3).toISOString();
const pollInput = {
  question: 'Preferred workshop time?',
  options: ['Morning', 'Afternoon'],
};

for (const driver of ['sqlite', 'postgres'] as const) {
  describe.skipIf(
    driver === 'postgres' && process.env.RUN_POSTGRES_TESTS !== 'true',
  )(driver + ' workspaces', () => {
    let store: Store, peer: Store, config: ReturnType<typeof readConfig>;
    let context: Record<string, string>;
    let primary: ReturnType<typeof request>,
      secondary: ReturnType<typeof request>;
    let owner: string,
      other: string,
      attendee: string,
      admin: string,
      existingGuest: string,
      otherId: string,
      ownerId: string,
      eventId: string;
    function migration(apply = false) {
      const result = spawnSync(
        process.execPath,
        [
          'node_modules/tsx/dist/cli.mjs',
          'scripts/migrate-workspaces.ts',
          ownerEmail,
          ...(apply ? ['--apply'] : []),
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            ...context,
            ALLOW_AWS: 'false',
            ALLOW_WORKSPACE_MIGRATION: 'true',
          },
        },
      );
      if (result.status !== 0) throw new Error(result.stderr);
      return JSON.parse(result.stdout) as {
        alreadyMigrated: boolean;
        existingCount: number;
        addedRecords: number;
      };
    }
    async function snapshot() {
      if (driver === 'sqlite') {
        const db = new DatabaseSync(config.SQLITE_PATH, { readOnly: true });
        try {
          return db
            .prepare(
              'SELECT kind,id,data,version FROM records ORDER BY kind,id',
            )
            .all();
        } finally {
          db.close();
        }
      }
      const pool = postgresPool(config);
      try {
        return (
          await pool.query(
            'SELECT kind,id,data,version FROM cch.records ORDER BY kind,id',
          )
        ).rows;
      } finally {
        await pool.end();
      }
    }
    const mutate = (
      path: string,
      cookie: string,
      body: object,
      workspaceId?: string,
      method: 'post' | 'delete' | 'patch' | 'put' = 'post',
      agent = primary,
    ) => {
      let call = agent[method]('/api' + path)
        .set('Origin', origin)
        .set('Cookie', cookie)
        .send(body);
      if (workspaceId) call = call.set('X-Workspace-Id', workspaceId);
      return call;
    };
    const get = (
      path: string,
      cookie: string,
      scope?: string,
      agent = primary,
    ) => {
      const call = agent.get('/api' + path).set('Cookie', cookie);
      return scope ? call.set('X-Workspace-Id', scope) : call;
    };
    const create = (name: string, cookie = owner) =>
      mutate('/workspaces', cookie, { name }).expect(201);
    async function code(id: string, cookie = owner) {
      return (
        await get('/workspaces/' + id + '/management', cookie).expect(200)
      ).body.invitation.code as string;
    }
    async function joinWorkspace(token: string, cookie: string, status = 200) {
      const p = (
        await mutate('/workspaces/preview', cookie, { code: token }).expect(200)
      ).body;
      return mutate('/workspaces/join', cookie, {
        code: token,
        workspaceId: p.id,
        confirmation: p.confirmation,
      }).expect(status);
    }
    async function guestJoin(token: string, name = 'Same Name') {
      const p = (
        await mutate('/auth/workspace-preview', '', { code: token }).expect(200)
      ).body;
      const response = await mutate('/auth/guest', '', {
        name,
        code: token,
        workspaceId: p.id,
        confirmation: p.confirmation,
      }).expect(201);
      return {
        id: response.body.id as string,
        cookie: (response.headers['set-cookie'][0] as string).split(';')[0],
      };
    }
    beforeEach(async () => {
      const sqlitePath = join(
        mkdtempSync(join(tmpdir(), 'cch-workspaces-')),
        'test.sqlite',
      );
      context = {
        NODE_ENV: 'test',
        APP_ORIGIN: origin,
        DATABASE_DRIVER: driver,
        SQLITE_PATH: sqlitePath,
        GUEST_DEMO_ENABLED: 'true',
        POSTGRES_URL: process.env.POSTGRES_TEST_URL ?? '',
      };
      config = readConfig(context);
      if (driver === 'postgres') {
        const u = new URL(config.POSTGRES_URL!);
        if (
          !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
          !/^\/cch_test_[a-f0-9]+$/.test(u.pathname)
        )
          throw new Error('Disposable loopback PostgreSQL required.');
        const pool = postgresPool(config);
        try {
          await pool.query('TRUNCATE cch.records');
          await pool.query(
            'UPDATE cch.summary SET events=0,confirmed=0,waitlisted=0,"activePolls"=0',
          );
        } finally {
          await pool.end();
        }
        store = new PostgresStore(config);
        peer = new PostgresStore(config);
      } else {
        store = new SqliteStore(sqlitePath);
        peer = new SqliteStore(sqlitePath);
      }
      const createAccount = async (
        email: string,
        role: 'organizer' | 'user' | 'admin',
      ) => {
        const u = await createUser(
          store,
          email,
          email.split('@')[0],
          password,
          role,
        );
        return {
          id: u.id,
          cookie: 'hub_session=' + (await login(store, email, password)).token,
          user: u,
        };
      };
      const o = await createAccount(ownerEmail, 'organizer'),
        m = await createAccount('manager@example.test', 'organizer'),
        a = await createAccount('attendee@example.test', 'user'),
        d = await createAccount('admin@example.test', 'admin');
      owner = o.cookie;
      other = m.cookie;
      attendee = a.cookie;
      admin = d.cookie;
      otherId = m.id;
      ownerId = o.id;
      const legacy = await createGuestSession(store, 'Legacy guest', 24, 500);
      existingGuest = 'hub_session=' + legacy.token;
      const hub = new HubService(store);
      const event = await hub.createEvent(m.user, {
        title: 'Original project groups',
        description: 'Preserve',
        location: 'Room 4',
        startsAt: date(),
        capacity: 36,
        groupConfiguration: {
          count: 9,
          capacity: 4,
          autoAssign: true,
          allowSelfSelection: true,
        },
      });
      eventId = event.id;
      await hub.register(a.user, event.id);
      await hub.createPoll(m.user, pollInput);
      primary = request(createApp(config, store, false));
      secondary = request(createApp(config, peer, false));
    });
    afterEach(async () => {
      await store?.close();
      await peer?.close();
    });

    it('migrates atomically, validates relationships, and preserves every source record and legacy session', async () => {
      const before = await snapshot();
      expect(migration()).toMatchObject({
        alreadyMigrated: false,
        existingCount: before.length,
        addedRecords: 13,
      });
      expect(await snapshot()).toEqual(before);
      const marker = await store.get<HubEvent>('event', eventId);
      await store.put(
        'event',
        eventId,
        { ...marker!.data, organizerId: randomUUID() },
        marker!.version,
      );
      expect(() => migration(true)).toThrow(/Invalid event owner/);
      expect(await store.get('workspace-config', 'v1')).toBeNull();
      await store.put('event', eventId, marker!.data, marker!.version + 1);
      const restored = await snapshot();
      migration(true);
      const after = await snapshot();
      const added = new Set(
        after
          .filter((row) => row.kind.startsWith('workspace'))
          .map((row) => row.kind),
      );
      expect(after.filter((row) => !added.has(row.kind))).toEqual(restored);
      expect(migration(true)).toMatchObject({
        alreadyMigrated: true,
        addedRecords: 0,
      });
      expect(await snapshot()).toEqual(after);
      await get('/events', existingGuest, PROJECT_WORKSPACE_ID, secondary)
        .expect(200)
        .expect((r) => {
          expect(r.body.items[0].id).toBe(eventId);
          expect(r.body.items[0].organizerId).toBe(otherId);
          expect(r.body.items[0].groups).toHaveLength(9);
        });
      await get('/auth/me', other, undefined, secondary)
        .expect(200)
        .expect((r) => expect(r.body.role).toBe('organizer'));
      await get('/workspaces', admin)
        .expect(200)
        .expect((r) => expect(r.body.items[0].role).toBe('manager'));
      await get('/workspaces', owner)
        .expect(200)
        .expect((r) => expect(r.body.items[0].role).toBe('owner'));
      await mutate('/auth/login', '', { email: ownerEmail, password }).expect(
        200,
      );
    }, 20000);

    it('requires private confirmation, rotates codes, maintains membership, and guards lifecycle operations', async () => {
      migration(true);
      const alpha = (await create('Alpha')).body.id,
        beta = (await create('Beta')).body.id;
      await get('/workspaces', owner).expect((r) =>
        expect(r.body.items).toHaveLength(3),
      );
      await mutate('/workspaces', attendee, { name: 'Forbidden' }).expect(403);
      await get('/events', other, alpha).expect(403);
      await get('/workspaces/' + alpha + '/management', other).expect(403);
      const old = await code(alpha);
      expect(old).toMatch(/^[\w-]{43}$/);
      const p = (
        await mutate('/auth/workspace-preview', '', { code: old }).expect(200)
      ).body;
      expect(Object.keys(p).sort()).toEqual(['confirmation', 'id', 'name']);
      await get('/events', '', alpha).expect(401);
      await mutate('/auth/guest', '', {
        name: 'Same Name',
        code: old,
        workspaceId: alpha,
      }).expect(400);
      await mutate('/auth/guest', '', {
        name: 'Same Name',
        code: old,
        workspaceId: beta,
        confirmation: p.confirmation,
      }).expect(400);
      expect(await store.list('guest')).toHaveLength(1);
      const a = await guestJoin(old),
        b = await guestJoin(old);
      expect(a.id).not.toBe(b.id);
      await get('/auth/me', a.cookie, undefined, secondary)
        .expect(200)
        .expect((r) => expect(r.body.id).toBe(a.id));
      await joinWorkspace(await code(beta), a.cookie);
      await joinWorkspace(await code(beta), a.cookie);
      await get('/workspaces', a.cookie, undefined, secondary).expect((r) =>
        expect(r.body.items.map((w: { id: string }) => w.id).sort()).toEqual(
          [alpha, beta].sort(),
        ),
      );
      await mutate(
        '/workspaces/' + alpha,
        owner,
        { rotate: true },
        undefined,
        'patch',
      ).expect(200);
      expect(await code(alpha)).not.toBe(old);
      await mutate('/auth/workspace-preview', '', { code: old }).expect(404);
      await get('/events', a.cookie, alpha).expect(200);
      const rotated = await code(alpha);
      await mutate(
        '/workspaces/' + alpha,
        owner,
        { invitationsEnabled: false },
        undefined,
        'patch',
      ).expect(200);
      await mutate('/auth/workspace-preview', '', { code: rotated }).expect(
        404,
      );
      await mutate(
        '/workspaces/' + alpha,
        owner,
        { invitationsEnabled: true },
        undefined,
        'patch',
      ).expect(200);
      await joinWorkspace(rotated, other);
      await mutate('/events', other, { ...pollInput }, alpha).expect(400);
      await mutate('/polls', other, pollInput, alpha).expect(403);
      await mutate('/workspaces/' + alpha + '/managers', owner, {
        email: 'manager@example.test',
      }).expect(204);
      await mutate('/polls', other, pollInput, alpha).expect(201);
      await mutate(
        '/workspaces/' + alpha,
        other,
        { status: 'archived' },
        undefined,
        'patch',
      ).expect(403);
      await mutate(
        '/workspaces/' + alpha + '/members/' + ownerId,
        other,
        { confirm: true },
        undefined,
        'delete',
      ).expect(409);
      await mutate(
        '/workspaces/' + alpha + '/members/me',
        owner,
        { confirm: true },
        undefined,
        'delete',
      ).expect(409);
      await mutate(
        '/workspaces/' + alpha + '/members/' + otherId,
        owner,
        { confirm: true },
        undefined,
        'delete',
      ).expect(204);
      await get('/polls', other, alpha).expect(403);
      await mutate(
        '/workspaces/' + alpha,
        owner,
        { status: 'deleted', confirmName: 'Alpha' },
        undefined,
        'patch',
      ).expect(409);
      await mutate(
        '/workspaces/' + alpha,
        owner,
        { status: 'archived' },
        undefined,
        'patch',
      ).expect(200);
      await get('/polls', a.cookie, alpha)
        .expect(200)
        .expect((r) => expect(r.body.items).toHaveLength(1));
      await mutate('/polls', owner, pollInput, alpha).expect(409);
      await mutate(
        '/workspaces/' + alpha,
        owner,
        { status: 'active' },
        undefined,
        'patch',
      ).expect(200);
      await mutate(
        '/workspaces/' + alpha + '/members/me',
        a.cookie,
        { confirm: true },
        undefined,
        'delete',
      ).expect(204);
      await get('/events', a.cookie, alpha).expect(403);
      await get('/events', a.cookie, beta).expect(200);
      await mutate(
        '/workspaces/' + alpha,
        owner,
        { status: 'archived' },
        undefined,
        'patch',
      ).expect(200);
      await mutate(
        '/workspaces/' + alpha,
        owner,
        { status: 'deleted', confirmName: 'wrong' },
        undefined,
        'patch',
      ).expect(409);
      await mutate(
        '/workspaces/' + alpha,
        owner,
        { status: 'deleted', confirmName: 'Alpha' },
        undefined,
        'patch',
      ).expect(200);
      await get('/events', owner, alpha).expect(403);
      await get('/polls', owner, beta)
        .expect(200)
        .expect((r) => expect(r.body.items).toHaveLength(0));
      await mutate('/auth/logout', a.cookie, {}).expect(200);
      await get('/auth/me', a.cookie, undefined, secondary).expect(401);
    }, 20000);

    it('deletes only authorized scoped polls atomically with votes and totals', async () => {
      migration(true);
      const alpha = (await create('Poll lab')).body.id,
        beta = (await create('Other lab')).body.id;
      const token = await code(alpha);
      await joinWorkspace(token, attendee);
      await joinWorkspace(token, other);
      const createPoll = async (scope: string) =>
        (await mutate('/polls', owner, pollInput, scope).expect(201)).body
          .id as string;
      const target = await createPoll(alpha),
        keep = await createPoll(alpha),
        unrelated = await createPoll(beta);
      await mutate(
        '/polls/' + target + '/votes',
        attendee,
        { option: 0 },
        alpha,
      ).expect(200);
      const remove = (
        id: string,
        cookie: string,
        scope: string,
        agent = primary,
      ) =>
        mutate(
          '/polls/' + id,
          cookie,
          { confirm: true },
          scope,
          'delete',
          agent,
        );
      await remove(target, attendee, alpha).expect(403);
      await remove(target, other, alpha).expect(403);
      await remove(target, owner, beta).expect(404);
      await remove(target, owner, randomUUID()).expect(403);
      await mutate('/polls/' + target, owner, {}, alpha, 'delete').expect(400);
      await mutate('/workspaces/' + alpha + '/managers', owner, {
        email: 'manager@example.test',
      }).expect(204);
      const results = await Promise.all([
        remove(target, other, alpha, secondary),
        remove(target, owner, alpha),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
      expect(await store.get('ws:' + alpha + ':poll', target)).toBeNull();
      await get('/summary', owner, alpha).expect((r) =>
        expect(r.body.activePolls).toBe(1),
      );
      await get('/polls', owner, alpha).expect((r) =>
        expect(r.body.items.map((p: { id: string }) => p.id)).toEqual([keep]),
      );
      await get('/polls', owner, beta).expect((r) =>
        expect(r.body.items.map((p: { id: string }) => p.id)).toEqual([
          unrelated,
        ]),
      );
      await remove(keep, owner, alpha).expect(200);
      await get('/summary', owner, alpha).expect((r) =>
        expect(r.body.activePolls).toBe(0),
      );
    }, 20000);

    it('scopes exports and preserves appointment conflict guards across workspaces', async () => {
      migration(true);
      const alpha = (await create('First schedule')).body.id;
      const beta = (await create('Second schedule', other)).body.id;
      await joinWorkspace(await code(alpha), attendee);
      await joinWorkspace(await code(beta, other), attendee);
      const id = (
        await mutate(
          '/events',
          owner,
          {
            title: 'Alpha event',
            description: '',
            location: 'Room 1',
            startsAt: date(),
            capacity: 1,
          },
          alpha,
        ).expect(201)
      ).body.id;
      await get(
        '/events/' + id + '/attendees.csv?workspace=' + alpha,
        owner,
      ).expect(200);
      await get(
        '/events/' + id + '/attendees.csv?workspace=' + beta,
        other,
      ).expect(404);
      await get(
        '/events/' + id + '/attendees.csv?workspace=' + alpha,
        attendee,
      ).expect(403);
      await mutate(
        '/events/' + id + '/registrations',
        attendee,
        {},
        beta,
      ).expect(404);

      const startsAt = date();
      const slot = {
        title: 'Office hours',
        location: 'Room 2',
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 15 * 60000).toISOString(),
      };
      const first = (await mutate('/slots', owner, slot, alpha).expect(201))
        .body.id;
      const second = (await mutate('/slots', other, slot, beta).expect(201))
        .body.id;
      await mutate('/slots/' + first + '/booking', attendee, {}, alpha).expect(
        200,
      );
      await mutate(
        '/slots/' + second + '/booking',
        attendee,
        {},
        beta,
        'post',
        secondary,
      ).expect(409);
      await mutate('/slots/' + first + '/booking', attendee, {}, beta).expect(
        404,
      );
      await mutate(
        '/workspaces/' + alpha,
        owner,
        { status: 'archived' },
        undefined,
        'patch',
      ).expect(200);
      await mutate(
        '/events/' + id + '/registrations',
        attendee,
        {},
        alpha,
      ).expect(409);
      await mutate(
        '/slots/' + first + '/booking',
        attendee,
        {},
        alpha,
        'delete',
      ).expect(409);
    }, 20000);

    it('bounds invalid invitations across independent app instances', async () => {
      migration(true);
      const token = 'a'.repeat(43);
      for (let i = 0; i < 20; i++)
        await mutate(
          '/auth/workspace-preview',
          '',
          { code: token },
          undefined,
          'post',
          i % 2 ? primary : secondary,
        ).expect(404);
      await mutate(
        '/auth/workspace-preview',
        '',
        { code: token },
        undefined,
        'post',
        secondary,
      ).expect(429);
      expect(await store.list('guest')).toHaveLength(1);
    }, 20000);
  });
}
