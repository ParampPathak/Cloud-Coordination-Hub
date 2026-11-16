import { randomBytes } from 'node:crypto';
import type {
  GuestIdentity,
  HubEvent,
  Poll,
  Slot,
  StoredUser,
} from '../../shared/types.js';
import { PROJECT_WORKSPACE_ID } from '../../shared/workspaces.js';
import type { StoreWrite } from './store.js';
import {
  inviteWrite,
  membershipWrites,
  workspaceRecord,
  type WorkspaceConfig,
} from './workspaces.js';

export interface MigrationRow {
  kind: string;
  id: string;
  data: unknown;
  version: number;
}

export function planWorkspaceMigration(
  rows: MigrationRow[],
  ownerEmail: string,
) {
  const lookup = new Map(rows.map((r) => [r.kind + '/' + r.id, r]));
  const counts: Record<string, number> = {};
  for (const row of rows)
    counts[row.kind.split(':')[0]] = (counts[row.kind.split(':')[0]] ?? 0) + 1;
  const marker = lookup.get('workspace-config/v1');
  if (marker) {
    const config = marker.data as WorkspaceConfig;
    if (
      config.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(config.invitationKey) ||
      !lookup.has('workspace/' + PROJECT_WORKSPACE_ID)
    )
      throw new Error('Workspace schema is incomplete or unsupported.');
    return { alreadyMigrated: true, counts, additions: [] as StoreWrite[] };
  }
  if (rows.some((r) => /^(workspace[-:]|workspace$|ws:)/.test(r.kind)))
    throw new Error(
      'Workspace records exist without a migration marker. Restore or investigate before retrying.',
    );
  const accounts = rows
    .filter((r) => r.kind === 'user')
    .map((r) => r.data as StoredUser);
  const guests = rows
    .filter((r) => r.kind === 'guest')
    .map((r) => r.data as GuestIdentity);
  const owner = accounts.find(
    (u) => u.email === ownerEmail.trim().toLowerCase(),
  );
  if (!owner || !['organizer', 'admin'].includes(owner.role))
    throw new Error('Select an existing organizer as Project workspace owner.');
  const identities = new Set([...accounts, ...guests].map((u) => u.id));
  if (identities.size !== accounts.length + guests.length)
    throw new Error('Duplicate identity IDs.');
  const managers = new Set(
    accounts.filter((u) => u.role !== 'user').map((u) => u.id),
  );
  const assert = (condition: unknown, row: MigrationRow, relation: string) => {
    if (!condition)
      throw new Error(
        'Invalid ' +
          row.kind +
          ' ' +
          relation +
          '. Review the source data before migration.',
      );
  };
  for (const row of rows) {
    assert(Number.isInteger(row.version) && row.version > 0, row, 'version');
    if (row.kind === 'event') {
      const event = row.data as HubEvent;
      assert(
        event.id === row.id && managers.has(event.organizerId),
        row,
        'owner or ID',
      );
      const groupIds = new Set(event.groups?.map((g) => g.id));
      for (const registration of event.registrations)
        assert(
          identities.has(registration.userId) &&
            (!registration.groupId || groupIds.has(registration.groupId)),
          row,
          'registration or group',
        );
    } else if (row.kind === 'poll') {
      const poll = row.data as Poll;
      assert(
        poll.id === row.id && managers.has(poll.organizerId),
        row,
        'owner or ID',
      );
      for (const userId of [
        ...Object.keys(poll.votes ?? {}),
        ...(poll.entries ?? []).map((e) => e.userId),
      ])
        assert(identities.has(userId), row, 'participant');
    } else if (row.kind === 'slot') {
      const slot = row.data as Slot;
      assert(
        slot.id === row.id && managers.has(slot.organizerId),
        row,
        'owner or ID',
      );
      for (const booking of slot.bookings ??
        (slot.booking ? [slot.booking] : []))
        assert(identities.has(booking.userId), row, 'booking');
      if (slot.scheduleId)
        assert(lookup.has('schedule/' + slot.scheduleId), row, 'schedule');
    } else if (row.kind === 'schedule') {
      for (const id of (row.data as { slots: string[] }).slots)
        assert(
          lookup.has('slot/' + id) &&
            (lookup.get('slot/' + id)?.data as Slot).scheduleId === row.id,
          row,
          'slot',
        );
    } else if (row.kind === 'session') {
      const session = row.data as {
        email?: string;
        guestId?: string;
        expiresAt: number;
      };
      if (session.expiresAt > Date.now() / 1000)
        assert(
          session.guestId
            ? lookup.has('guest/' + session.guestId)
            : lookup.has('user/' + session.email),
          row,
          'identity',
        );
    }
  }
  const config = {
    version: 1 as const,
    invitationKey: randomBytes(32).toString('hex'),
  };
  const project = workspaceRecord(PROJECT_WORKSPACE_ID, owner.id, {
    name: 'Project workspace',
    description: '',
    category: 'Cloud Computing · Team',
  });
  const additions: StoreWrite[] = [
    { kind: 'workspace-config', id: 'v1', data: config, expected: null },
    { kind: 'workspace', id: project.id, data: project, expected: null },
    inviteWrite(config, project),
    ...[...accounts, ...guests].flatMap((u) =>
      membershipWrites(
        project.id,
        {
          id: u.id,
          name: u.name,
          role:
            u.id === owner.id
              ? 'owner'
              : managers.has(u.id)
                ? 'manager'
                : 'attendee',
        },
        [null, null],
      ),
    ),
  ];
  return { alreadyMigrated: false, counts, additions };
}
