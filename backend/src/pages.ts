import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import { HubService } from './service.js';
import { HttpError } from './errors.js';
import { slotView } from './scheduling.js';
import { canManagePoll, normalizePoll } from './polls.js';
import type {
  User,
  HubEvent,
  Poll,
  Slot,
  Activity,
} from '../../shared/types.js';
export type Kind = 'event' | 'poll' | 'slot' | 'activity';
export interface PageQuery {
  limit: number;
  cursor?: string;
  search?: string;
  filter?: string;
  descending?: boolean;
}
export async function resourcePage(
  store: Store,
  user: User,
  kind: Kind,
  query: PageQuery,
) {
  const scope = createHash('sha256')
    .update(
      JSON.stringify([
        user.id,
        user.role,
        kind,
        query.search ?? '',
        query.filter ?? '',
        !!query.descending,
      ]),
    )
    .digest('hex');
  let after: string | undefined;
  if (query.cursor) {
    try {
      const cursor = JSON.parse(
        Buffer.from(query.cursor, 'base64url').toString(),
      );
      if (
        cursor.scope !== scope ||
        typeof cursor.after !== 'string' ||
        cursor.after.length > 200
      )
        throw new Error();
      after = cursor.after;
    } catch {
      throw new HttpError(400, 'Invalid pagination cursor.');
    }
  }
  const started = performance.now();
  const page = await store.page<HubEvent | Poll | Slot | Activity>(
    kind === 'activity' ? `activity-user:${user.id}` : kind,
    query.limit,
    after,
    query.descending,
  );
  const service = new HubService(store);
  const items: unknown[] = [];
  for (const raw of page.items) {
    if (kind === 'activity') {
      const activity = raw as Activity;
      let owned = false;
      // At most three targeted reads per candidate, never a full partition read.
      if (activity.actorId !== user.id) {
        for (const resource of ['event', 'poll', 'slot']) {
          const record = await store.get<{ organizerId: string }>(
            resource,
            activity.resourceId,
          );
          if (record?.data.organizerId === user.id) {
            owned = true;
            break;
          }
        }
      }
      if (activity.actorId !== user.id && !owned) continue;
      const poll = await store.get<Poll>('poll', activity.resourceId);
      items.push(
        poll &&
          normalizePoll(poll.data).settings.anonymous &&
          [
            'Voted in poll',
            'Updated poll participation',
            'Cancelled poll participation',
          ].includes(activity.message)
          ? { ...activity, actorId: '', actorName: 'Anonymous participant' }
          : activity,
      );
      continue;
    }
    let view:
      | ReturnType<HubService['eventView']>
      | ReturnType<HubService['pollView']>
      | Slot;
    if (kind === 'event') {
      const event = raw as HubEvent;
      view = service.eventView(event, user);
      if (query.filter === 'mine' && !view.registration) continue;
      if (
        query.filter === 'available' &&
        (Date.parse(event.startsAt) <= Date.now() ||
          view.confirmedCount >= event.capacity)
      )
        continue;
      if (
        query.filter === 'upcoming' &&
        Date.parse(event.startsAt) <= Date.now()
      )
        continue;
    } else if (kind === 'poll') {
      const poll = raw as Poll;
      if (
        normalizePoll(poll).settings.state === 'draft' &&
        !canManagePoll(user, poll)
      )
        continue;
      view = service.pollView(poll, user);
    } else {
      view = slotView(raw as Slot, user);
      if (
        query.filter === 'mine' &&
        !(
          view.bookings?.some((b) => b.userId === user.id) ||
          view.booking?.userId === user.id
        )
      )
        continue;
      if (
        query.filter === 'available' &&
        (view.blocked ||
          Date.parse(view.startsAt) <= Date.now() ||
          (view.bookedCount ?? (view.booking ? 1 : 0)) >= (view.capacity ?? 1))
      )
        continue;
    }
    const searchable = raw as {
      title?: string;
      question?: string;
      location?: string;
      description?: string;
    };
    if (
      query.search &&
      ![
        searchable.title,
        searchable.question,
        searchable.location,
        searchable.description,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query.search.toLowerCase())
    )
      continue;
    items.push(view);
  }
  return {
    items,
    nextCursor: page.nextCursor
      ? Buffer.from(JSON.stringify({ scope, after: page.nextCursor })).toString(
          'base64url',
        )
      : null,
    order: query.descending ? 'id-desc' : 'id-asc',
    examined: page.examined,
    queryMs: Math.round(performance.now() - started),
  };
}
