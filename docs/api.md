# REST API

Same-origin JSON API. All data routes require `hub_session`. Every mutation, including login, registration, and logout, requires an allowed `Origin`. Production requires the exact `APP_ORIGIN`; local development also allows localhost/127.0.0.1/IPv6 loopback on the configured origin port, backend port and Vite port 5173. Missing, arbitrary-port and hostile origins are rejected. `GET /api/health` and `/api/ready` are public. No bearer-token or organizer-ID bypass exists.

| Method | Endpoint                           | Behavior                                                            |
| ------ | ---------------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/health`                      | Process liveness                                                    |
| GET    | `/api/ready`                       | Database readiness, 503 on dependency failure                       |
| POST   | `/api/auth/register`               | `{email,name,password}`; creates attendee only                      |
| POST   | `/api/auth/login`                  | `{email,password}`; HttpOnly session cookie                         |
| GET    | `/api/auth/me`                     | Current public user                                                 |
| POST   | `/api/auth/logout`                 | Revoke current session                                              |
| GET    | `/api/snapshot`                    | Events, poll results, slots, scoped recent activity, database label |
| POST   | `/api/events`                      | Organizer: `{title,description,location,startsAt,capacity}`         |
| PUT    | `/api/events/:id`                  | Owner: same event fields; guarded capacity adjustment               |
| POST   | `/api/events/:id/registrations`    | Current user joins confirmed list or waitlist                       |
| DELETE | `/api/events/:id/registrations/me` | Cancel and atomically promote next eligible user                    |
| GET    | `/api/events/:id/attendees`        | Organizer owner only; joining order and status                      |
| GET    | `/api/events/:id/attendees.csv`    | Owner-only downloadable CSV with formula escaping                   |
| POST   | `/api/polls`                       | Organizer: `{question,options:string[]}`; publish immediately       |
| POST   | `/api/polls/:id/votes`             | `{option:number}`; zero-based option, one vote per user             |
| POST   | `/api/polls/:id/close`             | Organizer owner only                                                |
| POST   | `/api/slots`                       | Organizer: `{title,location,startsAt,endsAt}`                       |
| POST   | `/api/slots/:id/booking`           | Atomically reserve one slot                                         |
| DELETE | `/api/slots/:id/booking`           | Booking user only                                                   |

Dates are ISO-8601 timestamps with an offset, stored as instants. Browser forms convert local datetime input to UTC. Poll results are visible to every signed-in user; votes do not expose individual identities. Event attendee identities require ownership. Slot booking identity is redacted for unrelated users. Resource IDs are UUIDs. Unknown input properties are rejected. There is no event deletion or vote editing in this midpoint scope.

Typical statuses: 200 successful read/update, 201 creation, 400 invalid input, 401 unauthenticated, 403 unauthorized/origin mismatch, 404 unknown resource, 409 duplicate/full/conflict, 413 large body, 429 rate limit, 503 dependency unready. Errors use `{error: string}`; internal exceptions are not returned. `X-Request-Id` ties the response to structured logs.

Example local event creation (after browser login, use the browser UI or a cookie jar):

```json
{
  "title": "Cloud architecture studio",
  "description": "Review networking and deployment designs.",
  "location": "Room 204",
  "startsAt": "2030-10-12T14:00:00-05:00",
  "capacity": 2
}
```

The concrete date above is an API shape example; use an actual future instant for demonstrations. The dashboard refreshes every 15 seconds and after changes; a manual Refresh workspace control is also available. Snapshot queries are independently consistent reads, not a transactionally frozen cross-resource report.

## Stage 1 polling additions

Legacy `{question,options:string[]}` creation, `{option:number}` voting and close routes remain supported. Creation also accepts `mode` (`standard|signup|multiple`), one nullable `capacities` entry per option, `maxSelections`, `allowOrganizerVote`, `allowChanges`, `allowCancellation`, `anonymous`, `resultsVisibility` (`always|after-vote|after-close|organizer`), and initial `state` (`draft|open`). New polls default to anonymous standard voting, organizer voting off, no changes/cancellation, and visible results. Capacity modes require identified participation; signup requires every capacity. Valid capacities are positive integers up to 2,000.

| Method | Route                                        | Behavior                                                                                                      |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| PUT    | `/api/polls/:id`                             | Owner/admin replaces creation settings, retaining lifecycle; unsafe structural edits after participation fail |
| POST   | `/api/polls/:id/selections`                  | `{optionIds:string[]}`; stable IDs, unique selections, maximum and capacity validated atomically              |
| DELETE | `/api/polls/:id/selections/me`               | Cancel own selections when open and policy permits                                                            |
| POST   | `/api/polls/:id/state`                       | Owner/admin `{state: draft                                                                                    | open               | closed                | archived}`; archived polls cannot reopen |
| GET    | `/api/polls/:id/participants`                | Owner/admin identified list; `search,optionId,sort=name                                                       | date,direction=asc | desc,status=confirmed | cancelled,page,pageSize`                 |
| DELETE | `/api/polls/:id/participants/:participantId` | Owner/admin `{confirm:true}` cancels all selected topics for that participant                                 |

Participant responses contain `{rows,total,page,pageSize}` with a default page size of 20 (maximum 100). Anonymous participant reads/removals return 403 even for administrators. Poll views expose settings/stable IDs, caller-only `mySelections`, `canManage`, `resultsVisible`, participant/selection totals and capacity availability. Hidden results have empty counts and zero result totals; capacity usage remains public for capacity signups. Stored votes/entries and unrelated participant identities never appear in snapshot responses. Drafts appear only to owner/admin. Standard vote activity identities are redacted, including legacy activity records. Selection conflict returns 409 without altering the previous registration. Poll CSV/XLSX exports remain Stage 4.

## Final scheduling and grouped events

All endpoints require a database-backed session and mutations require the allowed Origin. Errors retain the existing `{error}` JSON shape. Capacity/version conflicts return 409, forbidden ownership/roles 403, missing resources 404 and invalid input 400.

| Endpoint                                          | Behavior                                                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/schedules/preview`                     | Organizer-only validated UTC interval preview from local `date`, `startTime`, `endTime`, IANA `timeZone`, `durationMinutes`, `capacity`, `weeks`, `bufferMinutes`, `breaks:[{start,end}]`, policies and UUID `requestId`. |
| `POST /api/schedules`                             | Same input plus `title`/`location`; atomically creates up to 64 slots and organizer guard, returns `{slotIds}`. Identical organizer/request ID is idempotent; changed input is rejected.                                  |
| `POST /api/slots/:id/booking`                     | Optional `{reason}` (maximum 1,000 characters). Capacity/overlap/duplicate/lead-time/active-limit checks; returns a private slot view.                                                                                    |
| `POST /api/slots/:id/reschedule`                  | `{slotId,reason?}` moves the caller's booking atomically; failed destination leaves original booking intact.                                                                                                              |
| `DELETE /api/slots/:id/booking`                   | Cancel caller's booking within cancellation policy.                                                                                                                                                                       |
| `DELETE /api/slots/:id/bookings/:participantId`   | Owning organizer cancellation with `{confirm:true}`.                                                                                                                                                                      |
| `PUT /api/slots/:id/block`                        | Owner-only `{blocked:boolean}`; cannot block confirmed appointments.                                                                                                                                                      |
| `GET /api/events/:id/groups`                      | Owner or confirmed registrant sees group names/capacities and member names/IDs.                                                                                                                                           |
| `PUT /api/events/:id/groups/membership`           | `{groupId:UUID                                                                                                                                                                                                            | null,participantId?}`. Student changes self when enabled; owner assigns/moves any confirmed registrant. Null leaves group without cancelling event registration. |
| `GET /api/events/:id/groups.csv`                  | Owner-only escaped CSV membership export.                                                                                                                                                                                 |
| `DELETE /api/events/:id/attendees/:participantId` | Owner-only `{confirm:true}` removal; membership release/FIFO promotion commit together.                                                                                                                                   |

Event creation optionally adds `groupConfiguration:{count,capacity,names?,autoAssign,allowSelfSelection}`; event capacity must equal count × group capacity (maximum 250). Group configuration/capacity is immutable after creation in this release; ordinary event fields remain editable. New regular registration, waitlist and cancellation routes are unchanged. Group transfers close when the event starts. Waitlisted users cannot join a group.

Policies: `bookingLeadMinutes`/`cancelBeforeMinutes` default zero, `maxActiveBookings` defaults 20, `weeks` defaults one (maximum eight), and `capacity` defaults one. Organizer self-booking is rejected. Source-zone DST gaps/folds require another local window. Snapshot slots expose `capacity`, `bookedCount`, blocked/source-zone/policy fields and only the caller's bookings/reasons, or all bookings to the owner. Legacy `booking` remains a compatibility projection. No public snapshot exposes other students' meeting reasons.

## Bounded browsing and summary API (November 13)

Authenticated `GET /api/events`, `/api/polls`, `/api/appointments` and `/api/activities` return `{items,nextCursor,order,examined,queryMs}`. `limit` defaults to 12 and is capped at 50. `cursor` is opaque; pass `nextCursor` unchanged. Query keys are validated. `descending=true` reverses stable resource-ID order; activity IDs are timestamp-plus-UUID, so descending gives newest-first activity. Resource UUID order is deliberately not advertised as global chronological order. Date displays are local/device-zone-aware.

`search` is case-insensitive over title/question/location/description. Events support `filter=all|mine|available|upcoming`; appointments support `mine|available`. Filters and authorization apply to a bounded candidate page, so a page can be empty while its cursor indicates more candidates. Continue until `nextCursor=null`; do not interpret an empty page as the end. This bounds each request instead of looping through sparse DynamoDB results internally. Cursor scope includes user, role, resource kind, search/filter and direction. Permission checks are repeated on every page and no private slot reasons or draft polls are exposed to unauthorized users. IDs do not confer authorization. Cursors are bookmarks, not access tokens or a snapshot-isolation guarantee across concurrent edits/deletions.

`GET /api/summary` reads one materialized aggregate containing total workspace events, confirmed seats, waitlisted seats and published, non-archived active polls. Totals are independent of page size. Draft counts are not exposed. The dashboard labels total events as **Workspace events**, not **Upcoming events**; its upcoming preview is a bounded sample, with full browsing available on Events. Counts from separate requests can reflect different commits while users make changes.

The UI fetches only the active resource page; the overview fetches summary plus bounded event/activity previews; Account does not fetch resources. Previous/Next preserve filters. Appointment destinations can be loaded in additional bounded pages. `GET /api/snapshot` is deprecated and capped at 50 candidates per partition for compatibility. Use the new endpoints to browse the complete dataset; no complete totals should be derived from snapshot arrays.

`Server-Timing: query;dur=...` and page diagnostics expose bounded query work without payloads. `examined` reports candidate records, not total database calls or DynamoDB consumed capacity. Activity queries target the actor/owner partition, rather than other users' global history; candidates can still require up to four targeted ownership/anonymity reads each. Authentication reads are additional.

API client: 15-second read and 30-second mutation timeout, caller cancellation, one delayed retry for network/5xx **GET** failures, no retry of mutations or 4xx responses. HTML, invalid JSON, unexpected MIME and empty 200 responses become safe errors; 204 is accepted. A mutation timeout warns the operation may already have saved. Refresh sequencing and identity checks discard stale results even if cancellation is ignored by transport.
