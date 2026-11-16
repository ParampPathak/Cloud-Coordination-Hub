// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { OfficeHoursBuilder } from '../frontend/Scheduling';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('locks the schedule inputs during preview and discards a preview on close', async () => {
  let resolvePreview!: (response: Response) => void;
  const preview = new Promise<Response>((resolve) => {
    resolvePreview = resolve;
  });
  const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(preview);
  render(<OfficeHoursBuilder onSaved={vi.fn()} />);
  const open = () =>
    fireEvent.click(
      screen.getByRole('button', { name: 'Create office-hour schedule' }),
    );
  open();
  const location = screen.getByLabelText('Office-hour location');
  const close = screen.getByRole('button', { name: 'Close schedule builder' });
  fireEvent.change(location, { target: { value: 'Room 108' } });
  fireEvent.change(screen.getByLabelText('Office-hour date'), {
    target: { value: '2030-01-01' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview appointments' }));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(location).toBeDisabled();
  expect(close).toBeDisabled();

  resolvePreview(
    new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
  );
  await screen.findByRole('button', { name: 'Save office hours' });
  expect(location).toBeEnabled();
  fireEvent.click(close);
  open();
  expect(
    screen.queryByRole('button', { name: 'Save office hours' }),
  ).toBeNull();
});
