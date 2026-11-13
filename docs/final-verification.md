# Final verification — November 9, 2026

These are observed local results, not a claim of AWS deployment. See [deployment/recovery](FINAL_DEPLOYMENT.md) for live prerequisites and [architecture](architecture.png) for the implemented, undeployed target.

## Consolidation and application

Fetched both original remote branches. Main's polling commit `f5f7b7a` and deployment commits `e8cbab8`/`52116ba` share ancestor `25dcd02`. A non-fast-forward merge preserved both histories without conflicts (`d591b33`). The merged baseline passed 57 automated tests and all existing installed-Edge browser flows. No reset or force-push was used.

New verification covers schedule generation/durations/breaks/buffers/weekly DST expansion and rejection of DST gaps/folds, idempotency, concurrent organizer windows, appointment last-place/duplicate/overlap races, atomic failed/successful rescheduling, privacy, blocking/authorization, preserved legacy bookings, group capacity/transfers/cancellation/FIFO promotion, rollback after a failed transaction condition, cross-application sessions, and non-destructive SQLite-to-DynamoDB migration.

Final regular suite: **69 passed, 3 explicit DynamoDB cases skipped**. Selected DynamoDB Local suite: **23 passed** (including the shared scenarios on SQLite and DynamoDB). Formatting, ESLint, TypeScript, frontend/backend builds, infrastructure guards, production restart smoke, shell/PowerShell syntax checks and the extended browser suite passed. Both CloudFormation templates passed cfn-lint 1.57.2. Production dependency audit reported zero vulnerabilities; moderate development-tool findings are documented in security.md. DynamoDB integration used AWS's checksum-verified **DynamoDB Local 3.3.1**, Java 21 and independent SDK clients; no AWS credentials or account calls. Temporary test tables were removed. Regular tests skip explicit DynamoDB cases until selected.

Installed-Edge browser workflows passed event/waitlist/promotion, existing polling/admin workflows, appointment creation/booking/cancellation, eight-slot professor preview/create, private meeting reason, nine groups of four, automatic/student/owner transfers, attendee/group CSV downloads, mobile horizontal-overflow checks, account/logout and no browser runtime errors. Screenshots were captured from actual isolated test data.

## Real 50-user HTTP load results

Commands: `npm run test:load` and `npm run test:load:dynamodb` (set `DYNAMODB_ENDPOINT` to a running local server). Built-in Node HTTP runner; 50 concurrent users, 12 rounds, five-second pauses, two independent application processes and a health-checking round-robin **test proxy**. SQLite used separate connections to one temporary file; DynamoDB used one disposable shared local table. Each round checks database invariants before cancellation. Accounts are isolated fixtures; passwords are verified through HTTP login. No production test target is accepted.

| Measurement                                            |     SQLite | DynamoDB Local 3.3.1 |
| ------------------------------------------------------ | ---------: | -------------------: |
| Concurrent users                                       |         50 |                   50 |
| Workload duration                                      |    66.72 s |              82.32 s |
| HTTP requests, including local failure probes          |      6,249 |                6,249 |
| Expected capacity/duplicate/group conflicts (409)      |        917 |                  929 |
| Unexpected failures                                    |          0 |                    0 |
| Success excluding expected conflicts                   |       100% |                 100% |
| API p50                                                |   32.88 ms |             80.02 ms |
| API p95                                                |  105.41 ms |            401.66 ms |
| Login p95                                              |  259.21 ms |            202.33 ms |
| Peak sampled application-process RSS                   | 239.30 MiB |           308.64 MiB |
| Peak sampled application-process CPU (100% = one core) |    122.51% |              165.76% |
| Resource samples                                       |        134 |                  168 |
| Duplicate bookings / overcapacity                      |      0 / 0 |                0 / 0 |

At every round barrier: event held 10 confirmed/40 waitlisted registrations, grouped event held 36 confirmed across nine capacity-four groups, all eight appointments had exactly one booking, and all 50 votes were present. Failed group transfers preserved capacity; cancellation/promotion remained consistent. Both processes received requests and persisted sessions worked across them. Raw results and samples: [SQLite](evidence/load-sqlite.json), [DynamoDB Local](evidence/load-dynamodb.json).

Limitations: Windows desktop, Node 24.19.0, 32 logical CPUs, 31.10 GiB host RAM; both load runs overlapped with other local verification. RSS/CPU samples cover application processes, not total host/database usage. The local DynamoDB JVM shares the desktop; managed AWS network/throughput/cost behavior differs. These are a one-minute classroom workload and contention tests, not a long-running soak test. They do **not** prove t3.micro CPU credits/memory adequacy, distributed rate-limit enforcement, HTTPS latency, or AWS quotas. A smaller GitHub runner exposed retry exhaustion during a 50-cancellation burst; a bounded per-resource process queue now reduces conflict storms while retaining database conditions. The regression passes locally. Popular aggregates serialize writes, and snapshots query growing partitions; pagination/indexing remains the next scale improvement. t3.micro remains an initial deployment candidate pending live measurement.

## Local controlled failure

After preserving a confirmed record and logged-in sessions, the runner killed one application process, sent 50 authenticated snapshot probes, started a replacement, and verified the existing session and database record through the proxy. SQLite: **50/50 successful probes**, 2.23-second probe window. DynamoDB Local: **50/50**, 4.68-second probe window. No failed probe was observed. The replacement was started by the test harness; this is **not an AWS Auto Scaling replacement** or an ALB failover measurement. No live zero-downtime claim is made.

## Infrastructure, security and operational limits

Offline template guards and `cfn-lint 1.57.2` schema validation passed for both HA and retained single-EC2 templates. The HA code defines two public/two private subnets, routes/security groups, HTTPS/redirect ALB/readiness targets, IMDSv2/offline-image launch template, two-instance ASG/CPU-request policies, shared retained/PITR table/gateway endpoint, optional SSM/Logs endpoints, seven dashboard widgets, six alarms and application/memory metric filters. This validates code, not account permissions, connectivity, real replacement, DNS or certificates.

Existing scrypt/hashed revocable sessions, exact-origin mutation checks, secure production cookies, strict Zod schemas, role/owner checks, CSV escaping and generic errors were retained. Booking reasons/other participants' bookings are projected privately. Logs use route templates and exclude bodies/query values. Auth limits accommodate classroom NAT traffic; authenticated API budgets are per user and process. Essential state is shared; limiter counters are local abuse controls rather than a cluster-wide quota.

No user data was deleted/migrated or cloud resources created. Migration tests cover consistent export, refusal to replace backups, read-only comparison, idempotent conditional import and preserved target conflicts. Docker execution, release AMI boot, Academy quotas/budget/session, least-privilege profile, public HTTPS URL, live CloudWatch events/datapoints, actual ALB routing/failure and ASG replacement remain unverified. A browser console was active, but no reliable Sandbox preflight was completed; local-only work was the selected scope.

Remote GitHub Actions results must be checked for the pushed main commit; local passes do not establish remote CI success. The completion response identifies the observed run and final commit. No automatic production deployment was added.

## November 13 follow-up

The measurements and test counts above remain historical. The [optimization and reliability verification](optimization-verification.md) records the current 98-test regular suite, separately selected 25-test DynamoDB integration suite, bounded-query benchmark and new 50-user runs, including an extended run. It also records migration requirements and the still-unverified AWS deployment status. Numerical sources and concise [poster notes](poster-update-notes.md) are provided without editing the academic poster or slides.
