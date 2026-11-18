// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QrScanner } from '../frontend/QrScanner';

beforeEach(() => {
  // jsdom does not implement the native dialog methods used by Modal.
  for (const name of ['showModal', 'close'])
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = name === 'showModal';
      },
    });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const name of ['showModal', 'close'])
    Reflect.deleteProperty(HTMLDialogElement.prototype, name);
});
function camera(getUserMedia: () => Promise<MediaStream>) {
  vi.stubGlobal(
    'navigator',
    Object.create(navigator, {
      mediaDevices: { value: { getUserMedia }, configurable: true },
    }),
  );
}
it('explains camera denial and keeps manual invitation entry available', async () => {
  camera(
    vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
  );
  const onCode = vi.fn();
  render(<QrScanner onCode={onCode} onClose={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Camera access was not allowed',
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'type the invitation code',
  );
  expect(onCode).not.toHaveBeenCalled();
});
it('stops camera tracks when the scanner is closed', async () => {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  camera(vi.fn().mockResolvedValue(stream));
  const view = render(<QrScanner onCode={vi.fn()} onClose={vi.fn()} />);
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Camera preview') as HTMLVideoElement).srcObject,
    ).toBe(stream),
  );
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});
it('stops a camera that resolves after the scanner has already closed', async () => {
  let resolve!: (stream: MediaStream) => void;
  camera(
    vi.fn().mockReturnValue(
      new Promise<MediaStream>((done) => {
        resolve = done;
      }),
    ),
  );
  const stop = vi.fn();
  const onCode = vi.fn();
  const view = render(<QrScanner onCode={onCode} onClose={vi.fn()} />);
  view.unmount();
  await act(async () =>
    resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream),
  );
  expect(stop).toHaveBeenCalledTimes(1);
  expect(onCode).not.toHaveBeenCalled();
});
