import { randomBytes } from 'node:crypto';
import { createUser } from './auth.js';
import { HubService } from './service.js';
import type { Store } from './store.js';

export async function createDemoData(store: Store) {
  if (!['Local SQLite', 'DynamoDB Local'].includes(store.kind))
    throw new Error('Demo data is local-only.');
  for (const kind of ['user', 'session', 'event', 'poll', 'slot', 'activity'])
    if ((await store.list(kind)).length)
      throw new Error(
        'Seed requires an empty local database to preserve your data.',
      );
  const password = `Demo9-${randomBytes(12).toString('base64url')}`;
  const organizer = await createUser(
    store,
    'organizer@example.test',
    'Alex Morgan',
    password,
    'organizer',
  );
  const attendee = await createUser(
    store,
    'attendee@example.test',
    'Jordan Lee',
    password,
  );
  const service = new HubService(store);
  const future = (days: number, hour: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
    return date.toISOString();
  };
  const event = await service.createEvent(organizer, {
    title: 'Cloud architecture studio',
    description:
      'Bring your architecture diagrams. We will explore secure networking, service choices, and deployment tradeoffs together.',
    location: 'Engineering Building · Room 204',
    startsAt: future(2, 14),
    capacity: 2,
  });
  await service.createEvent(organizer, {
    title: 'Midpoint demo rehearsal',
    description:
      'Run through the project presentation and test the event registration and waitlist flow as a team.',
    location: 'Innovation Lab',
    startsAt: future(4, 10),
    capacity: 12,
  });
  await service.register(attendee, event.id);
  const poll = await service.createPoll(organizer, {
    question: 'When should we hold our next team workshop?',
    options: ['Tuesday afternoon', 'Wednesday morning', 'Thursday afternoon'],
  });
  await service.vote(attendee, poll.id, 0);
  await service.createSlot(organizer, {
    title: 'Project office hours',
    location: 'Engineering Building · Room 108',
    startsAt: future(1, 15),
    endsAt: future(1, 15.5),
  });
  return { password, organizer };
}
