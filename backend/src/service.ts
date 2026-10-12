import {
  activeEntries,
  canManagePoll,
  managePoll,
  normalizePoll,
  settings,
} from './polls.js';
import type { PollInput, PollSettings } from '../../shared/types.js';
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
import { HttpError } from './errors.js';
export { HttpError } from './errors.js';
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
      const activity = this.activity(user, id, message);
      if (
        kind === 'poll' &&
        ['Updated poll participation', 'Cancelled poll participation'].includes(
          message,
        ) &&
        normalizePoll(record.data as Poll).settings.anonymous
      ) {
        activity.actorId = '';
        activity.actorName = 'Anonymous participant';
      }
      if (
        kind === 'poll' &&
        Buffer.byteLength(JSON.stringify(record.data), 'utf8') > 290_000
      )
        throw new HttpError(
          409,
          'This poll has reached its storage limit. Create a new poll; existing records are preserved.',
        );
      if (await this.store.put(kind, id, record.data, record.version, activity))
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
  async createPoll(user: User, input: PollInput) {
    if (user.role !== 'organizer' && user.role !== 'admin')
      throw new HttpError(403, 'Organizer access is required.');
    const config = settings(input);
    const poll: Poll = {
      question: input.question.trim(),
      options: input.options.map((o) => o.trim()),
      id: randomUUID(),
      organizerId: user.id,
      createdAt: now(),
      votes: {},
      closed: config.state !== 'open',
      settings: config,
      entries: [],
      schemaVersion: 1,
    };
    await this.store.put(
      'poll',
      poll.id,
      poll,
      null,
      this.activity(user, poll.id, 'Created poll'),
    );
    return this.pollView(poll, user);
  }
  async vote(user: User, id: string, option: number) {
    const record = await this.store.get<Poll>('poll', id);
    if (!record) throw new HttpError(404, 'Poll was not found.');
    const poll = normalizePoll(record.data);
    if (!Number.isInteger(option) || !poll.settings.optionIds[option])
      throw new HttpError(400, 'Choose an available option.');
    return this.selectPoll(user, id, [poll.settings.optionIds[option]]);
  }
  async selectPoll(user: User, id: string, optionIds: string[]) {
    return this.pollView(
      await this.mutate<Poll>(
        'poll',
        id,
        user,
        'Updated poll participation',
        (raw) => {
          const poll = normalizePoll(raw),
            config = poll.settings;
          if (config.state !== 'open')
            throw new HttpError(409, 'This poll is not open.');
          if (user.id === poll.organizerId && !config.allowOrganizerVote)
            throw new HttpError(
              403,
              'Organizer voting is disabled for this poll.',
            );
          if (
            !optionIds.length ||
            optionIds.length > config.maxSelections ||
            new Set(optionIds).size !== optionIds.length ||
            optionIds.some((id) => !config.optionIds.includes(id))
          )
            throw new HttpError(
              400,
              'Choose distinct available options within the selection limit.',
            );
          const active = activeEntries(poll),
            mine = active.filter((e) => e.userId === user.id);
          if (mine.length && !config.allowChanges)
            throw new HttpError(
              409,
              'You have already voted. Selection changes are disabled.',
            );
          if (
            mine.length === optionIds.length &&
            mine.every((e) => optionIds.includes(e.optionId))
          )
            throw new HttpError(409, 'Your selection is already recorded.');
          if (!mine.length && new Set(active.map((e) => e.userId)).size >= 2000)
            throw new HttpError(
              409,
              'This prototype supports 2,000 participants per poll.',
            );
          for (const optionId of optionIds) {
            const capacity =
              config.capacities[config.optionIds.indexOf(optionId)];
            if (
              capacity !== null &&
              active.filter(
                (e) => e.optionId === optionId && e.userId !== user.id,
              ).length >= capacity
            )
              throw new HttpError(
                409,
                'That topic is full. Your original selection has been preserved.',
              );
          }
          if (
            poll.entries.length +
              optionIds.filter((id) => !mine.some((e) => e.optionId === id))
                .length >
            4000
          )
            throw new HttpError(
              409,
              'This poll supports 4,000 historical selections. Existing records are preserved.',
            );
          const timestamp = now();
          let sequence = Math.max(
            Object.keys(poll.votes).length,
            ...poll.entries.map((e) => e.sequence),
          );
          for (const entry of mine)
            if (!optionIds.includes(entry.optionId)) {
              entry.status = 'cancelled';
              if (!poll.entries.includes(entry)) poll.entries.push(entry);
            }
          for (const optionId of optionIds)
            if (!mine.some((e) => e.optionId === optionId))
              poll.entries.push({
                userId: user.id,
                optionId,
                createdAt: timestamp,
                sequence: ++sequence,
                status: 'confirmed',
                ...(!config.anonymous
                  ? { name: user.name, email: user.email }
                  : {}),
              });
          // Preserve the old single-choice representation for compatible callers.
          if (config.maxSelections === 1)
            poll.votes[user.id] = config.optionIds.indexOf(optionIds[0]);
        },
      ),
      user,
    );
  }
  async cancelPoll(
    user: User,
    id: string,
    participantId = user.id,
    management = false,
  ) {
    return this.pollView(
      await this.mutate<Poll>(
        'poll',
        id,
        user,
        'Cancelled poll participation',
        (raw) => {
          const poll = normalizePoll(raw);
          if (management) {
            managePoll(user, poll);
            if (poll.settings.anonymous)
              throw new HttpError(
                403,
                'Anonymous voters cannot be identified or removed.',
              );
          } else if (
            !poll.settings.allowCancellation ||
            poll.settings.state !== 'open'
          )
            throw new HttpError(
              403,
              'Cancellation is not permitted for this poll.',
            );
          const mine = activeEntries(poll).filter(
            (e) => e.userId === participantId,
          );
          if (!mine.length)
            throw new HttpError(404, 'No active registration was found.');
          mine.forEach((e) => {
            e.status = 'cancelled';
            if (!poll.entries.includes(e)) poll.entries.push(e);
          });
          delete poll.votes[participantId];
        },
      ),
      user,
    );
  }
  async editPoll(user: User, id: string, input: PollInput) {
    return this.pollView(
      await this.mutate<Poll>(
        'poll',
        id,
        user,
        'Updated poll settings',
        (raw) => {
          const poll = normalizePoll(raw);
          managePoll(user, poll);
          if (poll.settings.state === 'archived')
            throw new HttpError(409, 'Archived polls cannot be edited.');
          const config = settings(
            input,
            input.options.map(
              (_, i) => poll.settings.optionIds[i] ?? randomUUID(),
            ),
          );
          config.state = poll.settings.state;
          if (
            (poll.entries.length || Object.keys(poll.votes).length) &&
            (JSON.stringify(input.options) !== JSON.stringify(poll.options) ||
              config.mode !== poll.settings.mode ||
              config.anonymous !== poll.settings.anonymous ||
              config.maxSelections !== poll.settings.maxSelections)
          )
            throw new HttpError(
              409,
              'Options, poll type, anonymity and selection maximum are locked after participation.',
            );
          for (let i = 0; i < config.capacities.length; i++)
            if (
              config.capacities[i] !== null &&
              config.capacities[i]! <
                activeEntries(poll).filter(
                  (e) => e.optionId === config.optionIds[i],
                ).length
            )
              throw new HttpError(
                409,
                'Capacity cannot be smaller than confirmed registrations.',
              );
          poll.question = input.question.trim();
          poll.options = input.options.map((o) => o.trim());
          poll.settings = config;
        },
      ),
      user,
    );
  }
  async pollState(user: User, id: string, state: PollSettings['state']) {
    return this.pollView(
      await this.mutate<Poll>('poll', id, user, `Poll ${state}`, (raw) => {
        const poll = normalizePoll(raw);
        managePoll(user, poll);
        if (poll.settings.state === 'archived')
          throw new HttpError(409, 'Archived polls cannot be reopened.');
        poll.settings.state = state;
        poll.closed = state !== 'open';
      }),
      user,
    );
  }
  async closePoll(user: User, id: string) {
    return this.pollState(user, id, 'closed');
  }
  async pollParticipants(
    user: User,
    id: string,
    query: {
      search?: string;
      optionId?: string;
      sort?: 'name' | 'date';
      direction?: 'asc' | 'desc';
      page?: number;
      pageSize?: number;
      status?: 'confirmed' | 'cancelled';
    } = {},
  ) {
    const record = await this.store.get<Poll>('poll', id);
    if (!record) throw new HttpError(404, 'Poll was not found.');
    const poll = normalizePoll(record.data);
    managePoll(user, poll);
    if (poll.settings.anonymous)
      throw new HttpError(
        403,
        'This poll is anonymous. Only aggregate results are available.',
      );
    const search = (query.search ?? '').toLowerCase();
    const rows = poll.entries
      .filter(
        (e) =>
          e.status === (query.status ?? 'confirmed') &&
          (!query.optionId || e.optionId === query.optionId) &&
          `${e.name} ${e.email}`.toLowerCase().includes(search),
      )
      .sort(
        (a, b) =>
          ((query.sort === 'name'
            ? (a.name ?? '').localeCompare(b.name ?? '')
            : (a.createdAt ?? '').localeCompare(b.createdAt ?? '')) ||
            a.sequence - b.sequence) * (query.direction === 'desc' ? -1 : 1),
      );
    const page = query.page ?? 1,
      pageSize = query.pageSize ?? 20;
    return {
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
    };
  }
  pollView(raw: Poll, user: User): PollView {
    const poll = normalizePoll(raw),
      config = poll.settings,
      active = activeEntries(poll);
    const mine = active
      .filter((e) => e.userId === user.id)
      .map((e) => e.optionId);
    const canManage = canManagePoll(user, poll);
    const resultsVisible =
      canManage ||
      config.resultsVisibility === 'always' ||
      (config.resultsVisibility === 'after-vote' && mine.length > 0) ||
      (config.resultsVisibility === 'after-close' &&
        ['closed', 'archived'].includes(config.state));
    const counts = config.optionIds.map(
      (id) => active.filter((e) => e.optionId === id).length,
    );
    return {
      id: poll.id,
      question: poll.question,
      options: poll.options,
      organizerId: poll.organizerId,
      createdAt: poll.createdAt,
      closed: config.state !== 'open',
      settings: config,
      schemaVersion: 1,
      canManage,
      resultsVisible,
      counts: resultsVisible ? counts : [],
      totalVotes: resultsVisible
        ? new Set(active.map((e) => e.userId)).size
        : 0,
      totalSelections: resultsVisible ? active.length : 0,
      mySelections: mine,
      myVote: mine.length ? config.optionIds.indexOf(mine[0]) : null,
      availability: config.capacities.map((capacity, i) => ({
        registered: capacity !== null || resultsVisible ? counts[i] : 0,
        remaining: capacity === null ? null : capacity - counts[i],
      })),
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
    const anonymousPolls = new Set(
      polls
        .filter((poll) => normalizePoll(poll).settings.anonymous)
        .map((poll) => poll.id),
    );
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
        .filter(
          (poll) =>
            normalizePoll(poll).settings.state !== 'draft' ||
            canManagePoll(user, poll),
        )
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
        .slice(0, 12)
        .map((activity) =>
          anonymousPolls.has(activity.resourceId) &&
          [
            'Voted in poll',
            'Updated poll participation',
            'Cancelled poll participation',
          ].includes(activity.message)
            ? { ...activity, actorId: '', actorName: 'Anonymous participant' }
            : activity,
        ),
      database: this.store.kind,
    };
  }
}
