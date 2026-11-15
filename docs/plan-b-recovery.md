# Plan B recovery after an Academy reset

The application was actually recreated and verified on November 15, 2026. Starting the lab alone does not prove that earlier resources survived. Verify the active account, lab timer/budget, stack, S3 bucket, database, and distribution before taking any deployment action. Never reuse stale success flags as proof that resources exist.

## Preserved local material

The private Cloud Computing workspace contains the checksummed software release, seven demonstration credentials, a final logical database backup, raw verification evidence, and executable verification/demo helpers under `artifacts/plan-b-deployment/`. Keep these outside public Git. The final backup contains password hashes and session records and must remain private.

- Software: `artifacts/aws-release/cch-plan-b-release-185d53c.tgz`, SHA-256 `e56842a8d95c7f9ea2d5e32d7c789ae23c5e3a12dc8231f35b272ca8574e9b9e`.
- Private recovery ZIP: `artifacts/plan-b-deployment/cch-final-private-recovery.zip`, SHA-256 `dafeebf2e080a57ca3af0a86b6bbaa2bb478d60bc17b8bfe38cc56480add45b0`.
- Final backup: `private-recovery-2026-11-15/final-demo-backup.json`, SHA-256 `5f67ec4bf8379d7de2cf2220b9e2bef9d42b5b90773b62bb50bd9b1664dada72`.
- Local restore verification: 88 records, schema version one, exact record/summary equality, isolated PostgreSQL 17 cluster stopped after verification. The test made no AWS changes.

## Recreate infrastructure and bootstrap

1. Confirm the current spending authorization. The approved plan used a $3, three-hour reserve, deletion protection disabled only on a new demo DB, encryption/private networking, and snapshot-on-deletion. Do not create resources beyond that approval or weaken an existing database's protections.
2. Use `main` and `scripts/deploy-plan-b.py`. Verify the application release checksum. Preserve SQLite/Plan C and the DynamoDB template as separate alternatives; do not deploy SQLite on the multi-instance Plan B stack.
3. Run the read-only `preflight` stage, inspect the existing `myS3Role` profile and CloudFront VPC-origin managed role, and verify supported AZs. Do not retry denied IAM changes. The previous successful AMI was `ami-096ef200a877f36af`, Amazon Linux 2023 release `2023.12.20261112`, Docker `25.0.18-1.amzn2023.0.3.x86_64`; revalidate availability before reusing pinned values.
4. If the account was reset but CloudShell home survived, back up private `state.json`. Only after confirming the old stack and bucket are absent, clear stale local `bucketCreated`, `outputs`, `changeSet`, `executedAt`, `databaseConfigured`, `ownerUrl`, `appUrl`, `parameters`, and `template` markers. Preserve credentials privately and stop if the account differs. The runner deliberately does not erase cloud resources.
5. Upload the reset-safe software archive through standard CloudShell, place it in a release directory as `plan-b-release.tgz`, and run `stage --release-directory <directory>`. Retain public-access blocking, encryption/versioning, and the explicit app-role denial on `operator/*`.
6. Run `plan`; inspect the actual change set. The verified initial plan contained 29 additions and zero application instances. Execute only the approved scope. Wait for actual stack completion, RDS availability, and CloudFront VPC-origin deployment; simulations are insufficient.
7. Restore or regenerate the offline management bundle from the preserved image using the `management-bundle` stage. It must include Node 24; standard private CloudShell supplied Node 20. The verified management bundle SHA-256 was `d795dfec81a471686ca94a97b7b4fe676ad2d76c186afc8a4423aed9fc81d333`. Its generation uses the trusted release image, not an EC2 builder.
8. Create/reconnect the private CloudShell management environment in the new private subnet with the existing app security group. Use only the authorized operator identity and S3 gateway transport. These environments lose local files after inactivity; recovering the checksummed bundle from S3 was exercised successfully.
9. For a fresh demonstration database, run `configure-plan-b-db.mjs` with private owner setup input to initialize schema, create the restricted SQL identity, and provision accounts without printing credentials. Run `configured` only after the setup result confirms success. It stages only the app URL and CA, not master credentials.
10. Run `start` to request two private nodes. Allow several minutes for standard-AMI package installation and offline Docker image loading. Verify actual target health, HTTPS health/readiness, both AZs, and application behavior before reporting success.

The earlier service-linked role was reused; this procedure must not broaden the application IAM role. No NAT gateway, public EC2 address, public RDS endpoint, or insecure proxy is required.

## Restore existing data instead of reseeding

The preserved JSON is a consistent PostgreSQL logical snapshot: `cch.records` including versions and guards, `cch.summary`, schema version, and server metadata. Its local restore was verified. A real AWS restore was not performed against the running demo.

Restore only into a separately approved **new empty database**, after `init-postgres` and `provision-postgres`, and **before creating demonstration users**. Check that the target has zero application records. In one transaction, insert each `(kind, id, data, version)` with bound parameters and restore the summary counters; then verify exact records and summary. Reuse the saved private demo credentials so their passwords match the restored hashes. Run the account verifier afterward without resetting existing passwords. New infrastructure/database connection credentials must be generated and kept private, rather than restoring the old database master URL.

`verify-backup-restore.mjs` in the local deployment artifacts is deliberately loopback-only and creates a new isolated local cluster; it must not be repointed at AWS. Do not overwrite, truncate, or restore over an existing application database without separate approval.

## Verify the presentation state

The local `prepare-demo.mjs` creates missing fictional fixtures without overwriting existing accounts. `reset-demo.mjs` restores the specifically identified demonstration starting state after testing. `verify-live.mjs` is a separate bounded AWS runner; the repository's original local load runner retains its loopback safeguards. Use the private account and fixture manifests, not passwords in command arguments or chat.

The verified starting state is two confirmed event attendees, Sam ready to join the waitlist, nine empty four-seat groups, eight available office-hour appointments, and a separate sample poll with votes. Actual screenshots and `presentation-screenshots/manifest.md` are stored locally. Do not modify the submitted presentation or poster.

The live stack is left running for the user. Lab expiration/End Lab may stop or remove resources. ALB, RDS, EBS, snapshots, and other retained resources can incur charges; do not assume stopping EC2 is complete cleanup. Cleanup and any destructive recovery remain separate user-approved actions.
