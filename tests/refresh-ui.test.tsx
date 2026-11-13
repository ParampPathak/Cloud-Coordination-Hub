// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import App from '../frontend/App';
const account = {
  id: 'first',
  name: 'First Student',
  email: 'first@example.test',
  role: 'user',
};
const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
function setup() {
  const pending: ((response: Response) => void)[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const path = String(url);
    if (path === '/api/health')
      return json({
        database: 'Local SQLite',
        deployment: 'local',
        https: false,
      });
    if (path === '/api/auth/me') return json(account);
    if (path === '/api/auth/logout') return json({ success: true });
    if (path === '/api/auth/login')
      return json({ ...account, id: 'second', name: 'Second Student' });
    if (path.startsWith('/api/polls?'))
      return json({ items: [], nextCursor: null });
    if (path.startsWith('/api/events?'))
      return new Promise((resolve) => pending.push(resolve));
    throw new Error(`Unexpected request: ${path}`);
  });
  render(
    <MemoryRouter initialEntries={['/events']}>
      <App />
    </MemoryRouter>,
  );
  return pending;
}
const page = (title: string) =>
  json({
    items: [
      {
        id: title,
        title,
        description: '',
        location: 'Room',
        startsAt: '2028-01-01T12:00:00Z',
        organizerId: 'owner',
        createdAt: '2026-01-01T00:00:00Z',
        capacity: 5,
        confirmedCount: 0,
        waitlistCount: 0,
        registration: null,
      },
    ],
    nextCursor: null,
  });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('keeps B visible when A completes after the newer manual refresh', async () => {
  const pending = setup();
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  const a = pending.at(-1)!;
  const before = pending.length;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));
  await waitFor(() => expect(pending.length).toBeGreaterThan(before));
  await act(async () => pending.at(-1)!(page('New result B')));
  expect(await screen.findByText('New result B')).toBeInTheDocument();
  await act(async () => a(page('Old result A')));
  expect(screen.queryByText('Old result A')).not.toBeInTheDocument();
  expect(screen.getByText('New result B')).toBeInTheDocument();
});
it('discards pending account data after logout and a second login', async () => {
  const pending = setup();
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  const first = pending.at(-1)!;
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByRole('button', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'second@example.test' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'Password123456' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(pending.length).toBeGreaterThan(1));
  await act(async () => pending.at(-1)!(page('Second account data')));
  await screen.findByText('Second account data');
  await act(async () => first(page('Private first account data')));
  expect(
    screen.queryByText('Private first account data'),
  ).not.toBeInTheDocument();
  expect(screen.getByText('Second account data')).toBeInTheDocument();
});
it('ignores late responses after navigating to another page', async () => {
  const pending = setup();
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  const old = pending.at(-1)!;
  fireEvent.click(screen.getByRole('link', { name: 'Polls' }));
  await screen.findByText('A good decision starts with a question');
  await act(async () => old(page('Late event data')));
  expect(
    screen.getByText('A good decision starts with a question'),
  ).toBeInTheDocument();
  expect(screen.queryByText('Late event data')).not.toBeInTheDocument();
});
