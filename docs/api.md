# REST API

Same-origin JSON API. All data routes require `hub_session`. Every mutation, including login, registration, and logout, requires `Origin` exactly matching `APP_ORIGIN`. `GET /api/health` and `/api/ready` are public. No bearer-token or organizer-ID bypass exists.

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
