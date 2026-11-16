import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { WorkspaceView, WorkspaceMember } from '../shared/workspaces';
import { PROJECT_WORKSPACE_ID } from '../shared/workspaces';
import { api } from './api';
import { Modal } from './Modal';

type Details = {
  workspace: WorkspaceView;
  members: WorkspaceMember[];
  invitation: { code: string; enabled: boolean };
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Could not complete the request. Try again.';

export function WorkspaceControls({
  active,
  items,
  userId,
  canCreate,
  onChange,
}: {
  active?: WorkspaceView;
  items: WorkspaceView[];
  userId: string;
  canCreate: boolean;
  onChange: (id?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'join' | 'manage' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<{
    id: string;
    name: string;
    confirmation: string;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const managed = items.filter((w) => w.role !== 'attendee');
  const close = () => {
    if (!busy) {
      setMode(null);
      trigger.current?.focus();
    }
  };
  function open(next: 'join' | 'manage') {
    setExpanded(false);
    setError('');
    setCode('');
    setPreview(null);
    setMode(next);
  }
  async function join(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!preview)
        setPreview(await api('/workspaces/preview', 'POST', { code }));
      else {
        const joined = await api<WorkspaceView>('/workspaces/join', 'POST', {
          code,
          workspaceId: preview.id,
          confirmation: preview.confirmation,
        });
        setMode(null);
        onChange(joined.id);
      }
    } catch (e) {
      setError(message(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  async function leave() {
    if (
      !active ||
      busy ||
      !window.confirm(
        'Leave ' +
          active.name +
          '? You will lose workspace access. Participation history is retained.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api('/workspaces/' + active.id + '/members/me', 'DELETE', {
        confirm: true,
      });
      onChange();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="workspace-control"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && expanded) {
          setExpanded(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setExpanded(false);
      }}
    >
      <button
        ref={trigger}
        className="workspace workspace-trigger"
        onClick={() => {
          setExpanded(!expanded);
          setError('');
        }}
        aria-expanded={expanded}
      >
        <span className="workspace-avatar" aria-hidden="true">
          {active ? active.name.trim().slice(0, 2).toUpperCase() : 'CC'}
        </span>
        <span className="workspace-label">
          <strong>{active?.name ?? 'Choose a workspace'}</strong>
          <span>{active?.category || 'Your workspaces'}</span>
        </span>
        <ChevronDown size={16} />
      </button>
      {error && !mode && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {expanded && (
        <div className="workspace-dropdown">
          <h2>Your workspaces</h2>
          {items.map((w) => (
            <button
              className="workspace-option"
              key={w.id}
              type="button"
              aria-current={w.id === active?.id ? 'true' : undefined}
              onClick={() => {
                setExpanded(false);
                onChange(w.id);
              }}
            >
              <span>
                {w.name}
                {w.status === 'archived' ? ' (archived)' : ''}
              </span>
              {w.id === active?.id && <Check size={16} />}
            </button>
          ))}
          <div className="workspace-menu-actions">
            <button className="button secondary" onClick={() => open('join')}>
              Join Workspace
            </button>
            {(canCreate || managed.length > 0) && (
              <button
                className="button secondary"
                onClick={() => open('manage')}
              >
                Manage Workspaces
              </button>
            )}
            {active && active.role !== 'owner' && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void leave()}
              >
                Leave Workspace
              </button>
            )}
          </div>
        </div>
      )}
      {mode === 'join' && (
        <Modal title="Join Workspace" onClose={close}>
          <form className="resource-form" onSubmit={join}>
            <label>
              Invitation code
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setPreview(null);
                }}
                required
                autoComplete="off"
                maxLength={64}
                readOnly={busy}
              />
            </label>
            {preview && (
              <p role="status">
                Join <strong>{preview.name}</strong>?
              </p>
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
                disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {preview ? 'Join Workspace' : 'Find workspace'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {mode === 'manage' && (
        <WorkspaceManagement
          managed={managed}
          canCreate={canCreate}
          initial={active?.id}
          userId={userId}
          onClose={() => setMode(null)}
          onChange={(id) => {
            setMode(null);
            onChange(id);
          }}
        />
      )}
    </div>
  );
}

function WorkspaceManagement({
  managed,
  canCreate,
  initial,
  userId,
  onClose,
  onChange,
}: {
  managed: WorkspaceView[];
  canCreate: boolean;
  initial?: string;
  userId: string;
  onClose: () => void;
  onChange: (id?: string) => void;
}) {
  const [selected, setSelected] = useState(
    managed.find((w) => w.id === initial)?.id ?? managed[0]?.id ?? '',
  );
  return (
    <Modal
      title="Manage Workspaces"
      className="workspace-modal"
      onClose={onClose}
    >
      <div className="workspace-manage-select">
        {managed.length > 0 && (
          <label>
            Owned and managed workspaces
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {canCreate && <option value="">Create a workspace</option>}
              {managed.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.role}
                </option>
              ))}
            </select>
          </label>
        )}
        {canCreate && selected && (
          <button className="button secondary" onClick={() => setSelected('')}>
            Create Workspace
          </button>
        )}
      </div>
      <WorkspaceSettings
        key={selected}
        id={selected}
        userId={userId}
        onChange={onChange}
      />
    </Modal>
  );
}

function WorkspaceSettings({
  id,
  userId,
  onChange,
}: {
  id: string;
  userId: string;
  onChange: (id?: string) => void;
}) {
  const [details, setDetails] = useState<Details | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(Boolean(id));
  const [confirmName, setConfirmName] = useState('');
  const [attempt, setAttempt] = useState(0);
  const path = '/workspaces/' + id;
  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    void api<Details>(path + '/management', 'GET', undefined, {
      signal: ctrl.signal,
    })
      .then(setDetails)
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [id, path, attempt]);
  async function perform(
    action: () => Promise<void>,
    success = 'Workspace updated.',
  ) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const reload = async () =>
    setDetails(await api<Details>(path + '/management'));
  const update = (change: unknown) =>
    perform(async () => {
      await api(path, 'PATCH', change);
      await reload();
    });
  const fields = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = {
      name: String(data.get('name')),
      description: String(data.get('description')),
      category: String(data.get('category')),
    };
    void perform(async () => {
      const saved = await api<WorkspaceView>(
        id ? path : '/workspaces',
        id ? 'PATCH' : 'POST',
        values,
      );
      onChange(saved.id);
    });
  };
  const owner = details?.workspace.role === 'owner';
  return (
    <>
      {loading && <p role="status">Loading workspace settings…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {id && !loading && !details && (
        <button
          className="button secondary"
          onClick={() => {
            setError('');
            setLoading(true);
            setAttempt(attempt + 1);
          }}
        >
          Try again
        </button>
      )}
      {notice && (
        <p className="alert success" role="status">
          {notice}
        </p>
      )}
      {(!id || owner) && (
        <form className="resource-form" onSubmit={fields}>
          <label>
            Workspace name
            <input
              name="name"
              defaultValue={details?.workspace.name}
              required
              maxLength={80}
            />
          </label>
          <label>
            Description
            <textarea
              name="description"
              defaultValue={details?.workspace.description}
              maxLength={500}
              rows={2}
            />
          </label>
          <label>
            Organization or category
            <input
              name="category"
              defaultValue={details?.workspace.category}
              maxLength={80}
            />
          </label>
          <button className="button primary" disabled={busy}>
            {id ? 'Save workspace details' : 'Create Workspace'}
          </button>
        </form>
      )}
      {details && (
        <>
          <section className="workspace-settings">
            <h3>Invitation code</h3>
            <p className="muted">
              Invitations are{' '}
              {details.invitation.enabled ? 'enabled' : 'disabled'}.
            </p>
            <label className="workspace-code">
              Current invitation code
              <input readOnly value={details.invitation.code} />
            </label>
            <div className="management-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void perform(
                    async () =>
                      navigator.clipboard.writeText(details.invitation.code),
                    'Invitation code copied.',
                  )
                }
              >
                Copy code
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void update({ rotate: true })}
              >
                Regenerate code
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void update({
                    invitationsEnabled: !details.invitation.enabled,
                  })
                }
              >
                {details.invitation.enabled
                  ? 'Disable invitations'
                  : 'Enable invitations'}
              </button>
            </div>
          </section>
          <section className="workspace-settings">
            <h3>Members</h3>
            <ul className="workspace-members">
              {details.members.map((m) => (
                <li key={m.id}>
                  <span>
                    <strong>{m.name}</strong> · {m.role}
                  </span>
                  {owner && m.id !== userId && m.role !== 'owner' && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Remove ' +
                              m.name +
                              ' from this workspace? Their participation history will be retained.',
                          )
                        )
                          void perform(async () => {
                            await api(path + '/members/' + m.id, 'DELETE', {
                              confirm: true,
                            });
                            await reload();
                          }, 'Member removed.');
                      }}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {owner && details.workspace.status === 'active' && (
              <form
                className="resource-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const email = String(
                    new FormData(event.currentTarget).get('email'),
                  );
                  void perform(async () => {
                    await api(path + '/managers', 'POST', { email });
                    await reload();
                  }, 'Organizer added as manager.');
                }}
              >
                <label>
                  Existing organizer email
                  <input name="email" type="email" maxLength={254} required />
                </label>
                <button className="button secondary" disabled={busy}>
                  Add manager
                </button>
              </form>
            )}
          </section>
          {owner && (
            <section className="workspace-settings">
              <h3>Workspace status</h3>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const active = details.workspace.status === 'active';
                    if (
                      active &&
                      !window.confirm(
                        'Archive ' +
                          details.workspace.name +
                          '? Participation will pause.',
                      )
                    )
                      return;
                    await api(path, 'PATCH', {
                      status: active ? 'archived' : 'active',
                    });
                    onChange(id);
                  })
                }
              >
                {details.workspace.status === 'active'
                  ? 'Archive workspace'
                  : 'Restore workspace'}
              </button>
              {details.workspace.status === 'archived' &&
                id !== PROJECT_WORKSPACE_ID && (
                  <form
                    className="resource-form workspace-delete"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (
                        !window.confirm(
                          'Delete ' +
                            details.workspace.name +
                            ' and revoke all workspace access? Historical records will be retained for recovery.',
                        )
                      )
                        return;
                      void perform(async () => {
                        await api(path, 'PATCH', {
                          status: 'deleted',
                          confirmName,
                        });
                        onChange();
                      });
                    }}
                  >
                    <p>
                      This removes the workspace from all member lists and
                      revokes access to its events, polls and appointments.
                      Historical records remain in storage.
                    </p>
                    <label>
                      Type the workspace name to confirm
                      <input
                        value={confirmName}
                        onChange={(event) => setConfirmName(event.target.value)}
                        required
                      />
                    </label>
                    <button
                      className="button danger"
                      disabled={busy || confirmName !== details.workspace.name}
                    >
                      Delete workspace
                    </button>
                  </form>
                )}
            </section>
          )}
        </>
      )}
    </>
  );
}
