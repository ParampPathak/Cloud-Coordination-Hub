import { useState } from 'react';
import { api } from './api';
import type { EventView, GroupView, Registration, User } from '../shared/types';

export function Groups({
  event,
  user,
  onChanged,
}: {
  event: EventView;
  user: User;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false),
    [groups, setGroups] = useState<GroupView[]>([]),
    [rows, setRows] = useState<Registration[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const owns = event.organizerId === user.id;
  async function load() {
    setBusy(true);
    setError('');
    try {
      const membership = await api<GroupView[]>(`/events/${event.id}/groups`);
      setGroups(membership);
      if (owns) setRows(await api(`/events/${event.id}/attendees`));
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load groups.');
    } finally {
      setBusy(false);
    }
  }
  async function assign(groupId: string | null, participantId = user.id) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/events/${event.id}/groups/membership`, 'PUT', {
        groupId,
        participantId,
      });
      await load();
      onChanged();
      setNotice('Group membership saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update group.');
    } finally {
      setBusy(false);
    }
  }
  if (!event.groups) return null;
  const confirmed = event.registration?.status === 'confirmed';
  return (
    <section className="group-section">
      <p className="muted">
        {event.groups.length} groups · {event.groups[0]?.capacity} students per
        group
        {event.registration?.groupId
          ? ` · Your group: ${event.groups.find((g) => g.id === event.registration?.groupId)?.name}`
          : ''}
      </p>
      {owns || confirmed ? (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => (open ? setOpen(false) : void load())}
        >
          {open ? 'Hide groups' : 'View groups'}
        </button>
      ) : (
        <small>Register to view and join groups.</small>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {open && (
        <>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void load()}
          >
            Refresh groups
          </button>
          <div className="group-grid">
            {groups.map((g) => (
              <div className="group-card" key={g.id}>
                <h4>
                  {g.name} — {g.members.length}/{g.capacity} students
                </h4>
                <ul>
                  {g.members.map((m) => (
                    <li key={m.userId}>
                      {m.name}
                      {m.userId === user.id ? ' (you)' : ''}
                    </li>
                  ))}
                </ul>
                <small>{g.capacity - g.members.length} available spots</small>
                {confirmed && event.groupSettings?.allowSelfSelection && (
                  <button
                    className="button secondary"
                    disabled={
                      busy ||
                      g.members.length >= g.capacity ||
                      g.members.some((m) => m.userId === user.id)
                    }
                    onClick={() => void assign(g.id)}
                  >
                    Join {g.name}
                  </button>
                )}
              </div>
            ))}
          </div>
          {confirmed && event.groupSettings?.allowSelfSelection && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void assign(null)}
            >
              Leave current group
            </button>
          )}
          {owns && (
            <>
              <h4>Assign or move students</h4>
              {rows
                .filter((r) => r.status === 'confirmed')
                .map((r) => (
                  <label key={r.userId}>
                    {r.name}
                    <select
                      aria-label={`Group for ${r.name}`}
                      disabled={busy}
                      value={r.groupId ?? ''}
                      onChange={(e) =>
                        void assign(e.target.value || null, r.userId)
                      }
                    >
                      <option value="">Unassigned</option>
                      {groups.map((g) => (
                        <option value={g.id} key={g.id}>
                          {g.name} ({g.members.length}/{g.capacity})
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              <a
                className="button secondary"
                href={`/api/events/${event.id}/groups.csv`}
              >
                Export group CSV
              </a>
            </>
          )}
        </>
      )}
    </section>
  );
}
