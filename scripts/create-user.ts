import { readConfig } from '../backend/src/config.js';
import { createStore } from '../backend/src/store.js';
import { createUser } from '../backend/src/auth.js';
import { z } from 'zod';
const [email, name, role = 'organizer'] = process.argv.slice(2);
const input = z
  .object({
    email: z.email(),
    name: z.string().min(1).max(80),
    role: z.enum(['user', 'organizer', 'admin']),
    password: z.string(),
  })
  .parse({ email, name, role, password: process.env.HUB_USER_PASSWORD });
const store = createStore(readConfig());
try {
  const user = await createUser(
    store,
    input.email,
    input.name,
    input.password,
    input.role,
  );
  console.log(`Created ${user.role}: ${user.email}`);
} finally {
  store.close();
}
