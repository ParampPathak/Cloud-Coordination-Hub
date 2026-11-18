// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  clearPendingInvite,
  inviteUrl,
  parseInvite,
  takeInviteFromLocation,
} from '../frontend/invite';

const code = 'A'.repeat(20) + '_-' + 'z9'.repeat(10) + 'Q';
const origin = 'https://hub.example.test';
afterEach(() => {
  clearPendingInvite();
  window.history.replaceState(null, '', '/');
});

it('builds invitation links that keep the code out of the request path', () => {
  const link = inviteUrl(code, origin);
  expect(link).toBe(origin + '/join#invite=' + code);
  const url = new URL(link);
  expect(url.pathname + url.search).toBe('/join');
});

it('accepts only this site’s invitation links or bare codes', () => {
  expect(code).toHaveLength(43);
  expect(parseInvite(code, origin)).toBe(code);
  expect(parseInvite('  ' + code + '\n', origin)).toBe(code);
  expect(parseInvite(inviteUrl(code, origin), origin)).toBe(code);
  for (const rejected of [
    '',
    'hello world',
    code.slice(1),
    code + 'x',
    code.replace('A', '!'),
    'https://evil.example.test/join#invite=' + code,
    origin + '/dashboard#invite=' + code,
    origin + '/join?invite=' + code,
    origin + '/join#invite=short',
    'javascript:alert(1)',
    'WIFI:S:network;T:WPA;P:secret;;',
  ])
    expect(parseInvite(rejected, origin)).toBeNull();
});

it('reads an invitation link once and clears the code from the address bar', () => {
  window.history.replaceState(null, '', '/join#invite=' + code);
  expect(takeInviteFromLocation()).toBe(code);
  expect(window.location.hash).toBe('');
  expect(window.location.pathname).toBe('/join');
  // A refresh of the join page keeps the pending invitation for this tab.
  expect(takeInviteFromLocation()).toBe(code);
  clearPendingInvite();
  expect(takeInviteFromLocation()).toBeNull();
});

it('ignores malformed invitation links', () => {
  window.history.replaceState(null, '', '/join#invite=not-a-code');
  expect(takeInviteFromLocation()).toBeNull();
});

it('decodes a generated workspace QR into the same confirmed-join invitation', () => {
  const link = inviteUrl(code, origin);
  const qr = QRCode.create(link, { errorCorrectionLevel: 'M' });
  const scale = 8,
    quiet = 4;
  const size = (qr.modules.size + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let row = 0; row < qr.modules.size; row++)
    for (let col = 0; col < qr.modules.size; col++)
      if (qr.modules.get(row, col))
        for (let y = 0; y < scale; y++)
          for (let x = 0; x < scale; x++) {
            const offset =
              (((row + quiet) * scale + y) * size + (col + quiet) * scale + x) *
              4;
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
          }
  const decoded = jsQR(pixels, size, size, { inversionAttempts: 'dontInvert' });
  expect(decoded?.data).toBe(link);
  expect(parseInvite(decoded!.data, origin)).toBe(code);
});
