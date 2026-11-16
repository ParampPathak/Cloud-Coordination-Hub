import { setTimeout } from 'node:timers/promises';
import type {
  GuestIdentity,
  HubEvent,
  Poll,
  Slot,
  User,
  Activity,
  StoredUser,
} from '../../shared/types.js';
import type { Store, StoreWrite } from './store.js';
import { HubService } from './service.js';
import { normalizePoll } from './polls.js';

// Trusted maintenance only. No HTTP endpoint exposes this operation.
export async function cleanupClassroomGuests(
  store: Store,
  guestIds: string[],
  apply = false,
) {
  if (
    !guestIds.length ||
    guestIds.length > 500 ||
    new Set(guestIds).size !== guestIds.length
  )
    throw new Error('Provide 1–500 distinct guest IDs.');
  const permanentIds = new Set(
    (await store.list<StoredUser>('user')).map((u) => u.id),
  );
  const guests: GuestIdentity[] = [];
  let alreadyAbsent = 0;
  for (const id of guestIds) {
    const r = await store.get<GuestIdentity>('guest', id);
    if (permanentIds.has(id))
      throw new Error(
        'Refusing cleanup: a selected identity is not a classroom guest.',
      );
    if (!r) {
      alreadyAbsent++;
      continue;
    }
    if (r.data.guest !== true || r.data.role !== 'user' || r.data.id !== id)
      throw new Error(
        'Refusing cleanup: a selected identity is not a classroom guest.',
      );
    guests.push(r.data);
  }
  const events = await store.list<HubEvent>('event'),
    slots = await store.list<Slot>('slot'),
    polls = await store.list<Poll>('poll');
  const report = {
    selectedGuests: guests.length,
    alreadyAbsent,
    apply,
    permanentAccountsModified: 0,
    organizerResourcesDeleted: 0,
  };
  if (!apply) return report;
  const retry = async (fn: () => Promise<boolean>) => {
    for (let i = 0; i < 32; i++) {
      if (await fn()) return;
      await setTimeout(5 + Math.random() * 15);
    }
    throw new Error(
      'Cleanup contention; selected guest access remains revoked. Retry the same explicit manifest.',
    );
  };
  for (const guest of guests) {
    await retry(async () => {
      const r = await store.get<GuestIdentity>('guest', guest.id);
      if (!r) return true;
      return store.put(
        'guest',
        guest.id,
        { ...r.data, disabled: true },
        r.version,
      );
    });
    await store.remove('session', guest.sessionKey);
    const actor: User = {
      id: guest.id,
      name: guest.name,
      role: 'user',
      guest: true,
      sessionExpiresAt: guest.expiresAt,
    };
    const hub = new HubService(store);
    for (const event of events) {
      const current = await store.get<HubEvent>('event', event.id);
      if (current?.data.registrations.some((r) => r.userId === guest.id))
        await hub.cancel(actor, event.id);
    }
    for (const slot of slots)
      await retry(async () => {
        const r = await store.get<Slot>('slot', slot.id);
        if (!r) return true;
        const all =
          r.data.bookings ??
          (r.data.booking
            ? [{ ...r.data.booking, reason: '', createdAt: null }]
            : []);
        if (!all.some((b) => b.userId === guest.id)) return true;
        const remaining = all.filter((b) => b.userId !== guest.id),
          guard = await store.get<{ intervals: { id: string }[] }>(
            'participant-schedule',
            guest.id,
          );
        const writes: StoreWrite[] = [
          {
            kind: 'slot',
            id: slot.id,
            expected: r.version,
            data: {
              ...r.data,
              bookings: remaining,
              bookedCount: remaining.length,
              booking: remaining[0]
                ? { userId: remaining[0].userId, name: remaining[0].name }
                : null,
            },
          },
        ];
        if (guard)
          writes.push({
            kind: 'participant-schedule',
            id: guest.id,
            expected: guard.version,
            data: {
              ...guard.data,
              intervals: guard.data.intervals.filter((i) => i.id !== slot.id),
            },
          });
        return store.transact(writes);
      });
    for (const poll of polls)
      await retry(async () => {
        const r = await store.get<Poll>('poll', poll.id);
        if (!r) return true;
        const data = normalizePoll(r.data);
        if (
          !(guest.id in data.votes) &&
          !data.entries.some((e) => e.userId === guest.id)
        )
          return true;
        delete data.votes[guest.id];
        data.entries = data.entries.filter((e) => e.userId !== guest.id);
        return store.put('poll', poll.id, data, r.version);
      });
    const owners = new Set(
      [...events, ...slots, ...polls].map((r) => r.organizerId),
    );
    for (const kind of [
      'activity',
      `activity-user:${guest.id}`,
      ...[...owners].map((id) => `activity-user:${id}`),
    ])
      for (const a of await store.list<Activity>(kind))
        if (a.actorId === guest.id) await store.remove(kind, a.id);
    await store.remove('participant-schedule', guest.id);
    await store.remove('guest', guest.id);
  }
  return report;
}
