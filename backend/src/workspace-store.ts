import type { Store, StoreWrite } from './store.js';
import { activityRecipients } from './store.js';
import { contribution, emptySummary, type Summary } from './read-model.js';
import { HttpError } from './errors.js';
import type { Activity, Slot } from '../../shared/types.js';
import { PROJECT_WORKSPACE_ID } from '../../shared/workspaces.js';

const sharedGuards = new Set(['participant-schedule', 'organizer-schedule']);

// Legacy data retains its exact keys. New partitions are disjoint and indexed
// by the existing adapter keys. The caller supplies checked membership versions.
export class WorkspaceStore implements Store {
  readonly kind: string;
  constructor(
    private base: Store,
    readonly workspaceId: string,
    private checks: StoreWrite[],
    private archived: boolean,
  ) {
    this.kind = base.kind;
  }
  private scoped(kind: string) {
    return this.workspaceId === PROJECT_WORKSPACE_ID || sharedGuards.has(kind)
      ? kind
      : 'ws:' + this.workspaceId + ':' + kind;
  }
  get<T>(kind: string, id: string) {
    return this.base.get<T>(this.scoped(kind), id);
  }
  list<T>(kind: string) {
    return this.base.list<T>(this.scoped(kind));
  }
  page<T>(kind: string, limit: number, after?: string, descending?: boolean) {
    return this.base.page<T>(this.scoped(kind), limit, after, descending);
  }
  legacySlots() {
    return this.base.list<Slot>('slot');
  }
  async summary(): Promise<Summary> {
    if (this.workspaceId === PROJECT_WORKSPACE_ID) return this.base.summary();
    return (await this.get<Summary>('summary', 'v1'))?.data ?? emptySummary();
  }
  put<T>(
    kind: string,
    id: string,
    data: T,
    expected: number | null,
    activity?: Activity,
  ) {
    return this.transact([{ kind, id, data, expected }], activity);
  }
  async transact(writes: StoreWrite[], activity?: Activity) {
    if (this.archived)
      throw new HttpError(409, 'Restore this workspace before making changes.');
    if (this.workspaceId === PROJECT_WORKSPACE_ID)
      return this.base.transact([...writes, ...this.checks], activity);

    const scoped = writes.map((write) => ({
      ...write,
      kind: this.scoped(write.kind),
    }));
    const counted = writes.filter(
      (w) => w.operation !== 'check' && ['event', 'poll'].includes(w.kind),
    );
    if (counted.length) {
      const current = await this.get<Summary>('summary', 'v1');
      const summary = { ...(current?.data ?? emptySummary()) };
      for (const w of counted) {
        const previous = await this.get(w.kind, w.id);
        if ((previous?.version ?? null) !== w.expected) return false;
        const before = contribution(w.kind, previous?.data);
        const after = contribution(
          w.kind,
          w.operation === 'delete' ? undefined : w.data,
        );
        for (const k of Object.keys(summary) as (keyof Summary)[])
          summary[k] += after[k] - before[k];
      }
      if (
        !current ||
        (Object.keys(summary) as (keyof Summary)[]).some(
          (k) => summary[k] !== current.data[k],
        )
      )
        scoped.push({
          kind: this.scoped('summary'),
          id: 'v1',
          data: summary,
          expected: current?.version ?? null,
        });
    }
    if (activity)
      for (const kind of [
        'activity',
        ...activityRecipients(writes, activity).map(
          (id) => 'activity-user:' + id,
        ),
      ])
        scoped.push({
          kind: this.scoped(kind),
          id: activity.id,
          data: activity,
          expected: null,
        });
    return this.base.transact([...scoped, ...this.checks]);
  }
  async remove(kind: string, id: string) {
    const record = await this.get(kind, id);
    if (
      record &&
      !(await this.transact([
        { kind, id, data: null, expected: record.version, operation: 'delete' },
      ]))
    )
      throw new HttpError(409, 'Resource changed. Refresh and try again.');
  }
  ready() {
    return this.base.ready();
  }
  close() {}
}
