import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { SqliteStore } from '../backend/src/store.js';
import { createUser, verifyPassword } from '../backend/src/auth.js';
import { HubService } from '../backend/src/service.js';
import type { StoredUser } from '../shared/types.js';
it('provisions exactly three organizers idempotently without changing Alex, ownership, or credentials', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'cch-organizers-')),
    db = join(folder, 'db.sqlite'),
    input = join(folder, 'accounts.local.json');
  const accounts = Array.from({ length: 3 }, (_, i) => ({
    name: 'Organizer ' + i,
    email: `organizer${i}@example.test`,
    password: 'TestProvisioning123',
    role: 'organizer',
  }));
  writeFileSync(input, JSON.stringify({ accounts }), { mode: 0o600 });
  const first = new SqliteStore(db);
  const alex = await createUser(
    first,
    'alex@example.test',
    'Alex',
    'OriginalPassword123',
    'organizer',
  );
  const event = await new HubService(first).createEvent(alex, {
    title: 'Keep ownership',
    description: '',
    location: 'Room',
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    capacity: 2,
  });
  const original = await first.get('user', alex.email);
  first.close();
  const run = () =>
    spawnSync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'scripts/provision-classroom-organizers.ts',
        input,
        '--apply',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        windowsHide: true,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_DRIVER: 'sqlite',
          SQLITE_PATH: db,
          ALLOW_ORGANIZER_PROVISION: 'true',
        },
      },
    );
  try {
    let result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"created":3');
    expect(result.stdout + result.stderr).not.toContain('TestProvisioning123');
    result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"created":0');
    expect(result.stdout).toContain('"alreadyVerified":3');
    const store = new SqliteStore(db);
    expect(await store.get('user', alex.email)).toEqual(original);
    expect(
      (await store.get<{ organizerId: string }>('event', event.id))!.data
        .organizerId,
    ).toBe(alex.id);
    expect(await store.list('user')).toHaveLength(4);
    for (const account of accounts) {
      const user = (await store.get<StoredUser>('user', account.email))!.data;
      expect(user.role).toBe('organizer');
      expect(user).not.toHaveProperty('password');
      expect(await verifyPassword(account.password, user.passwordHash)).toBe(
        true,
      );
    }
    const before = await store.list('user');
    store.close();
    accounts[0].password = 'DifferentPassword123';
    writeFileSync(input, JSON.stringify({ accounts }), { mode: 0o600 });
    result = run();
    expect(result.status).toBe(1);
    const after = new SqliteStore(db);
    expect(await after.list('user')).toEqual(before);
    after.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
