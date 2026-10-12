# Cloud Coordination Hub Implementation Plan

Status: Stage 1 approved and implemented. Stages 2-4 remain pending; Stage 2 requires user approval.

This plan covers the complete supplied feature requirements in four stages. Extend the existing application; preserve users, sessions, events, votes, reservations, and working workflows. The original planning task changed only this plan. Stage 1 application changes are now implemented under separate user approval; later stages remain pending.

## Existing implementation and reuse

| Area           | Inspected implementation                                                                                 | Reuse and gaps                                                                                                                                                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend       | `frontend/App.tsx`, `frontend/main.tsx`, `frontend/styles.css`                                           | React 19, TypeScript, React Router, Vite, Tailwind, Lucide icons. Reuse navigation, cards, native dialog, forms, notices, empty/error/loading states, green/neutral palette, typography, and responsive breakpoints. Pages and forms currently share one large App file; extract components incrementally as needed. |
| API client     | `frontend/api.ts`                                                                                        | Reuse authenticated same-origin JSON requests and `ApiError`. Add separate upload/download handling rather than assuming every response is JSON. Snapshot refresh runs every 15 seconds and after actions.                                                                                                           |
| Backend        | `backend/src/app.ts`, `backend/src/service.ts`, `backend/src/server.ts`                                  | Express 5 routes, strict Zod validation, service-layer ownership checks, structured errors, and activity logging. Extend these layers rather than replace them.                                                                                                                                                      |
| Authentication | `backend/src/auth.ts`, `shared/types.ts`, `scripts/create-user.ts`                                       | Scrypt passwords, hashed revocable sessions, HttpOnly cookies, trusted organizer provisioning, and attendee-only public signup. Roles currently are only `user` and `organizer`; no administrator or professor role exists. Treat professors as organizers; add explicitly provisioned administrator authorization.  |
| Persistence    | `backend/src/store.ts`, `backend/src/config.ts`, `docs/database.md`                                      | Node 24 SQLite locally, optional DynamoDB adapter. SQLite has one `records(kind,id,data,version)` table containing JSON aggregates, WAL, and version-conditioned writes inside `BEGIN IMMEDIATE`. DynamoDB uses conditional transactions. There is no migration framework or multi-resource transaction API.         |
| Events         | Event service, event routes, `EventCard`, attendee dialog                                                | Reuse confirmed/waitlisted status, FIFO sequence, atomic cancellation/promotion, duplicate protection, and safe capacity edits. Attendee rows lack email; the narrow dialog shows name/status/queue position. Existing CSV contains only name/status/sequence.                                                       |
| Polls          | Poll service/routes, `PollCard`, shared Poll types                                                       | Options are strings, votes map user IDs to option indexes, one immutable vote per user, publish/close only, results visible to signed-in users. Owners can currently vote. Public projections hide voter identities; preserve that privacy. No registration timestamps exist for legacy votes.                       |
| Office hours   | Slot service/routes, `SlotCard`, shared Slot type                                                        | Manually created UTC intervals with one optional booking. Owners can book their own slots. Same-slot booking is protected, but cross-slot overlaps, recurrence, availability windows, policies, booking reasons, and booking timestamps are absent.                                                                  |
| Verification   | `tests/backend.test.ts`, `tests/frontend.test.tsx`, `tests/dynamodb.test.ts`, `scripts/browser-smoke.ts` | Reuse Vitest, Supertest, Testing Library, independent SQLite connection concurrency tests, database reopen tests, DynamoDB Local integration, and isolated browser smoke workflows. Existing CI runs formatting, lint, types, tests, build/browser checks, and infrastructure validation.                            |

Existing prototype bounds include 2–8 poll options, 2,000 votes, event capacity 250, 500 active event registrations, a 300 KB serialized-record limit, and a 32 KB JSON request limit. Pagination alone does not remove aggregate storage limits. Review limits deliberately; never merely raise them without storage and concurrency validation.

## Shared design and preservation rules

- Keep SQLite fully usable without AWS or Google configuration. Preserve the DynamoDB adapter and existing production safeguards; no cloud deployment is part of these stages.
- Add versioned, repeatable migrations with a migration ledger and pre/post validation. Test upgrades from actual legacy-shaped fixtures and reopen the migrated database. Back up SQLite safely with the backend stopped or a supported online backup; retain original data until verification succeeds. Recovery instructions must restore a backup rather than destructively reverse new registrations.
- Introduce schema-versioned records and compatibility readers. Keep existing routes and payloads working where their meaning remains valid; use additive endpoints and optional fields for advanced features. Security changes such as rejecting owner self-booking intentionally tighten behavior and must be documented.
- Reuse aggregate conditional writes for operations confined to one poll/event. Extend Store with explicit atomic multi-record operations for scheduling, imports, migration batches, and consistency checks; sequential `put` calls are insufficient. SQLite must check invariants and commit all affected records/audit entries in one transaction. DynamoDB needs equivalent version/guard conditions and explicit handling of transaction/item limits.
- Prevent concurrent bookings in different slots using a versioned participant scheduling guard/index updated with the slot and booking in the same transaction. Apply equivalent organizer availability guards to prevent concurrent overlapping schedule creation. Retrying must recheck every invariant.
- Add trusted administrator provisioning and centralized management checks in Stage 1. Owners manage their resources; administrators receive an explicitly documented application-wide scope in the current single-workspace application. Public signup never accepts elevated roles. If workspaces are added later, management and participant identifiers must be scoped to them.
- Keep participant details out of public snapshots, hidden-result responses, activity messages, and unrelated-user booking views. Distinguish anonymous standard voting from identified signup registration; management access never reveals legacy voter identities.
- Reuse a management table with search, filters, sorting, pagination, loading/empty/error states, accessible labels, keyboard support, and mobile layout. Keep basic creation short; reveal advanced settings progressively.

## Stage 1 — Polling improvements and capacity-limited signups

### Data and migration

1. Add stable option IDs, optional per-option capacities, poll mode (standard, signup, multiple choice), selection maximum, vote-change/cancellation rules, result visibility, organizer voting, anonymity, and lifecycle state (draft/open/closed/archived).
2. Model voting and signup entries separately enough to preserve anonymity. Signup entries identify a participant and option, record server registration time and allocation sequence, and track active/cancelled status. Multiple-choice polls may optionally use capacities; each active selected option consumes one place.
3. Migrate legacy string options to stable IDs while preserving order, votes, counts, owners, IDs, and closed state. Legacy polls retain their existing voting/result behavior, including organizer participation; new polls default organizer voting to disabled. Do not invent missing vote timestamps or convert anonymous legacy votes to identified signup records.
4. Keep capacity allocation within a poll aggregate initially where bounded sizes remain safe. Add explicit bounds and indexed access patterns for management; separate registration records only when necessary, with transactional uniqueness and counts rather than unguarded independent writes.

### Backend and authorization

1. Extend create/edit/open/close/archive actions and retain the simple legacy create/vote contract. Reject unsafe edits to option identity, poll mode, anonymity, or selection limits once participation exists. Archive preserves history.
2. Validate unique selected option IDs, maximum selections, lifecycle, organizer participation, change permission, cancellation permission, and each option's remaining capacity on every request.
3. Make initial signup, cancellation, selection changes, and multi-option changes atomic. When any target option is unavailable, leave the entire original selection intact. Cancellation releases capacity; failed requests create no success audit entry. Use committed server timestamps and a deterministic sequence for first-come allocation.
4. Reject reducing capacity below active confirmed selections. An optional later resolution workflow must explicitly cancel or move affected entries with confirmation; automatic displacement is prohibited.
5. Add private management queries for identified signup participants with names, emails, registration times, option filtering, search, and sorting. Authorize owner/admin removal with confirmation and an audit entry. Anonymous polls expose aggregates only, including to administrators.
6. Enforce result visibility on the server, including `/api/snapshot`; preserve owner/admin aggregate management access. Multiple-choice results distinguish participant totals from total selections and label percentage denominators clearly.

### Frontend and affected files

Extend `shared/types.ts`, backend app/service/store/auth layers, and trusted provisioning. Extract poll forms/cards and a shared management table from `frontend/App.tsx` as needed. Add clear poll-type choices, capacities, remaining-space/full indicators, checkboxes for multiple selection, organizer-voting setting, change/cancel actions, and a dedicated management view. Export controls become functional in Stage 4; do not present unfinished controls as working.

### Acceptance and tests

- Standard voting remains simple; new owner voting is rejected by default and allowed only when enabled, under identical participant restrictions.
- Test vote changes, result visibility, anonymous identity protection, draft/open/closed/archive behavior, maximum selections, duplicate selections/signups, full options, cancellation, and safe capacity edits.
- Race requests through independent SQLite connections for the last place, duplicate signup, selection switching, and cancellation/capacity edits. Counts never exceed capacity; a failed switch retains the original place.
- Test owner/admin/unrelated organizer/student permissions and legacy migrations, including preserved organizer votes and counts. Add frontend and browser coverage for basic and advanced workflows.
- Update poll/API/database/security documentation after implementation and pass applicable regression checks before Stage 2.

## Stage 2 — Office-hours scheduling redesign

### Data and scheduling behavior

1. Add availability windows with organizer, local date/time, IANA time zone, duration, optional start increment, per-appointment capacity, buffers, breaks, selected weekdays, weekly recurrence, and a bounded recurrence horizon/end date.
2. Store generated appointment start/end instants in UTC plus the source zone and availability reference. Generate slots idempotently using stable occurrence identifiers. Offer 10, 15, 20, 30, and 60 minute presets without hardcoding the allowable model to those presets.
3. Preview generated appointments before saving. A 2–4 PM window with 15-minute duration and no breaks/buffers produces eight appointments. Exclude breaks and intervals that cannot fit completely; explain leftover time. Distinguish duration, buffer, and start increment; reject unintended overlapping appointments.
4. Handle nonexistent and ambiguous daylight-saving local times explicitly with validation or a user-selected offset, and expand recurrence in the source zone rather than adding fixed UTC weeks. Display the schedule zone and viewer-local zone clearly.
5. Replace the single booking with participant bookings containing identity, reason, status, and timestamps; add separate blocked-time records/state. Configure maximum active appointments per student, booking lead time and closing cutoff, cancellation deadlines, and change permission.
6. Migrate every existing slot and booking without changing its interval. Existing booking timestamps and original time zones are unknown; mark them unknown rather than manufacture values. Flag existing owner self-bookings for explicit review instead of silently deleting or converting them. Preserve existing conflicting bookings while reporting them; enforce new conflict rules for future changes.

### Backend and interfaces

1. Use multi-record transactions and participant guards for capacity, duplicates, overlapping bookings across organizers, active-booking limits, and atomic rescheduling. A failed destination booking leaves the original confirmed appointment unchanged.
2. Reject organizer self-booking on the server. Provide Block Time/unblock actions that do not consume participant capacity. Owners/admins can inspect booked students; unrelated users see availability only.
3. Make schedule edits/blocking preview their effect on confirmed bookings. Reject destructive changes until an explicit cancellation/rescheduling workflow resolves affected bookings. Keep history and audit actions; never silently regenerate away confirmed appointments.
4. Extend scheduling routes while retaining legacy single-slot creation and booking support for compatible student requests. Add availability preview/create/edit, appointment listing, management, blocking, and student upcoming-booking queries.
5. Replace manual-slot-first organizer UX with an availability builder and preview; add student slot selection, booking reason/confirmation, upcoming appointments, and policy-aware cancel/change flows. Reuse existing styles, forms, dialogs, and shared tables.

### Acceptance and tests

Test slot generation, all duration presets/custom validated duration, recurrence/weekday horizon, breaks/buffers, idempotence, capacities, time blocking, owner booking rejection, booking windows, active limits, duplicates, cancellations, atomic rescheduling, and changes affecting confirmed bookings. Include spring/fall daylight-saving cases, cross-zone display, concurrent requests for different overlapping slots and schedule creation, and legacy preservation. Extend SQLite and DynamoDB Local transaction tests and student/professor/admin browser workflows. Update README, API, database, and scheduling instructions before Stage 3.

## Stage 3 — Event attendee management improvements

### Backend and data

1. Preserve existing event registration/FIFO waitlist behavior and capacity safeguards. Add a private attendee projection containing name, email, registration timestamp, status, and queue position where applicable. Resolve existing user IDs through an indexed identity lookup; never expose password hashes or sessions. If a user cannot be resolved, display a missing-data marker rather than invent an email.
2. Add authorized management queries with validated search, confirmed/waitlisted status filters, sort fields/directions, deterministic tie-breaking, pagination, and total counts. Preserve the existing attendee endpoint's response shape for existing consumers; introduce an additive paginated endpoint if needed.
3. Report confirmed attendance, waitlisted total, total registrations, and remaining confirmed capacity distinctly. Counts describe the full event even when the visible table is filtered.
4. Support confirmed removal/cancellation management where shared controls require it, preserving atomic FIFO promotion and recording who acted. Keep cancellation history if statuses are introduced, without counting cancelled rows as active registrations.
5. Add query/index support appropriate to JSON storage and a documented aggregate-size bound. Do not promise unbounded events merely because the UI has pagination. Plan transactional separation of attendee records if measured sizes require it, while retaining existing registrations and sequence order.

### Frontend

Replace the narrow attendee dialog with a dedicated full-width management page or appropriately large dialog. Reuse the Stage 1 table and navigation patterns. Show readable names/emails/timestamps/status badges and attendance/capacity summaries; add search, filters, sortable headers, pagination, mobile cards or accessible horizontal scrolling, and clear empty/error states. Preserve and improve the existing CSV download; Excel and universal export arrive in Stage 4.

### Acceptance and tests

Test owner/admin access and unrelated organizer/student denial, including private emails in responses and exports; pagination boundaries, stable sorting/search/filter counts; legacy identity resolution; capacity edits, duplicate registration, waitlist promotion, and management cancellation races. Check desktop/mobile readability and keyboard navigation with larger synthetic event fixtures. Update attendee documentation before Stage 4.

## Stage 4 — CSV/Excel importing and exporting, optional Google Sheets

### Shared data model and dependencies

1. Add organizer-scoped imported participant records with stable IDs, normalized emails where required, names, provenance, and an optional verified authenticated-user link. Imported email never creates an active account or proves account ownership. Use the current single-workspace/owning-organizer scope; avoid global merging of unrelated organizations.
2. Support safe linking only after proof of email ownership or a separately verified administrative workflow. Because the app has no email-verification or invitation delivery system today, retain unlinked imported participants until that workflow is implemented; do not claim invitation delivery exists.
3. Add import jobs containing actor/time, destination, file metadata, mapping, duplicate policy, preview/version information, outcomes, and audit references. Preserve source registration timestamps when valid; store import time separately. Require a stated time zone for ambiguous source dates.
4. Choose maintained CSV and XLSX parsing/writing libraries after checking current official documentation, Node 24 support, licensing, and security. Add only needed dependencies and upload handling with route-specific limits. No parser or Google packages are installed during planning.

### Import wizard and supported destinations

Implement destination selection, file upload, Excel worksheet selection, column mapping, complete paginated preview, row-level validation, duplicate policy, and explicit confirmation. Support poll options/capacities; identified signup registrations; event attendees/statuses; office-hour availability windows; and existing bookings that reliably resolve to valid slots. Do not import identities into anonymous standard polls or fabricate missing required fields.

- Validate extension, actual contents, size, row/column/cell bounds, encoding, malformed CSV, worksheet structure, and XLSX decompression limits. Reject macros/unsupported formats; do not evaluate formulas or fetch external workbook links.
- Validate emails, participant scope, allowed statuses, option/event/slot relationships, dates/time zones, selection limits, schedule conflicts, booking policies, and capacities with the same backend rules used by interactive actions. Duplicate option labels or ambiguous appointment matches require correction, not guesses.
- Default duplicate handling to reject or skip with explanation. Allow updates only for explicitly supported fields and a reviewed before/after preview; require explicit confirmation. Never silently overwrite reservations, increase capacities, delete data, or displace participants.
- Revalidate destination versions, permissions, and capacity at commit because data may change after preview. Make confirmations idempotent to prevent double imports. A changed preview requires refreshed review when resulting changes differ.
- Commit the entire accepted row set and audit atomically; validation skips occur only under the selected policy and remain visible. On failure roll back all accepted changes. Bound file/import sizes to the supported transaction limits; do not silently split a supposedly atomic import into partial batches. Explain when the user must split a file.
- Return imported/skipped/duplicate/invalid/capacity-conflict/correction counts and a downloadable row-level error report. Distinguish committed totals from validation totals. Protect job previews/reports with destination authorization, retention limits, and safe temporary-file cleanup.

Google Sheets downloaded as CSV/XLSX work through this same wizard. Structured DOCX tables are an optional feasibility item only after reliable spreadsheets; add them only with deterministic table selection/mapping and equivalent validation. Otherwise explain the limitation and provide CSV/Excel conversion guidance. Unstructured Word/Google Docs paragraphs are not registration sources.

### Universal exports

1. Add shared owner/admin-authorized CSV and XLSX generation for poll results/signup participants, event attendees, and office-hour appointments. Preserve existing CSV routes while improving relevant fields.
2. Include resource title, option/topic, participant name/email where authorized and non-anonymous, timestamp/status, capacities/counts/remaining places. Office-hours exports include professor, source zone, date/start/end, student identity, reason only if authorized/needed, and booking status. Mark missing historical fields honestly.
3. XLSX includes summary and detailed participant sheets with capacity/availability data; provide option/session worksheets where useful. Anonymous polls export aggregates only, with no participant identity worksheet.
4. Use quoted UTF-8 CSV compatible with Excel/Sheets, correct escaping/newlines, explicit ISO dates/time-zone labels, safe file/sheet names, and spreadsheet formula-injection defenses in every text cell, including error reports. XLSX text must remain text rather than executable formulas. Test leading whitespace/control-character attacks as well as direct formula prefixes.
5. Define whether exports include all authorized records or current filters and label the action. Build each report from a consistent resource version; authorize again when downloading saved reports.

### Optional direct Google Sheets integration

Investigate only after local CSV/XLSX acceptance. Verify current official Google OAuth, Sheets API, and file-selection documentation; determine whether user-selected files and limited scopes meet read/write needs without broad Drive access. This is a feasibility gate, not a promise that configuration-free direct access will work.

If feasible, add an opt-in connection using server-side OAuth, state protection and PKCE where supported, minimal permissions, spreadsheet/worksheet selection, and the existing preview/validation/confirmation pipeline. Exports require explicit destination selection/authorization. Encrypt stored refresh tokens using a server-held secret, keep credentials out of Git/browser bundles/logs, and support revocation and local token removal. Document Google Cloud project/API setup, consent screen/test-user requirements, client credentials, redirect URIs, and secure local configuration. Without configuration, show an accurate unavailable state with CSV/XLSX alternatives; local operation remains complete. Do not connect to an account or claim integration tested without the required setup.

### Acceptance and tests

Test CSV and XLSX parsing/writing, multi-worksheet selection, mapping, missing fields, invalid emails/dates/relationships, scoped identities, duplicate policies, explicit updates, existing poll/event/bookings, schedule imports, overcapacity, changed destination after preview, unauthorized access, idempotent confirmation, rollback on injected failure, and concurrent import versus interactive registration. Verify every row is accounted for and error reports match outcomes. Round-trip CSV/XLSX with a parser, verify exact details/summaries, and test formula attacks and anonymous export privacy. If Google integration is implemented, test OAuth failure/revocation and unconfigured local mode; report external testing limitations explicitly.

## Validation and stage handoff

For each stage: implement migrations and backend invariants first, then integrate UI, run relevant automated tests, and complete student/organizer/admin workflows. Run `npm run check` and `npm run format:check`; use `npm run test:e2e` for changed user journeys and `npm run test:dynamodb` when local Docker/DynamoDB is available. The browser script writes screenshots, so review those changes deliberately. Report unavailable checks rather than claiming success. Never run tests/migrations against the user's live database; use temporary legacy fixtures and test databases.

Update `README.md`, `docs/api.md`, `docs/database.md`, and `docs/security.md` as relevant in each implementation stage. Each handoff must list completed behavior, important files, dependencies, migrations, run/test commands, evidence, unresolved limits, and required external configuration. Preserve login/logout/signup, events/waitlists, ordinary polls, dashboard refresh, scheduling history, and local startup as regression requirements.

## Approval boundary

Stage 1 was explicitly approved by the user and implemented. Stop after Stage 1 verification and handoff. Wait for explicit user approval before starting Stage 2. Google account connection and cloud deployment remain outside the current authorization.
