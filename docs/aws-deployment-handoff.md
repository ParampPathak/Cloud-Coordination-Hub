# AWS deployment handoff

Verified on 2026-11-15: **Plan B is deployed and working** at <https://dpryd7fgeqjpy.cloudfront.net>. CloudFormation `cch-plan-b-demo` reports `UPDATE_COMPLETE` in `us-east-1`. Both application instances and ALB targets are healthy. Public HTTPS readiness returns HTTP 200 with `{"status":"ready","database":"PostgreSQL"}`.

This replaces the previous pending-deployment status. The older deployment was absent when the lab resumed; it was recreated from the saved release. No End Lab action was performed.

## Actual architecture

CloudFront default-certificate HTTPS → CloudFront VPC origin → internal ALB → two private `t3.micro` EC2 instances in `us-east-1a` and `us-east-1b` → private, encrypted PostgreSQL 17.7 RDS `db.t3.micro`, 20 GiB. Auto Scaling is configured **2/2/3**. The dedicated VPC is `10.43.0.0/16`; private subnets are `10.43.10.0/24` and `10.43.11.0/24`. EC2 instances have no public IPs or SSH ingress. Bootstrap uses the S3 gateway endpoint and the pinned standard Amazon Linux 2023 AMI, with no NAT gateway or custom AMI.

RDS is **Single-AZ**. This is application-tier multi-AZ availability, not automatic database failover. PostgreSQL replaces the poster's DynamoDB architecture. Native CloudWatch monitoring is present; application logs are collected in private S3 batches, not streamed directly to CloudWatch Logs.

The existing `myS3Role` instance profile and existing CloudFront VPC-origin service-linked role were reused. No application IAM permissions were expanded. For this newly created demo database only, the user approved deletion protection disabled; encryption, private networking, authentication, verified TLS to PostgreSQL, and snapshot-on-deletion remain enabled. This supersedes the old keep-protection/admin-cleanup instruction.

## Verified behavior

- Live API checks passed for capacity limits, duplicate registrations, FIFO waitlist promotion, booking contention, rescheduling, cancellation, nine four-seat groups, CSV export, polls, authorization, and logout.
- Real browser sign-in worked for organizer Alex Morgan and attendees Sam Rivera and Jordan Lee. Waitlists, cancellation/promotion, booking/rescheduling/cancellation, calendar invitation download, group selection/transfer, poll voting, organizer results, and persistence after refresh were exercised.
- The bounded 50-user AWS test completed 441 requests with zero unexpected failures or server errors. API p50/p95/p99: **149/561/1040 ms**. All 441 request IDs matched application logs across both instances: 221 on one and 220 on the other.
- All three CloudWatch alarms are OK, with actual EC2, ALB, and RDS datapoints. EC2 memory utilization and ASG metric collection are not enabled; ASG capacity was verified through the service API.
- A private backup was restored into an isolated local PostgreSQL cluster: all **88 records** and summary totals matched exactly. AWS was unchanged by that restore check.

See [live verification](aws-live-verification.md), [measured performance](final-aws-performance.md), [recovery procedure](plan-b-recovery.md), and [sanitized evidence](evidence/plan-b-aws-live.json).

## Private local deliverables

Under `C:\Users\Geo\Documents\ChatGPT\Cloud Computing\artifacts\`:

- `cch-final-demo-accounts.local.json`: seven fictional demonstration accounts, including the organizer and four named attendees. Passwords must stay private.
- `presentation-screenshots/manifest.md`: 22 real captures covering all 19 requested screenshot requirements for slides 3–6 of the original screenshot brief. PNG exports and untouched browser JPEG originals are separate from the PowerPoint. Later nine-slide layouts can reuse these feature images.
- `plan-b-deployment/private-recovery-2026-11-15/`: private final backup, archived disposable test data, raw AWS/monitoring evidence, and accounts.
- `plan-b-deployment/backup-restore-verification.json`: successful restore verification.
- `aws-release/cch-plan-b-release-185d53c.tgz`: reset-safe software archive.

Do not commit these private backups, credentials, raw account-specific evidence, or screenshots. No PowerPoint or poster was modified.

## Demonstration starting state

`Final presentation dry run` has capacity two, with Jordan and Taylor confirmed. Sam is available to join the waitlist. `Cloud project groups` has nine empty four-seat groups, so Jordan can join Group 5 live. Eight 15-minute office-hour slots are available from 2–4 PM on November 19 in Engineering Building, Room 108. A separate sample anonymous poll contains three demonstration votes; the actual live-demo poll title is available for creation. Disposable performance users and resources were archived and removed after testing.

## Release and limits

Application code: `185d53c82b979282d7752dccbed2a8dcf499f03e`. Deployment tooling before this evidence update: `790caf4253ba74bf23d42fa79203ce48974bdfcb`. Release SHA-256: `e56842a8d95c7f9ea2d5e32d7c789ae23c5e3a12dc8231f35b272ca8574e9b9e`.

The bounded test is not a sustained-load or availability guarantee. No controlled instance-failure test was authorized or performed. Minor UI observations: confirmation messages persist across navigation/account changes until dismissed; appointment cards are not sorted chronologically. The core flows passed.

The last lab display was Ready, 01:08 remaining, and $0.10 used of $20; displayed billing can lag. The approved deployment reserve was $3 for three hours. The estimated running floor is about $0.08/hour, excluding variable traffic, logs, backups, and possible RDS CPU surplus. ALB, RDS, and storage can continue charging while resources exist. Do not end the lab, delete resources, or expand spending automatically.
