# Progress and final-project roadmap

**2026-10-10: local prototype implemented. No AWS connection or GitHub push.**

## Completed

- Organized React/TypeScript/Vite/Tailwind frontend, Express/TypeScript backend, shared types, local configuration, lint/format/build scripts and lockfile.
- Responsive dashboard, events, polls, scheduling, account/sign-in/attendee signup, organizer modal forms, live totals, real empty/loading/error/confirmation states.
- Persistent SQLite; DynamoDB adapter with conditional transactions and strongly consistent reads; explicit no-AWS default.
- Event creation/editing, confirmed registration, ordered waitlists, atomic cancellation/promotion, duplicate prevention, guarded capacity changes, owner-only attendee lists and CSV export.
- Poll creation/publishing, one vote per user, live results and owner-only close.
- Appointment creation, single-slot booking and cancellation; concurrency-safe double-booking protection.
- Password auth, database-backed revocable sessions, organizer provisioning CLI, backend ownership, strict validation, CSRF origin checks, secure-production configuration and request logging.
- Docker production image/Compose, offline release installer and local packaging script, Academy-aware CloudFormation, guarded future change-set script, CI build/test workflow.
- Architecture/database/API/security documentation, midpoint demo, slides outline, rubric checklist, deployment/cleanup procedure, cost assumptions and actual verification notes.

## Prepared or bounded

AWS resources, instance-profile permissions, certificate/DNS, release AMI, remote logging and CloudTrail are **prepared or prerequisite-dependent**, not deployed or verified. Docker and DynamoDB Local tests are specified but require available local tooling; see [verification.md](verification.md). GitHub Actions is defined but has not been pushed/executed remotely.

The aggregate data model intentionally bounds event registrations and poll votes. Lists load a whole classroom-sized workspace. Per-instance rate limits, organizer provisioning, no password-reset/email verification, no overlapping-slot detection, and no multi-workspace isolation are explicit prototype limitations. The current application targets one trusted class/team workspace; it is not a general SaaS product with independent tenants.

## Lessons and risk mitigations

| Lesson / risk                                                        | Response                                                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A visually complete UI alone is insufficient for a cloud course      | Working persistence, authentication, transactions, IaC, automation and actual local evidence accompany the UI.                   |
| Capacity and cancellation races can corrupt a naive implementation   | Aggregate version checks and transactional activity capture, with meaningful concurrency tests.                                  |
| “Private subnet” does not make registries/package managers reachable | Preloaded immutable AMI; no runtime downloads/NAT assumption.                                                                    |
| Existing profile permissions may be missing in a read-only IAM lab   | Explicit administrator prerequisite; no role creation or static-key fallback.                                                    |
| Cognito/certificates cannot be assumed                               | Independent application auth; existing HTTPS certificate prerequisite; retain safe local demo if cloud TLS is unavailable.       |
| Bills persist after stopping instances                               | Review whole-stack costs, defaults off for optional endpoints/trail, cleanup includes retained tables/buckets and AMI snapshots. |
| Cloud evidence must be real                                          | Every document distinguishes local verification, prepared templates and unverified cloud state.                                  |

## Remaining milestones

1. **Local demonstration readiness:** rehearse on the team presentation machine, run Docker/DynamoDB Local verification when Docker is available, review changes and obtain approval before pushing GitHub.
2. **Authorized AWS integration:** verify existing profile/PassRole, approved type/quota, certificate/DNS and release AMI; review costs/change set; deploy only after authorization; repeat the real core flows against DynamoDB.
3. **Reliability evidence:** two approved instances across AZs, measured latency/throughput, failure recovery, verified CloudWatch logs/metrics and CloudTrail scope, transactional retries under contention, table recovery drill.
4. **Application improvements:** CSV import/Excel export with validation, poll-to-event workflow, editable/draft polls, robust appointment interval conflict rules, password reset/email verification, organizer account lifecycle and accessibility review.
5. **Scale and final evaluation:** per-workspace isolation, paginated API/listing, separate registration/vote items if aggregate contention warrants, distributed rate limiting, final architecture/demo/evidence and lessons.

Recommended next priority: repeat the local demo with three real browser sessions and run the prepared DynamoDB Local/containers checks on a Docker-enabled workstation, before any AWS deployment activity.
