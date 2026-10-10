import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { NavLink, useLocation, Navigate } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  Clock3,
  Cloud,
  LayoutDashboard,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  Vote,
  X,
} from 'lucide-react';
import { api, ApiError } from './api';
import type {
  EventView,
  PollView,
  Registration,
  Slot,
  Snapshot,
  User,
} from '../shared/types';

const dateTime = (date: string) =>
  new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
const nav = [
  { path: '/dashboard', label: 'Overview', Icon: LayoutDashboard },
  { path: '/events', label: 'Events', Icon: CalendarDays },
  { path: '/polls', label: 'Polls', Icon: Vote },
  { path: '/scheduling', label: 'Scheduling', Icon: Clock3 },
  { path: '/account', label: 'Account', Icon: ShieldCheck },
];

function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Cloud size={23} />
      </span>
      <span>
        Coordination<span className="brand-sub">CLOUD HUB</span>
      </span>
    </div>
  );
}
function Login({
  onLogin,
  local,
}: {
  onLogin: (user: User) => void;
  local: boolean;
}) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    const credentials = {
      email: data.get('email'),
      password: data.get('password'),
    };
    try {
      if (register)
        await api('/auth/register', 'POST', {
          ...credentials,
          name: data.get('name'),
        });
      onLogin(await api<User>('/auth/login', 'POST', credentials));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-shell">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">
            A LITTLE LESS ADMIN. A LOT MORE TOGETHER.
          </span>
          <h1>
            Good things
            <br />
            happen when
            <br />
            <em>we coordinate.</em>
          </h1>
          <p>
            Events, decisions, and time together.
            <br />
            One shared space to make it happen.
          </p>
          <div className="story-pills">
            <span>
              <CalendarDays size={16} /> Events
            </span>
            <span>
              <Vote size={16} /> Polls
            </span>
            <span>
              <Clock3 size={16} /> Office hours
            </span>
          </div>
        </div>
        <small>Cloud Computing Project · Midpoint Prototype</small>
      </section>
      <main className="login-panel">
        <span className="badge local">
          <span className="dot" />{' '}
          {local ? 'Local development' : 'Cloud workspace'}
        </span>
        <h2>{register ? 'Join your workspace' : 'Welcome back'}</h2>
        <p className="muted">
          {register
            ? 'Create an attendee account to start coordinating.'
            : 'Sign in to see what’s happening in your workspace.'}
        </p>
        <form onSubmit={submit}>
          {register && (
            <label>
              Your name
              <input name="name" maxLength={80} required autoComplete="name" />
            </label>
          )}
          <label>
            Email address
            <input
              type="email"
              name="email"
              required
              autoComplete="username"
              maxLength={254}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              required
              minLength={register ? 12 : 1}
              maxLength={128}
              autoComplete={register ? 'new-password' : 'current-password'}
            />
          </label>
          {register && (
            <small className="muted">
              At least 12 characters, with uppercase, lowercase, and a number.
            </small>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
            <ArrowRight size={17} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError('');
          }}
        >
          {register
            ? 'Already have an account? Sign in'
            : 'New here? Create an attendee account'}
        </button>
        <div className="login-note">
          <ShieldCheck size={20} />
          <p>
            Organizer accounts are provisioned by the project team.{' '}
            {local
              ? 'This prototype runs locally; no AWS resources are connected.'
              : 'Your session is protected by HTTPS and backed by the shared database.'}
          </p>
        </div>
      </main>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      aria-labelledby="modal-title"
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function CreateForm({
  kind,
  event,
  onSaved,
  onClose,
}: {
  kind: 'event' | 'poll' | 'slot';
  event?: EventView;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const localDate = (iso?: string) => {
    if (!iso) return '';
    const date = new Date(iso);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const data = new FormData(e.currentTarget);
    const field = (key: string) => String(data.get(key) ?? '');
    try {
      if (kind === 'poll')
        await api('/polls', 'POST', {
          question: field('question'),
          options: field('options')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        });
      else if (kind === 'slot')
        await api('/slots', 'POST', {
          title: field('title'),
          location: field('location'),
          startsAt: new Date(field('startsAt')).toISOString(),
          endsAt: new Date(field('endsAt')).toISOString(),
        });
      else
        await api(
          event ? `/events/${event.id}` : '/events',
          event ? 'PUT' : 'POST',
          {
            title: field('title'),
            description: field('description'),
            location: field('location'),
            startsAt: new Date(field('startsAt')).toISOString(),
            capacity: Number(field('capacity')),
          },
        );
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="resource-form">
      {kind === 'poll' ? (
        <>
          <label>
            Question
            <input
              name="question"
              required
              maxLength={160}
              placeholder="What should we decide together?"
            />
          </label>
          <label>
            Options
            <textarea
              name="options"
              required
              rows={5}
              placeholder={
                'Tuesday afternoon\nWednesday morning\nThursday afternoon'
              }
            />
          </label>
          <small className="muted">
            One option per line. Add 2–8 distinct options. Results are visible
            to signed-in users.
          </small>
        </>
      ) : (
        <>
          <label>
            {kind === 'slot' ? 'Appointment title' : 'Event title'}
            <input
              name="title"
              defaultValue={event?.title}
              required
              maxLength={160}
              placeholder="Give it a clear, welcoming name"
            />
          </label>
          {kind === 'event' && (
            <label>
              Description
              <textarea
                name="description"
                defaultValue={event?.description}
                rows={3}
                maxLength={4000}
                placeholder="What can attendees expect?"
              />
            </label>
          )}
          <label>
            Location or meeting link
            <input
              name="location"
              required
              defaultValue={event?.location}
              maxLength={kind === 'event' ? 300 : 160}
              placeholder="Room, venue, or online meeting URL"
            />
          </label>
          <div className="form-row">
            <label>
              {kind === 'slot' ? 'Starts at' : 'Date and time'}
              <input
                name="startsAt"
                type="datetime-local"
                required
                defaultValue={localDate(event?.startsAt)}
              />
            </label>
            {kind === 'event' ? (
              <label>
                Capacity
                <input
                  name="capacity"
                  type="number"
                  required
                  min={1}
                  max={250}
                  defaultValue={event?.capacity ?? 20}
                />
              </label>
            ) : (
              <label>
                Ends at
                <input name="endsAt" type="datetime-local" required />
              </label>
            )}
          </div>
          <small className="muted">
            Dates use your browser’s local timezone. Event capacity is limited
            to 250 in this prototype.
          </small>
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button className="button primary" disabled={busy}>
          {busy
            ? 'Saving…'
            : event
              ? 'Save changes'
              : kind === 'poll'
                ? 'Publish poll'
                : kind === 'slot'
                  ? 'Create time slot'
                  : 'Create event'}
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}

export function EventCard({
  event,
  user,
  busy,
  act,
  edit,
  attendees,
}: {
  event: EventView;
  user: User;
  busy: boolean;
  act: (path: string, method: string, message: string) => void;
  edit: () => void;
  attendees: () => void;
}) {
  const date = new Date(event.startsAt);
  const ended = date.getTime() <= Date.now();
  const full = event.confirmedCount >= event.capacity;
  return (
    <article className="event-card">
      <div className="event-card-top">
        <div className="date-tile">
          <span>{date.toLocaleString(undefined, { month: 'short' })}</span>
          <strong>{date.getDate()}</strong>
        </div>
        <span
          className={`badge ${event.registration?.status === 'confirmed' ? 'green' : full ? 'amber' : 'neutral'}`}
        >
          {event.registration?.status === 'confirmed'
            ? 'You’re confirmed'
            : event.registration?.status === 'waitlisted'
              ? `Waitlist #${event.registration.position}`
              : ended
                ? 'Past event'
                : full
                  ? 'Waitlist open'
                  : 'Open for registration'}
        </span>
      </div>
      <h3>{event.title}</h3>
      <p className="event-description">
        {event.description || 'No description provided.'}
      </p>
      <div className="event-meta">
        <span>
          <Clock3 size={15} />
          {dateTime(event.startsAt)}
        </span>
        <span>
          <MapPin size={15} />
          {event.location}
        </span>
      </div>
      <div className="capacity-label">
        <span>
          <Users size={15} />
          {event.confirmedCount} / {event.capacity} seats filled
        </span>
        <span>
          {event.waitlistCount
            ? `${event.waitlistCount} waiting`
            : `${event.capacity - event.confirmedCount} available`}
        </span>
      </div>
      <div className="progress">
        <span
          style={{ width: `${(event.confirmedCount / event.capacity) * 100}%` }}
        />
      </div>
      <div className="event-actions">
        <button
          className={`button ${event.registration ? 'secondary' : 'primary'}`}
          disabled={busy || (!event.registration && ended)}
          onClick={() =>
            act(
              `/events/${event.id}/registrations${event.registration ? '/me' : ''}`,
              event.registration ? 'DELETE' : 'POST',
              event.registration
                ? 'Registration cancelled. Any open seat has been offered to the next attendee.'
                : full
                  ? 'You’ve joined the waitlist.'
                  : 'Your place is confirmed.',
            )
          }
        >
          {event.registration
            ? 'Cancel registration'
            : ended
              ? 'Registration closed'
              : full
                ? 'Join waitlist'
                : 'Register'}
          {!event.registration && !ended && <ArrowRight size={16} />}
        </button>
        {event.organizerId === user.id && (
          <div className="organizer-actions">
            <button
              className="text-button"
              onClick={edit}
              disabled={busy || ended}
            >
              Edit
            </button>
            <button className="text-button" onClick={attendees}>
              Attendees
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
function PollCard({
  poll,
  user,
  busy,
  act,
}: {
  poll: PollView;
  user: User;
  busy: boolean;
  act: (path: string, method: string, message: string, body?: unknown) => void;
}) {
  const [selection, setSelection] = useState<number | null>(null);
  return (
    <article className="panel poll-card">
      <div className="section-heading">
        <span className={`badge ${poll.closed ? 'neutral' : 'green'}`}>
          {poll.closed ? 'Closed' : 'Active poll'}
        </span>
        <span className="muted">
          {poll.totalVotes} vote{poll.totalVotes === 1 ? '' : 's'}
        </span>
      </div>
      <h3>{poll.question}</h3>
      <fieldset disabled={busy || poll.closed || poll.myVote !== null}>
        <legend className="sr-only">Choose an answer</legend>
        {poll.options.map((option, i) => (
          <label
            className={`poll-option ${selection === i || poll.myVote === i ? 'selected' : ''}`}
            key={i}
          >
            <div className="poll-option-label">
              <span>
                <input
                  type="radio"
                  name={`poll-${poll.id}`}
                  checked={poll.myVote === i || selection === i}
                  onChange={() => setSelection(i)}
                />
                {option}
                {poll.myVote === i && <Check size={15} />}
              </span>
              <strong>
                {poll.totalVotes
                  ? Math.round((poll.counts[i] / poll.totalVotes) * 100)
                  : 0}
                %
              </strong>
            </div>
            <div className="poll-bar">
              <span
                style={{
                  width: `${poll.totalVotes ? (poll.counts[i] / poll.totalVotes) * 100 : 0}%`,
                }}
              />
            </div>
          </label>
        ))}
      </fieldset>
      <div className="poll-footer">
        {poll.myVote !== null ? (
          <span className="success-inline">
            <Check size={16} />
            Your vote is recorded
          </span>
        ) : (
          <button
            className="button primary"
            disabled={selection === null || busy || poll.closed}
            onClick={() =>
              act(
                `/polls/${poll.id}/votes`,
                'POST',
                'Your vote has been recorded.',
                { option: selection },
              )
            }
          >
            Submit vote
            <ArrowRight size={16} />
          </button>
        )}
        {poll.organizerId === user.id && !poll.closed && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              act(`/polls/${poll.id}/close`, 'POST', 'Poll closed.')
            }
          >
            Close poll
          </button>
        )}
      </div>
    </article>
  );
}
function SlotCard({
  slot,
  user,
  busy,
  act,
}: {
  slot: Slot;
  user: User;
  busy: boolean;
  act: (path: string, method: string, message: string) => void;
}) {
  const mine = slot.booking?.userId === user.id;
  const past = Date.parse(slot.startsAt) <= Date.now();
  return (
    <article className="panel slot-card">
      <div className="slot-icon">
        <Clock3 size={22} />
      </div>
      <div className="slot-info">
        <span
          className={`badge ${mine ? 'green' : slot.booking ? 'neutral' : 'amber'}`}
        >
          {mine
            ? 'Your appointment'
            : slot.booking
              ? 'Reserved'
              : past
                ? 'Past slot'
                : 'Available'}
        </span>
        <h3>{slot.title}</h3>
        <p>
          {dateTime(slot.startsAt)} –{' '}
          {new Date(slot.endsAt).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </p>
        <p className="muted">{slot.location}</p>
        {slot.organizerId === user.id && slot.booking && (
          <small>Booked by {slot.booking.name}</small>
        )}
      </div>
      <button
        className={`button ${mine ? 'secondary' : 'primary'}`}
        disabled={busy || (!mine && (Boolean(slot.booking) || past))}
        onClick={() =>
          act(
            `/slots/${slot.id}/booking`,
            mine ? 'DELETE' : 'POST',
            mine ? 'Appointment cancelled.' : 'Appointment reserved.',
          )
        }
      >
        {mine
          ? 'Cancel booking'
          : slot.booking
            ? 'Reserved'
            : past
              ? 'Closed'
              : 'Reserve slot'}
      </button>
    </article>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <Cloud size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [local, setLocal] = useState(true);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState<{
    kind: 'event' | 'poll' | 'slot';
    event?: EventView;
  } | null>(null);
  const [attendees, setAttendees] = useState<{
    event: EventView;
    rows: Registration[];
  } | null>(null);
  const path = useLocation().pathname;
  const page = nav.find((n) => n.path === path);
  useEffect(() => {
    void api<{ database: string }>('/health')
      .then((result) => setLocal(result.database !== 'Amazon DynamoDB'))
      .catch(() => {});
    api<User>('/auth/me')
      .then(setUser)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401))
          setError(errorMessage(e));
      })
      .finally(() => setChecking(false));
  }, []);
  const reload = useCallback(async () => {
    try {
      setSnapshot(await api<Snapshot>('/snapshot'));
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        setSnapshot(null);
      }
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    void reload();
    const interval = setInterval(() => void reload(), 15_000);
    return () => clearInterval(interval);
  }, [user, reload]);
  useEffect(() => {
    setSearch('');
    setFilter('all');
  }, [path]);
  async function act(
    endpoint: string,
    method: string,
    message: string,
    body?: unknown,
  ) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api<unknown>(endpoint, method, body);
      if (
        method === 'POST' &&
        /\/events\/[^/]+\/registrations$/.test(endpoint)
      ) {
        const event = response as EventView;
        setNotice(
          event.registration?.status === 'confirmed'
            ? 'Your place is confirmed.'
            : `You have joined the waitlist at position ${event.registration?.position}.`,
        );
      } else {
        setNotice(message);
      }
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api('/auth/logout', 'POST');
      setUser(null);
      setSnapshot(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function showAttendees(event: EventView) {
    setBusy(true);
    try {
      setAttendees({
        event,
        rows: await api<Registration[]>(`/events/${event.id}/attendees`),
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (checking)
    return (
      <div className="page-loading" role="status">
        <Cloud /> Opening your workspace…
      </div>
    );
  if (!user)
    return (
      <>
        <Login
          local={local}
          onLogin={(u) => {
            setUser(u);
            setError('');
          }}
        />
        {error && (
          <div className="connection-error" role="alert">
            {error}
          </div>
        )}
      </>
    );
  if (!page) return <Navigate to="/dashboard" replace />;
  const events = snapshot?.events ?? [];
  const polls = snapshot?.polls ?? [];
  const slots = snapshot?.slots ?? [];
  const upcoming = events.filter((e) => Date.parse(e.startsAt) > Date.now());
  const confirmed = events.reduce((count, e) => count + e.confirmedCount, 0);
  const waiting = events.reduce((count, e) => count + e.waitlistCount, 0);
  const visibleEvents = events.filter(
    (e) =>
      `${e.title} ${e.description} ${e.location}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'mine' && e.registration) ||
        (filter === 'available' &&
          Date.parse(e.startsAt) > Date.now() &&
          e.confirmedCount < e.capacity)),
  );
  const eventCard = (event: EventView) => (
    <EventCard
      key={event.id}
      event={event}
      user={user}
      busy={busy}
      act={act}
      edit={() => setModal({ kind: 'event', event })}
      attendees={() => void showAttendees(event)}
    />
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace">
          <span className="workspace-avatar">CC</span>
          <div>
            <strong>Project workspace</strong>
            <span>Cloud Computing · Team</span>
          </div>
          <span className="workspace-dot" />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {nav.map(({ path, label, Icon }) => (
            <NavLink key={path} to={path}>
              <Icon size={19} />
              <span>{label}</span>
              {path === '/events' && snapshot && (
                <span className="nav-count">{upcoming.length}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="dot" />
            <strong>{local ? 'Local prototype' : 'Cloud workspace'}</strong>
            <p>
              {snapshot?.database ?? 'Connecting to database…'}
              <br />
              {local ? 'AWS deployment is disabled' : 'Shared cloud database'}
            </p>
          </div>
          <div className="profile">
            <span className="avatar">
              {user.name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div>
              <strong>{user.name}</strong>
              <span>
                {user.role === 'organizer' ? 'Organizer' : 'Attendee'}
              </span>
            </div>
            <button
              className="icon-button"
              title="Sign out"
              aria-label="Sign out"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/auth/logout', 'POST');
                  setUser(null);
                  setSnapshot(null);
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>{page.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="badge local">
              <span className="dot" />
              {local ? 'Local development' : 'Cloud workspace'}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              disabled={busy}
              onClick={() => void reload()}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR SHARED SPACE</span>
              <h1>
                {path === '/dashboard'
                  ? `Hello, ${user.name.split(' ')[0]}.`
                  : path === '/events'
                    ? 'Bring people together.'
                    : path === '/polls'
                      ? 'Make the next call together.'
                      : path === '/scheduling'
                        ? 'Make time for what matters.'
                        : 'Your account.'}
              </h1>
              <p>
                {path === '/dashboard'
                  ? 'A clear view of what’s happening and what’s coming next.'
                  : path === '/events'
                    ? 'Plan an event, find your place, and let the waitlist take care of itself.'
                    : path === '/polls'
                      ? 'A question, a few options, and one voice per person.'
                      : path === '/scheduling'
                        ? 'Simple office hours and appointments, without the back-and-forth.'
                        : 'Your identity and access in the project workspace.'}
              </p>
            </div>
            {user.role === 'organizer' && path !== '/account' && (
              <button
                className="button primary"
                onClick={() =>
                  setModal({
                    kind:
                      path === '/polls'
                        ? 'poll'
                        : path === '/scheduling'
                          ? 'slot'
                          : 'event',
                  })
                }
              >
                <Plus size={17} />
                {path === '/polls'
                  ? 'Create poll'
                  : path === '/scheduling'
                    ? 'Create time slot'
                    : 'Create event'}
              </button>
            )}
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={18} />
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss confirmation"
                onClick={() => setNotice('')}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {!snapshot ? (
            <div className="panel page-loading" role="status">
              Loading live workspace data…
            </div>
          ) : (
            <>
              {path === '/dashboard' && (
                <>
                  <section className="hero-panel">
                    <div>
                      <span className="hero-eyebrow">
                        <span className="dot" /> YOUR WORKSPACE, IN SYNC
                      </span>
                      <h2>
                        Less organizing.
                        <br />
                        More showing up.
                      </h2>
                      <p>
                        Keep the plan, the people, and the next step
                        <br className="desktop-only" /> in one place.
                      </p>
                      <NavLink to="/events" className="hero-link">
                        Explore upcoming events
                        <ArrowRight size={18} />
                      </NavLink>
                    </div>
                    <div className="hero-graphic" aria-hidden="true">
                      <div className="orbit orbit-one" />
                      <div className="orbit orbit-two" />
                      <div className="graphic-center">
                        <Cloud size={50} />
                      </div>
                      <span className="floating-card floating-one">
                        <CalendarDays size={18} />
                        Plan together
                        <Check size={15} />
                      </span>
                      <span className="floating-card floating-two">
                        <Users size={18} />
                        Find your place
                      </span>
                      <span className="floating-dot" />
                    </div>
                  </section>
                  <section
                    className="metrics"
                    aria-label="Live workspace totals"
                  >
                    {[
                      {
                        label: 'Upcoming events',
                        value: upcoming.length,
                        caption: 'Ready to bring people together',
                        Icon: CalendarDays,
                      },
                      {
                        label: 'Active polls',
                        value: polls.filter((p) => !p.closed).length,
                        caption: 'Decisions in the making',
                        Icon: BarChart3,
                      },
                      {
                        label: 'Confirmed seats',
                        value: confirmed,
                        caption: 'Across all workspace events',
                        Icon: Users,
                      },
                      {
                        label: 'On the waitlist',
                        value: waiting,
                        caption: 'Automatically promoted when free',
                        Icon: Clock3,
                      },
                    ].map(({ label, value, caption, Icon }) => (
                      <article className="metric" key={label}>
                        <div>
                          <span>{label}</span>
                          <Icon size={18} />
                        </div>
                        <strong>{value}</strong>
                        <p>{caption}</p>
                      </article>
                    ))}
                  </section>
                  <div className="section-heading">
                    <div>
                      <h2>Coming up next</h2>
                      <p className="muted">
                        A few things to put on your calendar.
                      </p>
                    </div>
                    <NavLink className="text-link" to="/events">
                      View all events
                      <ArrowRight size={16} />
                    </NavLink>
                  </div>
                  <section className="event-grid">
                    {upcoming.slice(0, 2).map(eventCard)}
                    {!upcoming.length && (
                      <Empty
                        title="Your next event starts here"
                        text="Organizers can create the first event. New events will appear here."
                      />
                    )}
                  </section>
                  <div className="dashboard-bottom">
                    <section className="panel">
                      <div className="section-heading">
                        <h2>Workspace pulse</h2>
                        <span className="badge neutral">Live totals</span>
                      </div>
                      <div className="pulse-stats">
                        <div>
                          <strong>{events.length}</strong>
                          <span>Total events</span>
                        </div>
                        <div>
                          <strong>
                            {
                              slots.filter(
                                (s) =>
                                  !s.booking &&
                                  Date.parse(s.startsAt) > Date.now(),
                              ).length
                            }
                          </strong>
                          <span>Open appointments</span>
                        </div>
                        <div>
                          <strong>
                            {events.filter((e) => e.registration).length}
                          </strong>
                          <span>Your registrations</span>
                        </div>
                      </div>
                      <div className="pulse-callout">
                        <Vote size={22} />
                        <div>
                          <strong>Every voice counts.</strong>
                          <p>
                            {polls.filter((p) => !p.closed).length} active polls
                            are ready for your input.
                          </p>
                        </div>
                        <NavLink to="/polls" aria-label="Browse polls">
                          <ArrowRight size={20} />
                        </NavLink>
                      </div>
                    </section>
                    <section className="panel">
                      <div className="section-heading">
                        <h2>Recent activity</h2>
                        <span className="muted">Your activity & resources</span>
                      </div>
                      {snapshot.activities.length ? (
                        <ul className="activity-list">
                          {snapshot.activities.slice(0, 4).map((a) => (
                            <li key={a.id}>
                              <span className="activity-icon">
                                <Check size={14} />
                              </span>
                              <div>
                                <strong>{a.message}</strong>
                                <p>
                                  {a.actorName} · {dateTime(a.createdAt)}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">
                          Your workspace activity will appear as you
                          participate.
                        </p>
                      )}
                    </section>
                  </div>
                </>
              )}
              {path === '/events' && (
                <>
                  <div className="toolbar">
                    <div className="tabs" aria-label="Filter events">
                      {[
                        { key: 'all', label: 'All events' },
                        { key: 'mine', label: 'My registrations' },
                        { key: 'available', label: 'Available seats' },
                      ].map((tab) => (
                        <button
                          key={tab.key}
                          className={filter === tab.key ? 'active' : ''}
                          onClick={() => setFilter(tab.key)}
                          aria-pressed={filter === tab.key}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <label className="search">
                      <Search size={17} />
                      <span className="sr-only">Search events</span>
                      <input
                        type="search"
                        placeholder="Search events…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="event-grid">
                    {visibleEvents.map(eventCard)}
                    {!visibleEvents.length && (
                      <Empty
                        title="No events here yet"
                        text={
                          search || filter !== 'all'
                            ? 'Try another search or filter.'
                            : 'An organizer can create your workspace’s first event.'
                        }
                      />
                    )}
                  </div>
                </>
              )}
              {path === '/polls' && (
                <div className="poll-grid">
                  {polls.map((poll) => (
                    <PollCard
                      key={poll.id}
                      poll={poll}
                      user={user}
                      busy={busy}
                      act={act}
                    />
                  ))}
                  {!polls.length && (
                    <Empty
                      title="A good decision starts with a question"
                      text="Published polls will appear here. Organizers can create the first one."
                    />
                  )}
                </div>
              )}
              {path === '/scheduling' && (
                <>
                  <div className="info-strip">
                    <ShieldCheck size={20} />
                    <p>
                      Each slot accepts one booking. Reservations are checked
                      and saved by the backend to prevent double booking.
                    </p>
                  </div>
                  <div className="slot-list">
                    {slots.map((slot) => (
                      <SlotCard
                        key={slot.id}
                        slot={slot}
                        user={user}
                        busy={busy}
                        act={act}
                      />
                    ))}
                    {!slots.length && (
                      <Empty
                        title="Clear a little space on your calendar"
                        text="Organizers can open office-hour or appointment slots here."
                      />
                    )}
                  </div>
                </>
              )}
              {path === '/account' && (
                <div className="account-grid">
                  <section className="panel">
                    <span className="avatar large">
                      {user.name
                        .split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')}
                    </span>
                    <h2>{user.name}</h2>
                    <p className="muted">{user.email}</p>
                    <span className="badge green">
                      {user.role === 'organizer' ? 'Organizer' : 'Attendee'}
                    </span>
                    <dl>
                      <dt>Access</dt>
                      <dd>
                        {user.role === 'organizer'
                          ? 'Create and manage your own events, polls, and appointment slots.'
                          : 'Register for events, vote in polls, and reserve appointments.'}
                      </dd>
                      <dt>Session</dt>
                      <dd>
                        8-hour server-side session. Signing out revokes this
                        session.
                      </dd>
                    </dl>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void logout()}
                    >
                      <LogOut size={16} />
                      Sign out
                    </button>
                  </section>
                  <section className="panel">
                    <ShieldCheck className="account-shield" size={30} />
                    <h2>Built with clear boundaries.</h2>
                    <p>
                      Passwords are hashed with scrypt. Organizer permissions
                      are checked on the server. Your session is stored in the
                      shared database.
                    </p>
                    <div className="info-strip">
                      <span className="dot" />
                      <p>
                        {snapshot.database}.{' '}
                        {local
                          ? 'Local development only. AWS has not been connected or deployed.'
                          : 'Using the shared Amazon DynamoDB deployment.'}
                      </p>
                    </div>
                    <p className="muted">
                      Organizer access is provisioned by the project team
                      through the local command line. There is no self-service
                      role upgrade.
                    </p>
                  </section>
                </div>
              )}
            </>
          )}
          <footer className="footer">
            <span>Cloud Coordination Hub</span>
            <span>Built for people. Ready to coordinate.</span>
          </footer>
        </main>
      </div>
      {modal && (
        <Modal
          title={
            modal.event
              ? 'Edit event'
              : modal.kind === 'poll'
                ? 'Create a poll'
                : modal.kind === 'slot'
                  ? 'Create an appointment slot'
                  : 'Create an event'
          }
          onClose={() => setModal(null)}
        >
          <CreateForm
            kind={modal.kind}
            event={modal.event}
            onClose={() => setModal(null)}
            onSaved={() => {
              setNotice('Saved to the database.');
              void reload();
            }}
          />
        </Modal>
      )}
      {attendees && (
        <Modal
          title={`Attendees · ${attendees.event.title}`}
          onClose={() => setAttendees(null)}
        >
          <p className="muted">
            Confirmed attendees and waitlist in joining order.
          </p>
          {attendees.rows.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Join order</th>
                  </tr>
                </thead>
                <tbody>
                  {attendees.rows.map((r) => (
                    <tr key={r.userId}>
                      <td>{r.name}</td>
                      <td>
                        <span
                          className={`badge ${r.status === 'confirmed' ? 'green' : 'amber'}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td>{r.sequence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No registrations yet.</p>
          )}
          <a
            className="button secondary export-link"
            href={`/api/events/${attendees.event.id}/attendees.csv`}
          >
            <ArrowDownToLine size={16} />
            Export CSV
          </a>
          <button
            className="button primary"
            onClick={() => void showAttendees(attendees.event)}
          >
            Refresh attendees
          </button>
        </Modal>
      )}
    </div>
  );
}
