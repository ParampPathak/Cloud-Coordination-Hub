import { randomUUID, createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import type {
  Activity,
  AppointmentBooking,
  ScheduleInput,
  Slot,
  User,
} from '../../shared/types.js';
import type { Store, StoreWrite } from './store.js';
import { HttpError } from './errors.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const scheduleSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    location: z.string().trim().min(1).max(160),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: time,
    endTime: time,
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, 'Choose a valid IANA time zone.'),
    durationMinutes: z.number().int().min(5).max(240),
    bufferMinutes: z.number().int().min(0).max(120).default(0),
    capacity: z.number().int().min(1).max(50).default(1),
    weeks: z.number().int().min(1).max(8).default(1),
    breaks: z
      .array(z.object({ start: time, end: time }).strict())
      .max(8)
      .default([]),
    bookingLeadMinutes: z.number().int().min(0).max(10080).default(0),
    cancelBeforeMinutes: z.number().int().min(0).max(10080).default(0),
    maxActiveBookings: z.number().int().min(1).max(50).default(20),
    requestId: z.uuid(),
  })
  .strict();

const minutes = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const overlaps = (a: Interval, b: Interval) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) &&
  Date.parse(b.startsAt) < Date.parse(a.endsAt);
interface Interval {
  id: string;
  startsAt: string;
  endsAt: string;
}
interface Guard {
  intervals: Interval[];
}
const active = (i: Interval) => Date.parse(i.endsAt) > Date.now();
function manager(user: User, slot?: Slot) {
  if (user.role !== 'organizer' || (slot && slot.organizerId !== user.id))
    throw new HttpError(
      403,
      'Only the owning organizer can manage these appointments.',
    );
}
// Test possible zone offsets instead of letting Date silently shift DST gaps/folds.
function utcInstant(date: string, minute: number, zone: string) {
  const local = `${date}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
  const naive = Date.parse(`${local}Z`);
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const stamp = (instant: number) =>
    formatter.format(new Date(instant)).replace(' ', 'T');
  const offsets = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 6) {
    const probe = naive + hour * 3600_000;
    offsets.add(Date.parse(`${stamp(probe)}Z`) - probe);
  }
  const candidates = [...offsets]
    .map((offset) => naive - offset)
    .filter((instant) => stamp(instant) === local);
  if (candidates.length !== 1)
    throw new HttpError(
      400,
      `The local time ${local} is ambiguous or nonexistent in ${zone}. Choose a time outside the daylight-saving transition.`,
    );
  return new Date(candidates[0]).toISOString();
}
export function generateSchedule(raw: ScheduleInput) {
  const input = scheduleSchema.parse(raw);
  const base = new Date(`${input.date}T12:00:00Z`);
  if (
    !Number.isFinite(base.getTime()) ||
    base.toISOString().slice(0, 10) !== input.date
  )
    throw new HttpError(400, 'Choose a valid date.');
  const start = minutes(input.startTime),
    end = minutes(input.endTime);
  if (start >= end)
    throw new HttpError(
      400,
      'End time must follow the start time on the same day.',
    );
  const breaks = input.breaks.map((b) => ({
    start: minutes(b.start),
    end: minutes(b.end),
  }));
  if (breaks.some((b) => b.start >= b.end || b.start < start || b.end > end))
    throw new HttpError(
      400,
      'Breaks must be within the office-hour window and end after they start.',
    );
  const slots: { startsAt: string; endsAt: string }[] = [];
  for (let week = 0; week < input.weeks; week++) {
    const date = new Date(base.getTime() + week * 7 * 86400_000)
      .toISOString()
      .slice(0, 10);
    for (
      let m = start;
      m + input.durationMinutes <= end;
      m += input.durationMinutes + input.bufferMinutes
    ) {
      if (breaks.some((b) => m < b.end && b.start < m + input.durationMinutes))
        continue;
      const startsAt = utcInstant(date, m, input.timeZone);
      const endsAt = utcInstant(
        date,
        m + input.durationMinutes,
        input.timeZone,
      );
      if (
        Date.parse(startsAt) <= Date.now() ||
        Date.parse(startsAt) > Date.now() + 366 * 86400_000
      )
        throw new HttpError(
          400,
          'Office hours must start in the future and within one year.',
        );
      if (
        (Date.parse(endsAt) - Date.parse(startsAt)) / 60000 !==
        input.durationMinutes
      )
        throw new HttpError(
          400,
          'An appointment crosses a daylight-saving transition. Choose another window.',
        );
      slots.push({ startsAt, endsAt });
      if (slots.length > 64)
        throw new HttpError(
          400,
          'Create at most 64 appointments in one schedule.',
        );
    }
  }
  if (!slots.length)
    throw new HttpError(
      400,
      'No complete appointments fit outside the breaks.',
    );
  return slots;
}

export function bookings(slot: Slot): AppointmentBooking[] {
  return (
    slot.bookings ??
    (slot.booking ? [{ ...slot.booking, reason: '', createdAt: null }] : [])
  );
}
function synchronize(slot: Slot) {
  const first = slot.bookings?.[0];
  slot.booking = first ? { userId: first.userId, name: first.name } : null;
}
export function slotView(slot: Slot, user: User): Slot {
  const entries = bookings(slot);
  const visible =
    slot.organizerId === user.id
      ? entries
      : entries.filter((b) => b.userId === user.id);
  return {
    ...slot,
    capacity: slot.capacity ?? 1,
    bookedCount: entries.length,
    bookings: visible,
    booking: visible[0]
      ? { userId: visible[0].userId, name: visible[0].name }
      : entries.length
        ? { userId: '', name: 'Reserved' }
        : null,
  };
}
export class SchedulingService {
  constructor(private store: Store) {}
  private activity(user: User, resourceId: string, message: string): Activity {
    const createdAt = new Date().toISOString();
    return {
      id: `${createdAt}#${randomUUID()}`,
      actorId: user.id,
      actorName: user.name,
      createdAt,
      resourceId,
      message,
    };
  }
  private async retry<T>(
    operation: () => Promise<{
      value: T;
      writes: StoreWrite[];
      activity?: Activity;
    }>,
  ) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const result = await operation();
      if (await this.store.transact(result.writes, result.activity))
        return result.value;
      await setTimeout(Math.min(10 * (attempt + 1), 100) + Math.random() * 20);
    }
    throw new HttpError(409, 'Appointments are busy. Refresh and try again.');
  }
  private async guard(kind: string, userId: string) {
    const record = await this.store.get<Guard>(kind, userId);
    // Compatibility bootstrap preserves all legacy bookings and intervals.
    const intervals =
      record?.data.intervals ??
      (await this.store.list<Slot>('slot'))
        .filter((s) =>
          kind === 'organizer-schedule'
            ? s.organizerId === userId
            : bookings(s).some((b) => b.userId === userId),
        )
        .map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt }));
    return {
      intervals: intervals.filter(active),
      expected: record?.version ?? null,
    };
  }
  async createSlot(
    user: User,
    input: Pick<Slot, 'title' | 'location' | 'startsAt' | 'endsAt'>,
  ) {
    manager(user);
    if (
      Date.parse(input.startsAt) <= Date.now() ||
      Date.parse(input.endsAt) <= Date.parse(input.startsAt)
    )
      throw new HttpError(
        400,
        'Choose a future interval with an end after its start.',
      );
    const slot: Slot = {
      ...input,
      id: randomUUID(),
      organizerId: user.id,
      createdAt: new Date().toISOString(),
      booking: null,
    };
    return this.retry(async () => {
      const guard = await this.guard('organizer-schedule', user.id);
      if (guard.intervals.some((i) => overlaps(i, slot)))
        throw new HttpError(409, 'This overlaps your existing office hours.');
      if (guard.intervals.length >= 500)
        throw new HttpError(
          409,
          'At most 500 upcoming appointments per organizer.',
        );
      return {
        value: slot,
        writes: [
          { kind: 'slot', id: slot.id, data: slot, expected: null },
          {
            kind: 'organizer-schedule',
            id: user.id,
            data: {
              intervals: [
                ...guard.intervals,
                { id: slot.id, startsAt: slot.startsAt, endsAt: slot.endsAt },
              ],
            },
            expected: guard.expected,
          },
        ],
        activity: this.activity(
          user,
          slot.id,
          `Opened appointment: ${slot.title}`,
        ),
      };
    });
  }
  async createSchedule(user: User, raw: ScheduleInput) {
    manager(user);
    const input = scheduleSchema.parse(raw);
    const key = `${user.id}:${input.requestId}`;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    type Receipt = { fingerprint: string; slots: string[] };
    const existing = await this.store.get<Receipt>('schedule', key);
    if (existing) {
      if (existing.data.fingerprint !== fingerprint)
        throw new HttpError(
          409,
          'This request ID was already used for another schedule.',
        );
      return { slotIds: existing.data.slots };
    }
    const generated = generateSchedule(input);
    const slots: Slot[] = generated.map((interval) => ({
      ...interval,
      id: randomUUID(),
      title: input.title,
      location: input.location,
      organizerId: user.id,
      createdAt: new Date().toISOString(),
      booking: null,
      bookings: [],
      capacity: input.capacity,
      timeZone: input.timeZone,
      scheduleId: key,
      bookingLeadMinutes: input.bookingLeadMinutes,
      cancelBeforeMinutes: input.cancelBeforeMinutes,
      maxActiveBookings: input.maxActiveBookings,
    }));
    try {
      return await this.retry(async () => {
        const guard = await this.guard('organizer-schedule', user.id);
        if (slots.some((s) => guard.intervals.some((i) => overlaps(i, s))))
          throw new HttpError(
            409,
            'This schedule overlaps your existing office hours.',
          );
        if (guard.intervals.length + slots.length > 500)
          throw new HttpError(
            409,
            'At most 500 upcoming appointments per organizer.',
          );
        return {
          value: { slotIds: slots.map((s) => s.id) },
          writes: [
            ...slots.map((s) => ({
              kind: 'slot',
              id: s.id,
              data: s,
              expected: null,
            })),
            {
              kind: 'organizer-schedule',
              id: user.id,
              data: {
                intervals: [
                  ...guard.intervals,
                  ...slots.map((s) => ({
                    id: s.id,
                    startsAt: s.startsAt,
                    endsAt: s.endsAt,
                  })),
                ],
              },
              expected: guard.expected,
            },
            {
              kind: 'schedule',
              id: key,
              data: { fingerprint, slots: slots.map((s) => s.id) },
              expected: null,
            },
          ],
          activity: this.activity(user, key, 'Created office-hour schedule'),
        };
      });
    } catch (error) {
      const receipt = await this.store.get<Receipt>('schedule', key);
      if (receipt?.data.fingerprint === fingerprint)
        return { slotIds: receipt.data.slots };
      throw error;
    }
  }
  async book(user: User, id: string, reason = '', sourceId?: string) {
    if (reason.length > 1000)
      throw new HttpError(400, 'Meeting reason is too long.');
    return this.retry(async () => {
      const record = await this.store.get<Slot>('slot', id);
      if (!record) throw new HttpError(404, 'Appointment was not found.');
      const slot = record.data;
      if (slot.organizerId === user.id)
        throw new HttpError(403, 'You cannot book your own office hours.');
      if (
        slot.blocked ||
        Date.parse(slot.startsAt) <=
          Date.now() + (slot.bookingLeadMinutes ?? 0) * 60000
      )
        throw new HttpError(
          409,
          'This appointment is unavailable or its booking cutoff has passed.',
        );
      slot.bookings = bookings(slot);
      if (slot.bookings.some((b) => b.userId === user.id))
        throw new HttpError(409, 'You already booked this appointment.');
      if (slot.bookings.length >= (slot.capacity ?? 1))
        throw new HttpError(409, 'This appointment is full.');
      const guard = await this.guard('participant-schedule', user.id);
      const intervals = guard.intervals.filter((i) => i.id !== sourceId);
      if (intervals.some((i) => overlaps(i, slot)))
        throw new HttpError(
          409,
          'You already have an overlapping appointment.',
        );
      if (intervals.length >= (slot.maxActiveBookings ?? 20))
        throw new HttpError(
          409,
          'Your active appointment limit has been reached.',
        );
      const writes: StoreWrite[] = [];
      if (sourceId) {
        if (sourceId === id)
          throw new HttpError(409, 'Choose a different destination.');
        const source = await this.store.get<Slot>('slot', sourceId);
        if (!source)
          throw new HttpError(404, 'Original appointment was not found.');
        source.data.bookings = bookings(source.data);
        if (!source.data.bookings.some((b) => b.userId === user.id))
          throw new HttpError(403, 'You can only reschedule your own booking.');
        this.cancellationWindow(source.data);
        source.data.bookings = source.data.bookings.filter(
          (b) => b.userId !== user.id,
        );
        synchronize(source.data);
        writes.push({
          kind: 'slot',
          id: sourceId,
          data: source.data,
          expected: source.version,
        });
      }
      slot.bookings.push({
        userId: user.id,
        name: user.name,
        reason: reason.trim(),
        createdAt: new Date().toISOString(),
      });
      synchronize(slot);
      writes.push(
        { kind: 'slot', id, data: slot, expected: record.version },
        {
          kind: 'participant-schedule',
          id: user.id,
          data: {
            intervals: [
              ...intervals,
              { id, startsAt: slot.startsAt, endsAt: slot.endsAt },
            ],
          },
          expected: guard.expected,
        },
      );
      return {
        value: slotView(slot, user),
        writes,
        activity: this.activity(
          user,
          id,
          sourceId ? 'Rescheduled appointment' : 'Booked appointment',
        ),
      };
    });
  }
  private cancellationWindow(slot: Slot) {
    if (
      Date.parse(slot.startsAt) <=
      Date.now() + (slot.cancelBeforeMinutes ?? 0) * 60000
    )
      throw new HttpError(
        409,
        'The cancellation deadline has passed. Contact the organizer.',
      );
  }
  async cancel(user: User, id: string, participantId = user.id) {
    return this.retry(async () => {
      const record = await this.store.get<Slot>('slot', id);
      if (!record) throw new HttpError(404, 'Appointment was not found.');
      const slot = record.data;
      const owns = user.role === 'organizer' && user.id === slot.organizerId;
      if (participantId !== user.id && !owns)
        throw new HttpError(403, 'You can only cancel your own booking.');
      slot.bookings = bookings(slot);
      if (!slot.bookings.some((b) => b.userId === participantId))
        throw new HttpError(
          403,
          'You can only cancel an existing booking you manage.',
        );
      if (!owns) this.cancellationWindow(slot);
      const guard = await this.guard('participant-schedule', participantId);
      slot.bookings = slot.bookings.filter((b) => b.userId !== participantId);
      synchronize(slot);
      return {
        value: slotView(slot, user),
        writes: [
          { kind: 'slot', id, data: slot, expected: record.version },
          {
            kind: 'participant-schedule',
            id: participantId,
            data: { intervals: guard.intervals.filter((i) => i.id !== id) },
            expected: guard.expected,
          },
        ],
        activity: this.activity(user, id, 'Cancelled appointment'),
      };
    });
  }
  async block(user: User, id: string, blocked: boolean) {
    return this.retry(async () => {
      const record = await this.store.get<Slot>('slot', id);
      if (!record) throw new HttpError(404, 'Appointment was not found.');
      manager(user, record.data);
      if (blocked && bookings(record.data).length)
        throw new HttpError(
          409,
          'Cancel or reschedule confirmed bookings before blocking this appointment.',
        );
      record.data.blocked = blocked;
      return {
        value: slotView(record.data, user),
        writes: [
          { kind: 'slot', id, data: record.data, expected: record.version },
        ],
        activity: this.activity(
          user,
          id,
          blocked ? 'Blocked appointment' : 'Unblocked appointment',
        ),
      };
    });
  }
}
