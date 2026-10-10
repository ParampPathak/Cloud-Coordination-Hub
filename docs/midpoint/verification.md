# Verification record

**Date: 2026-10-10 (America/Chicago). Status: local prototype; NOT deployed to AWS.**

## Actually executed locally

| Check                              | Result / evidence                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                     | Passed with ESLint 10 and TypeScript rules                                                                                      |
| `npm run typecheck`                | Passed: frontend and backend/scripts/tests                                                                                      |
| `npm test`                         | 26 tests passed (23 backend, 3 frontend), 1 DynamoDB Local integration test explicitly skipped; final run used Vitest 5.0.3     |
| `npm run build`                    | Passed: Vite static frontend and compiled TypeScript backend                                                                    |
| `npm run infra:validate`           | Passed: offline YAML, no IAM/Cognito/NAT, t2/t3, capacity ≤9, retained table, private subnets, IMDSv2 and no AWS CI permissions |
| `cfn-lint infrastructure/hub.yaml` | Passed with local cfn-lint 1.57.2; no AWS validation API called                                                                 |
| `npm run test:e2e`                 | Passed using installed headless Microsoft Edge and isolated persistent SQLite                                                   |
| Actual desktop/mobile screenshots  | `docs/screenshots/local-dashboard.png` and `local-mobile-events.png`; sample local records only                                 |

On this managed workstation, cfn-lint was installed into ignored `.tools` instead of the global Python environment, then executed with `PYTHONPATH=.tools` and `python -c 'from cfnlint.runner import main; main()' infrastructure/hub.yaml`. The ordinary `cfn-lint` command after a standard install is equivalent. Local schema validation is not proof of account service/permission compatibility.

CI action versions follow the maintainers' current examples: [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), [setup-python](https://github.com/actions/setup-python), and [upload-artifact](https://github.com/actions/upload-artifact). The remote workflow itself has not run.

## Verified behavior

`npm run check` and `npm run format:check` passed after the final application changes. Live `npm audit` identified vulnerabilities in earlier test dependencies; the runner was upgraded to Vitest 5.0.3 and the updated install reported **zero vulnerabilities**. This is a point-in-time registry check, not a guarantee against future advisories. Prepared PowerShell release/change-set scripts also passed local parser checks without running cloud actions.

`npm run dev` was started successfully with an isolated SQLite file: Vite served HTTP 200 on port 5173 and `/api/ready` was successfully proxied to the backend, reporting Local SQLite. The owned servers were stopped after verification. The compiled seed script created the example records and refused a second run against the same database. The change-set script's default no-AWS guard was exercised and blocked execution before any AWS command.

- Organizer event creation/persistence and role/ownership boundaries.
- Capacity handling, FIFO waitlists, duplicate registrations, cancellation, promotion and guarded capacity changes.
- Forty concurrent event joins using two SQLite connections, five confirmed seats, no lost entries or duplicate sequence numbers.
- Concurrent cancellation and duplicate-request behavior; audit records exist only for successful commits.
- Poll creation, voting/results, duplicate/invalid/closed voting prevention and concurrent vote persistence.
- Appointment single-slot concurrent booking: one successful booking; proper cancellation ownership.
- Persistence after SQLite close/reopen.
- API health/readiness, unauthenticated access, role escalation rejection, invalid input, hostile/missing Origin, HttpOnly/SameSite cookies, logout revocation, expiry and safe CSV export.
- Frontend waitlist actions/position and closed-registration states.
- Browser flows: organizer event form, two attendee sessions, confirmed/waitlisted/cancel/promote, poll form/vote/results, slot form/book/reserved/cancel, attendee list/CSV download, account, logout. No browser runtime errors; 390px mobile viewport without horizontal overflow.

## Unverified or deliberately not executed

- Docker build/Compose and real DynamoDB Local integration: Docker is not installed on this workstation. The opt-in integration test and CI service are prepared, but no local DynamoDB success is claimed.
- Any AWS CLI/API call, account connection, credentials retrieval, AWS validation API, IAM-profile inspection, certificate/DNS configuration, EC2/ALB/Auto Scaling/DynamoDB cloud behavior, CloudWatch delivery or CloudTrail operation: prohibited by the user's local-only restriction and not executed.
- AMI creation/image baking and release tar creation: Docker/approved cloud image builder are prerequisites, not completed artifacts.
- GitHub Actions remote execution or publishing/pushing the repository: workflow prepared; no push performed.
- Performance/high availability or large-scale load: meaningful local concurrency tests passed; cloud measurements and two-instance failover remain required.
- CSV/Excel import, poll-to-event automation, editable polls, overlapping-slot conflict detection, password reset/email verification and multi-workspace isolation: not implemented.

The health/readiness and documented API routes were exercised with Supertest or the real local browser/API flow. The local SQLite adapter is the verified persistence path. The DynamoDB adapter uses real AWS SDK commands and conditional transactions but still needs its prepared integration test executed against DynamoDB Local before claiming compatibility.

## Evidence still required before a cloud midpoint demonstration

Verify Academy profile/PassRole, certificate/DNS, approved type/quota and prepared AMI. After separately approved deployment, obtain actual healthy targets, private-subnet instance placement, live DynamoDB records, metrics/log delivery if enabled, CloudFormation resource state and configured CloudTrail audit evidence. Repeat the independent-user demo against the cloud origin, measure latency/errors and rehearse the presentation. No fabricated cloud screenshots or results are supplied.
