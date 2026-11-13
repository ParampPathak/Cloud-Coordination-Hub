// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../frontend/api';
import { RefreshGate } from '../frontend/refresh';
import { appointmentCalendar } from '../frontend/calendar';
import type { Slot } from '../shared/types';
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
it.each([401, 403, 404, 409, 429, 500, 503])(
  'handles HTTP %s without exposing proxy HTML',
  async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>private stack</html>', { status }),
    );
    await expect(api('/test', 'POST')).rejects.toMatchObject({ status });
    await expect(api('/test', 'POST')).rejects.not.toThrow('private stack');
  },
);
it('handles invalid JSON, unexpected types, empty responses, and 204', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  for (const response of [
    new Response('{bad', { headers: { 'Content-Type': 'application/json' } }),
    new Response('hello'),
    new Response(''),
  ]) {
    fetch.mockResolvedValueOnce(response);
    await expect(
      api('/test', 'GET', undefined, { retries: 0 }),
    ).rejects.toMatchObject({ status: 502 });
  }
  fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
  expect(await api('/test', 'DELETE')).toBeUndefined();
});
it('preserves useful conflict messages', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    json({ error: 'This appointment was just booked by someone else.' }, 409),
  );
  await expect(api('/test', 'POST')).rejects.toThrow('just booked');
});
it('retries safe reads once but never retries mutations', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(json({ ok: true }));
  const pending = api('/test');
  await vi.advanceTimersByTimeAsync(300);
  expect(await pending).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockClear().mockRejectedValue(new TypeError('offline'));
  await expect(api('/test', 'POST')).rejects.toThrow('Connection lost');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('times out stalled requests and supports explicit cancellation', async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
  const stalled = expect(
    api('/test', 'GET', undefined, { timeoutMs: 100, retries: 0 }),
  ).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(100);
  await stalled;
  const controller = new AbortController();
  const cancelled = expect(
    api('/test', 'GET', undefined, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await cancelled;
  expect(vi.getTimerCount()).toBe(0);
});
it('only permits the latest response and invalidates pending results on logout/navigation/unmount', async () => {
  const gate = new RefreshGate();
  let resolveA!: (n: number) => void, resolveB!: (n: number) => void;
  let displayed = 0;
  const a = gate.begin();
  const taskA = new Promise<number>((resolve) => {
    resolveA = resolve;
  }).then((n) => {
    if (a.current()) displayed = n;
  });
  const b = gate.begin();
  const taskB = new Promise<number>((resolve) => {
    resolveB = resolve;
  }).then((n) => {
    if (b.current()) displayed = n;
  });
  resolveB(2);
  await taskB;
  resolveA(1);
  await taskA;
  expect(displayed).toBe(2);
  expect(a.signal.aborted).toBe(true);
  gate.cancel();
  expect(b.current()).toBe(false);
  expect(b.signal.aborted).toBe(true);
});
it('exports UTC appointments with stable UIDs, escaped fields and folded lines', () => {
  const slot = {
    id: 'slot',
    title: 'Office, hours;' + 'é'.repeat(80),
    location: 'Room\n204',
    startsAt: '2027-01-01T10:00:00-06:00',
    endsAt: '2027-01-01T10:15:00-06:00',
  } as Slot;
  const calendar = appointmentCalendar(slot);
  expect(calendar).toContain('DTSTART:20270101T160000Z');
  expect(calendar).toContain('UID:slot@cloud-coordination-hub');
  expect(calendar).toContain('Office\\, hours\\;');
  for (const line of calendar.split('\r\n'))
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  expect(calendar).not.toContain('METHOD:REQUEST');
  expect(calendar.replace(/\r\n /g, '')).toContain(
    'Delete this entry if you cancel or reschedule',
  );
});
