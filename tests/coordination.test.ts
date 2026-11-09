import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { SqliteStore, DynamoStore, type Store } from '../backend/src/store.js';
import { readConfig } from '../backend/src/config.js';
import { HubService } from '../backend/src/service.js';
import {
  SchedulingService,
  generateSchedule,
  bookings,
  scheduleSchema,
} from '../backend/src/scheduling.js';
import { createApp } from '../backend/src/app.js';
import { createUser, login, sessionUser } from '../backend/src/auth.js';
import type { HubEvent, Slot, User, ScheduleInput } from '../shared/types.js';

const future = (hours = 48) =>
  new Date(Date.now() + hours * 3600_000).toISOString();
const schedule = (extra: Partial<ScheduleInput> = {}): ScheduleInput => ({
  title: 'Office hours',
  location: 'Room 108',
  date: future().slice(0, 10),
  startTime: '14:00',
  endTime: '16:00',
  timeZone: 'America/Chicago',
  durationMinutes: 15,
  bufferMinutes: 0,
  capacity: 1,
  weeks: 1,
  breaks: [],
  bookingLeadMinutes: 0,
  cancelBeforeMinutes: 0,
  maxActiveBookings: 20,
  requestId: randomUUID(),
  ...extra,
});
const owner: User = {
  id: 'professor',
  name: 'Professor',
  email: 'prof@example.test',
  role: 'organizer',
};
const student = (i: number): User => ({
  id: `student-${i}`,
  name: `Student ${i}`,
  email: `student${i}@example.test`,
  role: 'user',
});
describe('Office-hour generation', () => {
  beforeEach(() =>
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-09T12:00:00Z')),
  );
  afterEach(() => vi.restoreAllMocks());
  it('generates eight slots, excludes breaks, uses buffers and expands weekly in the source zone', () => {
    const eight = generateSchedule(schedule());
    expect(eight).toHaveLength(8);
    expect(
      new Date(eight[0].startsAt).toLocaleTimeString('en-US', {
        timeZone: 'America/Chicago',
        hour12: false,
      }),
    ).toBe('14:00:00');
    expect(
      generateSchedule(
        schedule({ breaks: [{ start: '14:30', end: '15:00' }] }),
      ),
    ).toHaveLength(6);
    expect(generateSchedule(schedule({ bufferMinutes: 15 }))).toHaveLength(4);
    const recurring = generateSchedule(
      schedule({
        date: '2027-03-07',
        weeks: 2,
        startTime: '14:00',
        endTime: '14:15',
      }),
    );
    expect(
      Date.parse(recurring[1].startsAt) - Date.parse(recurring[0].startsAt),
    ).toBe(167 * 3600_000);
  });
  it('rejects gaps, folds, invalid dates, oversized schedules, invalid zones and empty windows', () => {
    for (const input of [
      schedule({ date: '2027-03-14', startTime: '02:00', endTime: '02:30' }),
      schedule({ date: '2027-11-07', startTime: '01:00', endTime: '01:30' }),
      schedule({ date: '2027-02-30' }),
      schedule({ weeks: 8, durationMinutes: 10 }),
      schedule({ startTime: '16:00' }),
      schedule({ breaks: [{ start: '13:00', end: '15:00' }] }),
    ])
      expect(() => generateSchedule(input)).toThrow();
    expect(() =>
      scheduleSchema.parse(schedule({ timeZone: 'Invalid/Zone' })),
    ).toThrow();
    for (const duration of [10, 15, 20, 30, 60, 25])
      expect(
        generateSchedule(schedule({ durationMinutes: duration })).length,
      ).toBeGreaterThan(0);
  });
});

for (const driver of [
  'sqlite',
  ...(process.env.RUN_DYNAMODB_TESTS === 'true' ? ['dynamodb'] : []),
])
  describe(`${driver}: scheduling and groups across independent clients`, () => {
    let stores: Store[],
      hubs: HubService[],
      schedulers: SchedulingService[],
      directory: string;
    const touched = new Map<string, [string, string]>();
    beforeEach(async () => {
      directory = mkdtempSync(join(tmpdir(), 'hub-coordination-'));
      const raw =
        driver === 'sqlite'
          ? [
              new SqliteStore(join(directory, 'test.sqlite')),
              new SqliteStore(join(directory, 'test.sqlite')),
            ]
          : [0, 1].map(
              () =>
                new DynamoStore(
                  readConfig({
                    DATABASE_DRIVER: 'dynamodb',
                    DYNAMODB_ENDPOINT:
                      process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000',
                    DYNAMODB_TABLE:
                      process.env.DYNAMODB_TABLE ?? 'cloud-coordination-local',
                  }),
                ),
            );
      touched.clear();
      const track = (kind: string, id: string) =>
        touched.set(JSON.stringify([kind, id]), [kind, id]);
      stores = raw.map(
        (store) =>
          new Proxy(store, {
            get(target, key) {
              if (key === 'put')
                return async (
                  kind: string,
                  id: string,
                  data: unknown,
                  expected: number | null,
                  activity?: import('../shared/types.js').Activity,
                ) => {
                  track(kind, id);
                  if (activity) track('activity', activity.id);
                  return target.put(kind, id, data, expected, activity);
                };
              if (key === 'transact')
                return async (
                  writes: import('../backend/src/store.js').StoreWrite[],
                  activity?: import('../shared/types.js').Activity,
                ) => {
                  writes.forEach((w) => track(w.kind, w.id));
                  if (activity) track('activity', activity.id);
                  return target.transact(writes, activity);
                };
              const value = Reflect.get(target, key);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          }),
      );
      owner.id = randomUUID();
      hubs = stores.map((s) => new HubService(s));
      schedulers = stores.map((s) => new SchedulingService(s));
    });
    afterEach(async () => {
      try {
        if (driver === 'dynamodb')
          for (const [kind, id] of touched.values())
            await stores[0].remove(kind, id);
      } finally {
        stores.forEach((s) => s.close());
        rmSync(directory, { recursive: true, force: true });
      }
    });
    it('creates schedules idempotently and rejects concurrent overlapping organizer windows', async () => {
      const input = schedule();
      const result = await Promise.all(
        schedulers.map((s) => s.createSchedule(owner, input)),
      );
      expect(result[0]).toEqual(result[1]);
      expect(
        (await stores[0].list<Slot>('slot')).filter(
          (s) => s.organizerId === owner.id,
        ),
      ).toHaveLength(8);
      await expect(
        schedulers[0].createSchedule(owner, { ...input, title: 'Changed' }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        schedulers[0].createSchedule(owner, schedule()),
      ).rejects.toMatchObject({ status: 409 });
      const another = { ...owner, id: randomUUID() };
      const races = await Promise.allSettled(
        schedulers.map((s) => s.createSchedule(another, schedule())),
      );
      expect(races.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
    it('allows one winner for the last place; rejects duplicates, owner booking, unauthorized blocking and private reasons', async () => {
      const slot = await hubs[0].createSlot(owner, {
        title: 'One place',
        location: 'Room',
        startsAt: future(),
        endsAt: future(49),
      });
      const users = Array.from({ length: 10 }, () => ({
        ...student(0),
        id: randomUUID(),
      }));
      const results = await Promise.allSettled(
        users.map((u, i) => hubs[i % 2].bookSlot(u, slot.id, 'Private reason')),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const winner = bookings(
        (await stores[0].get<Slot>('slot', slot.id))!.data,
      )[0];
      await expect(
        hubs[1].bookSlot({ ...student(0), id: winner.userId }, slot.id),
      ).rejects.toMatchObject({ status: 409 });
      await expect(hubs[0].bookSlot(owner, slot.id)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        schedulers[0].block(student(20), slot.id, true),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        schedulers[0].block(owner, slot.id, true),
      ).rejects.toMatchObject({ status: 409 });
      const view = (await hubs[1].snapshot(student(100))).slots.find(
        (s) => s.id === slot.id,
      )!;
      expect(view.bookings).toEqual([]);
      expect(JSON.stringify(view)).not.toContain('Private reason');
      await schedulers[0].cancel(owner, slot.id, winner.userId);
      await schedulers[0].block(owner, slot.id, true);
      await expect(
        hubs[1].bookSlot(student(50), slot.id),
      ).rejects.toMatchObject({ status: 409 });
    });
    it('prevents cross-organizer overlapping bookings and leaves the source intact on failed rescheduling', async () => {
      const a = await hubs[0].createSlot(owner, {
        title: 'A',
        location: 'Room',
        startsAt: future(),
        endsAt: future(49),
      });
      const b = await hubs[1].createSlot(
        { ...owner, id: randomUUID() },
        {
          title: 'B',
          location: 'Room',
          startsAt: future(),
          endsAt: future(49),
        },
      );
      const u = { ...student(1), id: randomUUID() };
      const races = await Promise.allSettled([
        hubs[0].bookSlot(u, a.id),
        hubs[1].bookSlot(u, b.id),
      ]);
      expect(races.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const source = races[0].status === 'fulfilled' ? a : b,
        target = source.id === a.id ? b : a;
      const v = { ...student(2), id: randomUUID() };
      await hubs[1].bookSlot(v, target.id);
      await expect(
        schedulers[0].book(u, target.id, '', source.id),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        bookings((await stores[0].get<Slot>('slot', source.id))!.data)[0]
          .userId,
      ).toBe(u.id);
      await hubs[0].cancelSlot(v, target.id);
      await schedulers[1].book(u, target.id, 'Moved', source.id);
      expect(
        bookings((await stores[0].get<Slot>('slot', source.id))!.data),
      ).toHaveLength(0);
      expect(
        bookings((await stores[0].get<Slot>('slot', target.id))!.data)[0]
          .userId,
      ).toBe(u.id);
    });
    it('enforces multi-student slot capacity and booking/cancellation/active-limit policies', async () => {
      const plan = await schedulers[0].createSchedule(
        owner,
        schedule({
          endTime: '14:30',
          capacity: 2,
          maxActiveBookings: 1,
          cancelBeforeMinutes: 10080,
        }),
      );
      const users = Array.from({ length: 10 }, () => ({
        ...student(0),
        id: randomUUID(),
      }));
      const outcomes = await Promise.allSettled(
        users.map((u, i) =>
          hubs[i % 2].bookSlot(u, plan.slotIds[0], 'Private'),
        ),
      );
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      const slot = (await stores[0].get<Slot>('slot', plan.slotIds[0]))!.data;
      const winner = users.find((u) => u.id === bookings(slot)[0].userId)!;
      await expect(
        hubs[1].bookSlot(winner, plan.slotIds[1]),
      ).rejects.toMatchObject({ status: 409 });
      await expect(hubs[0].cancelSlot(winner, slot.id)).rejects.toMatchObject({
        status: 409,
      });
      const view = (await hubs[1].snapshot(winner)).slots.find(
        (s) => s.id === slot.id,
      )!;
      expect(view.bookedCount).toBe(2);
      expect(view.bookings).toHaveLength(1);
      await schedulers[0].cancel(owner, slot.id, winner.id);
      await hubs[1].bookSlot(winner, plan.slotIds[1]);
      const lead = await schedulers[0].createSchedule(
        { ...owner, id: randomUUID() },
        schedule({ endTime: '14:15', bookingLeadMinutes: 10080 }),
      );
      await expect(
        hubs[0].bookSlot({ ...student(3), id: randomUUID() }, lead.slotIds[0]),
      ).rejects.toMatchObject({ status: 409 });
    });
    it('preserves legacy bookings, blocks overlap, and cancels migrated entries without inventing timestamps', async () => {
      const u = { ...student(0), id: randomUUID() };
      const legacy: Slot = {
        id: randomUUID(),
        title: 'Legacy',
        location: 'Room',
        startsAt: future(),
        endsAt: future(49),
        createdAt: future(-1),
        organizerId: owner.id,
        booking: { userId: u.id, name: u.name },
      };
      await stores[0].put('slot', legacy.id, legacy, null);
      const other = await hubs[0].createSlot(
        { ...owner, id: randomUUID() },
        {
          title: 'Overlap',
          location: 'Room',
          startsAt: future(),
          endsAt: future(49),
        },
      );
      await expect(hubs[1].bookSlot(u, other.id)).rejects.toMatchObject({
        status: 409,
      });
      expect(
        (await hubs[1].snapshot(u)).slots.find((s) => s.id === legacy.id)!
          .bookings![0].createdAt,
      ).toBeNull();
      await hubs[0].cancelSlot(u, legacy.id);
      await hubs[1].bookSlot(u, other.id);
    });
    it('keeps registration, FIFO promotion, groups and transfers within capacity under contention', async () => {
      const event = await hubs[0].createEvent(owner, {
        title: 'Groups',
        description: '',
        location: 'Room',
        startsAt: future(),
        capacity: 36,
        groupConfiguration: {
          count: 9,
          capacity: 4,
          autoAssign: true,
          allowSelfSelection: true,
        },
      });
      const users = Array.from({ length: 50 }, (_, i) => ({
        ...student(i),
        id: randomUUID(),
      }));
      await Promise.all(users.map((u, i) => hubs[i % 2].register(u, event.id)));
      let record = (await stores[0].get<HubEvent>('event', event.id))!.data;
      expect(record.registrations).toHaveLength(50);
      expect(
        record.registrations.filter((r) => r.status === 'confirmed'),
      ).toHaveLength(36);
      expect(new Set(record.registrations.map((r) => r.userId)).size).toBe(50);
      expect(
        (await hubs[0].groups(owner, event.id)).every(
          (g) => g.members.length === 4,
        ),
      ).toBe(true);
      const first = record.registrations.find((r) => r.status === 'confirmed')!,
        waiting = record.registrations
          .filter((r) => r.status === 'waitlisted')
          .sort((a, b) => a.sequence - b.sequence)[0];
      const target = event.groups!.find((g) => g.id !== first.groupId)!;
      await expect(
        hubs[0].assignGroup(owner, event.id, target.id, first.userId),
      ).rejects.toMatchObject({ status: 409 });
      await hubs[1].cancel(
        users.find((u) => u.id === first.userId)!,
        event.id,
      );
      record = (await stores[0].get<HubEvent>('event', event.id))!.data;
      expect(
        record.registrations.find((r) => r.userId === waiting.userId),
      ).toMatchObject({ status: 'confirmed', groupId: first.groupId });
      await expect(
        hubs[0].assignGroup(
          { ...owner, id: randomUUID() },
          event.id,
          null,
          waiting.userId,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await hubs[0].assignGroup(owner, event.id, null, waiting.userId);
      const candidates = record.registrations
        .filter((r) => r.status === 'confirmed' && r.groupId !== first.groupId)
        .slice(0, 10);
      const transfers = await Promise.allSettled(
        candidates.map((r, i) =>
          hubs[i % 2].assignGroup(owner, event.id, first.groupId!, r.userId),
        ),
      );
      expect(transfers.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        (await hubs[1].groups(owner, event.id)).every(
          (g) => g.members.length <= 4,
        ),
      ).toBe(true);
    });
    it('rolls back every write when a later version condition fails', async () => {
      const key = randomUUID();
      await stores[0].put('test', key, { ok: true }, null);
      expect(
        await stores[1].transact([
          { kind: 'test', id: key + 'new', data: { ok: true }, expected: null },
          { kind: 'test', id: key, data: { ok: false }, expected: 99 },
        ]),
      ).toBe(false);
      expect(await stores[0].get('test', key + 'new')).toBeNull();
      await stores[0].remove('test', key);
    });
  });

describe('Scheduling and group API security', () => {
  it('uses shared sessions across apps, validates policies and protects group exports', async () => {
    const store = new SqliteStore(':memory:');
    try {
      const config = readConfig({
        NODE_ENV: 'test',
        SQLITE_PATH: ':memory:',
        APP_ORIGIN: 'https://hub.example.test',
      });
      const org = await createUser(
        store,
        'prof@example.test',
        'Professor',
        'TestingPassword19',
        'organizer',
      );
      const attendee = await createUser(
        store,
        'student@example.test',
        '=Formula',
        'TestingPassword19',
      );
      const session = await login(store, attendee.email, 'TestingPassword19');
      const token = `hub_session=${session.token}`;
      const apps = [
        createApp(config, store, false),
        createApp(config, store, false),
      ];
      expect(
        (await request(apps[1]).get('/api/auth/me').set('Cookie', token)).body
          .id,
      ).toBe(attendee.id);
      const event = await new HubService(store).createEvent(org, {
        title: 'Groups',
        description: '',
        location: 'Room',
        startsAt: future(),
        capacity: 1,
        groupConfiguration: {
          count: 1,
          capacity: 1,
          autoAssign: false,
          allowSelfSelection: true,
        },
      });
      expect(
        (
          await request(apps[0])
            .get(`/api/events/${event.id}/groups.csv`)
            .set('Cookie', token)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(apps[0])
            .post('/api/schedules')
            .set('Cookie', token)
            .set('Origin', config.APP_ORIGIN)
            .send(schedule())
        ).status,
      ).toBe(403);
      await new HubService(store).register(attendee, event.id);
      expect(
        (
          await request(apps[1])
            .put(`/api/events/${event.id}/groups/membership`)
            .set('Cookie', token)
            .set('Origin', config.APP_ORIGIN)
            .send({ groupId: event.groups![0].id, participantId: org.id })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(apps[1])
            .put(`/api/events/${event.id}/groups/membership`)
            .set('Cookie', token)
            .set('Origin', config.APP_ORIGIN)
            .send({ groupId: event.groups![0].id })
        ).status,
      ).toBe(200);
      expect((await sessionUser(store, session.token))!.id).toBe(attendee.id);
    } finally {
      store.close();
    }
  });
});
