import type { HubEvent, Poll } from '../../shared/types.js';
import { normalizePoll } from './polls.js';
export interface Summary {
  events: number;
  confirmed: number;
  waitlisted: number;
  activePolls: number;
}
export const emptySummary = (): Summary => ({
  events: 0,
  confirmed: 0,
  waitlisted: 0,
  activePolls: 0,
});
export function contribution(kind: string, data: unknown): Summary {
  const result = emptySummary();
  if (kind === 'event' && data) {
    const event = data as HubEvent;
    result.events = 1;
    result.confirmed = (event.registrations ?? []).filter(
      (r) => r.status === 'confirmed',
    ).length;
    result.waitlisted = (event.registrations ?? []).filter(
      (r) => r.status === 'waitlisted',
    ).length;
  }
  if (kind === 'poll' && data) {
    const poll = normalizePoll(data as Poll);
    result.activePolls = Number(
      poll.settings.state !== 'draft' &&
        poll.settings.state !== 'archived' &&
        !poll.closed,
    );
  }
  return result;
}
