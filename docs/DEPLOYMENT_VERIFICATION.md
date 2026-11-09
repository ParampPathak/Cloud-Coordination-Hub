# EC2 preparation verification

Preparation performed locally on Windows with Node 24.19.0 and npm 11.17.0. Base repository commit: `25dcd0201ab5f75d6f7c34413e731ade30cc0a01`. No push, AWS login, AWS SDK connection, resource creation or deployment was performed. Existing authentication/API/development workflows and the DynamoDB architecture were preserved.

## Changes and purpose

| Files                                                                | Purpose                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/config.ts`, `.env.example`                              | Allow file-backed production SQLite; validate/normalize HTTP(S) origins; explicitly gate insecure classroom HTTP. Existing host/port/path configuration retained.                                                                         |
| `backend/src/app.ts`                                                 | Serve the existing built frontend independent of working directory; trust only loopback proxies for SQLite; retain HTTPS cookie/HSTS/CSP protections, with deliberate HTTP demo exception. No API routes or authorization checks removed. |
| `backend/src/server.ts`                                              | Structured listener startup-error logging and database close on listener failure; existing health, readiness, startup logs and signal shutdown retained.                                                                                  |
| `backend/src/demo-data.ts`, `scripts/seed.ts`                        | Explicit production SQLite seeding opt-in; reject any known existing application records; add sample registration/vote without overwriting data.                                                                                          |
| `package.json`, `scripts/start-production.mjs`                       | Reuse existing Vite/TypeScript build and server; add cross-platform production startup and compiled user/seed CLI commands. No dependency changes.                                                                                        |
| `scripts/deploy-ec2.sh`, `deployment/*`                              | Ubuntu prerequisites, Node24 checksum validation, unprivileged release build/tests, persistent external state, backup, systemd activation/readiness/rollback and Nginx example. Config stays outside source.                              |
| `scripts/production-smoke.mjs`, `tests/backend.test.ts`              | Production frontend/assets/API/auth/CSRF/registration/restart persistence and HTTPS/security/seed safeguard checks. All fixture data and generated credentials remain temporary.                                                          |
| `infrastructure/single-ec2.yaml`                                     | Optional one-instance template using an existing VPC/subnet/key; restricted SSH, encrypted gp3, no IAM, ALB, NAT or managed database; T3 Standard credits.                                                                                |
| `.gitignore`, `.gitattributes`                                       | Ignore databases/backups/private keys and keep Ubuntu scripts/service line endings correct.                                                                                                                                               |
| `.github/workflows/ci.yml`                                           | Add offline production smoke, Bash syntax and new template validation to existing CI. The existing artifact-preparation CD file is unchanged; no deployment workflow/secrets/OIDC added.                                                  |
| `README.md`, `docs/security.md`, `docs/database.md`, `docs/AWS_*.md` | Reconcile single-instance mode with older DynamoDB documentation; exact Windows/Ubuntu setup, Sandbox/manual prerequisites, budget, demo, updates, backup and recovery guidance.                                                          |

## Observed results

- `npm ci --no-audit --no-fund`: passed using the existing lockfile. npm reported an esbuild install-script approval warning; builds nevertheless succeeded. Dependencies and lockfile were not changed.
- Baseline `npm test`: 29 passed, 1 intentionally skipped. Initial restricted-sandbox run failed with loopback `EACCES` and temporary-file errors; rerunning with local socket/file access passed without application changes.
- Final `npm run check`: passed ESLint, both TypeScript checks, tests (**31 passed, 1 skipped**), Vite/backend build and existing offline infrastructure guards.
- `npm run test:production`, and final `node scripts/production-smoke.mjs`: passed built frontend/asset/SPA serving from a different working directory, health/readiness, public-origin login and malicious-origin rejection, HTTP cookie/header handling, event creation, attendee registration, explicit/duplicate seed refusal, and record/session persistence after restarting the real compiled server.
- HTTPS regression test: passed Secure cookie, HSTS/CSP and exact-origin validation assertions.
- `npm run test:e2e`: passed existing browser event creation, registration/waitlist/promotion, polls, appointments, CSV, desktop/mobile rendering, account/logout and no runtime-error checks. Generated screenshot replacements were discarded to preserve the existing documentation images.
- `bash -n scripts/deploy-ec2.sh`: passed using locally available Bash. The first sandbox attempt was denied by the Windows runtime; retry with execution access passed.
- `cfn-lint infrastructure/hub.yaml infrastructure/single-ec2.yaml`: passed local schema validation. A development-time `CpuCredits` typo was caught by validation and corrected to `CPUCredits`; it is not a remaining failure.
- Formatting and whitespace: checked before handoff.

## Unverified boundaries

- DynamoDB Local integration is intentionally skipped by ordinary `npm test`; no Docker executable was available here. The existing CI still runs that separate integration. No DynamoDB/cloud API was contacted.
- Ubuntu package installation, actual systemd/Nginx activation, Node binary download on the instance, rollback during a live activation failure, TLS issuance and public EC2 reachability were not executed on Windows. Syntax/schema/application tests do not replace those checks.
- No account-specific AWS Academy permissions, AMI, budget, public subnet, SSH access or End Lab/reset behavior were inspected. The manual checklist covers what you must verify.
- CI changes were checked locally; no remote workflow was triggered. No public application URL or cloud login credentials exist from this preparation.
- SQLite is single-instance storage on one EBS volume and Node24's SQLite API is experimental. HTTP demo mode has no transport confidentiality. Use disposable classroom data/accounts and private backups.

Deployment status: **prepared locally, not deployed; waiting for your manual AWS setup and review**.
