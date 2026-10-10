import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { Store } from './store.js';
import type {
  Activity,
  User,
  HubEvent,
  Poll,
  Slot,
  EventView,
  PollView,
  Snapshot,
} from '../../shared/types.js';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const now = () => new Date().toISOString();
export function organizer(user: User) {
  if (user.role !== 'organizer')
    throw new HttpError(403, 'Organizer access is required.');
}
function owner(user: User, entity: { organizerId: string }) {
  organizer(user);
  if (user.id !== entity.organizerId)
    throw new HttpError(403, 'You can only manage your own resources.');
}
export class HubService {
  constructor(public store: Store) {}
  private activity(user: User, resourceId: string, message: string): Activity {
    return {
      id: `${now()}#${randomUUID()}`,
      actorId: user.id,
      actorName: user.name,
      resourceId,
      message,
      createdAt: now(),
    };
  }
  private async mutate<T>(
    kind: string,
    id: string,
    user: User,
    message: string,
    fn: (data: T) => void,
  ): Promise<T> {
    for (let attempt = 0; attempt < 32; attempt++) {
      const record = await this.store.get<T>(kind, id);
      if (!record) throw new HttpError(404, 'Resource was not found.');
      fn(record.data);
      if (
        await this.store.put(
          kind,
          id,
          record.data,
          record.version,
          this.activity(user, id, message),
        )
      )
        return record.data;
      await setTimeout(Math.min(5 * (attempt + 1), 60) + Math.random() * 10);
    }
    throw new HttpError(409, 'This resource is busy. Please try again.');
  }
  async createEvent(
    user: User,
    input: Pick<
      HubEvent,
      'title' | 'description' | 'location' | 'startsAt' | 'capacity'
    >,
  ) {
    organizer(user);
    const event: HubEvent = {
      ...input,
      id: randomUUID(),
      organizerId: user.id,
      createdAt: now(),
      registrations: [],
      nextSequence: 1,
    };
    await this.store.put(
      'event',
      event.id,
      event,
      null,
      this.activity(user, event.id, `Created ${event.title}`),
    );
    return this.eventView(event, user);
  }
  async editEvent(
    user: User,
    id: string,
    input: Pick<
      HubEvent,
      'title' | 'description' | 'location' | 'startsAt' | 'capacity'
    >,
  ) {
    return this.eventView(
      await this.mutate<HubEvent>(
        'event',
        id,
        user,
        'Updated event',
        (event) => {
          owner(user, event);
          if (
            input.capacity <
            event.registrations.filter((r) => r.status === 'confirmed').length
          )
            throw new HttpError(
              409,
              'Capacity cannot be smaller than the confirmed attendance.',
            );
          Object.assign(event, input);
          this.promote(event);
        },
      ),
      user,
    );
  }
  private promote(event: HubEvent) {
    const waiting = event.registrations
      .filter((r) => r.status === 'waitlisted')
      .sort((a, b) => a.sequence - b.sequence);
    let confirmed = event.registrations.filter(
      (r) => r.status === 'confirmed',
    ).length;
    for (const entry of waiting) {
      if (confirmed >= event.capacity) break;
      entry.status = 'confirmed';
      confirmed++;
    }
  }
  async register(user: User, id: string) {
    return this.eventView(
      await this.mutate<HubEvent>(
        'event',
        id,
        user,
        'Registered for event',
        (event) => {
          if (Date.parse(event.startsAt) <= Date.now())
            throw new HttpError(409, 'Registration has closed for this event.');
          if (event.registrations.some((r) => r.userId === user.id))
            throw new HttpError(
              409,
              'You are already registered or waitlisted.',
            );
          if (event.registrations.length >= 500)
            throw new HttpError(
              409,
              'This prototype supports 500 active registrations per event.',
            );
          const confirmed = event.registrations.filter(
            (r) => r.status === 'confirmed',
          ).length;
          event.registrations.push({
            userId: user.id,
            name: user.name,
            status: confirmed < event.capacity ? 'confirmed' : 'waitlisted',
            sequence: event.nextSequence++,
            createdAt: now(),
          });
        },
      ),
      user,
    );
  }
  async cancel(user: User, id: string) {
    return this.eventView(
      await this.mutate<HubEvent>(
        'event',
        id,
        user,
        'Cancelled registration; next eligible attendee promoted when a seat opened',
        (event) => {
          if (!event.registrations.some((r) => r.userId === user.id))
            throw new HttpError(
              404,
              'You have no registration for this event.',
            );
          event.registrations = event.registrations.filter(
            (r) => r.userId !== user.id,
          );
          this.promote(event);
        },
      ),
      user,
    );
  }
  async attendees(user: User, id: string) {
    const event = await this.store.get<HubEvent>('event', id);
    if (!event) throw new HttpError(404, 'Event was not found.');
    owner(user, event.data);
    return event.data.registrations.sort((a, b) => a.sequence - b.sequence);
  }
  eventView(event: HubEvent, user: User): EventView {
    const { registrations, nextSequence: _sequence, ...data } = event;
    void _sequence;
    const mine = registrations.find((r) => r.userId === user.id);
    const waiting = registrations
      .filter((r) => r.status === 'waitlisted')
      .sort((a, b) => a.sequence - b.sequence);
    return {
      ...data,
      confirmedCount: registrations.filter((r) => r.status === 'confirmed')
        .length,
      waitlistCount: waiting.length,
      registration: mine
        ? {
            ...mine,
            ...(mine.status === 'waitlisted'
              ? { position: waiting.findIndex((r) => r.userId === user.id) + 1 }
              : {}),
          }
        : null,
    };
  }
  async createPoll(user: User, input: Pick<Poll, 'question' | 'options'>) {
    organizer(user);
    const poll: Poll = {
      ...input,
      id: randomUUID(),
      organizerId: user.id,
      createdAt: now(),
      votes: {},
      closed: false,
    };
    await this.store.put(
      'poll',
      poll.id,
      poll,
      null,
      this.activity(user, poll.id, `Published poll: ${poll.question}`),
    );
    return this.pollView(poll, user);
  }
  async vote(user: User, id: string, option: number) {
    return this.pollView(
      await this.mutate<Poll>('poll', id, user, 'Voted in poll', (poll) => {
        if (poll.closed) throw new HttpError(409, 'This poll is closed.');
        if (Object.hasOwn(poll.votes, user.id))
          throw new HttpError(409, 'You have already voted.');
        if (
          !Number.isInteger(option) ||
          option < 0 ||
          option >= poll.options.length
        )
          throw new HttpError(400, 'Choose an available option.');
        if (Object.keys(poll.votes).length >= 2000)
          throw new HttpError(
            409,
            'This prototype supports 2,000 votes per poll.',
          );
        poll.votes[user.id] = option;
      }),
      user,
    );
  }
  async closePoll(user: User, id: string) {
    return this.pollView(
      await this.mutate<Poll>('poll', id, user, 'Closed poll', (poll) => {
        owner(user, poll);
        poll.closed = true;
      }),
      user,
    );
  }
  pollView(poll: Poll, user: User): PollView {
    const { votes, ...data } = poll;
    return {
      ...data,
      counts: poll.options.map(
        (_, i) => Object.values(votes).filter((v) => v === i).length,
      ),
      totalVotes: Object.keys(votes).length,
      myVote: votes[user.id] ?? null,
    };
  }
  async createSlot(
    user: User,
    input: Pick<Slot, 'title' | 'location' | 'startsAt' | 'endsAt'>,
  ) {
    organizer(user);
    const slot: Slot = {
      ...input,
      id: randomUUID(),
      organizerId: user.id,
      createdAt: now(),
      booking: null,
    };
    await this.store.put(
      'slot',
      slot.id,
      slot,
      null,
      this.activity(user, slot.id, `Opened appointment: ${slot.title}`),
    );
    return slot;
  }
  async bookSlot(user: User, id: string) {
    return this.mutate<Slot>('slot', id, user, 'Booked appointment', (slot) => {
      if (Date.parse(slot.startsAt) <= Date.now())
        throw new HttpError(409, 'This appointment is in the past.');
      if (slot.booking)
        throw new HttpError(409, 'This appointment is already booked.');
      slot.booking = { userId: user.id, name: user.name };
    });
  }
  async cancelSlot(user: User, id: string) {
    return this.mutate<Slot>(
      'slot',
      id,
      user,
      'Cancelled appointment',
      (slot) => {
        if (slot.booking?.userId !== user.id)
          throw new HttpError(403, 'You can only cancel your own booking.');
        slot.booking = null;
      },
    );
  }
  async snapshot(user: User): Promise<Snapshot> {
    const [events, polls, slots, activities] = await Promise.all([
      this.store.list<HubEvent>('event'),
      this.store.list<Poll>('poll'),
      this.store.list<Slot>('slot'),
      this.store.list<Activity>('activity'),
    ]);
    const owned = new Set(
      [...events, ...polls, ...slots]
        .filter((r) => r.organizerId === user.id)
        .map((r) => r.id),
    );
    return {
      events: events
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .map((event) => this.eventView(event, user)),
      polls: polls
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((poll) => this.pollView(poll, user)),
      slots: slots
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .map((slot) => ({
          ...slot,
          booking:
            slot.booking &&
            slot.booking.userId !== user.id &&
            slot.organizerId !== user.id
              ? { userId: '', name: 'Reserved' }
              : slot.booking,
        })),
      activities: activities
        .filter((a) => a.actorId === user.id || owned.has(a.resourceId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 12),
      database: this.store.kind,
    };
  }
}
