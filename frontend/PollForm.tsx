import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api } from './api';
import type { PollInput, PollView } from '../shared/types';

const MAX_OPTIONS = 8;
type OptionField = { key: number; label: string; capacity: string };

export function PollForm({
  poll,
  onSaved,
  onCancel,
}: {
  poll?: PollView;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const config = poll?.settings;
  const prefix = useId();
  const nextKey = useRef(poll?.options.length ?? 2);
  const [options, setOptions] = useState<OptionField[]>(() =>
    (poll?.options ?? ['', '']).map((label, key) => ({
      key,
      label,
      capacity: String(config?.capacities[key] ?? ''),
    })),
  );
  const [question, setQuestion] = useState(poll?.question ?? '');
  const [mode, setMode] = useState<NonNullable<PollInput['mode']>>(
    config?.mode ?? 'standard',
  );
  const [limited, setLimited] = useState(
    config?.capacities.some((c) => c !== null) ?? false,
  );
  const [maximum, setMaximum] = useState(String(config?.maxSelections ?? 2));
  const [organizer, setOrganizer] = useState(
    config?.allowOrganizerVote ?? false,
  );
  const [changes, setChanges] = useState(config?.allowChanges ?? false);
  const [cancellation, setCancellation] = useState(
    config?.allowCancellation ?? false,
  );
  const [anonymous, setAnonymous] = useState(config?.anonymous ?? true);
  const [visibility, setVisibility] = useState<
    NonNullable<PollInput['resultsVisibility']>
  >(config?.resultsVisibility ?? 'always');
  const [state, setState] = useState<'draft' | 'open'>('open');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const capacityEnabled = mode === 'signup' || (mode === 'multiple' && limited);
  useEffect(() => {
    if (focusKey !== null)
      document.getElementById(`${prefix}-option-${focusKey}`)?.focus();
  }, [focusKey, prefix]);
  function updateOption(
    key: number,
    field: 'label' | 'capacity',
    value: string,
  ) {
    setOptions((rows) =>
      rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
    setErrors({});
  }
  function fieldError(key: string) {
    return errors[key] ? (
      <span
        id={`${prefix}-error-${key}`}
        className="poll-field-error"
        role="alert"
      >
        {errors[key]}
      </span>
    ) : null;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const validation: Record<string, string> = {};
    const labels = options.map((o) => o.label.trim());
    if (!question.trim()) validation.question = 'Enter a question.';
    if (options.length < 2 || options.length > MAX_OPTIONS)
      validation.options = 'Add between 2 and 8 options.';
    options.forEach((option, i) => {
      if (!labels[i])
        validation[`option-${option.key}`] = 'Enter an option name.';
      else if (
        labels.filter(
          (label) => label.toLowerCase() === labels[i].toLowerCase(),
        ).length > 1
      )
        validation[`option-${option.key}`] = 'Option names must be unique.';
      if (
        capacityEnabled &&
        ((mode === 'signup' && !option.capacity) ||
          (option.capacity &&
            (!Number.isInteger(Number(option.capacity)) ||
              Number(option.capacity) < 1 ||
              Number(option.capacity) > 2000)))
      )
        validation[`capacity-${option.key}`] =
          'Enter a whole number from 1 to 2,000.';
    });
    if (
      mode === 'multiple' &&
      (!Number.isInteger(Number(maximum)) ||
        Number(maximum) < 1 ||
        Number(maximum) > options.length)
    )
      validation.maximum =
        'Choose a maximum between 1 and the number of options.';
    setErrors(validation);
    if (Object.keys(validation).length) {
      document
        .getElementById(`${prefix}-${Object.keys(validation)[0]}`)
        ?.focus();
      return;
    }
    const input: PollInput = {
      question: question.trim(),
      options: labels,
      mode,
      capacities: options.map((option) =>
        capacityEnabled && option.capacity ? Number(option.capacity) : null,
      ),
      maxSelections: mode === 'multiple' ? Number(maximum) : 1,
      allowOrganizerVote: organizer,
      allowChanges: changes,
      allowCancellation: cancellation,
      anonymous: capacityEnabled ? false : anonymous,
      resultsVisibility: visibility,
      ...(!poll ? { state } : {}),
    };
    setBusy(true);
    try {
      await api(
        poll ? `/polls/${poll.id}` : '/polls',
        poll ? 'PUT' : 'POST',
        input,
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save poll.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="resource-form poll-form" noValidate>
      <p className="muted poll-form-intro">
        {poll
          ? 'Update your poll settings and topic capacities.'
          : 'Ask a question, add your options, and choose how people participate.'}
      </p>
      <div className="poll-form-section">
        <label htmlFor={`${prefix}-question`}>Question</label>
        <input
          id={`${prefix}-question`}
          required
          maxLength={160}
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setErrors({});
          }}
          aria-invalid={Boolean(errors.question)}
          aria-describedby={
            errors.question ? `${prefix}-error-question` : undefined
          }
          placeholder="What would you like to ask?"
        />
        {fieldError('question')}
      </div>
      <div className="poll-form-section">
        <label htmlFor={`${prefix}-mode`}>Poll type</label>
        <select
          id={`${prefix}-mode`}
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as typeof mode);
            setErrors({});
          }}
        >
          <option value="standard">Standard poll</option>
          <option value="signup">Capacity-limited signup</option>
          <option value="multiple">Multiple choice</option>
        </select>
      </div>
      {mode === 'multiple' && (
        <div className="poll-form-section">
          <label htmlFor={`${prefix}-maximum`}>Maximum choices</label>
          <input
            id={`${prefix}-maximum`}
            type="number"
            min={1}
            max={options.length}
            value={maximum}
            onChange={(e) => {
              setMaximum(e.target.value);
              setErrors({});
            }}
            aria-invalid={Boolean(errors.maximum)}
            aria-describedby={
              errors.maximum ? `${prefix}-error-maximum` : undefined
            }
          />
          {fieldError('maximum')}
          <label className="poll-setting">
            <input
              type="checkbox"
              checked={limited}
              onChange={(e) => setLimited(e.target.checked)}
            />
            <span>Limit each topic's capacity</span>
          </label>
        </div>
      )}
      <section
        className="poll-form-section"
        aria-labelledby={`${prefix}-options-heading`}
      >
        <div className="poll-options-heading">
          <h3 id={`${prefix}-options-heading`}>Options</h3>
          <span className="muted">
            {options.length} / {MAX_OPTIONS}
          </span>
        </div>
        <p className="muted">
          Add at least two distinct options.
          {mode === 'multiple' && limited
            ? ' Leave capacity blank for an unlimited topic.'
            : ''}
        </p>
        <div className="poll-option-fields">
          {options.map((option, i) => (
            <div
              className={`poll-option-row ${capacityEnabled ? 'with-capacity' : ''}`}
              key={option.key}
            >
              <div>
                <label htmlFor={`${prefix}-option-${option.key}`}>
                  Option {i + 1}
                </label>
                <input
                  id={`${prefix}-option-${option.key}`}
                  value={option.label}
                  maxLength={120}
                  required
                  placeholder="Option name"
                  onChange={(e) =>
                    updateOption(option.key, 'label', e.target.value)
                  }
                  aria-invalid={Boolean(errors[`option-${option.key}`])}
                  aria-describedby={
                    errors[`option-${option.key}`]
                      ? `${prefix}-error-option-${option.key}`
                      : undefined
                  }
                />
                {fieldError(`option-${option.key}`)}
              </div>
              {capacityEnabled && (
                <div>
                  <label htmlFor={`${prefix}-capacity-${option.key}`}>
                    Capacity {i + 1}
                  </label>
                  <input
                    id={`${prefix}-capacity-${option.key}`}
                    type="number"
                    min={1}
                    max={2000}
                    required={mode === 'signup'}
                    value={option.capacity}
                    placeholder={mode === 'multiple' ? 'Unlimited' : 'e.g. 8'}
                    onChange={(e) =>
                      updateOption(option.key, 'capacity', e.target.value)
                    }
                    aria-invalid={Boolean(errors[`capacity-${option.key}`])}
                    aria-describedby={
                      errors[`capacity-${option.key}`]
                        ? `${prefix}-error-capacity-${option.key}`
                        : undefined
                    }
                  />
                  {fieldError(`capacity-${option.key}`)}
                </div>
              )}
              <button
                type="button"
                className="button secondary poll-remove-option"
                aria-label={`Remove option ${i + 1}`}
                disabled={options.length <= 2 || busy}
                onClick={() => {
                  setOptions((rows) =>
                    rows.filter((row) => row.key !== option.key),
                  );
                  setErrors({});
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        {fieldError('options')}
        <button
          type="button"
          className="button secondary"
          disabled={options.length >= MAX_OPTIONS || busy}
          onClick={() => {
            const key = nextKey.current++;
            setOptions((rows) => [...rows, { key, label: '', capacity: '' }]);
            setFocusKey(key);
            setErrors({});
          }}
        >
          + Add Option
        </button>
        {poll && (
          <p className="muted">
            After participation, option names, poll type, anonymity and maximum
            choices cannot change.
          </p>
        )}
      </section>
      <details className="poll-advanced" open={Boolean(poll)}>
        <summary>Advanced settings</summary>
        <div className="poll-advanced-body">
          <fieldset className="poll-settings-group">
            <legend>Participation</legend>
            <label className="poll-setting">
              <input
                type="checkbox"
                aria-label="Allow organizer to vote"
                checked={organizer}
                onChange={(e) => setOrganizer(e.target.checked)}
              />
              <span>
                <span className="poll-setting-title">
                  Allow organizer to vote
                </span>
                <small>
                  The creator participates under the same rules as everyone
                  else.
                </small>
              </span>
            </label>
            <label className="poll-setting">
              <input
                type="checkbox"
                aria-label="Allow selection changes"
                checked={changes}
                onChange={(e) => setChanges(e.target.checked)}
              />
              <span>
                <span className="poll-setting-title">
                  Allow selection changes
                </span>
                <small>
                  Participants can switch options while the poll is open.
                </small>
              </span>
            </label>
            <label className="poll-setting">
              <input
                type="checkbox"
                aria-label="Allow cancellation while open"
                checked={cancellation}
                onChange={(e) => setCancellation(e.target.checked)}
              />
              <span>
                <span className="poll-setting-title">
                  Allow cancellation while open
                </span>
                <small>Cancelling a signup releases its reserved places.</small>
              </span>
            </label>
          </fieldset>
          <fieldset className="poll-settings-group">
            <legend>Privacy and results</legend>
            {!capacityEnabled ? (
              <label className="poll-setting">
                <input
                  type="checkbox"
                  aria-label="Anonymous participation (no participant list)"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                />
                <span>
                  <span className="poll-setting-title">
                    Anonymous participation (no participant list)
                  </span>
                  <small>
                    Organizers see aggregate results rather than participant
                    identities.
                  </small>
                </span>
              </label>
            ) : (
              <p className="muted">
                Capacity-limited topics identify participants so organizers can
                manage signups.
              </p>
            )}
            <label htmlFor={`${prefix}-visibility`}>Result visibility</label>
            <select
              id={`${prefix}-visibility`}
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as typeof visibility)
              }
            >
              <option value="always">Always</option>
              <option value="after-vote">After participating</option>
              <option value="after-close">After closing</option>
              <option value="organizer">
                Organizers and administrators only
              </option>
            </select>
          </fieldset>
          {!poll && (
            <fieldset className="poll-settings-group">
              <legend>Publishing</legend>
              <label htmlFor={`${prefix}-state`}>Initial state</label>
              <select
                id={`${prefix}-state`}
                value={state}
                onChange={(e) => setState(e.target.value as typeof state)}
              >
                <option value="open">Publish now</option>
                <option value="draft">Save draft</option>
              </select>
              <p className="muted">
                Drafts are visible only to the owner and administrators.
              </p>
            </fieldset>
          )}
        </div>
      </details>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer className="poll-form-footer">
        {onCancel && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? 'Saving…' : poll ? 'Save settings' : 'Create poll'}
        </button>
      </footer>
    </form>
  );
}
