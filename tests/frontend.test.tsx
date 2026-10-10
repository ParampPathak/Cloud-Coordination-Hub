// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { EventCard } from '../frontend/App';
import type { EventView, User } from '../shared/types';
afterEach(cleanup);
const user: User = {
  id: 'attendee',
  name: 'Jordan',
  email: 'jordan@example.test',
  role: 'user',
};
const event: EventView = {
  id: 'event',
  title: 'Workshop',
  description: 'A test event',
  location: 'Room 204',
  startsAt: new Date(Date.now() + 86400_000).toISOString(),
  capacity: 1,
  organizerId: 'organizer',
  createdAt: new Date().toISOString(),
  confirmedCount: 1,
  waitlistCount: 0,
  registration: null,
};
describe('Event interface', () => {
  it('offers a waitlist action when capacity is full', () => {
    const act = vi.fn();
    render(
      <EventCard
        event={event}
        user={user}
        busy={false}
        act={act}
        edit={vi.fn()}
        attendees={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Join waitlist/ }));
    expect(act).toHaveBeenCalledWith(
      '/events/event/registrations',
      'POST',
      expect.stringContaining('waitlist'),
    );
    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
  });
  it('shows waitlist position and cancellation action', () => {
    const act = vi.fn();
    render(
      <EventCard
        event={{
          ...event,
          waitlistCount: 2,
          registration: {
            userId: user.id,
            name: user.name,
            status: 'waitlisted',
            sequence: 3,
            createdAt: event.createdAt,
            position: 2,
          },
        }}
        user={user}
        busy={false}
        act={act}
        edit={vi.fn()}
        attendees={vi.fn()}
      />,
    );
    expect(screen.getByText('Waitlist #2')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel registration' }),
    );
    expect(act).toHaveBeenCalledWith(
      '/events/event/registrations/me',
      'DELETE',
      expect.any(String),
    );
  });
  it('disables registration for past events', () => {
    render(
      <EventCard
        event={{ ...event, startsAt: '2020-01-01T00:00:00Z' }}
        user={user}
        busy={false}
        act={vi.fn()}
        edit={vi.fn()}
        attendees={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Registration closed' }),
    ).toBeDisabled();
  });
});
