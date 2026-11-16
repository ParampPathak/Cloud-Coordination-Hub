# Classroom guest access — preparation and operation

Implementation enables name-only attendee sessions without fake emails or shared passwords. Permanent account sign-in and registration remain available. Guests cannot become organizers or manage another person's registrations. PostgreSQL stores every guest, session and participation record; independent application nodes use the same records. SQLite remains the local default.

## Runtime configuration

Guest access defaults to off. Set `GUEST_DEMO_ENABLED=true`, `GUEST_SESSION_HOURS=24` (1–168), and `GUEST_DAILY_LIMIT=500` (50–10,000). The Plan B private runtime JSON accepts `guestDemoEnabled`, `guestSessionHours`, and `guestDailyLimit`; the bootstrap validates them and writes the application environment. For initial setup, explicitly run the existing deployment runner's `configured --enable-classroom-demo` stage. This does not update running processes; deploy the reviewed bootstrap and roll/restart both instances for later changes.

Joining accepts only a display name. A cryptographically random UUID distinguishes duplicate names. The cookie contains a random token; storage retains its SHA-256 hash. Cookies are HttpOnly, SameSite=Lax, Secure over production HTTPS, and expire after the configured interval. Exit Demo revokes the session. Expiration/revocation does not remove registrations, bookings, votes, or activity. A guest must retain the same browser cookie to resume; a new join creates a new identity.

Abuse limits: 120 joins per IP per 15 minutes per process, the existing authentication limit, and an atomic shared daily admission counter (default 500). The IP allowance supports 50 students behind classroom NAT. The database cap is shared across instances; it counts joins during the UTC day rather than concurrent active students. Closing guest mode blocks new and existing guest sessions while preserving permanent sign-in and participation data. No paid CAPTCHA or email service is required.

## Dedicated organizer provisioning

Use `node dist/backend/scripts/provision-classroom-organizers.js PRIVATE_JSON` for a dry run; add `--apply` with `ALLOW_ORGANIZER_PROVISION=true` only in the trusted private management environment. Input is `{ "accounts": [three objects containing name, email, password, role: "organizer"] }`; protect the file with mode 0600 on Linux. Never put passwords in shell arguments, Git, documentation or browser screenshots.

The command prechecks all three selected accounts. Existing accounts must have the expected name, organizer role and matching password hash. It creates only missing accounts through the normal scrypt authentication path, refuses conflicts, and never resets other accounts. Existing Alex/demo users and resource ownership are preserved.

## Scoped maintenance cleanup

`node dist/backend/scripts/cleanup-classroom-guests.js PRIVATE_UUID_ARRAY_JSON` is a dry run. Apply requires `--apply`, `ALLOW_GUEST_CLEANUP=true`, and guest mode disabled in the maintenance configuration. Before ordinary class cleanup, close guest access on both app instances and drain in-flight requests. This trusted command has no public HTTP endpoint.

It accepts 1–500 explicit guest UUIDs, rejects permanent user IDs, revokes selected sessions, cancels only selected guests' event registrations through the existing FIFO promotion logic, releases their bookings/group seats, and removes their votes and activity. Organizer events/slots/polls and permanent users remain. Already absent guests are reported without failure, so the same manifest can be retried. The daily admission counter remains to prevent cleanup from bypassing the abuse cap. Archive authorized demonstration/test data before applying cleanup.

## Verification completed locally

- Default suite: 112 tests passed, with opt-in database suites skipped; lint, type checks, production build and original infrastructure validation passed.
- Real isolated PostgreSQL 17 suite: 43 tests passed, one optional test skipped. Includes 50 simultaneous independent classroom guests across two app/store instances, shared sessions, event capacity and FIFO promotion, a contested appointment, nine groups of four, and 50 committed poll votes.
- Organizer provisioning verifies three creations, an unchanged second run, password hashes, conflict refusal and preservation of an existing organizer and owned event.
- Classroom UI tests verify name-only access, attendee routing, Exit Demo, disabled mode and friendly full-appointment messaging. The tests also exposed and fixed an Account-page navigation/loading race.

These are local results, not AWS deployment or AWS performance evidence. See the live verification record for independently observed deployment results.

## Current lab recovery status (2026-11-15)

Fresh STS and resource inventory show that the current Sandbox is a different account from the earlier verified deployment. It has no project EC2, ALB, ASG, RDS, CloudFront distribution or S3 bucket. Preserve the Academy-managed stack. The previous public hostname is unavailable; previous verification documents are historical evidence.

The private final logical backup contains 88 records with schema version 1 and was verified by exact restore into isolated local PostgreSQL. Recovery must target an empty newly initialized database, preserve all record IDs, password hashes and organizer ownership, and finish before provisioning additional accounts. Never restore the archived disposable load-test dataset. Do not treat permission simulations as deployment evidence.

## Manual lab renewal

In this Sandbox, one supported Start Lab click while Ready changed the remaining time from about 1 hour to about 3 hours after Initializing returned to Ready. Before class, start/renew manually, wait for Ready, open AWS through the Academy button and verify STS account and website health. Renew manually before the timer becomes short, allowing setup time; do not use an unattended renewal loop, End Lab or Reset. After any restart, check both ALB targets, database availability, HTTPS health and a real guest session before sharing the QR code. A different STS account requires recovery review, not reuse of old deployment state.
