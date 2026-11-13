# Optimization and reliability verification — November 13, 2026

## Result and scope

The five confirmed problems were addressed: bounded active-page loading with exact transactional summary counters; stale-response protection; explicit deployment metadata; network/timeouts/cancellation handling; and periodic, indexed, bounded SQLite session cleanup. Event, poll, scheduling and group transaction invariants, authentication and ownership checks remain in place. This is locally verified classroom readiness, **not verified AWS production readiness**.

Started from clean `main` at `2733fd9`; fetched origin and confirmed it matched and that the remote had only `main`. Existing history was preserved. No branch was created, no reset/force-push was used, no academic poster or PowerPoint was edited, no real user database was migrated, and no billable resource was created.

## Implementation

- `Store.page` uses SQLite keyset predicates/ORDER BY/LIMIT on the primary index, or one strongly consistent DynamoDB partition Query with Limit and a continuation key. Every HTTP candidate page is bounded, including the now-deprecated snapshot compatibility route. API resource pages include a user/filter/sort-bound cursor. The server projects authorized views and redacts anonymous activity on every request.
- The overview reads one materialized summary plus bounded upcoming-event and user-scoped activity previews. Event/poll counters commit with their canonical writes; activity fanout commits to actor/owner partitions in that same transaction. Counts do not depend on the visible page. The event metric deliberately means **all workspace events**; published, non-archived polls are counted separately from drafts. No private rows are downloaded just to compute counts.
- Active Events/Polls/Scheduling fetch their own page; Account fetches no resources. Previous/Next retains filters. Page controls cannot reuse an old cursor while a refresh is pending. Appointment rescheduling can fetch more destinations in bounded pages, including outside the displayed page.
- AbortController plus monotonic sequencing prevents delayed A from replacing newer B. UI tests exercise delayed transport that ignores cancellation, navigation, logout and a different-account login. Mutation callbacks use the current view and identity; navigation does not cancel committed writes. Background errors are separate from action errors. Polling pauses in hidden tabs, refreshes on return, and backs off to 120 seconds after repeated failures.
- Shared API client validates content type/JSON, handles empty/204 responses, friendly 401/403/404/409/429/5xx messages, proxy HTML, lost connections, timeouts and explicit cancellation. Reads time out after 15 seconds and may retry once after a delay; mutations time out after 30 seconds and are never automatically retried. Unknown mutation outcomes explicitly require a refresh before another submission.
- Validated `DEPLOYMENT_MODE=local|ec2|aws-multi` is separate from database type. CloudFormation and EC2 env examples set the appropriate mode. Multi-instance AWS rejects SQLite and DynamoDB Local. HTTPS copy follows configured origin, not assumptions about hosting.
- SQLite uses an expiry expression index and at most 500 expired-session deletions per maintenance batch. One process-local worker starts at server startup, repeats at configurable intervals (default 900 seconds), catches transient maintenance failure and is stopped on close. Authentication still rejects expiry immediately. DynamoDB TTL remains configured. Tests verify abandoned expiry removal, active-session preservation, bounded backlog draining and worker cleanup.
- Campus shared-IP auth allowance is 400 mutations/15 minutes/process, with 20 failed attempts/account/15 minutes/process; user-based API quotas remain intact. Scrypt, HttpOnly/SameSite/HTTPS cookies, server sessions, origin validation and all booking/group/poll conditions were preserved.
- Optional `.ics` downloads have UTC dates, stable resource UID, escaped/folded UTF-8 fields, and clear cancellation/rescheduling instructions. They omit private meeting reasons. They are snapshots, not email delivery, automated calendar updates or reminders.

## Automated and browser checks

[Machine-readable checks](evidence/optimization-checks.json): **98 regular tests passed; 5 DynamoDB-specific cases skipped in that command.** The separately selected DynamoDB Local suite passed **25 tests**, including shared scenarios; do not sum these as distinct tests. Formatting, ESLint, TypeScript, frontend/backend builds, infrastructure guards and cfn-lint on both templates passed. Existing installed-Edge event/waitlist/promotion, polling/admin, scheduling, groups/CSV, responsive/mobile, account/logout and production-restart/session workflows passed without browser runtime errors.

New regressions cover 120-record bounded traversal without `list`, draft/activity privacy, scoped cursors, counter rollback and concurrent-client consistency, recent relevant activity despite unrelated traffic, stale UI races, every requested network failure class, deployment modes, cleanup batching/lifecycle, calendar encoding, and stopped-writer legacy DynamoDB summary/activity migration with preview/refusal/idempotency/canonical-version preservation.

## Local 50-user measurements

All rows below use 50 concurrent authenticated fixtures, two independent backend processes sharing one isolated database, and a local health-checking test proxy. The final runs verified event 10-confirmed/40-waitlisted, nine groups of four with 36 confirmed, eight single-winner appointments, 50 votes, atomic failed moves and FIFO cancellation/promotion. New loads also assert summary totals (2 events, 46 confirmed seats, 54 waitlisted seats, 1 active poll) at round barriers. Every row had **zero unexpected failures, zero duplicate bookings and zero overcapacity**. Expected conflicts are recorded in each raw source. Failure/replacement checks had 50/50 successful probes and preserved the session and confirmed registration.

| Source                                                                             | Rounds | Requests | Duration s | API p50 ms | API p95 ms | API p99 ms |  Max ms | Peak worker MiB | Peak worker CPU % |
| ---------------------------------------------------------------------------------- | -----: | -------: | ---------: | ---------: | ---------: | ---------: | ------: | --------------: | ----------------: |
| [SQLite baseline](evidence/optimization-load-sqlite-legacy.json)                   |     12 |    6,249 |      70.58 |      51.71 |     184.25 |     242.47 |  353.86 |          235.04 |            106.50 |
| [SQLite paginated](evidence/optimization-load-sqlite-paginated.json)               |     12 |   10,395 |      71.14 |      18.62 |     151.30 |     262.37 | 1412.44 |          216.10 |            138.74 |
| [DynamoDB Local baseline](evidence/optimization-load-dynamodb-legacy.json)         |     12 |    6,249 |      84.53 |      78.88 |     436.43 |     727.40 |  952.37 |          307.80 |            175.51 |
| [DynamoDB Local paginated](evidence/optimization-load-dynamodb-paginated.json)     |     12 |   10,395 |      76.49 |      20.24 |     241.75 |     385.37 |  636.62 |          262.91 |            212.08 |
| [DynamoDB Local extended](evidence/optimization-load-dynamodb-paginated-soak.json) |     30 |   25,683 |     206.30 |      21.78 |     350.85 |     650.64 | 1305.10 |          281.23 |            196.68 |

Baseline rows were measured before capping the old all-record snapshot and adding scoped activity. The new workload retains the same core capacity fixtures and 12 rounds/five-second pauses, but adds separate page/summary reads, periodic activity refreshes, failed-reschedule checks and logout (10,395 versus 6,249 requests). These are repeatable comparative workloads, not a controlled one-variable experiment. p95 and sampled memory improved in these runs; peak CPU did not uniformly improve. Do not claim every request was faster: SQLite and extended DynamoDB maximum latency exceeded one second, while the stated **p95 below one second** target passed. The longer 30-round run is over three minutes, not an hours-long soak test.

Host: Windows desktop, Node 24.21.0, 24 logical CPUs, about 31.14 GiB RAM; local DynamoDB reported **1.25.1**. The official AWS download archive hash is recorded above for reproducibility, not as an independently verified publisher signature. Historical November 9 results used a different runtime/hardware/database version and remain historical. CPU 100% means one logical core. Memory/CPU samples measure application workers, not the JVM or whole machine. These results say nothing conclusive about t3.micro memory, credits, AWS network latency, quotas or managed service availability.

Page diagnostics record candidate rows and query duration; they **exclude** authentication reads, additional ownership/anonymity gets and SDK retries. They are not total DynamoDB read capacity. Each raw report labels that limitation. No total-RCU or database-consumed-capacity claim is made.

## Large-dataset dashboard comparison

[Raw query benchmark](evidence/optimization-query-benchmark.json), isolated in-memory SQLite, 30 samples per mode and 100/1,000 synthetic events plus audit records. The old all-record path exists only in the benchmark; live compatibility snapshots are now capped.

At 1,000 events, response size fell from **307,966 bytes to 4,097 bytes** (98.67% smaller). Base entity rows fetched fell from **2,000 to 13**, plus one summary read and any targeted lookups for actual relevant activity. Service-level p95 was **4.124 ms versus 0.080 ms**. This is an in-process benchmark, not HTTP or AWS latency; fewer preview records are intentional, and full browsing is available through cursors.

## Migration, remaining limits and operations

Before upgrading a populated DynamoDB table, stop **all** writers, back up storage, preview `npx tsx scripts/rebuild-summary.ts`, then use `ALLOW_SUMMARY_REBUILD=true` plus `--apply` after independently confirming the maintenance window. The command backfills scoped activity and summary counters without altering canonical versions. An unmigrated populated table fails readiness. Also rebuild after importing a pre-update backup that lacks scoped activity. Do not mix old and new writers or directly modify records outside Store. SQLite bootstraps its summary and legacy activity index once. Runtime/session maintenance did not touch the repository's real database in this verification.

Pagination is genuinely bounded on both adapters, but intentionally uses stable **UUID order**, not a global chronological index. Search/visibility filters apply to bounded candidates, so sparse pages can be empty with a valid next cursor. The upcoming preview is a sample, not a guarantee of the nearest upcoming events. A future time/user-specific index would make sparse filtering and chronological browsing more efficient. The entire workspace is still one tenancy, not tenant-isolated. The global summary record adds a transaction contention point; successful 50-user tests do not establish unlimited scale. Legacy scheduling guards can still bootstrap old records by reading the slot partition. Legacy snapshot clients must migrate to paginated endpoints to browse more than 50 resources.

Rate limits are process-local, not distributed quotas. Backlogs larger than 500 expired sessions drain over successive maintenance intervals. Calendar cancellation/rescheduling requires deleting the old local entry; no provider-backed email reminders, verified email recovery or automatic calendar synchronization is implemented because no delivery provider is configured. These are documented future features, not functioning buttons.

## AWS architecture, evidence and publication

Retained two-AZ public HTTPS ALB, private EC2 ASG 2/2/3, shared retained/PITR/TTL DynamoDB, gateway endpoint, health checks, scaling and optional private Logs/SSM access. Added only table-scoped UpdateItem permission, explicit deployment mode and page/timeout log metric filters/widgets. No extra service was introduced. Real IAM, budget, quotas, ACM/domain, image bootstrap, healthy targets, CloudWatch delivery and live failover still require a current authorized Sandbox and cost review. No AWS CLI/current verified Sandbox access was available; no AWS deployment or HA performance is claimed.

Updated editable [architecture.svg](architecture.svg) and a 3840×2550 [architecture.png](architecture.png), retaining the “Implemented CloudFormation target — AWS deployment not yet verified” label. Academic poster and slides remain untouched. [Poster update notes](poster-update-notes.md) identify verified changes and remaining work. GitHub Actions for the final pushed commit is checked after publication; see the final delivery message for its run URL/result and commit SHA.

## Changed files

- `.env.example`
- `README.md`
- `backend/src/app.ts`
- `backend/src/config.ts`
- `backend/src/pages.ts`
- `backend/src/read-model.ts`
- `backend/src/server.ts`
- `backend/src/service.ts`
- `backend/src/store.ts`
- `deployment/ec2.env.example`
- `docs/FINAL_DEPLOYMENT.md`
- `docs/api.md`
- `docs/architecture.png`
- `docs/architecture.svg`
- `docs/database.md`
- `docs/evidence/optimization-checks.json`
- `docs/evidence/optimization-load-dynamodb-legacy.json`
- `docs/evidence/optimization-load-dynamodb-paginated-soak.json`
- `docs/evidence/optimization-load-dynamodb-paginated.json`
- `docs/evidence/optimization-load-sqlite-legacy.json`
- `docs/evidence/optimization-load-sqlite-paginated.json`
- `docs/evidence/optimization-query-benchmark.json`
- `docs/optimization-verification.md`
- `docs/poster-update-notes.md`
- `docs/screenshots/local-dashboard.png`
- `docs/screenshots/local-mobile-events.png`
- `docs/security.md`
- `frontend/App.tsx`
- `frontend/Scheduling.tsx`
- `frontend/api.ts`
- `frontend/calendar.ts`
- `frontend/refresh.ts`
- `infrastructure/hub.yaml`
- `infrastructure/required-existing-role-policy.json`
- `scripts/load-test.ts`
- `scripts/query-benchmark.ts`
- `scripts/rebuild-summary.ts`
- `scripts/render-architecture.mjs`
- `tests/api-client.test.tsx`
- `tests/dynamodb.test.ts`
- `tests/migration.test.ts`
- `tests/polls-frontend.test.tsx`
- `tests/refresh-ui.test.tsx`
- `tests/reliability.test.ts`
- `docs/final-verification.md`
- `backend/tsconfig.json`
