// Runs the built production server twice with isolated SQLite, never AWS.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = mkdtempSync(join(tmpdir(), 'hub-production-'));
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const origin = 'http://203.0.113.10'; // Simulates the exact public EC2 origin.
const env = {
  ...process.env,
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: String(port),
  APP_ORIGIN: origin,
  ALLOW_INSECURE_HTTP: 'true',
  ALLOW_AWS: 'false',
  DATABASE_DRIVER: 'sqlite',
  SQLITE_PATH: join(directory, 'hub.sqlite'),
  ALLOW_DEMO_SEED: 'true',
};
const seed = () =>
  spawnSync(process.execPath, [join(root, 'dist/backend/scripts/seed.js')], {
    cwd: directory,
    env,
    encoding: 'utf8',
  });
let server;
let output = '';
async function stop() {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
}
async function start() {
  server = spawn(
    process.execPath,
    [join(root, 'dist/backend/backend/src/server.js')],
    { cwd: directory, env, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  server.stderr.on('data', (data) => {
    output += data;
  });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error(`Server exited: ${output}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/ready`)).ok) return;
    } catch {
      /* Starting. */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw Error('Production readiness timed out.');
}
async function api(path, method = 'GET', body, cookie, requestOrigin = origin) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      Origin: requestOrigin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
try {
  const refused = spawnSync(
    process.execPath,
    [join(root, 'dist/backend/scripts/seed.js')],
    {
      cwd: directory,
      env: { ...env, ALLOW_DEMO_SEED: 'false' },
      encoding: 'utf8',
    },
  );
  assert.notEqual(
    refused.status,
    0,
    'Production seeding must require explicit opt-in.',
  );
  const seeded = seed();
  assert.equal(
    seeded.status,
    0,
    'Production SQLite seed must succeed with explicit opt-in.',
  );
  const password = seeded.stdout.match(
    /Temporary password for both: (.+)/,
  )?.[1];
  assert(password);
  assert.notEqual(
    seed().status,
    0,
    'Repeat seed must preserve populated data.',
  );
  await start();
  const frontend = await api('/');
  assert.equal(frontend.status, 200);
  const html = await frontend.text();
  assert(html.includes('id="root"'));
  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  assert(asset);
  assert.equal((await api(asset)).status, 200);
  assert(
    !frontend.headers
      .get('content-security-policy')
      .includes('upgrade-insecure-requests'),
  );
  assert.equal(frontend.headers.get('strict-transport-security'), null);
  assert.equal((await api('/events')).status, 200);
  assert.equal((await api('/api/health')).status, 200);
  assert.equal((await api('/api/snapshot')).status, 401);
  const credentials = { email: 'organizer@example.test', password };
  assert.equal(
    (
      await api(
        '/api/auth/login',
        'POST',
        credentials,
        undefined,
        'http://evil.example',
      )
    ).status,
    403,
  );
  const signedIn = await api('/api/auth/login', 'POST', credentials);
  assert.equal(signedIn.status, 200);
  const session = signedIn.headers.get('set-cookie');
  assert(session.includes('HttpOnly') && session.includes('SameSite=Lax'));
  assert(!session.includes('Secure'));
  const cookie = session.split(';')[0];
  const created = await api(
    '/api/events',
    'POST',
    {
      title: 'EC2 persistence smoke test',
      description: 'Isolated test data',
      location: 'Classroom',
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      capacity: 2,
    },
    cookie,
  );
  assert.equal(created.status, 201);
  const event = await created.json();
  const attendee = await api('/api/auth/login', 'POST', {
    email: 'attendee@example.test',
    password,
  });
  const attendeeCookie = attendee.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (
      await api(
        `/api/events/${event.id}/registrations`,
        'POST',
        undefined,
        attendeeCookie,
      )
    ).status,
    201,
  );
  await stop();
  await start();
  assert.equal(
    (await api('/api/auth/me', 'GET', undefined, cookie)).status,
    200,
  );
  const snapshot = await (
    await api('/api/snapshot', 'GET', undefined, cookie)
  ).json();
  assert(
    snapshot.events.some(
      (entry) => entry.id === event.id && entry.confirmedCount === 1,
    ),
  );
  console.log(
    'Production smoke passed: built frontend/assets, SPA routes, health/readiness, public-origin authentication/CSRF, event creation/registration, seed protection, SQLite and sessions across server restart.',
  );
} finally {
  await stop();
  rmSync(directory, { recursive: true, force: true });
}
