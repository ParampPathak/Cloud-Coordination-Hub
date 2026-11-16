import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { SqliteStore, type Store } from '../backend/src/store.js';
import { PostgresStore } from '../backend/src/postgres-store.js';
import { readConfig } from '../backend/src/config.js';
import { createApp } from '../backend/src/app.js';
import {
  createUser,
  tokenKey,
  login,
  sessionUser,
} from '../backend/src/auth.js';
import { createGuestSession } from '../backend/src/guests.js';
import { cleanupClassroomGuests } from '../backend/src/guest-cleanup.js';
import { HubService } from '../backend/src/service.js';
import type { GuestIdentity, HubEvent, Slot } from '../shared/types.js';
const origin = 'http://localhost:3000';
for (const driver of ['sqlite', 'postgres'] as const)
  describe.skipIf(
    driver === 'postgres' && process.env.RUN_POSTGRES_TESTS !== 'true',
  )(
    `${driver}: independent classroom identities and shared transactions`,
    () => {
      let a: Store, b: Store, admin: Pool | undefined;
      const config = (enabled = true) =>
        readConfig({
          NODE_ENV: 'test',
          APP_ORIGIN: origin,
          DATABASE_DRIVER: driver,
          POSTGRES_URL: process.env.POSTGRES_TEST_URL,
          GUEST_DEMO_ENABLED: String(enabled),
          GUEST_SESSION_HOURS: '24',
          GUEST_DAILY_LIMIT: '500',
        });
      beforeEach(async () => {
        if (driver === 'sqlite') {
          a = new SqliteStore(':memory:');
          b = a;
        } else {
          const u = new URL(process.env.POSTGRES_TEST_URL!);
          if (
            !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
            !/^\/cch_test_[a-f0-9]+$/.test(u.pathname)
          )
            throw new Error('Disposable local PostgreSQL target required.');
          admin = new Pool({ connectionString: u.href });
          await admin.query('TRUNCATE cch.records');
          await admin.query(
            'UPDATE cch.summary SET events=0,confirmed=0,waitlisted=0,"activePolls"=0',
          );
          a = new PostgresStore(config());
          b = new PostgresStore(config());
        }
      });
      afterEach(async () => {
        await a?.close();
        if (b !== a) await b?.close();
        await admin?.end();
      });
      it('joins with only a name, persists across app instances, and never creates a permanent account', async () => {
        const apps = [
          createApp(config(), a, false),
          createApp(config(), b, false),
        ];
        const joined = await request(apps[0])
          .post('/api/auth/guest')
          .set('Origin', origin)
          .send({ name: 'Same Name' })
          .expect(201);
        expect(joined.body).toMatchObject({
          name: 'Same Name',
          role: 'user',
          guest: true,
        });
        expect(joined.body).not.toHaveProperty('email');
        expect(joined.body).not.toHaveProperty('passwordHash');
        const cookie = joined.headers['set-cookie'][0];
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Lax');
        expect(cookie).toContain('Max-Age=86400');
        await request(apps[1])
          .get('/api/auth/me')
          .set('Cookie', cookie)
          .expect(200, joined.body);
        const second = await request(apps[1])
          .post('/api/auth/guest')
          .set('Origin', origin)
          .send({ name: 'Same Name' })
          .expect(201);
        expect(second.body.id).not.toBe(joined.body.id);
        expect(await a.list('user')).toHaveLength(0);
        expect(await a.list('guest')).toHaveLength(2);
        await request(apps[1])
          .post('/api/auth/logout')
          .set('Origin', origin)
          .set('Cookie', cookie)
          .expect(200);
        await request(apps[0])
          .get('/api/auth/me')
          .set('Cookie', cookie)
          .expect(401);
      });
      it('rejects elevation, cross-origin joining, and guest management of another attendee', async () => {
        const app = createApp(config(), a, false),
          future = new Date(Date.now() + 86400000).toISOString();
        await request(app)
          .post('/api/auth/guest')
          .set('Origin', origin)
          .send({ name: 'Guest', role: 'organizer' })
          .expect(400);
        await request(app)
          .post('/api/auth/guest')
          .set('Origin', 'https://untrusted.example')
          .send({ name: 'Guest' })
          .expect(403);
        await request(app)
          .post('/api/auth/guest')
          .set('Origin', origin)
          .send({ name: '   ' })
          .expect(400);
        const joined = await request(app)
            .post('/api/auth/guest')
            .set('Origin', origin)
            .send({ name: 'Guest' })
            .expect(201),
          cookie = joined.headers['set-cookie'][0];
        const owner = await createUser(
            a,
            'owner@example.test',
            'Owner',
            'TestPassword123',
            'organizer',
          ),
          hub = new HubService(a);
        const event = await hub.createEvent(owner, {
          title: 'Class groups',
          description: '',
          location: 'Room 108',
          startsAt: future,
          capacity: 36,
          groupConfiguration: {
            count: 9,
            capacity: 4,
            autoAssign: false,
            allowSelfSelection: true,
          },
        });
        await request(app)
          .post('/api/events')
          .set('Origin', origin)
          .set('Cookie', cookie)
          .send({
            title: 'Unauthorized',
            description: '',
            location: 'Room',
            startsAt: future,
            capacity: 2,
          })
          .expect(403);
        await request(app)
          .post('/api/polls')
          .set('Origin', origin)
          .set('Cookie', cookie)
          .send({ question: 'Unauthorized', options: ['A', 'B'] })
          .expect(403);
        await request(app)
          .post(`/api/events/${event.id}/registrations`)
          .set('Origin', origin)
          .set('Cookie', cookie)
          .expect(201);
        await request(app)
          .put(`/api/events/${event.id}/groups/membership`)
          .set('Origin', origin)
          .set('Cookie', cookie)
          .send({ groupId: event.groups![0].id, participantId: owner.id })
          .expect(403);
        await request(app)
          .get(`/api/events/${event.id}/attendees`)
          .set('Cookie', cookie)
          .expect(403);
      });
      it('expires and disables sessions without deleting participation or changing permanent users', async () => {
        const app = createApp(config(), a, false),
          g = await createGuestSession(a, 'Guest', 24, 500);
        const owner = await createUser(
            a,
            'owner@example.test',
            'Owner',
            'TestPassword123',
            'organizer',
          ),
          hub = new HubService(a);
        const event = await hub.createEvent(owner, {
          title: 'Preserved',
          description: '',
          location: 'Room',
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          capacity: 2,
        });
        await hub.register(g.user, event.id);
        const off = createApp(config(false), b, false);
        await request(off)
          .post('/api/auth/guest')
          .set('Origin', origin)
          .send({ name: 'No' })
          .expect(403);
        await request(off)
          .get('/api/auth/me')
          .set('Cookie', `hub_session=${g.token}`)
          .expect(401);
        const signed = await login(a, owner.email, 'TestPassword123');
        expect(
          (await sessionUser(b, signed.token, { guestEnabled: false }))?.id,
        ).toBe(owner.id);
        const session = await a.get<{ guestId: string; expiresAt: number }>(
          'session',
          tokenKey(g.token),
        );
        await a.put(
          'session',
          tokenKey(g.token),
          { ...session!.data, expiresAt: 1 },
          session!.version,
        );
        await request(app)
          .get('/api/auth/me')
          .set('Cookie', `hub_session=${g.token}`)
          .expect(401);
        expect(await a.get('guest', g.user.id)).not.toBeNull();
        expect(
          (await a.get<HubEvent>('event', event.id))!.data.registrations,
        ).toHaveLength(1);
      });
      it('enforces the distributed daily cap atomically, without orphan identities or sessions', async () => {
        await a.put(
          'guest-admission',
          new Date().toISOString().slice(0, 10),
          { count: 499 },
          null,
        );
        const outcomes = await Promise.allSettled([
          createGuestSession(a, 'One', 24, 500),
          createGuestSession(b, 'Two', 24, 500),
        ]);
        expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(
          1,
        );
        expect(outcomes.find((r) => r.status === 'rejected')).toMatchObject({
          reason: { status: 429 },
        });
        expect(await a.list('guest')).toHaveLength(1);
        expect(await a.list('session')).toHaveLength(1);
      });
      it('supports 50 simultaneous students across shared stores without duplicate bookings or capacity violations', async () => {
        const apps = [
          createApp(config(), a, false),
          createApp(config(), b, false),
        ];
        const students = await Promise.all(
          Array.from({ length: 50 }, (_, i) =>
            request(apps[i % 2])
              .post('/api/auth/guest')
              .set('Origin', origin)
              .send({ name: 'Classroom Student' })
              .expect(201),
          ),
        );
        const users = students.map((s) => s.body),
          cookies = students.map((s) => s.headers['set-cookie'][0]);
        expect(new Set(users.map((u) => u.id)).size).toBe(50);
        await Promise.all(
          students.map((s, i) =>
            request(apps[(i + 1) % 2])
              .get('/api/auth/me')
              .set('Cookie', cookies[i])
              .expect(200, s.body),
          ),
        );
        const owner = await createUser(
            a,
            'owner@example.test',
            'Owner',
            'TestPassword123',
            'organizer',
          ),
          hub = new HubService(a),
          future = new Date(Date.now() + 86400000).toISOString();
        const event = await hub.createEvent(owner, {
          title: 'Capacity',
          description: '',
          location: 'Room',
          startsAt: future,
          capacity: 10,
        });
        await Promise.all(
          cookies.map((cookie, i) =>
            request(apps[i % 2])
              .post(`/api/events/${event.id}/registrations`)
              .set('Origin', origin)
              .set('Cookie', cookie)
              .expect(201),
          ),
        );
        let rows = await hub.attendees(owner, event.id);
        expect(rows.filter((r) => r.status === 'confirmed')).toHaveLength(10);
        expect(rows.filter((r) => r.status === 'waitlisted')).toHaveLength(40);
        expect(new Set(rows.map((r) => r.userId)).size).toBe(50);
        const leaving = rows.find((r) => r.status === 'confirmed')!,
          next = rows
            .filter((r) => r.status === 'waitlisted')
            .sort((x, y) => x.sequence - y.sequence)[0],
          which = users.findIndex((u) => u.id === leaving.userId);
        await request(apps[1])
          .delete(`/api/events/${event.id}/registrations/me`)
          .set('Origin', origin)
          .set('Cookie', cookies[which])
          .expect(200);
        rows = await hub.attendees(owner, event.id);
        expect(rows.find((r) => r.userId === next.userId)?.status).toBe(
          'confirmed',
        );
        const slot = await hub.createSlot(owner, {
          title: 'Office hour',
          location: 'Room 108',
          startsAt: future,
          endsAt: new Date(Date.parse(future) + 900000).toISOString(),
        });
        const bookings = await Promise.all(
          cookies.map((cookie, i) =>
            request(apps[i % 2])
              .post(`/api/slots/${slot.id}/booking`)
              .set('Origin', origin)
              .set('Cookie', cookie)
              .send({}),
          ),
        );
        expect(bookings.filter((r) => r.status === 200)).toHaveLength(1);
        expect(bookings.filter((r) => r.status === 409)).toHaveLength(49);
        expect(
          (await b.get<Slot>('slot', slot.id))!.data.bookings,
        ).toHaveLength(1);
        const groups = await hub.createEvent(owner, {
          title: 'Nine groups',
          description: '',
          location: 'Room',
          startsAt: future,
          capacity: 36,
          groupConfiguration: {
            count: 9,
            capacity: 4,
            autoAssign: false,
            allowSelfSelection: true,
          },
        });
        await Promise.all(
          cookies.map((cookie, i) =>
            request(apps[i % 2])
              .post(`/api/events/${groups.id}/registrations`)
              .set('Origin', origin)
              .set('Cookie', cookie)
              .expect(201),
          ),
        );
        const joins = await Promise.all(
          cookies.map((cookie, i) =>
            request(apps[i % 2])
              .put(`/api/events/${groups.id}/groups/membership`)
              .set('Origin', origin)
              .set('Cookie', cookie)
              .send({ groupId: groups.groups![4].id }),
          ),
        );
        expect(joins.filter((r) => r.status === 200)).toHaveLength(4);
        expect(joins.filter((r) => r.status === 409)).toHaveLength(46);
        expect(
          (await hub.groups(owner, groups.id)).every(
            (g) => g.capacity === 4 && g.members.length <= 4,
          ),
        ).toBe(true);
        const poll = await hub.createPoll(owner, {
          question: 'Classroom poll',
          options: ['Events', 'Groups'],
          anonymous: true,
        });
        await Promise.all(
          cookies.map((cookie, i) =>
            request(apps[i % 2])
              .post(`/api/polls/${poll.id}/votes`)
              .set('Origin', origin)
              .set('Cookie', cookie)
              .send({ option: i % 2 })
              .expect(200),
          ),
        );
        expect(
          (await hub.snapshot(owner)).polls.find((p) => p.id === poll.id)
            ?.totalVotes,
        ).toBe(50);
      });
      it('cleans only explicitly selected guests, promotes waitlists, and preserves permanent accounts and organizer resources', async () => {
        const owner = await createUser(
            a,
            'owner@example.test',
            'Owner',
            'TestPassword123',
            'organizer',
          ),
          permanent = await createUser(
            a,
            'student@example.test',
            'Permanent',
            'TestPassword123',
          ),
          g = await createGuestSession(a, 'Temporary', 24, 500),
          hub = new HubService(a),
          future = new Date(Date.now() + 86400000).toISOString();
        const event = await hub.createEvent(owner, {
          title: 'Preserved',
          description: '',
          location: 'Room',
          startsAt: future,
          capacity: 1,
        });
        await hub.register(g.user, event.id);
        await hub.register(permanent, event.id);
        const slot = await hub.createSlot(owner, {
          title: 'Preserved office hour',
          location: 'Room',
          startsAt: future,
          endsAt: new Date(Date.parse(future) + 900000).toISOString(),
        });
        await hub.bookSlot(g.user, slot.id);
        const poll = await hub.createPoll(owner, {
          question: 'Preserved poll',
          options: ['A', 'B'],
          anonymous: true,
        });
        await hub.vote(g.user, poll.id, 0);
        await hub.vote(permanent, poll.id, 1);
        await expect(
          cleanupClassroomGuests(a, [owner.id], true),
        ).rejects.toThrow('not a classroom guest');
        expect((await cleanupClassroomGuests(a, [g.user.id])).apply).toBe(
          false,
        );
        expect(await a.get('guest', g.user.id)).not.toBeNull();
        await cleanupClassroomGuests(a, [g.user.id], true);
        expect(await a.get('guest', g.user.id)).toBeNull();
        expect(
          (await cleanupClassroomGuests(a, [g.user.id], true)).alreadyAbsent,
        ).toBe(1);
        expect(await sessionUser(b, g.token)).toBeNull();
        expect(await a.list('user')).toHaveLength(2);
        const state = await hub.snapshot(owner);
        expect(
          state.events.find((e) => e.id === event.id)?.confirmedCount,
        ).toBe(1);
        expect((await hub.attendees(owner, event.id))[0].userId).toBe(
          permanent.id,
        );
        expect(state.slots.find((s) => s.id === slot.id)?.booking).toBeNull();
        expect(state.polls.find((p) => p.id === poll.id)?.totalVotes).toBe(1);
        expect(await a.get<GuestIdentity>('guest', g.user.id)).toBeNull();
      });
    },
  );
