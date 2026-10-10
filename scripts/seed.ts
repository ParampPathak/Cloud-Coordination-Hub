import { randomBytes } from 'node:crypto';
import { readConfig } from '../backend/src/config.js';
import { createStore } from '../backend/src/store.js';
import { createUser } from '../backend/src/auth.js';
import { HubService } from '../backend/src/service.js';
const config = readConfig();
if (
  config.NODE_ENV === 'production' ||
  config.ALLOW_AWS === 'true' ||
  (config.DATABASE_DRIVER === 'dynamodb' && !config.DYNAMODB_ENDPOINT)
)
  throw new Error('Demo seed is local-only.');
const store = createStore(config);
try {
  if ((await store.list('user')).length)
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
  await createUser(store, 'attendee@example.test', 'Jordan Lee', password);
  const service = new HubService(store);
  const future = (days: number, hour: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
    return date.toISOString();
  };
  await service.createEvent(organizer, {
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
  await service.createPoll(organizer, {
    question: 'When should we hold our next team workshop?',
    options: ['Tuesday afternoon', 'Wednesday morning', 'Thursday afternoon'],
  });
  await service.createSlot(organizer, {
    title: 'Project office hours',
    location: 'Engineering Building · Room 108',
    startsAt: future(1, 15),
    endsAt: future(1, 15.5),
  });
  // Local demonstration credentials are generated each run and never written to source.
  console.log(
    'LOCAL DEMO DATA CREATED. These are example accounts, not AWS identities.',
  );
  console.log(
    'Organizer: organizer@example.test\nAttendee: attendee@example.test',
  );
  console.log(`Temporary password for both: ${password}`);
} finally {
  store.close();
}
