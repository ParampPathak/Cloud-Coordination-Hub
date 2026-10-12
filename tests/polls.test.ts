import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../backend/src/store.js';
import { HubService } from '../backend/src/service.js';
import { createApp } from '../backend/src/app.js';
import { createUser, login } from '../backend/src/auth.js';
import { readConfig } from '../backend/src/config.js';
import type { Poll, User, PollInput } from '../shared/types.js';
const owner: User = {
  id: 'owner',
  name: 'Professor',
  email: 'owner@example.test',
  role: 'organizer',
};
const admin: User = {
  id: 'admin',
  name: 'Admin',
  email: 'admin@example.test',
  role: 'admin',
};
const student = (i: number): User => ({
  id: `student-${i}`,
  name: `Student ${i}`,
  email: `student${i}@example.test`,
  role: 'user',
});
const basic: PollInput = { question: 'Topic?', options: ['Science', 'Art'] };
const signup: PollInput = {
  ...basic,
  mode: 'signup',
  capacities: [1, 2],
  allowChanges: true,
  allowCancellation: true,
};
let store: SqliteStore, service: HubService;
beforeEach(() => {
  store = new SqliteStore(':memory:');
  service = new HubService(store);
});
afterEach(() => store.close());
describe('Stage 1 polling', () => {
  it('redacts legacy anonymous vote activities from the owner dashboard', async () => {
    const poll: Poll = {
      id: 'legacy',
      question: 'Old poll',
      options: ['A', 'B'],
      organizerId: owner.id,
      createdAt: '2020-01-01',
      closed: false,
      votes: { [student(1).id]: 0 },
    };
    await store.put('poll', poll.id, poll, null);
    await store.put(
      'activity',
      'legacy-vote',
      {
        id: 'legacy-vote',
        actorId: student(1).id,
        actorName: student(1).name,
        resourceId: poll.id,
        createdAt: '2020-01-02',
        message: 'Voted in poll',
      },
      null,
    );
    const snapshot = await service.snapshot(owner);
    expect(snapshot.polls[0].counts).toEqual([1, 0]);
    expect(snapshot.activities[0]).toMatchObject({
      actorId: '',
      actorName: 'Anonymous participant',
    });
  });
  it('rolls back an invalid legacy migration without changing any valid records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-poll-rollback-')),
      path = join(dir, 'hub.sqlite');
    const valid = {
      id: 'a',
      question: 'Old',
      options: ['A', 'B'],
      organizerId: owner.id,
      createdAt: '2020-01-01',
      closed: false,
      votes: { owner: 0 },
    };
    const db = new DatabaseSync(path);
    db.exec(
      'CREATE TABLE records (kind TEXT,id TEXT,data TEXT,version INTEGER,PRIMARY KEY(kind,id))',
    );
    const insert = db.prepare('INSERT INTO records VALUES (?,?,?,?)');
    insert.run('poll', 'a', JSON.stringify(valid), 2);
    insert.run(
      'poll',
      'b',
      JSON.stringify({ ...valid, id: 'b', votes: { owner: 99 } }),
      3,
    );
    db.close();
    try {
      expect(() => new SqliteStore(path)).toThrow(/migration aborted/);
      const check = new DatabaseSync(path);
      expect(
        check.prepare("SELECT data,version FROM records WHERE id='a'").get(),
      ).toMatchObject({ data: JSON.stringify(valid), version: 2 });
      expect(
        check
          .prepare("SELECT name FROM sqlite_master WHERE name='migrations'")
          .get(),
      ).toBeUndefined();
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('retains a full legacy poll compactly through migration and reopening', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-large-poll-')),
      path = join(dir, 'hub.sqlite');
    const legacy = {
      id: 'large',
      question: 'Old',
      options: ['A', 'B'],
      organizerId: owner.id,
      createdAt: '2020-01-01',
      closed: false,
      votes: Object.fromEntries(
        Array.from({ length: 2000 }, (_, i) => [`participant-${i}`, i % 2]),
      ),
    };
    const db = new DatabaseSync(path);
    db.exec(
      'CREATE TABLE records (kind TEXT,id TEXT,data TEXT,version INTEGER,PRIMARY KEY(kind,id))',
    );
    db.prepare('INSERT INTO records VALUES (?,?,?,?)').run(
      'poll',
      legacy.id,
      JSON.stringify(legacy),
      1,
    );
    db.close();
    const migrated = new SqliteStore(path);
    try {
      const svc = new HubService(migrated);
      expect(
        svc.pollView((await migrated.get<Poll>('poll', legacy.id))!.data, owner)
          .counts,
      ).toEqual([1000, 1000]);
      expect((await svc.closePoll(owner, legacy.id)).totalVotes).toBe(2000);
    } finally {
      migrated.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('defaults owner voting off, permits enabled owners and enforces duplicates', async () => {
    const poll = await service.createPoll(owner, basic);
    await expect(service.vote(owner, poll.id, 0)).rejects.toMatchObject({
      status: 403,
    });
    await service.editPoll(owner, poll.id, {
      ...basic,
      allowOrganizerVote: true,
    });
    expect((await service.vote(owner, poll.id, 0)).counts).toEqual([1, 0]);
    await expect(service.vote(owner, poll.id, 1)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('preserves original signup on a full destination and frees cancelled places', async () => {
    const poll = await service.createPoll(owner, signup),
      ids = poll.settings!.optionIds;
    await service.selectPoll(student(1), poll.id, [ids[0]]);
    await service.selectPoll(student(2), poll.id, [ids[1]]);
    await expect(
      service.selectPoll(student(2), poll.id, [ids[0]]),
    ).rejects.toMatchObject({ status: 409 });
    expect((await service.snapshot(student(2))).polls[0].mySelections).toEqual([
      ids[1],
    ]);
    await service.cancelPoll(student(1), poll.id);
    const changed = await service.selectPoll(student(2), poll.id, [ids[0]]);
    expect(changed.availability.map((a) => a.remaining)).toEqual([0, 2]);
    const rows = await service.pollParticipants(owner, poll.id);
    expect(rows.rows[0]).toMatchObject({
      email: student(2).email,
      name: student(2).name,
      status: 'confirmed',
    });
    expect(rows.rows[0].createdAt).toMatch(/^\d{4}-/);
  });
  it('enforces multiple choice limits and commits the entire selection atomically', async () => {
    const poll = await service.createPoll(owner, {
        ...signup,
        mode: 'multiple',
        maxSelections: 2,
        capacities: [1, 1],
      }),
      ids = poll.settings!.optionIds;
    await expect(
      service.selectPoll(student(1), poll.id, [ids[0], ids[0]]),
    ).rejects.toMatchObject({ status: 400 });
    await service.selectPoll(student(1), poll.id, [ids[0]]);
    await expect(
      service.selectPoll(student(2), poll.id, ids),
    ).rejects.toMatchObject({ status: 409 });
    expect((await service.snapshot(student(2))).polls[0].mySelections).toEqual(
      [],
    );
    const view = await service.selectPoll(student(1), poll.id, ids);
    expect([view.totalVotes, view.totalSelections]).toEqual([1, 2]);
    await expect(
      service.createPoll(owner, { ...basic, maxSelections: 2 }),
    ).rejects.toThrow();
    await expect(
      service.createPoll(owner, { ...signup, anonymous: true }),
    ).rejects.toThrow();
  });
  it('limits single-choice selections and checks cancellation/change policies', async () => {
    const poll = await service.createPoll(owner, {
        ...signup,
        allowChanges: false,
        allowCancellation: false,
      }),
      ids = poll.settings!.optionIds;
    await expect(
      service.selectPoll(student(1), poll.id, ids),
    ).rejects.toMatchObject({ status: 400 });
    await service.selectPoll(student(1), poll.id, [ids[0]]);
    await expect(
      service.selectPoll(student(1), poll.id, [ids[1]]),
    ).rejects.toMatchObject({ status: 409 });
    await expect(service.cancelPoll(student(1), poll.id)).rejects.toMatchObject(
      { status: 403 },
    );
  });
  it('protects anonymous identities and hidden results including activity logs', async () => {
    const poll = await service.createPoll(owner, {
      ...basic,
      resultsVisibility: 'after-vote',
      allowChanges: true,
    });
    const hidden = (await service.snapshot(student(2))).polls[0];
    expect(hidden.counts).toEqual([]);
    expect(hidden.resultsVisible).toBe(false);
    expect((await service.vote(student(1), poll.id, 0)).resultsVisible).toBe(
      true,
    );
    const snapshot = await service.snapshot(owner);
    expect(JSON.stringify(snapshot)).not.toContain(student(1).id);
    expect(JSON.stringify(snapshot)).not.toContain(student(1).name);
    await expect(
      service.pollParticipants(admin, poll.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.cancelPoll(admin, poll.id, student(1).id, true),
    ).rejects.toMatchObject({ status: 403 });
    await service.editPoll(admin, poll.id, {
      ...basic,
      resultsVisibility: 'organizer',
    });
    expect((await service.snapshot(student(1))).polls[0].resultsVisible).toBe(
      false,
    );
    expect((await service.snapshot(admin)).polls[0].resultsVisible).toBe(true);
    await service.editPoll(admin, poll.id, {
      ...basic,
      resultsVisibility: 'after-close',
    });
    expect((await service.snapshot(student(1))).polls[0].resultsVisible).toBe(
      false,
    );
    await service.closePoll(admin, poll.id);
    expect((await service.snapshot(student(1))).polls[0].resultsVisible).toBe(
      true,
    );
  });
  it('protects draft lifecycle, locks unsafe edits, supports administrator management', async () => {
    const poll = await service.createPoll(owner, { ...signup, state: 'draft' });
    expect((await service.snapshot(student(1))).polls).toHaveLength(0);
    await expect(service.vote(student(1), poll.id, 0)).rejects.toMatchObject({
      status: 409,
    });
    await service.pollState(admin, poll.id, 'open');
    await service.vote(student(1), poll.id, 0);
    await expect(
      service.editPoll(owner, poll.id, { ...signup, capacities: [1, 0] }),
    ).rejects.toThrow();
    await expect(
      service.editPoll(owner, poll.id, {
        ...signup,
        options: ['Renamed', 'Art'],
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.editPoll(owner, poll.id, { ...signup, anonymous: true }),
    ).rejects.toThrow();
    await expect(
      service.pollParticipants({ ...owner, id: 'other' }, poll.id),
    ).rejects.toMatchObject({ status: 403 });
    await service.cancelPoll(admin, poll.id, student(1).id, true);
    expect(
      (await service.pollParticipants(owner, poll.id, { status: 'cancelled' }))
        .total,
    ).toBe(1);
    await service.pollState(admin, poll.id, 'archived');
    await expect(
      service.pollState(owner, poll.id, 'open'),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.editPoll(owner, poll.id, signup),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('rejects lowering capacities below confirmed registrations and paginates participants', async () => {
    const poll = await service.createPoll(owner, {
      ...signup,
      capacities: [3, 2],
    });
    for (let i = 0; i < 3; i++) await service.vote(student(i), poll.id, 0);
    await expect(
      service.editPoll(admin, poll.id, { ...signup, capacities: [2, 2] }),
    ).rejects.toMatchObject({ status: 409 });
    const rows = await service.pollParticipants(owner, poll.id, {
      page: 2,
      pageSize: 1,
      sort: 'name',
      direction: 'desc',
      search: 'student',
      optionId: poll.settings!.optionIds[0],
    });
    expect(rows.total).toBe(3);
    expect(rows.rows[0].name).toBe('Student 1');
    await service.editPoll(admin, poll.id, { ...signup, capacities: [4, 2] });
    expect(
      (await service.snapshot(student(4))).polls[0].availability[0].remaining,
    ).toBe(1);
  });
  it('handles last-place and duplicate races across independent SQLite connections', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-poll-')),
      path = join(dir, 'hub.sqlite');
    const first = new SqliteStore(path),
      second = new SqliteStore(path);
    try {
      const a = new HubService(first),
        b = new HubService(second),
        poll = await a.createPoll(owner, signup);
      const result = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          (i % 2 ? a : b).vote(student(i), poll.id, 0),
        ),
      );
      expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        a.pollView((await first.get<Poll>('poll', poll.id))!.data, owner)
          .counts,
      ).toEqual([1, 0]);
      const duplicate = await Promise.allSettled([
        a.vote(student(30), poll.id, 1),
        b.vote(student(30), poll.id, 1),
      ]);
      expect(duplicate.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const active = (await a.pollParticipants(owner, poll.id)).rows;
      await a.cancelPoll(
        owner,
        poll.id,
        active.find((e) => e.optionId === poll.settings!.optionIds[0])!.userId,
        true,
      );
      const switches = await Promise.allSettled([
        a.vote(student(30), poll.id, 0),
        b.vote(student(31), poll.id, 0),
      ]);
      expect(switches.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        a.pollView((await first.get<Poll>('poll', poll.id))!.data, owner)
          .counts[0],
      ).toBe(1);
    } finally {
      first.close();
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('migrates legacy votes repeatably without inventing timestamps or losing owner votes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-poll-migration-')),
      path = join(dir, 'hub.sqlite');
    const db = new DatabaseSync(path);
    db.exec(
      'CREATE TABLE records (kind TEXT,id TEXT,data TEXT,version INTEGER,PRIMARY KEY(kind,id))',
    );
    db.prepare('INSERT INTO records VALUES (?,?,?,?)').run(
      'poll',
      'legacy',
      JSON.stringify({
        id: 'legacy',
        question: 'Old',
        options: ['A', 'B'],
        organizerId: owner.id,
        createdAt: '2020-01-01',
        closed: false,
        votes: { owner: 1 },
      }),
      7,
    );
    db.close();
    try {
      const migrated = new SqliteStore(path);
      const record = (await migrated.get<Poll>('poll', 'legacy'))!;
      expect(record.data.entries).toEqual([]);
      expect(record.data.votes).toEqual({ owner: 1 });
      expect(record.data.settings!.allowOrganizerVote).toBe(true);
      expect(
        new HubService(migrated).pollView(record.data, owner).counts,
      ).toEqual([0, 1]);
      migrated.close();
      const reopened = new SqliteStore(path);
      expect((await reopened.get<Poll>('poll', 'legacy'))!.version).toBe(
        record.version,
      );
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('enforces API management authorization, confirmation and strict selection validation', async () => {
    const app = createApp(
      readConfig({ NODE_ENV: 'test', SQLITE_PATH: ':memory:' }),
      store,
      false,
    );
    const prof = await createUser(
      store,
      'prof@example.test',
      'Prof',
      'Password12345',
      'organizer',
    );
    const administrator = await createUser(
      store,
      'admin@example.test',
      'Admin',
      'Password12345',
      'admin',
    );
    const pupil = await createUser(
      store,
      'pupil@example.test',
      'Pupil',
      'Password12345',
    );
    const cookie = async (email: string) =>
      `hub_session=${(await login(store, email, 'Password12345')).token}`;
    const profCookie = await cookie(prof.email),
      adminCookie = await cookie(administrator.email),
      studentCookie = await cookie(pupil.email);
    const poll = await service.createPoll(prof, signup);
    await request(app)
      .get(`/api/polls/${poll.id}/participants`)
      .set('Cookie', studentCookie)
      .expect(403);
    await request(app)
      .post(`/api/polls/${poll.id}/selections`)
      .set('Cookie', studentCookie)
      .set('Origin', 'http://localhost:5173')
      .send({ optionIds: [poll.settings!.optionIds[0]] })
      .expect(200);
    await request(app)
      .get(`/api/polls/${poll.id}/participants?page=0`)
      .set('Cookie', profCookie)
      .expect(400);
    await request(app)
      .get(`/api/polls/${poll.id}/participants`)
      .set('Cookie', adminCookie)
      .expect(200);
    await request(app)
      .delete(`/api/polls/${poll.id}/participants/${pupil.id}`)
      .set('Cookie', adminCookie)
      .set('Origin', 'http://localhost:5173')
      .send({})
      .expect(400);
    await request(app)
      .delete(`/api/polls/${poll.id}/participants/${pupil.id}`)
      .set('Cookie', adminCookie)
      .set('Origin', 'http://localhost:5173')
      .send({ confirm: true })
      .expect(200);
    await request(app)
      .put(`/api/polls/${poll.id}`)
      .set('Cookie', studentCookie)
      .set('Origin', 'http://localhost:5173')
      .send(signup)
      .expect(403);
    await request(app)
      .post(`/api/polls/${poll.id}/state`)
      .set('Cookie', adminCookie)
      .set('Origin', 'http://localhost:5173')
      .send({ state: 'closed' })
      .expect(200);
  });
});
