// Invitation links keep the code in the URL fragment, which browsers never
// send to the server, CloudFront or load balancer logs.
export const INVITE_PATH = '/join';
const CODE = /^[A-Za-z0-9_-]{43}$/;
const PENDING = 'cch-pending-invite';

export function inviteUrl(code: string, origin = window.location.origin) {
  return origin + INVITE_PATH + '#invite=' + encodeURIComponent(code);
}

/** Accepts a bare invitation code or an invitation link for this site only. */
export function parseInvite(
  text: string,
  origin = window.location.origin,
): string | null {
  const value = text.trim();
  if (CODE.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== INVITE_PATH) return null;
  const code = new URLSearchParams(url.hash.slice(1)).get('invite');
  return code && CODE.test(code) ? code : null;
}

/** Reads an invitation link once, then removes the code from the address bar. */
export function takeInviteFromLocation(): string | null {
  const here = window.location;
  if (here.pathname === INVITE_PATH) {
    const code = parseInvite(here.href);
    window.history.replaceState(null, '', INVITE_PATH);
    if (code) {
      try {
        sessionStorage.setItem(PENDING, code);
      } catch {
        // Storage can be unavailable; the code still applies to this page.
      }
      return code;
    }
  }
  try {
    return sessionStorage.getItem(PENDING);
  } catch {
    return null;
  }
}

export function clearPendingInvite() {
  try {
    sessionStorage.removeItem(PENDING);
  } catch {
    // Nothing to clear.
  }
}
