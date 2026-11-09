// Repeatable 50-user HTTP workload and local process-failure test. No remote target option.
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { createServer, request as proxyRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
} from '@aws-sdk/client-dynamodb';
import { readConfig } from '../backend/src/config.js';
import { createStore } from '../backend/src/store.js';
import { createUser } from '../backend/src/auth.js';
import { HubService } from '../backend/src/service.js';
import { SchedulingService, bookings } from '../backend/src/scheduling.js';
import type { HubEvent, Poll, Slot, Snapshot } from '../shared/types.js';

const driver = process.argv.includes('--dynamodb') ? 'dynamodb' : 'sqlite';
const rounds = Number(process.env.HUB_LOAD_ROUNDS ?? 12);
assert(
  Number.isInteger(rounds) && rounds >= 1 && rounds <= 50,
  'Use 1–50 rounds.',
);
const directory = mkdtempSync(join(tmpdir(), 'hub-load-'));
const table = `hub-load-${randomUUID()}`;
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_DRIVER: driver,
  SQLITE_PATH: join(directory, 'load.sqlite'),
  ALLOW_AWS: 'false',
  DYNAMODB_TABLE: table,
  ...(driver === 'dynamodb'
    ? {
        DYNAMODB_ENDPOINT:
          process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000',
      }
    : {}),
};
const config = readConfig(env);
// Both configuration validation and explicit endpoint requirement prevent accidental AWS load.
if (driver === 'dynamodb')
  assert(config.DYNAMODB_ENDPOINT, 'DynamoDB Local endpoint required.');
const dynamo =
  driver === 'dynamodb'
    ? new DynamoDBClient({
        region: config.AWS_REGION,
        endpoint: config.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      })
    : null;
if (dynamo)
  await dynamo.send(
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
const store = createStore(config),
  service = new HubService(store),
  scheduling = new SchedulingService(store);
type Worker = {
  child: ChildProcess;
  port: number;
  healthy: boolean;
  pid: number;
};
const workers: Worker[] = [],
  samples: { pid: number; cpuPercent: number; rssMiB: number }[] = [];
const metrics: {
  path: string;
  status: number;
  ms: number;
  expected: boolean;
}[] = [];
const targets = new Map<number, number>();
let cursor = 0,
  probing = false;
const proxy = createServer((req, res) => {
  const healthy = workers.filter(
    (w) =>
      w.healthy && w.child.exitCode === null && w.child.signalCode === null,
  );
  if (!healthy.length) {
    res.writeHead(503);
    res.end();
    return;
  }
  const target = healthy[cursor++ % healthy.length];
  targets.set(target.pid, (targets.get(target.pid) ?? 0) + 1);
  const upstream = proxyRequest(
    {
      hostname: '127.0.0.1',
      port: target.port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    },
  );
  upstream.on('error', () => {
    target.healthy = false;
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});
const sampler = setInterval(() => {
  if (probing) return;
  probing = true;
  void Promise.all(
    workers.map(async (w) => {
      try {
        w.healthy = (
          await fetch(`http://127.0.0.1:${w.port}/api/ready`, {
            signal: AbortSignal.timeout(500),
          })
        ).ok;
      } catch {
        w.healthy = false;
      }
    }),
  ).finally(() => {
    probing = false;
  });
}, 250);
async function worker() {
  const child = fork(new URL('./load-worker.js', import.meta.url), [], {
    env: { ...env, APP_ORIGIN: origin },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let errors = '';
  child.stderr?.on('data', (chunk) => {
    errors += chunk;
  });
  child.on('message', (message) => {
    const m = message as {
      type: string;
      pid: number;
      cpuPercent: number;
      rssMiB: number;
    };
    if (m.type === 'sample') samples.push(m);
  });
  const ready = await new Promise<{ port: number; pid: number }>(
    (resolve, reject) => {
      const timer = globalThis.setTimeout(
        () => reject(Error(`Worker startup timeout: ${errors}`)),
        15000,
      );
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error(`Worker exited ${code}: ${errors}`));
      });
      child.on('message', (message) => {
        const m = message as { type: string; port: number; pid: number };
        if (m.type === 'ready') {
          clearTimeout(timer);
          resolve(m);
        }
      });
    },
  );
  const item = { child, ...ready, healthy: true };
  workers.push(item);
  return item;
}
await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(proxy.address() as import('node:net').AddressInfo).port}`;
const password = `Load9-${randomBytes(16).toString('hex')}`;
async function call(
  path: string,
  method = 'GET',
  cookie = '',
  body?: unknown,
  conflicts = false,
) {
  const start = performance.now();
  let status = 0;
  let data: unknown;
  try {
    const response = await fetch(origin + path, {
      method,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    status = response.status;
    const raw = await response.text();
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    return {
      status,
      data,
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    };
  } finally {
    metrics.push({
      path: path.startsWith('/api/auth')
        ? path
        : path.replace(/[a-f0-9-]{36}/g, ':id'),
      status,
      ms: performance.now() - start,
      expected: conflicts && status === 409,
    });
  }
}
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.ceil(values.length * p) - 1)
  ] ?? 0;
const check = (r: { status: number; data?: unknown }, status = 200) =>
  assert.equal(r.status, status, JSON.stringify(r.data));
const barriers = new Map<
  string,
  { waiting: { resolve: () => void; reject: (error: unknown) => void }[] }
>();
let report: Record<string, unknown> | undefined;
try {
  const organizer = await createUser(
    store,
    'load-organizer@example.test',
    'Load professor',
    password,
    'organizer',
  );
  // Offline fixture accounts; requests below still exercise password verification and persistent sessions.
  const users = [];
  for (let i = 0; i < 50; i++)
    users.push(
      await createUser(
        store,
        `load-${i}@example.test`,
        `Load student ${i}`,
        password,
      ),
    );
  const startsAt = new Date(Date.now() + 3 * 86400_000).toISOString();
  const input = {
    title: 'Load event',
    description: 'Isolated fixture',
    location: 'Local',
    startsAt,
    capacity: 10,
  };
  const event = await service.createEvent(organizer, input);
  const grouped = await service.createEvent(organizer, {
    ...input,
    title: 'Load grouped event',
    capacity: 36,
    groupConfiguration: {
      count: 9,
      capacity: 4,
      autoAssign: true,
      allowSelfSelection: true,
    },
  });
  const poll = await service.createPoll(organizer, {
    question: 'Load poll',
    options: ['A', 'B'],
    allowCancellation: true,
    allowChanges: true,
  });
  const plan = await scheduling.createSchedule(organizer, {
    title: 'Load office hours',
    location: 'Local',
    date: startsAt.slice(0, 10),
    startTime: '14:00',
    endTime: '16:00',
    timeZone: 'UTC',
    durationMinutes: 15,
    bufferMinutes: 0,
    capacity: 1,
    weeks: 1,
    breaks: [],
    bookingLeadMinutes: 0,
    cancelBeforeMinutes: 0,
    maxActiveBookings: 20,
    requestId: randomUUID(),
  });
  const slots = plan.slotIds;
  await worker();
  await worker();
  const cookies = Array<string>(50).fill('');
  const started = performance.now();
  console.log(
    `Starting 50 concurrent HTTP users, ${rounds} rounds, two application processes, ${driver}.`,
  );
  await Promise.all(
    users.map(async (u, i) => {
      check(await call('/'));
      const signed = await call('/api/auth/login', 'POST', '', {
        email: u.email,
        password,
      });
      check(signed);
      cookies[i] = signed.cookie;
      const cookie = signed.cookie;
      for (let round = 0; round < rounds; round++) {
        check(await call('/api/snapshot', 'GET', cookie));
        check(
          await call(
            `/api/events/${event.id}/registrations`,
            'POST',
            cookie,
            {},
            false,
          ),
          201,
        );
        check(
          await call(
            `/api/events/${grouped.id}/registrations`,
            'POST',
            cookie,
            {},
            false,
          ),
          201,
        );
        const membership = await call(
          `/api/events/${grouped.id}/groups/membership`,
          'PUT',
          cookie,
          { groupId: grouped.groups![i % 9].id },
          true,
        );
        assert([200, 409].includes(membership.status));
        const booked = await call(
          `/api/slots/${slots[i % slots.length]}/booking`,
          'POST',
          cookie,
          { reason: 'Isolated load test' },
          true,
        );
        assert([200, 409].includes(booked.status));
        check(
          await call(`/api/polls/${poll.id}/votes`, 'POST', cookie, {
            option: i % 2,
          }),
        );
        check(await call('/api/snapshot', 'GET', cookie));
        // At this barrier all 50 active users retain their registrations for correctness checks.
        await barrier(round);
        if (booked.status === 200)
          check(
            await call(
              `/api/slots/${slots[i % slots.length]}/booking`,
              'DELETE',
              cookie,
            ),
          );
        check(
          await call(
            `/api/events/${event.id}/registrations/me`,
            'DELETE',
            cookie,
          ),
        );
        check(
          await call(
            `/api/events/${grouped.id}/registrations/me`,
            'DELETE',
            cookie,
          ),
        );
        check(
          await call(`/api/polls/${poll.id}/selections/me`, 'DELETE', cookie),
        );
        await setTimeout(Number(process.env.HUB_LOAD_THINK_MS ?? 5000));
      }
    }),
  );
  const workloadMs = performance.now() - started;
  assert.equal(targets.size, 2, 'Both processes must receive requests.');
  // Retain a record and an authenticated session across a hard failure and replacement.
  check(
    await call(`/api/events/${event.id}/registrations`, 'POST', cookies[0], {}),
    201,
  );
  const failed = workers[0];
  failed.child.kill('SIGKILL');
  await once(failed.child, 'exit');
  const failureStart = performance.now();
  let interruptions = 0,
    successfulProbes = 0;
  for (let i = 0; i < 50; i++) {
    const response = await call('/api/snapshot', 'GET', cookies[i]);
    if (response.status === 200) successfulProbes++;
    else interruptions++;
    await setTimeout(20);
  }
  const recoveryDetectionMs = performance.now() - failureStart;
  const replacement = await worker();
  check(await call('/api/auth/me', 'GET', cookies[0]));
  const snapshot = (await call('/api/snapshot', 'GET', cookies[0]))
    .data as Snapshot;
  assert(
    snapshot.events.find((e) => e.id === event.id)?.registration,
    'Confirmed registration lost after failure.',
  );
  const persisted = (await store.get<HubEvent>('event', event.id))!.data;
  assert.equal(persisted.registrations.length, 1);
  assert.equal(
    bookings((await store.get<Slot>('slot', slots[0]))!.data).length,
    0,
  );
  const latency = metrics.filter(
    (m) => m.path.startsWith('/api/') && !m.expected,
  );
  const unexpected = metrics.filter(
    (m) => !m.expected && (m.status < 200 || m.status >= 400),
  );
  const apiUnexpected = latency.filter(
    (m) => m.status < 200 || m.status >= 400,
  );
  report = {
    date: new Date().toISOString(),
    driver,
    environment:
      'Local Windows host; two Node processes behind an HTTP health-checking test proxy. Not EC2, AWS ALB, HTTPS or ASG evidence.',
    node: process.version,
    host: {
      logicalCpus: cpus().length,
      totalMemoryGiB: totalmem() / 1073741824,
    },
    users: 50,
    rounds,
    workloadDurationSeconds: workloadMs / 1000,
    requests: metrics.length,
    expectedCapacityConflicts: metrics.filter((m) => m.expected).length,
    unexpectedFailures: unexpected.length,
    successRateExcludingExpectedConflicts:
      1 - unexpected.length / metrics.filter((m) => !m.expected).length,
    apiSuccessRateExcludingExpectedConflicts:
      1 - apiUnexpected.length / latency.length,
    apiP50Ms: percentile(
      latency.map((m) => m.ms),
      0.5,
    ),
    apiP95Ms: percentile(
      latency.map((m) => m.ms),
      0.95,
    ),
    loginP95Ms: percentile(
      metrics.filter((m) => m.path === '/api/auth/login').map((m) => m.ms),
      0.95,
    ),
    workerSamples: samples,
    peakWorkerRssMiB: Math.max(0, ...samples.map((s) => s.rssMiB)),
    peakWorkerCpuPercent: Math.max(0, ...samples.map((s) => s.cpuPercent)),
    routing: Object.fromEntries(targets),
    correctness: {
      roundsVerified: rounds,
      eventConfirmed: 10,
      eventWaitlisted: 40,
      groups: 9,
      groupCapacity: 4,
      confirmedGroupRegistrations: 36,
      appointmentWinnersPerRound: 8,
      duplicateBookings: 0,
      overCapacity: 0,
    },
    localFailureTest: {
      successfulProbes,
      interruptions,
      probeWindowMs: recoveryDetectionMs,
      probeRequests: 50,
      replacementPid: replacement.pid,
      sessionAndRecordPreserved: true,
      awsFailoverVerified: false,
    },
    unexpectedRequestDetails: unexpected,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    `artifacts/load-${driver}.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        ...report,
        workerSamples: `${samples.length} samples recorded in artifact`,
      },
      null,
      2,
    ),
  );
  assert(
    apiUnexpected.length / latency.length <= 0.01,
    'API success target missed.',
  );
  assert(
    percentile(
      latency.map((m) => m.ms),
      0.95,
    ) < 1000,
    'API p95 target missed.',
  );
} finally {
  clearInterval(sampler);
  for (const w of workers)
    if (w.child.exitCode === null && w.child.signalCode === null) {
      w.child.send('stop');
      await once(w.child, 'exit');
    }
  proxy.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  store.close();
  if (dynamo) {
    await dynamo.send(new DeleteTableCommand({ TableName: table }));
    dynamo.destroy();
  }
  rmSync(directory, { recursive: true, force: true });
}

// A real rendezvous: no user cancels until all participants complete that round.

async function verifyRound() {
  const event = (await store.list<HubEvent>('event')).find(
    (e) => e.title === 'Load event',
  )!;
  assert.equal(event.registrations.length, 50);
  assert.equal(
    event.registrations.filter((r) => r.status === 'confirmed').length,
    10,
  );
  assert.equal(new Set(event.registrations.map((r) => r.userId)).size, 50);
  const grouped = (await store.list<HubEvent>('event')).find(
    (e) => e.title === 'Load grouped event',
  )!;
  assert.equal(
    grouped.registrations.filter((r) => r.status === 'confirmed').length,
    36,
  );
  for (const group of grouped.groups!)
    assert(
      grouped.registrations.filter((r) => r.groupId === group.id).length <= 4,
    );
  for (const s of await store.list<Slot>('slot'))
    assert.equal(bookings(s).length, 1);
  const poll = (await store.list<Poll>('poll'))[0];
  assert.equal(Object.keys(poll.votes).length, 50);
}
// Function declaration permits the workload to start before these barriers are first used.
function barrier(round: number): Promise<void> {
  const key = `barrier-${round}`;
  const state = barriers.get(key) ?? { waiting: [] };
  barriers.set(key, state);
  return new Promise<void>((resolve, reject) => {
    state.waiting.push({ resolve, reject });
    if (state.waiting.length === 50)
      void verifyRound().then(
        () => state.waiting.forEach((p) => p.resolve()),
        (error) => state.waiting.forEach((p) => p.reject(error)),
      );
  });
}
