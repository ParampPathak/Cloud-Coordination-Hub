import { SqliteStore } from '../backend/src/store.js';
import { HubService } from '../backend/src/service.js';
import { resourcePage } from '../backend/src/pages.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { User } from '../shared/types.js';
const store = new SqliteStore(':memory:'),
  service = new HubService(store);
const owner: User = {
  id: 'owner',
  email: 'owner@example.test',
  name: 'Owner',
  role: 'organizer',
};
const viewer: User = { ...owner, id: 'viewer', role: 'user' };
const samples: unknown[] = [];
try {
  for (const target of [100, 1000]) {
    const count = (await store.summary()).events;
    for (let i = count; i < target; i++)
      await service.createEvent(owner, {
        title: `Benchmark event ${i}`,
        description: 'Isolated synthetic record.',
        location: 'Test room',
        capacity: 50,
        startsAt: '2028-01-01T12:00:00Z',
      });
    for (const mode of ['legacy', 'paginated'] as const) {
      const timings: number[] = [];
      let bytes = 0,
        entityRows = 0;
      for (let run = 0; run < 30; run++) {
        const begin = performance.now();
        const data =
          mode === 'legacy'
            ? {
                events: (
                  await store.list<import('../shared/types.js').HubEvent>(
                    'event',
                  )
                ).map((event) => service.eventView(event, viewer)),
                polls: await store.list('poll'),
                slots: await store.list('slot'),
                activities: (
                  await store.list<import('../shared/types.js').Activity>(
                    'activity',
                  )
                )
                  .filter((a) => a.actorId === viewer.id)
                  .slice(-12),
                database: store.kind,
              }
            : {
                summary: await store.summary(),
                events: await resourcePage(store, viewer, 'event', {
                  limit: 12,
                  filter: 'upcoming',
                }),
                activities: await resourcePage(store, viewer, 'activity', {
                  limit: 12,
                  descending: true,
                }),
              };
        timings.push(performance.now() - begin);
        bytes = Buffer.byteLength(JSON.stringify(data));
        entityRows =
          mode === 'legacy'
            ? target * 2
            : (
                data as {
                  events: { examined: number };
                  activities: { examined: number };
                }
              ).events.examined +
              (data as { activities: { examined: number } }).activities
                .examined;
      }
      timings.sort((a, b) => a - b);
      samples.push({
        recordsPerKind: target,
        mode,
        samples: 30,
        responseBytes: bytes,
        baseEntityRowsRead: entityRows,
        p50Ms: timings[14],
        p95Ms: timings[28],
        notes:
          'SQLite in-memory service benchmark, includes bounded activity ownership lookups. Not HTTP, DynamoDB or AWS latency.',
      });
    }
  }
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/query-benchmark.json',
    JSON.stringify({ date: new Date().toISOString(), samples }, null, 2),
  );
  console.log(JSON.stringify(samples, null, 2));
} finally {
  store.close();
}
