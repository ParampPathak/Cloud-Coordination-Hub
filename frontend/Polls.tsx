import { PollForm } from './PollForm';
export { PollForm } from './PollForm';
import { ManagementTable } from './ManagementTable';
import { useEffect, useState } from 'react';
import { api } from './api';
import type { PollEntry, PollView, User } from '../shared/types';

export function PollCard({
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
  const [selection, setSelection] = useState<string[]>(poll.mySelections);
  const [management, setManagement] = useState(false);
  const savedSelections = JSON.stringify(poll.mySelections);
  useEffect(() => {
    setSelection(JSON.parse(savedSelections) as string[]);
  }, [savedSelections]);
  const config = poll.settings!;
  const blocked =
    busy ||
    config.state !== 'open' ||
    (user.id === poll.organizerId && !config.allowOrganizerVote) ||
    (poll.mySelections.length > 0 && !config.allowChanges);
  return (
    <article className="panel poll-card">
      <div className="section-heading">
        <span className="badge green">
          {config.state} · {config.mode}
        </span>
        {poll.resultsVisible && (
          <span>
            {poll.totalVotes} participants
            {config.maxSelections > 1 &&
              ` · ${poll.totalSelections} selections`}
          </span>
        )}
      </div>
      <h3>{poll.question}</h3>
      <p className="muted">
        Choose up to {config.maxSelections}.{' '}
        {config.anonymous
          ? 'Anonymous voting.'
          : 'Organizers can view participant details.'}
      </p>
      <fieldset disabled={blocked}>
        <legend className="sr-only">Choose an answer</legend>
        {poll.options.map((label, i) => {
          const id = config.optionIds[i],
            checked = selection.includes(id),
            available = poll.availability[i];
          const full = available.remaining === 0;
          const disabled = !checked && full && !poll.mySelections.includes(id);
          return (
            <label
              className={`poll-option ${checked ? 'selected' : ''} ${full ? 'full' : 'available'} ${blocked || disabled ? 'unavailable' : ''}`}
              key={id}
            >
              <input
                type={config.maxSelections > 1 ? 'checkbox' : 'radio'}
                name={`poll-${poll.id}`}
                aria-label={label}
                checked={checked}
                disabled={disabled}
                onChange={() =>
                  setSelection(
                    config.maxSelections === 1
                      ? [id]
                      : checked
                        ? selection.filter((s) => s !== id)
                        : [...selection, id],
                  )
                }
              />
              <span className="poll-option-content">
                <span className="poll-option-title">{label}</span>
                {available.remaining !== null ? (
                  <span className="poll-option-stat">
                    {available.registered} / {config.capacities[i]} registered
                    &mdash; {available.remaining} spaces remaining
                  </span>
                ) : (
                  poll.resultsVisible && (
                    <span className="poll-option-stat">
                      {poll.counts[i]}{' '}
                      {config.mode === 'standard' ? 'votes' : 'selections'} (
                      {poll.totalVotes
                        ? Math.round((poll.counts[i] / poll.totalVotes) * 100)
                        : 0}
                      % of participants)
                    </span>
                  )
                )}
              </span>
              <span className="poll-option-state">
                {checked && (
                  <span className="poll-selected-label">Selected</span>
                )}
                {available.remaining !== null && (
                  <span className={`badge ${full ? 'neutral' : 'green'}`}>
                    {full ? 'Full' : 'Available'}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      {!poll.resultsVisible && (
        <p className="muted">Results are hidden by the organizer's settings.</p>
      )}
      {user.id === poll.organizerId && !config.allowOrganizerVote && (
        <p className="muted">Organizer voting is disabled.</p>
      )}
      {poll.mySelections.length > 0 && (
        <div className="poll-confirmation" role="status">
          <strong>
            {config.mode === 'signup'
              ? 'Your registration is confirmed.'
              : 'Your selection is recorded.'}
          </strong>
          <span>
            {poll.mySelections
              .map((id) => poll.options[config.optionIds.indexOf(id)])
              .join(', ')}
          </span>
        </div>
      )}
      <div className="poll-footer">
        <button
          className="button primary"
          disabled={
            blocked ||
            !selection.length ||
            selection.length > config.maxSelections
          }
          onClick={() =>
            act(
              `/polls/${poll.id}/selections`,
              'POST',
              'Your selection is recorded.',
              { optionIds: selection },
            )
          }
        >
          {poll.mySelections.length
            ? 'Change selection'
            : config.mode === 'signup'
              ? 'Register'
              : 'Submit vote'}
        </button>
        {poll.mySelections.length > 0 &&
          config.allowCancellation &&
          config.state === 'open' && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                act(
                  `/polls/${poll.id}/selections/me`,
                  'DELETE',
                  'Participation cancelled.',
                )
              }
            >
              Cancel selection
            </button>
          )}
        {poll.canManage && (
          <button
            className="button secondary"
            onClick={() => setManagement(!management)}
          >
            {management ? 'Hide management' : 'Manage poll'}
          </button>
        )}
      </div>
      {management && <PollManagement poll={poll} act={act} busy={busy} />}
    </article>
  );
}

function PollManagement({
  poll,
  act,
  busy,
}: {
  poll: PollView;
  busy: boolean;
  act: (path: string, method: string, message: string, body?: unknown) => void;
}) {
  const [search, setSearch] = useState(''),
    [option, setOption] = useState(''),
    [sort, setSort] = useState('date'),
    [direction, setDirection] = useState('asc'),
    [status, setStatus] = useState('confirmed'),
    [page, setPage] = useState(1);
  const [result, setResult] = useState<{
      rows: PollEntry[];
      total: number;
    } | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [editing, setEditing] = useState(false);
  useEffect(() => {
    if (poll.settings!.anonymous) return;
    let cancelled = false;
    setLoading(true);
    const query = new URLSearchParams({
      search,
      optionId: option,
      sort,
      direction,
      status,
      page: String(page),
    });
    void api<{ rows: PollEntry[]; total: number }>(
      `/polls/${poll.id}/participants?${query}`,
    )
      .then((data) => {
        if (!cancelled) {
          setResult(data);
          setError('');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [poll, search, option, sort, direction, status, page]);
  return (
    <section className="poll-management" aria-label="Poll management">
      <h4>Poll management</h4>
      <div className="management-actions">
        {(['open', 'closed', 'archived'] as const).map((state) => (
          <button
            className="button secondary"
            disabled={
              busy ||
              poll.settings!.state === state ||
              poll.settings!.state === 'archived'
            }
            key={state}
            onClick={() => {
              if (
                state !== 'archived' ||
                window.confirm(
                  'Archive this poll? Participation stops; records are preserved.',
                )
              )
                act(`/polls/${poll.id}/state`, 'POST', `Poll ${state}.`, {
                  state,
                });
            }}
          >
            {state === 'open'
              ? 'Open poll'
              : state === 'closed'
                ? 'Close poll'
                : 'Archive poll'}
          </button>
        ))}
        <button
          className="button secondary"
          disabled={poll.settings!.state === 'archived'}
          onClick={() => setEditing(!editing)}
        >
          Edit settings and capacities
        </button>
      </div>
      {editing && (
        <PollForm
          poll={poll}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            act('/snapshot', 'GET', 'Settings saved.');
          }}
        />
      )}
      {poll.settings!.anonymous ? (
        <p>
          Anonymous poll: aggregate results only. Voter identities remain
          private.
        </p>
      ) : (
        <>
          <div className="management-filters">
            <label>
              Search participants
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              Topic
              <select
                value={option}
                onChange={(e) => {
                  setOption(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All topics</option>
                {poll.options.map((label, i) => (
                  <option key={i} value={poll.settings!.optionIds[i]}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="date">Registration date</option>
                <option value="name">Name</option>
              </select>
            </label>
            <label>
              Direction
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="confirmed">Confirmed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          </div>
          {error && <p role="alert">{error}</p>}
          {loading && <p role="status">Loading participants…</p>}
          {!loading && result && (
            <>
              <p>{result.total} matching selections</p>
              <ManagementTable
                rows={result.rows}
                rowKey={(e) => e.sequence}
                columns={[
                  { title: 'Name', cell: (e) => e.name ?? 'Unknown' },
                  { title: 'Email', cell: (e) => e.email ?? 'Unknown' },
                  {
                    title: 'Topic',
                    cell: (e) =>
                      poll.options[
                        poll.settings!.optionIds.indexOf(e.optionId)
                      ],
                  },
                  {
                    title: 'Registered',
                    cell: (e) =>
                      e.createdAt
                        ? new Date(e.createdAt).toLocaleString()
                        : 'Unknown',
                  },
                  { title: 'Status', cell: (e) => e.status },
                  {
                    title: 'Action',
                    cell: (e) =>
                      e.status === 'confirmed' && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Cancel all selections for ${e.name}? Spaces will be released.`,
                              )
                            )
                              act(
                                `/polls/${poll.id}/participants/${encodeURIComponent(e.userId)}`,
                                'DELETE',
                                'Registration cancelled.',
                                { confirm: true },
                              );
                          }}
                        >
                          Remove participant
                        </button>
                      ),
                  },
                ]}
              />
              {!result.rows.length && (
                <p>No participants match these filters.</p>
              )}
              <div className="management-actions">
                <button
                  className="button secondary"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <span>Page {page}</span>
                <button
                  className="button secondary"
                  disabled={page * 20 >= result.total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
