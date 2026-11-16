// @vitest-environment jsdom
import React from 'react';
import { afterEach, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import App from '../frontend/App';
const guest = {
  id: 'guest-id',
  name: 'Class Student',
  role: 'user',
  guest: true,
  sessionExpiresAt: Math.floor(Date.now() / 1000) + 86400,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
function mount(enabled = true) {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url, options) => {
      const path = String(url);
      if (path === '/api/health')
        return json({
          database: 'PostgreSQL',
          deployment: 'aws-multi',
          https: true,
          guestDemoEnabled: enabled,
          guestSessionHours: 24,
        });
      if (path === '/api/auth/me') return json({ error: 'Sign in' }, 401);
      if (path === '/api/auth/guest') return json(guest, 201);
      if (path === '/api/auth/logout') return json({ success: true });
      if (path === '/api/summary')
        return json({ events: 0, confirmed: 0, waitlisted: 0, activePolls: 0 });
      if (path.startsWith('/api/appointments?'))
        return json({
          items: [0, 1].map((i) => ({
            id: 'slot-' + i,
            title: 'Office hours',
            organizerId: 'owner',
            location: 'Room 108',
            startsAt: `2030-11-19T2${i}:00:00Z`,
            endsAt: `2030-11-19T2${i}:15:00Z`,
            createdAt: '2026-01-01T00:00:00Z',
            capacity: 1,
            bookedCount: 1,
            booking: { userId: 'another', name: 'Another student' },
          })),
          nextCursor: null,
        });
      if (
        ['/api/events?', '/api/activities?', '/api/polls?'].some((prefix) =>
          path.startsWith(prefix),
        )
      )
        return json({ items: [], nextCursor: null });
      throw new Error(`Unexpected ${options?.method ?? 'GET'} ${path}`);
    });
  render(
    <MemoryRouter initialEntries={['/polls']}>
      <App />
    </MemoryRouter>,
  );
  return fetcher;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('offers classroom join with only a display name, redirects to the attendee dashboard, and supports exit', async () => {
  const fetcher = mount();
  const join = await screen.findByRole('button', {
    name: 'Join Classroom Demo',
  });
  await waitFor(() => expect(join).toBeEnabled());
  fireEvent.click(join);
  expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'Class Student' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Enter classroom' }));
  await screen.findByRole('heading', { name: 'Hello, Class.' });
  expect(
    screen.queryByRole('button', { name: 'Create event' }),
  ).not.toBeInTheDocument();
  const call = fetcher.mock.calls.find(([url]) => url === '/api/auth/guest')!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({ name: 'Class Student' });
  fireEvent.click(screen.getByRole('link', { name: 'Account' }));
  await screen.findByText('Classroom guest · temporary attendee');
  fireEvent.click(
    within(screen.getByRole('main')).getByRole('button', { name: 'Exit Demo' }),
  );
  await screen.findByRole('heading', { name: 'Welcome back' });
});
it('clearly disables classroom joining when the server has closed guest mode', async () => {
  mount(false);
  const join = await screen.findByRole('button', {
    name: 'Join Classroom Demo',
  });
  expect(join).toBeDisabled();
  expect(
    await screen.findByText('Classroom demo access is currently closed.'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Email address')).toBeInTheDocument();
});
it('shows a clear full-appointments message when every loaded appointment is booked', async () => {
  mount();
  const join = await screen.findByRole('button', {
    name: 'Join Classroom Demo',
  });
  await waitFor(() => expect(join).toBeEnabled());
  fireEvent.click(join);
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'Class Student' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Enter classroom' }));
  await screen.findByRole('heading', { name: 'Hello, Class.' });
  fireEvent.click(screen.getByRole('link', { name: 'Scheduling' }));
  expect(
    await screen.findByText(
      'All appointments are currently booked. Check back for cancellations.',
    ),
  ).toBeInTheDocument();
});
