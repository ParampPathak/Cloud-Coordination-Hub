import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { tokenKey } from './auth.js';
import { HttpError } from './errors.js';
import type { Store, StoreWrite } from './store.js';
import type { GuestIdentity, User } from '../../shared/types.js';

export async function createGuestSession(
  store: Store,
  name: string,
  hours: number,
  dailyLimit: number,
  membership?: (guest: { id: string; name: string }) => Promise<StoreWrite[]>,
) {
  name = name.trim();
  if (!name || name.length > 80)
    throw new HttpError(400, 'Enter a display name of 1–80 characters.');
  const id = randomUUID(),
    token = randomBytes(32).toString('hex'),
    key = tokenKey(token);
  const now = Date.now(),
    expiresAt = Math.floor(now / 1000) + hours * 3600;
  const guest: GuestIdentity = {
    id,
    name,
    role: 'user',
    guest: true,
    createdAt: new Date(now).toISOString(),
    expiresAt,
    sessionKey: key,
  };
  const day = new Date(now).toISOString().slice(0, 10);
  for (let attempt = 0; attempt < 32; attempt++) {
    const admission = await store.get<{ count: number }>(
      'guest-admission',
      day,
    );
    const count = admission?.data.count ?? 0;
    if (count >= dailyLimit)
      throw new HttpError(
        429,
        'The classroom guest limit has been reached. Please ask an organizer for help.',
      );
    if (
      await store.transact([
        {
          kind: 'guest-admission',
          id: day,
          data: { count: count + 1 },
          expected: admission?.version ?? null,
        },
        { kind: 'guest', id, data: guest, expected: null },
        {
          kind: 'session',
          id: key,
          data: { guestId: id, expiresAt },
          expected: null,
        },
        ...(membership ? await membership({ id, name }) : []),
      ])
    ) {
      const user: User = {
        id,
        name,
        role: 'user',
        guest: true,
        sessionExpiresAt: expiresAt,
      };
      return { token, user, expiresAt };
    }
    await setTimeout(5 + Math.random() * 15);
  }
  throw new HttpError(409, 'The classroom is busy. Please try joining again.');
}
