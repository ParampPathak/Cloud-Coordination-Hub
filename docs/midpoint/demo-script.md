# Midpoint demonstration: 8 minutes

**Show the local prototype. Do not describe it as deployed to AWS.** The same flows support a later DynamoDB/ALB/EC2 deployment once prerequisites are satisfied. Current screenshots are actual local test evidence.

## Before presenting

1. Install Node 24 and run `npm ci`, `npm run check`, then `npm run demo:seed` against an empty local database. Record the newly generated temporary password privately; never commit it or put it in slides. For a clean additional demo database, set `SQLITE_PATH=./data/midpoint.sqlite` in the same PowerShell session before seeding and starting.
2. Run `npm run dev`, open `http://localhost:5173`, and sign in as `organizer@example.test`. Open an incognito/separate browser profile for `attendee@example.test`.
3. Create another attendee using the Create an attendee account flow. Public signup cannot create an organizer. These independent browser sessions are needed to demonstrate multiple people.
4. Have [architecture.md](architecture.md), [verification.md](verification.md), and terminal test output ready. No AWS console login is needed now.

## Timed walkthrough

| Time      | Screen/action                                        | What to explain / evidence                                                                                                                                                                                   |
| --------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–0:45 | Login and Overview                                   | Local badge and SQLite label. Metrics are calculated from stored records, not static sample numbers.                                                                                                         |
| 0:45–1:45 | Organizer: Events → Create event                     | Title “Midpoint registration demo”, future time, capacity 1. Form POSTs `/api/events`; organizer identity comes from the session. Show success and resulting card.                                           |
| 1:45–2:30 | Attendee A: Events → Register                        | POST `/api/events/:id/registrations`. Confirmed status appears, capacity is full.                                                                                                                            |
| 2:30–3:15 | Attendee B: refresh → Join waitlist                  | The same endpoint returns a waitlisted registration and position #1. Backend enforces capacity.                                                                                                              |
| 3:15–4:00 | Attendee A: Cancel registration; attendee B: refresh | DELETE `/api/events/:id/registrations/me`. B becomes confirmed. Cancellation and promotion are one version-checked transaction.                                                                              |
| 4:00–4:40 | Organizer: Attendees → Export CSV                    | Refresh attendee modal. Show B confirmed, A removed. Owner-only JSON/CSV endpoints; CSV is a real download.                                                                                                  |
| 4:40–5:40 | Organizer: Polls → Create poll; attendee A votes     | Two distinct options. POST `/api/polls`, then `/api/polls/:id/votes`. Real vote totals/proportions. Repeated votes are rejected by backend.                                                                  |
| 5:40–6:30 | Scheduling → Create time slot → attendee reserves    | POST `/api/slots` and `/api/slots/:id/booking`. Other session sees Reserved and cannot reserve. Cancel to reopen.                                                                                            |
| 6:30–7:15 | Terminal and documentation                           | Show passing meaningful concurrency/security tests, production build, and offline CloudFormation validation. Explain the separate DynamoDB Local integration test and any local tooling limitation honestly. |
| 7:15–8:00 | Architecture and roadmap                             | Prepared ALB/private EC2/DynamoDB endpoint, existing profile, no Cognito, no NAT, ≤9 account instances. Cloud deployment is deliberately pending authorization and external prerequisites.                   |

If showing API requests in browser DevTools, display paths/statuses and record shapes, not session-cookie values or passwords. Demonstrate persistence by stopping and restarting the backend with the same SQLite path, then refreshing. Dashboard background refresh can take up to 15 seconds; use Refresh workspace to keep the presentation moving.

## Evidence to collect later after authorized AWS deployment

Only after deployment: EC2 instance type/profile/private IP; ALB listeners and target group healthy state; public/private subnets, route tables and groups; actual DynamoDB event and session records (redact hashes/tokens); CloudFormation resources; CloudWatch metrics/logs if remote logging was enabled; CloudTrail's configured scope. Request flow should then be Browser → ALB → EC2 → DynamoDB → browser. Until then, show the diagram as **prepared target architecture**, not service-integration proof.

## Failure fallback

If Node development watch tooling fails, use `npm run build`, set `APP_ORIGIN=http://localhost:3000`, then `npm start`, and open port 3000. SQLite is a fully working local fallback when Docker/DynamoDB Local is unavailable. Preserve the working events flow first; screenshots supplement the live demo but do not replace actual results.
