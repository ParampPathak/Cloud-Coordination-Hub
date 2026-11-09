import { useState, type FormEvent } from 'react';
import type { ScheduleInput, Slot, User } from '../shared/types';
import { api } from './api';

type Action = (
  path: string,
  method: string,
  message: string,
  body?: unknown,
) => void;
const format = (date: string, timeZone?: string) =>
  new Date(date).toLocaleString(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
export function OfficeHoursBuilder({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [preview, setPreview] = useState<
    { startsAt: string; endsAt: string }[]
  >([]);
  const [draft, setDraft] = useState<ScheduleInput | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setDraft(null);
    setPreview([]);
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '');
    const input: ScheduleInput = {
      title: value('title'),
      location: value('location'),
      date: value('date'),
      startTime: value('startTime'),
      endTime: value('endTime'),
      timeZone: value('timeZone'),
      durationMinutes: Number(value('durationMinutes')),
      capacity: Number(value('capacity')),
      weeks: Number(value('weeks')),
      bufferMinutes: Number(value('bufferMinutes')),
      breaks:
        value('breakStart') || value('breakEnd')
          ? [{ start: value('breakStart'), end: value('breakEnd') }]
          : [],
      bookingLeadMinutes: Number(value('bookingLeadMinutes')),
      cancelBeforeMinutes: Number(value('cancelBeforeMinutes')),
      maxActiveBookings: Number(value('maxActiveBookings')),
      requestId: crypto.randomUUID(),
    };
    try {
      setPreview(await api('/schedules/preview', 'POST', input));
      setDraft(input);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not preview office hours.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api('/schedules', 'POST', draft);
      setPreview([]);
      setDraft(null);
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save office hours.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel scheduling-builder">
      <button
        className="button secondary"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? 'Close schedule builder' : 'Create office-hour schedule'}
      </button>
      {open && (
        <form
          className="resource-form"
          onSubmit={submit}
          onChange={() => {
            setDraft(null);
            setPreview([]);
          }}
        >
          <h2>Office hours</h2>
          <p className="muted">
            Choose a local window. Preview every appointment before saving.
            Weekly repeats stay in the selected time zone.
          </p>
          <label>
            Schedule title
            <input
              name="title"
              required
              maxLength={160}
              defaultValue="Professor office hours"
            />
          </label>
          <label>
            Office-hour location
            <input name="location" required maxLength={160} />
          </label>
          <div className="form-row">
            <label>
              Office-hour date
              <input name="date" type="date" required />
            </label>
            <label>
              Time zone
              <input
                name="timeZone"
                required
                defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Window start
              <input
                name="startTime"
                type="time"
                required
                defaultValue="14:00"
              />
            </label>
            <label>
              Window end
              <input name="endTime" type="time" required defaultValue="16:00" />
            </label>
          </div>
          <div className="form-row">
            <label>
              Appointment minutes
              <input
                name="durationMinutes"
                type="number"
                min={5}
                max={240}
                required
                defaultValue={15}
              />
            </label>
            <label>
              Students per appointment
              <input
                name="capacity"
                type="number"
                min={1}
                max={50}
                required
                defaultValue={1}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Repeat weekly for weeks
              <input
                name="weeks"
                type="number"
                min={1}
                max={8}
                required
                defaultValue={1}
              />
            </label>
            <label>
              Buffer minutes
              <input
                name="bufferMinutes"
                type="number"
                min={0}
                max={120}
                required
                defaultValue={0}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Break starts (optional)
              <input name="breakStart" type="time" />
            </label>
            <label>
              Break ends (optional)
              <input name="breakEnd" type="time" />
            </label>
          </div>
          <details>
            <summary>Booking policies</summary>
            <div className="form-row">
              <label>
                Booking cutoff minutes
                <input
                  name="bookingLeadMinutes"
                  type="number"
                  min={0}
                  max={10080}
                  defaultValue={0}
                />
              </label>
              <label>
                Cancellation cutoff minutes
                <input
                  name="cancelBeforeMinutes"
                  type="number"
                  min={0}
                  max={10080}
                  defaultValue={0}
                />
              </label>
            </div>
            <label>
              Maximum active appointments per student
              <input
                name="maxActiveBookings"
                type="number"
                min={1}
                max={50}
                defaultValue={20}
              />
            </label>
          </details>
          <small className="muted">
            Up to 64 appointments per schedule. Breaks, buffers, and leftover
            minutes do not become appointments. Ambiguous daylight-saving times
            require another window.
          </small>
          <button className="button primary" disabled={busy}>
            {busy ? 'Please wait…' : 'Preview appointments'}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {draft && (
        <div className="schedule-preview">
          <h3>
            {preview.length} appointments · {draft.timeZone}
          </h3>
          <ul>
            {preview.map((s) => (
              <li key={s.startsAt}>
                {format(s.startsAt, draft.timeZone)} –{' '}
                {format(s.endsAt, draft.timeZone)}
              </li>
            ))}
          </ul>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void save()}
          >
            Save office hours
          </button>
        </div>
      )}
    </section>
  );
}
export function SlotCard({
  slot,
  user,
  busy,
  act,
  slots = [],
}: {
  slot: Slot;
  user: User;
  busy: boolean;
  act: Action;
  slots?: Slot[];
}) {
  const [reason, setReason] = useState(''),
    [destination, setDestination] = useState('');
  const mine = Boolean(
    slot.bookings?.some((b) => b.userId === user.id) ||
    slot.booking?.userId === user.id,
  );
  const owns = slot.organizerId === user.id;
  const count = slot.bookedCount ?? (slot.booking ? 1 : 0),
    capacity = slot.capacity ?? 1;
  const past = Date.parse(slot.startsAt) <= Date.now();
  const full = count >= capacity;
  const alternatives = slots.filter(
    (s) =>
      s.id !== slot.id &&
      !s.blocked &&
      Date.parse(s.startsAt) > Date.now() &&
      (s.bookedCount ?? (s.booking ? 1 : 0)) < (s.capacity ?? 1) &&
      s.organizerId !== user.id,
  );
  return (
    <article className="panel appointment-card">
      <div className="section-heading">
        <h3>{slot.title}</h3>
        <span className={`badge ${mine ? 'green' : 'neutral'}`}>
          {mine
            ? 'Your appointment'
            : slot.blocked
              ? 'Blocked'
              : past
                ? 'Past slot'
                : full
                  ? 'Reserved'
                  : 'Available'}
        </span>
      </div>
      <p>
        {format(slot.startsAt)} – {format(slot.endsAt)}
      </p>
      <p className="muted">
        {slot.location} · {count}/{capacity} students
      </p>
      {slot.timeZone && (
        <small className="muted">
          Schedule zone: {slot.timeZone} ·{' '}
          {format(slot.startsAt, slot.timeZone)}. Times above use your device
          zone.
        </small>
      )}
      {!owns && !mine && !past && !full && !slot.blocked && (
        <label>
          Reason for meeting (optional)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={2}
          />
        </label>
      )}
      {!owns && (
        <div className="event-actions">
          <button
            className={`button ${mine ? 'secondary' : 'primary'}`}
            disabled={busy || (!mine && (full || past || slot.blocked))}
            onClick={() =>
              mine
                ? act(
                    `/slots/${slot.id}/booking`,
                    'DELETE',
                    'Appointment cancelled.',
                  )
                : act(
                    `/slots/${slot.id}/booking`,
                    'POST',
                    'Appointment reserved.',
                    { reason },
                  )
            }
          >
            {mine
              ? 'Cancel booking'
              : full
                ? 'Reserved'
                : past || slot.blocked
                  ? 'Closed'
                  : 'Reserve slot'}
          </button>
        </div>
      )}
      {mine && !past && (
        <div className="form-row">
          <label>
            Move appointment to
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              <option value="">Choose another slot</option>
              {alternatives.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {format(s.startsAt)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            disabled={busy || !destination}
            onClick={() =>
              act(
                `/slots/${slot.id}/reschedule`,
                'POST',
                'Appointment rescheduled.',
                { slotId: destination, reason },
              )
            }
          >
            Reschedule booking
          </button>
        </div>
      )}
      {owns && (
        <>
          <ul className="booking-list">
            {(
              slot.bookings ??
              (slot.booking
                ? [{ ...slot.booking, reason: '', createdAt: null }]
                : [])
            ).map((b) => (
              <li key={b.userId}>
                <strong>{b.name}</strong>
                {b.reason && <p>{b.reason}</p>}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Cancel ${b.name}'s appointment?`))
                      act(
                        `/slots/${slot.id}/bookings/${b.userId}`,
                        'DELETE',
                        'Booking cancelled.',
                        { confirm: true },
                      );
                  }}
                >
                  Cancel student booking
                </button>
              </li>
            ))}
          </ul>
          <button
            className="button secondary"
            disabled={busy || past || (!slot.blocked && count > 0)}
            onClick={() =>
              act(
                `/slots/${slot.id}/block`,
                'PUT',
                slot.blocked ? 'Appointment reopened.' : 'Appointment blocked.',
                { blocked: !slot.blocked },
              )
            }
          >
            {slot.blocked ? 'Unblock appointment' : 'Block appointment'}
          </button>
          {count > 0 && (
            <small className="muted">
              Cancel confirmed bookings before blocking this slot.
            </small>
          )}
        </>
      )}
    </article>
  );
}
