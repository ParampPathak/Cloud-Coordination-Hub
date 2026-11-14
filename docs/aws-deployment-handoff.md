# AWS deployment handoff

Status: Plan A remains blocked; Plans B/C have permission-supported alternatives awaiting implementation and deployment approval. No final deployment is running in the inspected account. Region: us-east-1. Application release: 71fa096545f147c6ad5a7fdf1414163192c731da. The lab was started with explicit user approval and was left running; no End Lab action was performed.

## Plan B implementation update

The user selected Plan B preparation only. PostgreSQL storage, local concurrency/TLS verification and a separate CloudFormation/bootstrap path are prepared; no AWS deployment was authorized or executed. Read [the preparation runbook](plan-b-preparation.md) before any new provisioning. The old 71fa096 software archive lacks PostgreSQL and is only a preserved fallback artifact. RDS ModifyDBInstance simulation is explicitly denied, so deletion-protection/cleanup must be resolved before spending. The user explicitly chose to keep deletion protection enabled and arrange administrator-assisted cleanup. The protected template has not been weakened; do not ask again to disable it.

## Resume from verified evidence

Read [the deployment alternatives audit](aws-deployment-options.md), [the current preflight](aws-live-verification.md), [pending performance results](final-aws-performance.md), and [the optional HTTPS proposal](AWS_CLOUDFRONT_PROPOSAL.md). The original final stack is not deployed. Earlier public demo responses reported SQLite. The latest audit found its hostname no longer resolves; do not present it as a working link. Those historical responses never established a shared DynamoDB or two-instance deployment.

Confirm the active Console account with STS on every resumed/reset session. The exact account-specific administrator request is local and gitignored under artifacts/aws-admin-request/. Its three JSON files describe a project-specific EC2 trust policy, DynamoDB/log-stream access, and permission to pass the exact project role to EC2. They have not been applied. Do not broaden unrelated roles, bypass IAM, or supply temporary Console keys to EC2.

For exact Plan A, resolve the DynamoDB role/profile gap before provisioning. Plans B/C can instead use the existing EC2-trusted myS3Role, subject to project-use approval, with the documented Amazon-owned AL2023/S3 private bootstrap. A paid custom-AMI builder is not required by that design; actual bootstrap still needs verification. Recheck time/budget, review actual parameters and change set, and obtain explicit spending and CloudFront architecture approval before executing. Preserve the Academy-managed stack and unrelated resources.

## Release preparation

A Node 24 production image was built and its isolated packaging checks passed in CloudShell. The image tar/checksum/installer were prepared under /tmp/cch-release-bundle in that CloudShell environment. The offline release was also downloaded and verified outside AWS under artifacts/aws-release/ in the local Cloud Computing workspace. Compressed archive SHA-256: aa527045099026e5cb45d7e3d29b727fd84978b170dd7f26aadd2878f85598d5. Verify this checksum before reuse. Temporary CloudShell paths alone are not reset-safe. The local aws-preflight scripts in the Cloud Computing workspace preserve the read-only recheck and build/check procedures. Do not mistake the isolated SQLite packaging fixture for production storage.

## Accounts and feature verification

Provision one organizer and one attendee using scripts/create-user.ts or its built trusted CLI, after pointing it at the selected verified production database. Generate random credentials at provisioning time. The planned private destination is artifacts/cch-academy-accounts.local.json; no such final-stack credentials have been created by this work. Never print passwords to chat, command logs or Git. Use a separate isolated pool for performance tests.

Verify the final architecture and both roles before events/waitlists, office hours, groups, polls, persistence and screenshots. All 19 requested presentation feature screenshots remain pending. Their local checklist is artifacts/presentation-screenshots/manifest.md. The sign-in capture is preliminary UI evidence only. Keep the reference PowerPoint and poster unchanged.

## Outstanding work

- Select and approve the architecture: Plan A needs a new approved scoped DynamoDB profile/PassRole; B/C use existing-role alternatives with disclosed differences.
- Implement and verify the Amazon-owned AL2023/S3 bootstrap and review actual resource/cost parameters.
- Deploy and verify the selected architecture; retain the full DynamoDB template as the exact-poster target.
- Secure account provisioning and browser feature tests.
- A separately guarded, explicitly authorized AWS 50-user runner and measurements.
- Verified private backup outside the Sandbox and separately authorized controlled failure test.
- Feature screenshots, manifest updates and final evidence.

Do not claim completion, final-stack availability, working demonstration credentials, measured AWS capacity or successful failover until those results are observed.

The role-creation blocker is now confirmed by actual requests, not simulations alone. Both the user-approved SDK attempt and the subsequently requested manual IAM Console attempt failed at iam:CreateRole. The Console stated that no identity-based policy allows that action. Stop retrying that denied operation with the same identity. Exact Plan A needs an administrator-supplied approved profile/PassRole; the subsequent read-only review also identified Plan B/C candidates using existing role permissions. See the alternatives audit rather than treating the custom-role denial as a blocker for every architecture. Private evidence and ready-to-send text are bundled locally in the Cloud Computing workspace at artifacts/aws-admin-request.zip.
