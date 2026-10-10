import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { StoredUser, User, Role } from '../../shared/types.js';
import type { Store } from './store.js';
import { HttpError } from './service.js';
const derive = promisify(scrypt);
export const passwordPolicy =
  /^(?=.{12,128}$)(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).+$/;
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await derive(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [, salt, hash] = encoded.split(':');
  const key = (await derive(password, salt, 64)) as Buffer;
  const stored = Buffer.from(hash, 'hex');
  return key.length === stored.length && timingSafeEqual(key, stored);
}
export function publicUser(user: StoredUser): User {
  const { id, name, email, role } = user;
  return { id, name, email, role };
}
export async function createUser(
  store: Store,
  email: string,
  name: string,
  password: string,
  role: Role = 'user',
) {
  if (!passwordPolicy.test(password))
    throw new HttpError(
      400,
      'Use 12–128 characters including uppercase, lowercase, and a number.',
    );
  const user: StoredUser = {
    id: randomUUID(),
    email: email.toLowerCase().trim(),
    name,
    role,
    passwordHash: await passwordHash(password),
    createdAt: new Date().toISOString(),
  };
  if (!(await store.put('user', user.email, user, null)))
    throw new HttpError(409, 'An account already exists for this email.');
  return publicUser(user);
}
interface Session {
  email: string;
  expiresAt: number;
}
export function tokenKey(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export async function login(store: Store, email: string, password: string) {
  const record = await store.get<StoredUser>(
    'user',
    email.toLowerCase().trim(),
  );
  // A fixed valid hash avoids a fast user-not-found path.
  const fallback = 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64);
  const valid = await verifyPassword(
    password,
    record?.data.passwordHash ?? fallback,
  );
  if (!record || !valid)
    throw new HttpError(401, 'Email or password is incorrect.');
  const token = randomBytes(32).toString('hex');
  await store.put(
    'session',
    tokenKey(token),
    {
      email: record.data.email,
      expiresAt: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
    },
    null,
  );
  return { token, user: publicUser(record.data) };
}
export async function sessionUser(
  store: Store,
  token: unknown,
): Promise<User | null> {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await store.get<Session>('session', tokenKey(token));
  if (!session) return null;
  if (session.data.expiresAt <= Date.now() / 1000) {
    await store.remove('session', tokenKey(token));
    return null;
  }
  const user = await store.get<StoredUser>('user', session.data.email);
  return user ? publicUser(user.data) : null;
}
