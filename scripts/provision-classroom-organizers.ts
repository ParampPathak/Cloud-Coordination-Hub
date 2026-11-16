import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { readConfig } from '../backend/src/config.js';
import { createStore } from '../backend/src/store.js';
import { createUser, verifyPassword } from '../backend/src/auth.js';
import type { StoredUser } from '../shared/types.js';

const [input, flag] = process.argv.slice(2);
if (!input || ![undefined, '--apply'].includes(flag))
  throw new Error(
    'Use a protected account file path and optional --apply; never pass passwords as arguments.',
  );
if (process.platform !== 'win32' && (statSync(input).mode & 0o077) !== 0)
  throw new Error('Account input must be private (mode 0600).');
const data = z
  .object({
    accounts: z
      .array(
        z.object({
          email: z.email(),
          name: z.string().trim().min(1).max(80),
          password: z.string().min(12).max(128),
          role: z.literal('organizer'),
        }),
      )
      .length(3),
  })
  .strict()
  .parse(JSON.parse(readFileSync(resolve(input), 'utf8')));
if (new Set(data.accounts.map((a) => a.email.toLowerCase())).size !== 3)
  throw new Error('Three distinct organizer emails required.');
const apply = flag === '--apply';
if (apply && process.env.ALLOW_ORGANIZER_PROVISION !== 'true')
  throw new Error('Explicit ALLOW_ORGANIZER_PROVISION=true required.');
const store = createStore(readConfig());
try {
  await store.ready();
  let created = 0,
    existing = 0;
  for (const a of data.accounts) {
    const r = await store.get<StoredUser>('user', a.email.toLowerCase());
    if (r) {
      if (
        r.data.role !== 'organizer' ||
        r.data.name !== a.name ||
        !(await verifyPassword(a.password, r.data.passwordHash))
      )
        throw new Error(
          'An existing selected account differs; no password, role, or unrelated account was changed.',
        );
      existing++;
    }
  }
  if (apply)
    for (const a of data.accounts)
      if (!(await store.get('user', a.email.toLowerCase()))) {
        await createUser(store, a.email, a.name, a.password, 'organizer');
        created++;
      }
  console.log(
    JSON.stringify({
      apply,
      selectedOrganizers: 3,
      created,
      alreadyVerified: existing,
      passwordsPrinted: false,
      unrelatedUsersChanged: false,
    }),
  );
} catch {
  console.error(
    'Organizer provisioning stopped. Review selected account conflicts or private database access; credentials withheld.',
  );
  process.exitCode = 1;
} finally {
  await store.close();
}
