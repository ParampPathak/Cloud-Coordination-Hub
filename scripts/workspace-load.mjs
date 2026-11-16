import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { Pool } from 'pg';
import { createApp } from '../dist/backend/backend/src/app.js';
import { readConfig } from '../dist/backend/backend/src/config.js';
import { createUser } from '../dist/backend/backend/src/auth.js';
import { PostgresStore } from '../dist/backend/backend/src/postgres-store.js';
import { postgresSchema } from '../dist/backend/backend/src/postgres-schema.js';
import { planWorkspaceMigration } from '../dist/backend/backend/src/workspace-migration.js';

const origin = 'http://localhost:3000';
const local = (source) => {
  const url = new URL(source ?? '');
  assert(
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.search &&
      !url.hash,
    'This runner permits only local PostgreSQL.',
  );
  return url;
};
const options = (url) =>
  readConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: origin,
    DATABASE_DRIVER: 'postgres',
    POSTGRES_URL: url.href,
    POSTGRES_POOL_MAX: '10',
    GUEST_DEMO_ENABLED: 'true',
    ALLOW_AWS: 'false',
  });
async function worker() {
  const url = local(process.env.CCH_WORKSPACE_TEST_DATABASE);
  assert(
    /^\/cch_workspace_load_[a-f0-9]{32}$/.test(url.pathname) &&
      typeof process.send === 'function',
  );
  const config = options(url);
  const store = new PostgresStore(config);
  await store.ready();
  const server = createApp(config, store, false).listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.send({ port: server.address().port });
  process.on('disconnect', () =>
    server.close(async () => {
      await store.close();
      process.exit(0);
    }),
  );
}
async function run() {
  const source = local(process.env.POSTGRES_TEST_URL);
  const admin = new Pool({ connectionString: source.href, max: 1 });
  const database = 'cch_workspace_load_' + randomUUID().replaceAll('-', '');
  const url = new URL(source);
  url.pathname = '/' + database;
  const fixture = new Pool({ connectionString: url.href, max: 4 });
  const config = options(url);
  const store = new PostgresStore(config);
  let created = false;
  const children = [];
  const measures = [];
  const failures = [];
  let record = false;
  const cookies = [];
  const add = async (
    index,
    path,
    { method = 'GET', body, scope, cookie, expected = [200] } = {},
  ) => {
    const started = performance.now();
    let status = 0;
    try {
      const response = await fetch(
        'http://127.0.0.1:' + children[index % 2].port + '/api' + path,
        {
          method,
          headers: {
            Origin: origin,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...(scope ? { 'X-Workspace-Id': scope } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(40000),
        },
      );
      status = response.status;
      const json = await response.json();
      assert(
        expected.includes(status),
        method + ' ' + path + ' returned ' + status + ' ' + (json.error ?? ''),
      );
      return {
        json,
        status,
        cookie: response.headers.get('set-cookie')?.split(';')[0],
      };
    } catch (error) {
      failures.push(error.message);
      throw error;
    } finally {
      if (record)
        measures.push({ duration: performance.now() - started, status });
    }
  };
  const post = (i, path, body, cookie, scope, expected) =>
    add(i, path, { method: 'POST', body, cookie, scope, expected });
  const phase = async (name, fn) => {
    const settled = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) => fn(i)),
    );
    const rejected = settled.filter((r) => r.status === 'rejected');
    assert.equal(
      rejected.length,
      0,
      name +
        ' failures: ' +
        rejected
          .slice(0, 4)
          .map((r) => r.reason.message)
          .join(' | '),
    );
    return settled.map((r) => r.value);
  };
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    created = true;
    await fixture.query(postgresSchema);
    const email = 'organizer@example.test',
      password = 'LocalFixture9-' + randomBytes(12).toString('hex');
    await createUser(store, email, 'Organizer Fixture', password, 'organizer');
    const rows = (
      await fixture.query('SELECT kind,id,data,version FROM cch.records')
    ).rows;
    const migration = planWorkspaceMigration(rows, email);
    assert(await store.transact(migration.additions));
    for (let i = 0; i < 2; i++) {
      const child = fork(new URL(import.meta.url), ['--worker'], {
        env: { ...process.env, CCH_WORKSPACE_TEST_DATABASE: url.href },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      children.push({ child });
      children[i].port = await Promise.race([
        once(child, 'message').then(([value]) => value.port),
        once(child, 'exit').then(() => {
          throw new Error('Worker exited early.');
        }),
      ]);
    }
    const organizer = (await post(0, '/auth/login', { email, password }))
      .cookie;
    const alpha = (
      await post(
        0,
        '/workspaces',
        { name: 'Load test' },
        organizer,
        undefined,
        [201],
      )
    ).json.id;
    const beta = (
      await post(
        1,
        '/workspaces',
        { name: 'Isolated comparison' },
        organizer,
        undefined,
        [201],
      )
    ).json.id;
    const getCode = async (scope) =>
      (
        await add(0, '/workspaces/' + scope + '/management', {
          cookie: organizer,
        })
      ).json.invitation.code;
    const first = await getCode(alpha),
      second = await getCode(beta);
    const date = new Date(Date.now() + 7 * 86400e3);
    const event = (
      await post(
        0,
        '/events',
        {
          title: 'Groups',
          description: 'Load fixture',
          location: 'Local',
          startsAt: date.toISOString(),
          capacity: 36,
          groupConfiguration: {
            count: 9,
            capacity: 4,
            autoAssign: true,
            allowSelfSelection: true,
          },
        },
        organizer,
        alpha,
        [201],
      )
    ).json;
    const poll = (
      await post(
        0,
        '/polls',
        { question: 'Workshop time?', options: ['A', 'B'] },
        organizer,
        alpha,
        [201],
      )
    ).json;
    const slot = (
      await post(
        0,
        '/slots',
        {
          title: 'Local office hours',
          location: 'Local',
          startsAt: date.toISOString(),
          endsAt: new Date(+date + 900000).toISOString(),
        },
        organizer,
        alpha,
        [201],
      )
    ).json;
    record = true;
    const guests = await phase('guest admission', async (i) => {
      const p = (await post(i, '/auth/workspace-preview', { code: first }))
        .json;
      const g = await post(
        i,
        '/auth/guest',
        {
          name: 'Same Name',
          code: first,
          workspaceId: p.id,
          confirmation: p.confirmation,
        },
        undefined,
        undefined,
        [201],
      );
      cookies[i] = g.cookie;
      return g.json.id;
    });
    assert.equal(new Set(guests).size, 50);
    await phase('shared sessions', async (i) => {
      const { json } = await add(i + 1, '/auth/me', { cookie: cookies[i] });
      assert.equal(json.id, guests[i]);
    });
    await phase('second membership', async (i) => {
      const p = (
        await post(i, '/workspaces/preview', { code: second }, cookies[i])
      ).json;
      await post(
        i + 1,
        '/workspaces/join',
        { code: second, workspaceId: beta, confirmation: p.confirmation },
        cookies[i],
      );
    });
    await phase('scope switching and isolation', async (i) => {
      const mine = await add(i, '/workspaces', { cookie: cookies[i] });
      assert.deepEqual(
        mine.json.items.map((w) => w.id).sort(),
        [alpha, beta].sort(),
      );
      const own = await add(i, '/events', { cookie: cookies[i], scope: alpha });
      const other = await add(i + 1, '/events', {
        cookie: cookies[i],
        scope: beta,
      });
      assert.deepEqual(
        own.json.items.map((e) => e.id),
        [event.id],
      );
      assert.equal(other.json.items.length, 0);
    });
    const registration = await phase('event registrations', (i) =>
      post(
        i,
        '/events/' + event.id + '/registrations',
        {},
        cookies[i],
        alpha,
        [201],
      ),
    );
    const winners = registration
      .map((r, i) => (r.json.registration.status === 'confirmed' ? i : -1))
      .filter((i) => i >= 0);
    assert.equal(winners.length, 36);
    await phase('group selection or full capacity', (i) =>
      add(i, '/events/' + event.id + '/groups/membership', {
        method: 'PUT',
        body: { groupId: event.groups[i % 9].id },
        cookie: cookies[i],
        scope: alpha,
        expected: [200, 409],
      }),
    );
    const before = await add(1, '/events/' + event.id + '/attendees', {
      cookie: organizer,
      scope: alpha,
    });
    const next = before.json.find((r) => r.status === 'waitlisted').userId;
    await add(1, '/events/' + event.id + '/registrations/me', {
      method: 'DELETE',
      cookie: cookies[winners[0]],
      scope: alpha,
    });
    const after = await add(0, '/events/' + event.id + '/attendees', {
      cookie: organizer,
      scope: alpha,
    });
    assert.equal(after.json.find((r) => r.userId === next).status, 'confirmed');
    assert.equal(after.json.filter((r) => r.status === 'confirmed').length, 36);
    assert.equal(new Set(after.json.map((r) => r.userId)).size, 49);
    const groups = (
      await add(0, '/events/' + event.id + '/groups', {
        cookie: organizer,
        scope: alpha,
      })
    ).json;
    assert.equal(groups.length, 9);
    const members = groups.flatMap((g) => g.members.map((m) => m.userId));
    assert.equal(members.length, 36);
    assert.equal(new Set(members).size, 36);
    assert(groups.every((g) => g.members.length === 4));
    const bookings = await phase('appointment booking', (i) =>
      post(
        i,
        '/slots/' + slot.id + '/booking',
        { reason: 'Local test' },
        cookies[i],
        alpha,
        [200, 409],
      ),
    );
    assert.equal(bookings.filter((r) => r.status === 200).length, 1);
    await phase('poll voting', (i) =>
      post(
        i,
        '/polls/' + poll.id + '/votes',
        { option: i % 2 },
        cookies[i],
        alpha,
      ),
    );
    await phase('reject guest poll deletion', (i) =>
      add(i, '/polls/' + poll.id, {
        method: 'DELETE',
        body: { confirm: true },
        scope: alpha,
        cookie: cookies[i],
        expected: [403],
      }),
    );
    const results = await add(1, '/polls', { cookie: organizer, scope: alpha });
    assert.equal(results.json.items[0].totalVotes, 50);
    await add(1, '/polls/' + poll.id, {
      method: 'DELETE',
      body: { confirm: true },
      scope: beta,
      cookie: organizer,
      expected: [404],
    });
    await add(0, '/polls/' + poll.id, {
      method: 'DELETE',
      body: { confirm: true },
      scope: alpha,
      cookie: organizer,
    });
    assert.equal(
      (await add(1, '/summary', { cookie: organizer, scope: alpha })).json
        .activePolls,
      0,
    );
    assert.deepEqual(
      (await add(1, '/summary', { cookie: organizer, scope: beta })).json,
      { events: 0, confirmed: 0, waitlisted: 0, activePolls: 0 },
    );
  } finally {
    if (measures.length) {
      measures.sort((a, b) => a.duration - b.duration);
      const percentile = (p) =>
        Math.round(measures[Math.ceil(p * measures.length) - 1].duration);
      const report = {
        users: 50,
        independentProcesses: children.length,
        requests: measures.length,
        unexpectedErrors: failures.length,
        expectedConflicts: measures.filter((m) => m.status === 409).length,
        expectedForbidden: measures.filter((m) => m.status === 403).length,
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
      };
      mkdirSync('artifacts/workspace-load', { recursive: true });
      writeFileSync(
        'artifacts/workspace-load/results.json',
        JSON.stringify(report, null, 2) + '\n',
      );
      console.log(JSON.stringify(report, null, 2));
    }
    for (const { child } of children)
      if (child.connected) {
        const done = once(child, 'exit');
        child.disconnect();
        await done;
      }
    await fixture.end();
    await store.close();
    try {
      if (created)
        await admin.query('DROP DATABASE "' + database + '" WITH (FORCE)');
    } finally {
      await admin.end();
    }
  }
}
await (process.argv[2] === '--worker' ? worker() : run());
