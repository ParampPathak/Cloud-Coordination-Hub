import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../backend/src/store.js';
import { HubService } from '../backend/src/service.js';
import { createApp } from '../backend/src/app.js';
import { allowedOrigins, readConfig } from '../backend/src/config.js';
import { createDemoData } from '../backend/src/demo-data.js';
import {
  createUser,
  login,
  sessionUser,
  tokenKey,
} from '../backend/src/auth.js';
import type { User, HubEvent, Poll, Slot } from '../shared/types.js';
const organizer: User = {
  id: 'organizer-a',
  name: 'Alex',
  email: 'alex@example.test',
  role: 'organizer',
};
const other: User = {
  id: 'organizer-b',
  name: 'Other',
  email: 'other@example.test',
  role: 'organizer',
};
const attendee = (i: number): User => ({
  id: `attendee-${i}`,
  name: `Attendee ${i}`,
  email: `attendee${i}@example.test`,
  role: 'user',
});
const future = new Date(Date.now() + 86400_000).toISOString();
const eventInput = {
  title: 'Architecture workshop',
  description: 'Test event',
  location: 'Room 204',
  startsAt: future,
  capacity: 2,
};
let store: SqliteStore;
let service: HubService;
beforeEach(() => {
  store = new SqliteStore(':memory:');
  service = new HubService(store);
});
afterEach(() => store.close());
describe('Events and waitlists', () => {
  it('creates and persists an organizer-owned event', async () => {
    const event = await service.createEvent(organizer, eventInput);
    expect(
      (await store.get<HubEvent>('event', event.id))?.data.organizerId,
    ).toBe(organizer.id);
    expect(event.confirmedCount).toBe(0);
    expect(await store.list('activity')).toHaveLength(1);
  });
  it('fills capacity, assigns FIFO positions, and promotes on cancellation', async () => {
    const event = await service.createEvent(organizer, eventInput);
    await service.register(attendee(1), event.id);
    await service.register(attendee(2), event.id);
    expect(
      (await service.register(attendee(3), event.id)).registration?.position,
    ).toBe(1);
    expect(
      (await service.register(attendee(4), event.id)).registration?.position,
    ).toBe(2);
    await service.cancel(attendee(1), event.id);
    const persisted = (await store.get<HubEvent>('event', event.id))!.data;
    expect(
      persisted.registrations.find((r) => r.userId === attendee(3).id)?.status,
    ).toBe('confirmed');
    expect(
      service.eventView(persisted, attendee(4)).registration?.position,
    ).toBe(1);
    expect(service.eventView(persisted, attendee(1)).confirmedCount).toBe(2);
  });
  it('rejects duplicate confirmed and waitlisted registrations', async () => {
    const event = await service.createEvent(organizer, {
      ...eventInput,
      capacity: 1,
    });
    for (const i of [1, 2]) {
      await service.register(attendee(i), event.id);
      await expect(
        service.register(attendee(i), event.id),
      ).rejects.toMatchObject({ status: 409 });
    }
  });
  it('handles 40 simultaneous registrations across separate store connections without overbooking', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-test-'));
    const path = join(dir, 'hub.sqlite');
    const first = new SqliteStore(path);
    const second = new SqliteStore(path);
    try {
      const services = [new HubService(first), new HubService(second)];
      const event = await services[0].createEvent(organizer, {
        ...eventInput,
        capacity: 5,
      });
      await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          services[i % 2].register(attendee(i), event.id),
        ),
      );
      const persisted = (await second.get<HubEvent>('event', event.id))!.data;
      expect(persisted.registrations).toHaveLength(40);
      expect(
        persisted.registrations.filter((r) => r.status === 'confirmed'),
      ).toHaveLength(5);
      expect(new Set(persisted.registrations.map((r) => r.sequence)).size).toBe(
        40,
      );
      expect(await first.list('activity')).toHaveLength(41);
    } finally {
      first.close();
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('concurrent duplicate requests succeed once and audit only committed changes', async () => {
    const event = await service.createEvent(organizer, eventInput);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => service.register(attendee(1), event.id)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await store.list('activity')).toHaveLength(2);
  });
  it('concurrent cancellations preserve counts and promote exactly the freed seats', async () => {
    const event = await service.createEvent(organizer, eventInput);
    for (let i = 1; i <= 5; i++) await service.register(attendee(i), event.id);
    await Promise.all([
      service.cancel(attendee(1), event.id),
      service.cancel(attendee(2), event.id),
    ]);
    const data = (await store.get<HubEvent>('event', event.id))!.data;
    expect(
      data.registrations
        .filter((r) => r.status === 'confirmed')
        .map((r) => r.userId),
    ).toEqual([attendee(3).id, attendee(4).id]);
    expect(
      data.registrations.filter((r) => r.status === 'waitlisted'),
    ).toHaveLength(1);
    await expect(service.cancel(attendee(1), event.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('waitlist cancellation does not disturb confirmed seats', async () => {
    const event = await service.createEvent(organizer, {
      ...eventInput,
      capacity: 1,
    });
    await service.register(attendee(1), event.id);
    await service.register(attendee(2), event.id);
    const result = await service.cancel(attendee(2), event.id);
    expect(result.confirmedCount).toBe(1);
    expect(result.waitlistCount).toBe(0);
  });
  it('increasing capacity promotes waitlisted users and lowering below attendance fails', async () => {
    const event = await service.createEvent(organizer, {
      ...eventInput,
      capacity: 1,
    });
    await service.register(attendee(1), event.id);
    await service.register(attendee(2), event.id);
    expect(
      (await service.editEvent(organizer, event.id, eventInput)).confirmedCount,
    ).toBe(2);
    await expect(
      service.editEvent(organizer, event.id, { ...eventInput, capacity: 1 }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('requires ownership to edit events or read attendees', async () => {
    const event = await service.createEvent(organizer, eventInput);
    await expect(
      service.editEvent(other, event.id, eventInput),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.attendees(attendee(1), event.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.createEvent(attendee(1), eventInput),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('persists application data across database reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-persistence-'));
    const path = join(dir, 'hub.sqlite');
    const initial = new SqliteStore(path);
    const event = await new HubService(initial).createEvent(
      organizer,
      eventInput,
    );
    initial.close();
    const reopened = new SqliteStore(path);
    try {
      expect(
        (await reopened.get<HubEvent>('event', event.id))!.data.title,
      ).toBe(eventInput.title);
    } finally {
      reopened.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe('Polls and appointments', () => {
  it('counts real votes and rejects duplicate, invalid, closed and unauthorized voting changes', async () => {
    const poll = await service.createPoll(organizer, {
      question: 'When?',
      options: ['Monday', 'Tuesday'],
    });
    expect((await service.vote(attendee(1), poll.id, 1)).counts).toEqual([
      0, 1,
    ]);
    await expect(service.vote(attendee(1), poll.id, 0)).rejects.toMatchObject({
      status: 409,
    });
    await expect(service.vote(attendee(2), poll.id, 9)).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.closePoll(other, poll.id)).rejects.toMatchObject({
      status: 403,
    });
    await service.closePoll(organizer, poll.id);
    await expect(service.vote(attendee(2), poll.id, 0)).rejects.toMatchObject({
      status: 409,
    });
    expect((await store.get<Poll>('poll', poll.id))!.data.votes).toEqual({
      'attendee-1': 1,
    });
  });
  it('persists all concurrent poll votes', async () => {
    const poll = await service.createPoll(organizer, {
      question: 'When?',
      options: ['Monday', 'Tuesday'],
    });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        service.vote(attendee(i), poll.id, i % 2),
      ),
    );
    expect(
      service.pollView(
        (await store.get<Poll>('poll', poll.id))!.data,
        attendee(1),
      ).counts,
    ).toEqual([10, 10]);
  });
  it('allows exactly one concurrent appointment booking and permits owner cancellation', async () => {
    const slot = await service.createSlot(organizer, {
      title: 'Office hours',
      location: 'Room 204',
      startsAt: future,
      endsAt: new Date(Date.parse(future) + 1800_000).toISOString(),
    });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        service.bookSlot(attendee(i), slot.id),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const data = (await store.get<Slot>('slot', slot.id))!.data;
    await expect(service.cancelSlot(other, slot.id)).rejects.toMatchObject({
      status: 403,
    });
    const booked = Array.from({ length: 10 }, (_, i) => attendee(i)).find(
      (u) => u.id === data.booking!.userId,
    )!;
    expect((await service.cancelSlot(booked, slot.id)).booking).toBeNull();
  });
});
describe('API authentication and validation', () => {
  const config = readConfig({
    NODE_ENV: 'test',
    SQLITE_PATH: ':memory:',
    APP_ORIGIN: 'http://localhost:5173',
  });
  const password = 'TestingPassword19';
  async function authenticated(
    role: 'user' | 'organizer' = 'organizer',
    suffix = '',
  ) {
    await createUser(
      store,
      `alex${suffix}@example.test`,
      'Alex',
      password,
      role,
    );
    const agent = request.agent(createApp(config, store, false));
    const response = await agent
      .post('/api/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .send({ email: `alex${suffix}@example.test`, password });
    expect(response.status).toBe(200);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    return agent;
  }
  it('provides health/readiness and rejects unauthenticated data access', async () => {
    const app = createApp(config, store, false);
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/ready')).body.database).toBe(
      'Local SQLite',
    );
    expect((await request(app).get('/api/snapshot')).status).toBe(401);
  });
  it('authenticates, creates an event, validates input, and revokes logout sessions', async () => {
    const agent = await authenticated();
    expect(
      (
        await agent
          .post('/api/events')
          .set('Origin', config.APP_ORIGIN)
          .send(eventInput)
      ).status,
    ).toBe(201);
    expect(
      (
        await agent
          .post('/api/events')
          .set('Origin', config.APP_ORIGIN)
          .send({ ...eventInput, capacity: -1 })
      ).status,
    ).toBe(400);
    expect(
      (
        await agent
          .post('/api/events')
          .set('Origin', config.APP_ORIGIN)
          .send({ ...eventInput, organizerId: 'spoofed' })
      ).status,
    ).toBe(400);
    expect((await agent.get('/api/snapshot')).body.events).toHaveLength(1);
    await agent.post('/api/auth/logout').set('Origin', config.APP_ORIGIN);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
  it('rejects malicious and missing origins even on login', async () => {
    const app = createApp(config, store, false);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .set('Origin', 'https://evil.example')
          .send({ email: 'alex@example.test', password })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'alex@example.test', password })
      ).status,
    ).toBe(403);
  });
  it('public registration cannot escalate roles and does not expose password hashes', async () => {
    const app = createApp(config, store, false);
    const input = { email: 'user@example.test', name: 'User', password };
    expect(
      (
        await request(app)
          .post('/api/auth/register')
          .set('Origin', config.APP_ORIGIN)
          .send({ ...input, role: 'organizer' })
      ).status,
    ).toBe(400);
    const response = await request(app)
      .post('/api/auth/register')
      .set('Origin', config.APP_ORIGIN)
      .send(input);
    expect(response.status).toBe(201);
    expect(response.body.role).toBe('user');
    expect(response.body.passwordHash).toBeUndefined();
  });
  it('enforces organizer ownership and prevents unauthorized CSV access', async () => {
    const org = await authenticated();
    const user = await authenticated('user', '-user');
    const event = (
      await org
        .post('/api/events')
        .set('Origin', config.APP_ORIGIN)
        .send(eventInput)
    ).body;
    expect(
      (
        await user
          .put(`/api/events/${event.id}`)
          .set('Origin', config.APP_ORIGIN)
          .send(eventInput)
      ).status,
    ).toBe(403);
    expect(
      (await user.get(`/api/events/${event.id}/attendees.csv`)).status,
    ).toBe(403);
  });
  it('escapes CSV formula injection and returns a downloadable export', async () => {
    const org = await authenticated();
    const event = (
      await org
        .post('/api/events')
        .set('Origin', config.APP_ORIGIN)
        .send(eventInput)
    ).body;
    await service.register(
      { ...attendee(1), name: '=HYPERLINK("evil")' },
      event.id,
    );
    const response = await org.get(`/api/events/${event.id}/attendees.csv`);
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.text).toContain('"\'=HYPERLINK(""evil"")"');
  });
  it('returns generic invalid login and honors session expiry', async () => {
    const app = createApp(config, store, false);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .set('Origin', config.APP_ORIGIN)
          .send({ email: 'missing@example.test', password })
      ).status,
    ).toBe(401);
    await createUser(store, 'test@example.test', 'Test', password);
    const result = await login(store, 'test@example.test', password);
    const record = await store.get<{ email: string; expiresAt: number }>(
      'session',
      tokenKey(result.token),
    );
    await store.put(
      'session',
      tokenKey(result.token),
      { email: 'test@example.test', expiresAt: 1 },
      record!.version,
    );
    expect(await sessionUser(store, result.token)).toBeNull();
  });
  it('validates poll options and appointment time ranges', async () => {
    const agent = await authenticated();
    expect(
      (
        await agent
          .post('/api/polls')
          .set('Origin', config.APP_ORIGIN)
          .send({ question: 'When?', options: ['same', 'SAME'] })
      ).status,
    ).toBe(400);
    expect(
      (
        await agent.post('/api/slots').set('Origin', config.APP_ORIGIN).send({
          title: 'Slot',
          location: 'Room',
          startsAt: future,
          endsAt: future,
        })
      ).status,
    ).toBe(400);
  });
});
describe('Local-only configuration safeguards', () => {
  it('keeps HTTPS production cookies secure and validates the exact origin', async () => {
    const password = 'TestingPassword19';
    const secureConfig = readConfig({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://hub.example',
    });
    await createUser(store, 'secure@example.test', 'Secure User', password);
    const app = createApp(secureConfig, store, false);
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', secureConfig.APP_ORIGIN)
      .send({ email: 'secure@example.test', password });
    expect(response.status).toBe(200);
    expect(String(response.headers['set-cookie'])).toContain('Secure');
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['content-security-policy']).toContain(
      'upgrade-insecure-requests',
    );
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .set('Origin', 'http://hub.example')
          .send({ email: 'secure@example.test', password })
      ).status,
    ).toBe(403);
  });
  it('uses an absolute shared database path and keeps the memory test database unchanged', () => {
    expect(readConfig({}).SQLITE_PATH).toMatch(/[\\/]data[\\/]hub\.sqlite$/);
    expect(readConfig({ SQLITE_PATH: ':memory:' }).SQLITE_PATH).toBe(
      ':memory:',
    );
  });
  it('permits only explicit local development UI ports, with exact production origin', () => {
    const local = allowedOrigins(readConfig({}));
    expect(local.has('http://127.0.0.1:3000')).toBe(true);
    expect(local.has('http://localhost:3000')).toBe(true);
    expect(local.has('http://127.0.0.1:5173')).toBe(true);
    expect(local.has('http://127.0.0.1:9999')).toBe(false);
    const production = allowedOrigins(
      readConfig({
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://hub.example',
        DATABASE_DRIVER: 'dynamodb',
        ALLOW_AWS: 'true',
      }),
    );
    expect([...production]).toEqual(['https://hub.example']);
  });
  it('defaults to SQLite and prohibits implicit AWS connections', () => {
    expect(readConfig({}).DATABASE_DRIVER).toBe('sqlite');
    expect(() => readConfig({ DATABASE_DRIVER: 'dynamodb' })).toThrow(
      'AWS access is disabled',
    );
    expect(() =>
      readConfig({
        DATABASE_DRIVER: 'dynamodb',
        DYNAMODB_ENDPOINT: 'https://dynamodb.us-east-1.amazonaws.com',
      }),
    ).toThrow('must be local');
    expect(
      readConfig({
        DATABASE_DRIVER: 'dynamodb',
        DYNAMODB_ENDPOINT: 'http://localhost:8000',
      }).ALLOW_AWS,
    ).toBe('false');
  });
  it('rejects invalid ports and unsafe production settings', () => {
    expect(() => readConfig({ PORT: '0' })).toThrow();
    expect(() => readConfig({ NODE_ENV: 'production' })).toThrow('HTTPS');
    expect(
      readConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://hub.example' })
        .DATABASE_DRIVER,
    ).toBe('sqlite');
    expect(() =>
      readConfig({
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://hub.example',
        SQLITE_PATH: ':memory:',
      }),
    ).toThrow('persistent');
    expect(
      readConfig({
        NODE_ENV: 'production',
        APP_ORIGIN: 'http://203.0.113.10',
        ALLOW_INSECURE_HTTP: 'true',
      }).APP_ORIGIN,
    ).toBe('http://203.0.113.10');
    expect(() =>
      readConfig({ APP_ORIGIN: 'https://hub.example/path' }),
    ).toThrow('origin');
  });
});

describe('Seeded demo authentication from supported local UI origins', () => {
  it('refuses seeding existing event data even when there are no users', async () => {
    await service.createEvent(organizer, eventInput);
    await expect(createDemoData(store)).rejects.toThrow('empty local database');
    expect(await store.list('user')).toHaveLength(0);
    expect(await store.list('event')).toHaveLength(1);
  });
  it('authenticates seeded organizer and attendee, preserves CSRF checks and does not reseed existing data', async () => {
    const { password } = await createDemoData(store);
    const app = createApp(
      readConfig({ NODE_ENV: 'development', SQLITE_PATH: ':memory:' }),
      store,
      false,
    );
    for (const [email, role] of [
      ['organizer@example.test', 'organizer'],
      ['attendee@example.test', 'user'],
    ]) {
      for (const origin of [
        'http://127.0.0.1:3000',
        'http://localhost:3000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ]) {
        const agent = request.agent(app);
        const response = await agent
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({ email, password });
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ email, role });
        expect(response.body.passwordHash).toBeUndefined();
        expect((await agent.get('/api/auth/me')).body.email).toBe(email);
        expect((await agent.get('/api/snapshot')).status).toBe(200);
      }
    }
    for (const origin of [
      'http://evil.example',
      'http://127.0.0.1:9999',
      'null',
      'http://127.0.0.1:3000.evil.example',
    ]) {
      expect(
        (
          await request(app)
            .post('/api/auth/login')
            .set('Origin', origin)
            .send({ email: 'organizer@example.test', password })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'organizer@example.test', password })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .set('Origin', 'http://127.0.0.1:3000')
          .send({
            email: 'organizer@example.test',
            password: 'WrongPassword19',
          })
      ).status,
    ).toBe(401);
    await expect(createDemoData(store)).rejects.toThrow('empty local database');
    expect(await store.list('user')).toHaveLength(2);
  });
});
