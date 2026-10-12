import { createStore } from '../backend/src/store.js';
import { readConfig } from '../backend/src/config.js';
import { normalizePoll } from '../backend/src/polls.js';
import type { Poll } from '../shared/types.js';

// SQLite startup already performs this migration atomically. This command also
// upgrades legacy DynamoDB records using conditional writes; it is resumable.
const store = createStore(readConfig());
try {
  let changed = 0;
  for (const candidate of await store.list<Poll>('poll')) {
    let completed = false;
    for (let attempt = 0; attempt < 32; attempt++) {
      const record = await store.get<Poll>('poll', candidate.id);
      if (!record || record.data.schemaVersion === 1) {
        completed = true;
        break;
      }
      if (
        await store.put(
          'poll',
          candidate.id,
          normalizePoll(record.data),
          record.version,
        )
      ) {
        changed++;
        completed = true;
        break;
      }
    }
    if (!completed)
      throw new Error(
        'Migration encountered a busy poll. Rerun after stopping writes.',
      );
  }
  await store.put(
    'migration',
    '001-polls',
    { appliedAt: new Date().toISOString(), schemaVersion: 1 },
    null,
  );
  console.log(
    `Poll migration complete: ${changed} legacy records upgraded. Existing votes preserved.`,
  );
} finally {
  store.close();
}
