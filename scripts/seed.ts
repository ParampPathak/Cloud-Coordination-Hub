import { readConfig } from '../backend/src/config.js';
import { createStore } from '../backend/src/store.js';
import { createDemoData } from '../backend/src/demo-data.js';
const config = readConfig();
if (
  config.NODE_ENV === 'production' ||
  config.ALLOW_AWS === 'true' ||
  (config.DATABASE_DRIVER === 'dynamodb' && !config.DYNAMODB_ENDPOINT)
)
  throw new Error('Demo seed is local-only.');
const store = createStore(config);
if (config.DATABASE_DRIVER === 'sqlite')
  console.log(`Local SQLite database: ${config.SQLITE_PATH}`);
try {
  const { password } = await createDemoData(store);
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
