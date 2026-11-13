import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteStore, DynamoStore } from '../backend/src/store.js';
import { HubService } from '../backend/src/service.js';
import { resourcePage } from '../backend/src/pages.js';
import { readConfig } from '../backend/src/config.js';
import {
  login,
  createUser,
  sessionUser,
  tokenKey,
} from '../backend/src/auth.js';
import type { User } from '../shared/types.js';
const owner: User = {
  id: 'owner',
  name: 'Owner',
  email: 'o@example.test',
  role: 'organizer',
};
const student: User = {
  id: 'student',
  name: 'Student',
  email: 's@example.test',
  role: 'user',
};
const stores: SqliteStore[] = [];
const make = () => {
  const store = new SqliteStore(':memory:');
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const event = {
  title: 'Event',
  description: '',
  location: 'Room',
  startsAt: new Date(Date.now() + 86400000).toISOString(),
  capacity: 2,
};
describe('Bounded resource queries', () => {
  it('traverses 120 records without calling list or losing/duplicating records', async () => {
    const store = make(),
      service = new HubService(store);
    for (let i = 0; i < 120; i++)
      await service.createEvent(owner, { ...event, title: `Event ${i}` });
    const list = vi
      .spyOn(store, 'list')
      .mockRejectedValue(new Error('Unbounded read'));
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await resourcePage(store, student, 'event', {
        limit: 7,
        cursor,
      });
      expect(page.examined).toBeLessThanOrEqual(8);
      for (const item of page.items as { id: string }[]) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen.size).toBe(120);
    expect(list).not.toHaveBeenCalled();
    expect((await store.summary()).events).toBe(120);
  });
  it('keeps drafts private and binds cursors to filters and users', async () => {
    const store = make(),
      service = new HubService(store);
    await service.createPoll(owner, {
      question: 'Private draft',
      options: ['A', 'B'],
      state: 'draft',
    });
    expect(
      (await resourcePage(store, student, 'poll', { limit: 5 })).items,
    ).toHaveLength(0);
    expect(
      (await resourcePage(store, owner, 'poll', { limit: 5 })).items,
    ).toHaveLength(1);
    expect((await store.summary()).activePolls).toBe(0);
    for (let i = 0; i < 3; i++) await service.createEvent(owner, event);
    const page = await resourcePage(store, student, 'event', { limit: 1 });
    await expect(
      resourcePage(store, owner, 'event', {
        limit: 1,
        cursor: page.nextCursor!,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      resourcePage(store, student, 'event', {
        limit: 1,
        cursor: page.nextCursor!,
        search: 'changed',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('maintains totals atomically through registration, waitlist, cancellation and conflicts', async () => {
    const store = make(),
      service = new HubService(store);
    const created = await service.createEvent(owner, { ...event, capacity: 1 });
    await service.register(student, created.id);
    await service.register({ ...student, id: 'second' }, created.id);
    expect(await store.summary()).toMatchObject({
      events: 1,
      confirmed: 1,
      waitlisted: 1,
    });
    await expect(service.register(student, created.id)).rejects.toMatchObject({
      status: 409,
    });
    await service.cancel(student, created.id);
    expect(await store.summary()).toMatchObject({
      confirmed: 1,
      waitlisted: 0,
    });
  });
  it('does not disclose other users activity', async () => {
    const store = make();
    await new HubService(store).createEvent(owner, event);
    expect(
      (await resourcePage(store, student, 'activity', { limit: 5 })).items,
    ).toHaveLength(0);
    expect(
      (await resourcePage(store, owner, 'activity', { limit: 5 })).items,
    ).toHaveLength(1);
  });
  it('uses exactly one bounded DynamoDB Query, preserving its continuation', async () => {
    const store = new DynamoStore(
      readConfig({
        DATABASE_DRIVER: 'dynamodb',
        DYNAMODB_ENDPOINT: 'http://127.0.0.1:8000',
      }),
    );
    const send = vi
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({
        Items: [{ data: { id: 'a' } }],
        LastEvaluatedKey: { pk: 'event', sk: 'a' },
        ScannedCount: 1,
      });
    (store as unknown as { client: { send: typeof send } }).client = { send };
    const page = await store.page('event', 5, 'before');
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][0] as { input: unknown }).input).toMatchObject({
      Limit: 5,
      ExclusiveStartKey: { pk: 'event', sk: 'before' },
    });
    expect(page.nextCursor).toBe('a');
  });
});
describe('Deployment metadata', () => {
  it.each(['local', 'ec2', 'aws-multi'] as const)(
    'validates explicit %s mode',
    (mode) => {
      const config = readConfig({
        DEPLOYMENT_MODE: mode,
        ...(mode === 'aws-multi'
          ? { DATABASE_DRIVER: 'dynamodb', ALLOW_AWS: 'true' }
          : {}),
      });
      expect(config.DEPLOYMENT_MODE).toBe(mode);
    },
  );
  it('rejects invalid modes and multi-instance SQLite or DynamoDB Local', () => {
    expect(() => readConfig({ DEPLOYMENT_MODE: 'unknown' })).toThrow();
    expect(() => readConfig({ DEPLOYMENT_MODE: 'aws-multi' })).toThrow();
    expect(() =>
      readConfig({
        DEPLOYMENT_MODE: 'aws-multi',
        DATABASE_DRIVER: 'dynamodb',
        DYNAMODB_ENDPOINT: 'http://localhost:8000',
      }),
    ).toThrow();
    expect(
      readConfig({ DEPLOYMENT_MODE: 'ec2', DATABASE_DRIVER: 'sqlite' })
        .DEPLOYMENT_MODE,
    ).toBe('ec2');
  });
});
describe('Session maintenance', () => {
  it('removes abandoned expired sessions and preserves working logins', async () => {
    const store = make();
    await createUser(store, student.email, student.name, 'LongPassword123');
    const signed = await login(store, student.email, 'LongPassword123');
    await store.put(
      'session',
      'abandoned',
      { email: student.email, expiresAt: 1 },
      null,
    );
    expect(store.cleanupSessions()).toBe(1);
    expect(await sessionUser(store, signed.token)).not.toBeNull();
    const stored = (await store.get<{ email: string; expiresAt: number }>(
      'session',
      tokenKey(signed.token),
    ))!;
    await store.put(
      'session',
      tokenKey(signed.token),
      { ...stored.data, expiresAt: 1 },
      stored.version,
    );
    expect(await sessionUser(store, signed.token)).toBeNull();
    expect(await store.get('session', tokenKey(signed.token))).toBeNull();
  });
  it('runs a single configurable worker and stops on close', async () => {
    vi.useFakeTimers();
    const store = new SqliteStore(':memory:');
    store.startSessionCleanup(60);
    store.startSessionCleanup(60);
    await store.put('session', 'expired', { expiresAt: 1 }, null);
    await store.put('session', 'valid', { expiresAt: 9999999999 }, null);
    await vi.advanceTimersByTimeAsync(60000);
    expect(await store.get('session', 'expired')).toBeNull();
    expect(await store.get('session', 'valid')).not.toBeNull();
    store.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('fetches relevant recent activity despite another organizer producing 100 later actions', async () => {
  const store = make(),
    service = new HubService(store);
  await service.createEvent(owner, event);
  for (let i = 0; i < 100; i++)
    await service.createEvent({ ...owner, id: 'other-owner' }, event);
  const page = await resourcePage(store, owner, 'activity', {
    limit: 12,
    descending: true,
  });
  expect(page.items).toHaveLength(1);
  expect(page.examined).toBe(1);
});
it('bounds each session cleanup batch and drains the backlog without touching active sessions', async () => {
  const store = make();
  for (let i = 0; i < 501; i++)
    await store.put('session', `old-${i}`, { expiresAt: 1 }, null);
  await store.put('session', 'active', { expiresAt: 9999999999 }, null);
  expect(store.cleanupSessions()).toBe(500);
  expect(store.cleanupSessions()).toBe(1);
  expect(store.cleanupSessions()).toBe(0);
  expect(await store.get('session', 'active')).not.toBeNull();
});
