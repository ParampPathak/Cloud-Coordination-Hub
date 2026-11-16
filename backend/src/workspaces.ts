import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { Store, StoreWrite, RecordVersion } from './store.js';
import type { StoredUser, User } from '../../shared/types.js';
import {
  PROJECT_WORKSPACE_ID,
  type WorkspaceMember,
  type WorkspaceRole,
  type WorkspaceView,
  type WorkspaceStatus,
} from '../../shared/workspaces.js';
import { HttpError } from './errors.js';

export interface WorkspaceConfig {
  version: 1;
  invitationKey: string;
}
export interface WorkspaceRecord {
  id: string;
  name: string;
  description: string;
  category: string;
  ownerId: string;
  status: WorkspaceStatus;
  invitationNonce: string;
  invitationsEnabled: boolean;
}
export type WorkspaceFields = Pick<
  WorkspaceRecord,
  'name' | 'description' | 'category'
>;
export async function workspaceConfig(store: Store) {
  const config = await store.get<WorkspaceConfig>('workspace-config', 'v1');
  if (
    config &&
    (config.data.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(config.data.invitationKey))
  )
    throw new HttpError(503, 'Workspace schema is unavailable.');
  return config;
}

export function workspaceRecord(
  id: string,
  ownerId: string,
  fields: WorkspaceFields,
): WorkspaceRecord {
  return {
    id,
    ...fields,
    ownerId,
    status: 'active',
    invitationNonce: randomBytes(32).toString('hex'),
    invitationsEnabled: true,
  };
}
export const invitationCode = (
  config: WorkspaceConfig,
  workspace: WorkspaceRecord,
) =>
  createHmac('sha256', Buffer.from(config.invitationKey, 'hex'))
    .update(workspace.id + ':' + workspace.invitationNonce)
    .digest('base64url');
const digest = (code: string) =>
  createHash('sha256').update(code).digest('hex');

export function membershipWrites(
  workspaceId: string,
  member: WorkspaceMember,
  expected: [number | null, number | null],
): StoreWrite[] {
  return [
    {
      kind: 'workspace-user:' + member.id,
      id: workspaceId,
      data: { workspaceId, ...member },
      expected: expected[0],
    },
    {
      kind: 'workspace-members:' + workspaceId,
      id: member.id,
      data: member,
      expected: expected[1],
    },
  ];
}
export const checkVersion = (
  kind: string,
  id: string,
  expected: number | null,
): StoreWrite => ({ kind, id, data: null, expected, operation: 'check' });
export const inviteWrite = (
  config: WorkspaceConfig,
  workspace: WorkspaceRecord,
): StoreWrite => ({
  kind: 'workspace-invite',
  id: digest(invitationCode(config, workspace)),
  data: { workspaceId: workspace.id },
  expected: null,
});

function view(workspace: WorkspaceRecord, role: WorkspaceRole): WorkspaceView {
  const { id, name, description, category, status } = workspace;
  if (status === 'deleted')
    throw new HttpError(403, 'Workspace is unavailable.');
  return { id, name, description, category, status, role };
}
export function canCreateWorkspace(user: User) {
  return !user.guest && (user.role === 'organizer' || user.role === 'admin');
}
export class Workspaces {
  constructor(
    private store: Store,
    private config: WorkspaceConfig,
  ) {}
  async list(user: User) {
    const links = await this.store.list<
      WorkspaceMember & { workspaceId: string }
    >('workspace-user:' + user.id);
    const workspaces = await Promise.all(
      links.map(async (m) => {
        const record = await this.store.get<WorkspaceRecord>(
          'workspace',
          m.workspaceId,
        );
        if (!record || record.data.status === 'deleted') return null;
        return view(record.data, m.role);
      }),
    );
    return workspaces
      .filter((w) => w !== null)
      .sort((a, b) =>
        a.id === PROJECT_WORKSPACE_ID
          ? -1
          : b.id === PROJECT_WORKSPACE_ID
            ? 1
            : a.name.localeCompare(b.name),
      );
  }
  async access(user: User, id: string) {
    const [workspace, member] = await Promise.all([
      this.store.get<WorkspaceRecord>('workspace', id),
      this.store.get<WorkspaceMember>('workspace-user:' + user.id, id),
    ]);
    if (!workspace || !member || workspace.data.status === 'deleted')
      throw new HttpError(403, 'Workspace is unavailable.');
    const role = user.guest ? 'attendee' : member.data.role;
    return {
      workspace,
      member,
      role,
      checks: [
        checkVersion('workspace', id, workspace.version),
        checkVersion('workspace-user:' + user.id, id, member.version),
      ],
    };
  }
  async create(user: User, fields: WorkspaceFields) {
    if (!canCreateWorkspace(user))
      throw new HttpError(403, 'Organizer access is required.');
    const workspace = workspaceRecord(randomUUID(), user.id, fields);
    const committed = await this.store.transact([
      { kind: 'workspace', id: workspace.id, data: workspace, expected: null },
      ...membershipWrites(
        workspace.id,
        { id: user.id, name: user.name, role: 'owner' },
        [null, null],
      ),
      inviteWrite(this.config, workspace),
    ]);
    if (!committed)
      throw new HttpError(409, 'Workspace creation conflicted. Try again.');
    return view(workspace, 'owner');
  }
  async invitation(code: string) {
    const key = digest(code.trim());
    const invite = await this.store.get<{ workspaceId: string }>(
      'workspace-invite',
      key,
    );
    const workspace =
      invite &&
      (await this.store.get<WorkspaceRecord>(
        'workspace',
        invite.data.workspaceId,
      ));
    if (
      !workspace ||
      workspace.data.status !== 'active' ||
      !workspace.data.invitationsEnabled ||
      digest(invitationCode(this.config, workspace.data)) !== key
    )
      throw new HttpError(
        404,
        'This invitation is invalid, revoked, or disabled.',
      );
    return workspace;
  }
  private signature(
    code: string,
    id: string,
    subject: string,
    expires: string,
  ) {
    return createHmac('sha256', Buffer.from(this.config.invitationKey, 'hex'))
      .update(JSON.stringify(['join', digest(code), id, subject, expires]))
      .digest('hex');
  }
  async preview(code: string, subject: string) {
    const { data } = await this.invitation(code);
    const expires = String(Math.floor(Date.now() / 1000) + 600);
    return {
      id: data.id,
      name: data.name,
      confirmation:
        expires + '.' + this.signature(code, data.id, subject, expires),
    };
  }
  confirm(code: string, id: string, subject: string, confirmation: string) {
    const [expires, sig] = confirmation.split('.');
    if (
      !sig ||
      Number(expires) <= Date.now() / 1000 ||
      !timingSafeEqual(
        Buffer.from(sig, 'hex'),
        Buffer.from(this.signature(code, id, subject, expires), 'hex'),
      )
    )
      throw new HttpError(
        400,
        'Invitation confirmation expired or changed. Find the workspace again.',
      );
  }
  async prepareJoin(
    code: string,
    confirmId: string,
    user: Pick<User, 'id' | 'name'>,
  ) {
    const workspace = await this.invitation(code);
    if (workspace.data.id !== confirmId)
      throw new HttpError(
        400,
        'Confirm the workspace shown for this invitation.',
      );
    const current = await this.store.get<WorkspaceMember>(
      'workspace-user:' + user.id,
      confirmId,
    );
    return {
      role: current?.data.role ?? ('attendee' as const),
      workspace,
      writes: [
        checkVersion('workspace', confirmId, workspace.version),
        ...(current
          ? [
              checkVersion(
                'workspace-user:' + user.id,
                confirmId,
                current.version,
              ),
            ]
          : membershipWrites(confirmId, { ...user, role: 'attendee' }, [
              null,
              null,
            ])),
      ],
    };
  }
  async join(code: string, id: string, user: User) {
    for (let i = 0; i < 8; i++) {
      const join = await this.prepareJoin(code, id, {
        id: user.id,
        name: user.name,
      });
      if (await this.store.transact(join.writes))
        return view(join.workspace.data, join.role);
      await setTimeout(5 + Math.random() * 15);
    }
    throw new HttpError(409, 'Membership changed. Try again.');
  }
  async management(user: User, id: string) {
    const { workspace, role } = await this.access(user, id);
    if (role === 'attendee')
      throw new HttpError(403, 'Workspace management access is required.');
    const members = await this.store.list<WorkspaceMember>(
      'workspace-members:' + id,
    );
    return {
      workspace: view(workspace.data, role),
      members,
      invitation: {
        code: invitationCode(this.config, workspace.data),
        enabled: workspace.data.invitationsEnabled,
      },
    };
  }
  async change(
    user: User,
    id: string,
    change: Partial<WorkspaceFields> & {
      status?: WorkspaceStatus;
      invitationsEnabled?: boolean;
      rotate?: boolean;
      confirmName?: string;
    },
  ) {
    const access = await this.access(user, id);
    const { workspace, role } = access;
    const { rotate, status, confirmName, invitationsEnabled, ...fields } =
      change;
    if (
      role === 'attendee' ||
      (role === 'manager' && (status || Object.keys(fields).length))
    )
      throw new HttpError(
        403,
        'Workspace owner access is required for this change.',
      );
    if (
      status === 'deleted' &&
      (id === PROJECT_WORKSPACE_ID ||
        confirmName !== workspace.data.name ||
        workspace.data.status !== 'archived')
    )
      throw new HttpError(
        409,
        'Archive the workspace and enter its exact name before deleting. Project workspace is protected.',
      );
    const updated = {
      ...workspace.data,
      ...fields,
      ...(status ? { status } : {}),
      ...(invitationsEnabled === undefined ? {} : { invitationsEnabled }),
      ...(rotate ? { invitationNonce: randomBytes(32).toString('hex') } : {}),
    };
    const writes: StoreWrite[] = [
      { kind: 'workspace', id, data: updated, expected: workspace.version },
      access.checks[1],
    ];
    if (rotate) {
      const oldId = digest(invitationCode(this.config, workspace.data));
      const old = await this.store.get('workspace-invite', oldId);
      if (old)
        writes.push({
          kind: 'workspace-invite',
          id: oldId,
          data: null,
          expected: old.version,
          operation: 'delete',
        });
      writes.push(inviteWrite(this.config, updated));
    }
    if (!(await this.store.transact(writes)))
      throw new HttpError(409, 'Workspace changed. Refresh and try again.');
    return updated.status === 'deleted' ? null : view(updated, role);
  }
  async appoint(user: User, id: string, email: string) {
    const access = await this.access(user, id);
    if (access.role !== 'owner' || access.workspace.data.status !== 'active')
      throw new HttpError(
        403,
        'Only an active workspace owner can add managers.',
      );
    const account = await this.store.get<StoredUser>(
      'user',
      email.toLowerCase(),
    );
    if (!account || !['organizer', 'admin'].includes(account.data.role))
      throw new HttpError(404, 'No eligible organizer account was found.');
    if (account.data.id === user.id)
      throw new HttpError(409, 'The owner already manages this workspace.');
    await this.writeMember(
      access.workspace,
      { id: account.data.id, name: account.data.name, role: 'manager' },
      access.checks,
    );
  }
  private async writeMember(
    workspace: RecordVersion<WorkspaceRecord>,
    target: WorkspaceMember,
    checks: StoreWrite[],
  ) {
    const id = workspace.data.id;
    const [link, member] = await this.memberRecords(id, target.id);
    if (
      !(await this.store.transact([
        ...checks,
        ...membershipWrites(id, target, [
          link?.version ?? null,
          member?.version ?? null,
        ]),
      ]))
    )
      throw new HttpError(409, 'Membership changed. Refresh and try again.');
  }
  private memberRecords(id: string, target: string) {
    return Promise.all([
      this.store.get<WorkspaceMember>('workspace-user:' + target, id),
      this.store.get<WorkspaceMember>('workspace-members:' + id, target),
    ]);
  }
  async remove(user: User, id: string, target: string) {
    const access = await this.access(user, id);
    if (target === access.workspace.data.ownerId)
      throw new HttpError(
        409,
        'The workspace owner cannot leave or be removed.',
      );
    if (target !== user.id && access.role !== 'owner')
      throw new HttpError(403, 'Workspace owner access is required.');
    const [link, member] = await this.memberRecords(id, target);
    if (!link || !member) return;
    const writes: StoreWrite[] = [
      ...access.checks.filter(
        (c) => target !== user.id || c.kind === 'workspace',
      ),
      {
        kind: 'workspace-user:' + target,
        id,
        data: null,
        expected: link.version,
        operation: 'delete',
      },
      {
        kind: 'workspace-members:' + id,
        id: target,
        data: null,
        expected: member.version,
        operation: 'delete',
      },
    ];
    if (!(await this.store.transact(writes)))
      throw new HttpError(409, 'Membership changed. Refresh and try again.');
  }
}
