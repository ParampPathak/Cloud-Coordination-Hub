import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { readConfig } from '../backend/src/config.js';
import { createStore } from '../backend/src/store.js';
import { cleanupClassroomGuests } from '../backend/src/guest-cleanup.js';
const [manifest, flag] = process.argv.slice(2);
if (!manifest || ![undefined, '--apply'].includes(flag))
  throw new Error(
    'Provide a private JSON array of explicit guest IDs; default is dry-run.',
  );
const ids = z
  .array(z.uuid())
  .min(1)
  .max(500)
  .parse(JSON.parse(readFileSync(manifest, 'utf8')));
if (flag === '--apply' && process.env.ALLOW_GUEST_CLEANUP !== 'true')
  throw new Error('Explicit ALLOW_GUEST_CLEANUP=true required.');
const config = readConfig();
if (flag === '--apply' && config.GUEST_DEMO_ENABLED === 'true')
  throw new Error(
    'Disable guest joining in this maintenance configuration before applying cleanup.',
  );
const store = createStore(config);
try {
  await store.ready();
  console.log(
    JSON.stringify(
      await cleanupClassroomGuests(store, ids, flag === '--apply'),
    ),
  );
} finally {
  await store.close();
}
