// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PollCard, PollForm } from '../frontend/Polls';
import type { PollView, User } from '../shared/types';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const user: User = {
  id: 'student',
  name: 'Student',
  email: 's@example.test',
  role: 'user',
};
const poll: PollView = {
  id: 'poll',
  question: 'Choose a topic',
  options: ['Science', 'Art'],
  organizerId: 'owner',
  createdAt: '2026-01-01',
  closed: false,
  counts: [1, 0],
  totalVotes: 1,
  totalSelections: 1,
  myVote: null,
  mySelections: [],
  resultsVisible: true,
  canManage: false,
  availability: [
    { registered: 1, remaining: 0 },
    { registered: 0, remaining: 2 },
  ],
  settings: {
    mode: 'signup',
    optionIds: ['science', 'art'],
    capacities: [1, 2],
    maxSelections: 1,
    allowOrganizerVote: false,
    allowChanges: true,
    allowCancellation: true,
    anonymous: false,
    resultsVisibility: 'always',
    state: 'open',
  },
};
describe('Polling interface', () => {
  it('validates empty and duplicate option names beside their fields without sending a request', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    render(<PollForm onSaved={vi.fn()} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'Topic?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getAllByText('Enter an option name.')).toHaveLength(2);
    expect(screen.getByLabelText('Option 1')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    fireEvent.change(screen.getByLabelText('Option 1'), {
      target: { value: ' Art ' },
    });
    fireEvent.change(screen.getByLabelText('Option 2'), {
      target: { value: 'art' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getAllByText('Option names must be unique.')).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('adds/removes options within the existing two-to-eight option limit', () => {
    render(<PollForm onSaved={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Remove option 1' }),
    ).toBeDisabled();
    for (let i = 0; i < 6; i++)
      fireEvent.click(screen.getByRole('button', { name: '+ Add Option' }));
    expect(screen.getByLabelText('Option 8')).toHaveFocus();
    expect(screen.getByRole('button', { name: '+ Add Option' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove option 4' }));
    expect(screen.queryByLabelText('Option 8')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add Option' })).toBeEnabled();
  });
  it('preserves option-capacity pairs and settings across type changes and removal', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const saved = vi.fn();
    render(<PollForm onSaved={saved} />);
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'Topics?' },
    });
    fireEvent.change(screen.getByLabelText('Poll type'), {
      target: { value: 'signup' },
    });
    fireEvent.change(screen.getByLabelText('Option 1'), {
      target: { value: 'Science' },
    });
    fireEvent.change(screen.getByLabelText('Capacity 1'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByLabelText('Option 2'), {
      target: { value: 'Remove me' },
    });
    fireEvent.change(screen.getByLabelText('Capacity 2'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add Option' }));
    fireEvent.change(screen.getByLabelText('Option 3'), {
      target: { value: 'Art' },
    });
    fireEvent.change(screen.getByLabelText('Capacity 3'), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove option 2' }));
    expect(screen.getByLabelText('Capacity 2')).toHaveValue(7);
    fireEvent.click(screen.getByLabelText('Allow selection changes'));
    fireEvent.change(screen.getByLabelText('Poll type'), {
      target: { value: 'standard' },
    });
    fireEvent.click(
      screen.getByLabelText('Anonymous participation (no participant list)'),
    );
    fireEvent.change(screen.getByLabelText('Poll type'), {
      target: { value: 'signup' },
    });
    expect(screen.getByLabelText('Option 2')).toHaveValue('Art');
    expect(screen.getByLabelText('Capacity 1')).toHaveValue(8);
    expect(screen.getByLabelText('Allow selection changes')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Create poll' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({
      options: ['Science', 'Art'],
      capacities: [8, 7],
      anonymous: false,
      allowChanges: true,
    });
  });
  it('keeps anonymous and publishing settings when changing poll type', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    render(<PollForm onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'When?' },
    });
    fireEvent.change(screen.getByLabelText('Option 1'), {
      target: { value: 'Monday' },
    });
    fireEvent.change(screen.getByLabelText('Option 2'), {
      target: { value: 'Tuesday' },
    });
    fireEvent.click(
      screen.getByLabelText('Anonymous participation (no participant list)'),
    );
    fireEvent.change(screen.getByLabelText('Initial state'), {
      target: { value: 'draft' },
    });
    fireEvent.change(screen.getByLabelText('Result visibility'), {
      target: { value: 'after-close' },
    });
    fireEvent.change(screen.getByLabelText('Poll type'), {
      target: { value: 'signup' },
    });
    fireEvent.change(screen.getByLabelText('Poll type'), {
      target: { value: 'standard' },
    });
    expect(
      screen.getByLabelText('Anonymous participation (no participant list)'),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Create poll' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({
      anonymous: false,
      state: 'draft',
      resultsVisibility: 'after-close',
    });
  });
  it('validates signup capacities and preserves optional unlimited multiple-choice topics', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    render(<PollForm onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'Topic?' },
    });
    fireEvent.change(screen.getByLabelText('Option 1'), {
      target: { value: 'Science' },
    });
    fireEvent.change(screen.getByLabelText('Option 2'), {
      target: { value: 'Art' },
    });
    fireEvent.change(screen.getByLabelText('Poll type'), {
      target: { value: 'signup' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(
      screen.getAllByText('Enter a whole number from 1 to 2,000.'),
    ).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Capacity 1'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByLabelText('Poll type'), {
      target: { value: 'multiple' },
    });
    fireEvent.click(screen.getByLabelText("Limit each topic's capacity"));
    fireEvent.click(screen.getByRole('button', { name: 'Create poll' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({
      mode: 'multiple',
      capacities: [8, null],
      maxSelections: 2,
    });
  });
  it('makes the option card clickable without duplicating capacity statistics', () => {
    render(<PollCard poll={poll} user={user} busy={false} act={vi.fn()} />);
    fireEvent.click(screen.getByText('Art'));
    expect(screen.getByRole('radio', { name: 'Art' })).toBeChecked();
    expect(screen.getByText('Art').closest('label')).toHaveClass('selected');
    expect(screen.getByText('Science').closest('label')).toHaveClass('full');
    expect(screen.queryByText(/% of participants/)).not.toBeInTheDocument();
  });
  it('confirms only saved registrations and lets Cancel dismiss without a request', () => {
    const fetch = vi.spyOn(globalThis, 'fetch'),
      cancel = vi.fn();
    const card = render(
      <PollCard
        poll={{ ...poll, mySelections: ['art'], myVote: 1 }}
        user={user}
        busy={false}
        act={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your registration is confirmed.',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Art');
    card.unmount();
    render(<PollForm onSaved={vi.fn()} onCancel={cancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('disables full topics, shows places and submits the stable option ID', () => {
    const act = vi.fn();
    render(<PollCard poll={poll} user={user} busy={false} act={act} />);
    expect(screen.getByRole('radio', { name: /Science/ })).toBeDisabled();
    expect(screen.getByText(/2 spaces remaining/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Art/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(act).toHaveBeenCalledWith(
      '/polls/poll/selections',
      'POST',
      expect.any(String),
      { optionIds: ['art'] },
    );
  });
  it('prevents owner participation while keeping management available', () => {
    render(
      <PollCard
        poll={{ ...poll, canManage: true }}
        user={{ ...user, id: 'owner', role: 'organizer' }}
        busy={false}
        act={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Register' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Manage poll' })).toBeEnabled();
  });
  it('supports change and cancellation while not rendering hidden results', () => {
    const act = vi.fn();
    render(
      <PollCard
        poll={{
          ...poll,
          resultsVisible: false,
          counts: [],
          mySelections: ['art'],
          myVote: 1,
        }}
        user={user}
        busy={false}
        act={act}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel selection' }));
    expect(act).toHaveBeenCalledWith(
      '/polls/poll/selections/me',
      'DELETE',
      expect.any(String),
    );
    expect(screen.getByText(/Results are hidden/)).toBeInTheDocument();
    expect(screen.queryByText(/% of participants/)).not.toBeInTheDocument();
  });
  it('enforces the multiple-choice maximum in the interface', () => {
    render(
      <PollCard
        poll={{
          ...poll,
          options: ['Science', 'Art', 'Math'],
          counts: [0, 0, 0],
          settings: {
            ...poll.settings!,
            mode: 'multiple',
            maxSelections: 2,
            optionIds: ['science', 'art', 'math'],
            capacities: [null, null, null],
          },
          availability: Array.from({ length: 3 }, () => ({
            registered: 0,
            remaining: null,
          })),
        }}
        user={user}
        busy={false}
        act={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Science/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Art/ }));
    expect(screen.getByRole('button', { name: 'Submit vote' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Math/ }));
    expect(screen.getByRole('button', { name: 'Submit vote' })).toBeDisabled();
  });
  it('creates a simple anonymous poll with organizer voting disabled', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const saved = vi.fn();
    render(<PollForm onSaved={saved} />);
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'When?' },
    });
    fireEvent.change(screen.getByLabelText('Option 1'), {
      target: { value: 'Monday' },
    });
    fireEvent.change(screen.getByLabelText('Option 2'), {
      target: { value: 'Tuesday' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create poll' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({
      mode: 'standard',
      allowOrganizerVote: false,
      anonymous: true,
      maxSelections: 1,
    });
  });
  it('shows anonymous aggregate management without fetching a participant list', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    render(
      <PollCard
        poll={{
          ...poll,
          canManage: true,
          settings: { ...poll.settings!, mode: 'standard', anonymous: true },
        }}
        user={{ ...user, role: 'admin' }}
        busy={false}
        act={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Manage poll' }));
    expect(
      screen.getByText(/Voter identities remain private/),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
