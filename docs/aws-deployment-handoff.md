# AWS deployment handoff

Status: blocked before billable final deployment. Region: us-east-1. Application release: 71fa096545f147c6ad5a7fdf1414163192c731da. The lab was started with explicit user approval and was left running; no End Lab action was performed.

## Resume from verified evidence

Read [the current preflight](aws-live-verification.md), [pending performance results](final-aws-performance.md), and [the optional HTTPS proposal](AWS_CLOUDFRONT_PROPOSAL.md). The original final stack is not deployed. The existing public demo uses SQLite; its public health/readiness responses are not evidence of a shared DynamoDB or two-instance deployment.

Confirm the active Console account with STS on every resumed/reset session. The exact account-specific administrator request is local and gitignored under artifacts/aws-admin-request/. Its three JSON files describe a project-specific EC2 trust policy, DynamoDB/log-stream access, and permission to pass the exact project role to EC2. They have not been applied. Do not broaden unrelated roles, bypass IAM, or supply temporary Console keys to EC2.

Resolve this role/profile access before creating resources. Resolve the offline-AMI constraint before paying for a builder. Recheck time/budget, review actual parameters and change set, and obtain explicit spending and CloudFront architecture approval before executing. Preserve the Academy-managed stack and unrelated resources.

## Release preparation

A Node 24 production image was built and its isolated packaging checks passed in CloudShell. The image tar/checksum/installer were prepared under /tmp/cch-release-bundle in that CloudShell environment. The offline release was also downloaded and verified outside AWS under artifacts/aws-release/ in the local Cloud Computing workspace. Compressed archive SHA-256: aa527045099026e5cb45d7e3d29b727fd84978b170dd7f26aadd2878f85598d5. Verify this checksum before reuse. Temporary CloudShell paths alone are not reset-safe. The local aws-preflight scripts in the Cloud Computing workspace preserve the read-only recheck and build/check procedures. Do not mistake the isolated SQLite packaging fixture for production storage.

## Accounts and feature verification

Provision one organizer and one attendee using scripts/create-user.ts or its built trusted CLI, after pointing it at the correct shared production table. Generate random credentials at provisioning time. The planned private destination is artifacts/cch-academy-accounts.local.json; no such final-stack credentials have been created by this work. Never print passwords to chat, command logs or Git. Use a separate isolated pool for performance tests.

Verify the final architecture and both roles before events/waitlists, office hours, groups, polls, persistence and screenshots. All 19 requested presentation feature screenshots remain pending. Their local checklist is artifacts/presentation-screenshots/manifest.md. The sign-in capture is preliminary UI evidence only. Keep the reference PowerPoint and poster unchanged.

## Outstanding work

- Approved EC2 profile, scoped table/log access and PassRole.
- Permitted image/bootstrap mechanism and reviewed resource/cost proposal.
- Final ALB/ASG two-AZ/shared-DynamoDB/CloudWatch deployment and real verification.
- Secure account provisioning and browser feature tests.
- A separately guarded, explicitly authorized AWS 50-user runner and measurements.
- Verified private backup outside the Sandbox and separately authorized controlled failure test.
- Feature screenshots, manifest updates and final evidence.

Do not claim completion, final-stack availability, working demonstration credentials, measured AWS capacity or successful failover until those results are observed.

The role-creation blocker is now confirmed by actual requests, not simulations alone. Both the user-approved SDK attempt and the subsequently requested manual IAM Console attempt failed at iam:CreateRole. The Console stated that no identity-based policy allows that action. Stop retrying with the same identity; resume after an administrator supplies the approved profile/PassRole or an approved alternate project environment. Private evidence and ready-to-send text are bundled locally in the Cloud Computing workspace at artifacts/aws-admin-request.zip.
