# Classroom deployment — live verification, November 15, 2026

**Live HTTPS website: https://dm6fo1syg8qfg.cloudfront.net/**

The approved Plan B application is deployed and verified in the replacement AWS Academy Sandbox. The old dpryd7fgeqjpy.cloudfront.net address belongs to the earlier deployment and should not be shared. These results come from actual AWS resources, the running website and committed database operations, rather than permission simulations or CI alone.

## Actual architecture and release

- CloudFront managed HTTPS and a deployed VPC origin connect to an internal Application Load Balancer.
- Two healthy private t3.micro EC2 instances run across two Availability Zones. ASG minimum/desired/maximum are 2/2/3. The software update retained the original empty ASG; no database replacement occurred.
- Shared, encrypted, private RDS PostgreSQL 17.7 uses a restricted cch_app SQL identity and verified TLS. The database is Single-AZ, as approved for Plan B.
- Native CloudWatch monitoring and three alarms are present; bounded application logs go to private S3. Application IAM trust, inline policies, attached-policy state and boundary were checked against the initial inventory and remained unchanged. The approved CloudFront service-linked role was actually created.
- Application image commit: fdb2e3169dd498086fd298b1cfee681624950bdc, including the latest teammate changes and classroom guest access. Release archive SHA-256: cd78d26cd890841e149c10b655255e743dd00dd51bca5e577d7f9ac6a6426240. Later documentation-only commits do not change that image.
- Bootstrap uses the pinned Amazon-owned AL2023 AMI and Docker 25.0.18-1.amzn2023.0.3.x86_64 from its regional S3 repository, with a verified offline Node 24.22.3 image. No NAT gateway, custom application IAM role, custom AMI or public EC2 address was added.

This approved Plan B uses PostgreSQL and private S3 application logs in place of the poster's DynamoDB and CloudWatch Logs design. App instances span AZs; the Single-AZ database is the remaining availability limitation. SQLite/local development and existing Plan C deployment files are preserved.

## Accounts and data preservation

The saved 88-record logical backup was restored only into an empty initialized database and verified by exact record and summary comparison. All original record IDs, password hashes and organizer ownership were preserved. Seven existing permanent accounts, including Alex and the prepared demonstration users, remain. Exactly three dedicated team organizer accounts were provisioned through the normal scrypt authentication path, with no password resets or unrelated role changes. Actual sign-in, session lookup and logout succeeded for all ten prepared permanent accounts.

Guest mode is enabled: a display name creates a distinct attendee UUID and a database-backed 24-hour session, without email or password fields. Production cookies were verified Secure, HttpOnly and SameSite=Lax. Name-only joining, mobile layout, refresh persistence and Exit Demo were checked on the real site. Expiration or logout retains participation records. Configurable guest mode, per-IP join limits and the shared daily admission cap remain in place; see classroom-guest-access.md for scoped maintenance.

The original presentation fixtures were preserved: events and FIFO waitlists; eight 15-minute office-hour slots from 2–4 PM; nine groups with four seats each; and the sample poll. Local recovery files and all screenshots remain outside Git. Passwords, session secrets, raw database exports, AWS identifiers and private account files are not published here. A final private backup containing 145 records, including subsequent application activity, was downloaded locally and checksum-verified after deployment.

## Live 50-student workload

| Measurement                                  | Observed result                     |
| -------------------------------------------- | ----------------------------------- |
| Independent simultaneous guest identities    | 50, all using the same display name |
| Total HTTP requests                          | 452                                 |
| Successful valid requests                    | 384 / 384 (100%)                    |
| Expected business conflicts                  | 66 HTTP 409 responses               |
| Deliberate authorization checks              | One HTTP 403 and one HTTP 401       |
| Unexpected server errors                     | 0                                   |
| API p50 / p95 / p99                          | 124 / 708 / 877 ms                  |
| Test duration                                | 5.543 seconds                       |
| Request IDs matched in real application logs | 452                                 |
| Requests served by the two app hosts         | 226 / 226                           |

The test verified event capacity, duplicate rejection, FIFO promotion after cancellation, contested appointment booking, rescheduling/cancellation, group capacity and CSV export, 50 recorded poll votes, shared sessions, attendee authorization boundaries and logout. Expected capacity conflicts were not counted as failed valid requests. These are measured results for this bounded workload, not a guarantee for arbitrary production traffic.

Actual monitoring evidence includes EC2 CPU, ALB request/response metrics, RDS CPU/free memory and 44 runtime-memory samples. Reported app process RSS ranged from 89–207 MiB; the maximum reported EC2 CPU datapoint was about 2.32% in the observed five-minute metric window. That is a sampled metric, not an instantaneous peak. Application logs showed no server errors. GitHub CI passed; the local suites previously passed 112 default tests and 43 real PostgreSQL integration tests.

The complete disposable test dataset was archived to operator-only private S3 before cleanup. Cleanup removed only the explicitly identified 50 test guests, five test resources and their dependent records (490 records total), preserved all ten permanent accounts and protected domain records, checked summary consistency and retained the admission counter. Real activity after that cleanup is included in the final backup.

## Classroom access and renewal schedule

A separate local classroom-access package contains a public-URL-only PNG QR code, student instructions, five real-site screenshot captures with original JPEGs and PNG copies, and screenshot/verification manifests. Nothing was composited or fabricated. Actual tool-captured image dimensions are recorded in the manifest; images were not enlarged to claim 1920×1080. The original presentation screenshot package and PowerPoint/poster were kept separate and unchanged.

Students open the website, choose Join Classroom Demo, enter a display name and choose Enter classroom. Keep the same browser to retain the guest session. On phones, Account contains Exit Demo.

Two hourly renewal reminders were created in Codex under **Cloud Hub lab renewal reminders**. These remind the operator to renew manually; they do not keep AWS Academy running automatically.

1. Before class, open the Sandbox and use the supported Start Lab control. Wait for Ready. Renew manually again before time runs short; supported active-session renewal was observed to restore roughly three hours.
2. Confirm the same AWS account after any restart. Open the current HTTPS link and confirm both ALB targets and database readiness. If the account changed, stop and review recovery rather than reusing old IDs or credentials.
3. Do not automate authentication/Start Lab, use an unattended renewal loop, or click End Lab/Reset during the demonstration.
4. Renewal does not extend spending approval. The existing allowance remains USD 3 for the three-hour deployment/test window; review costs and obtain approval before extending billable operation. Cleanup remains a separately approved action, with backups/snapshot retention.

At the last observation the Sandbox was Ready with about 2 hours 21 minutes remaining and displayed USD 0.10 used of USD 20. Academy cost reporting may lag. Estimated light-demo running cost remains roughly USD 0.07–0.15/hour plus traffic/burst/storage variations; it is not an account-specific billing quote. Pricing API access was denied once and was not retried. Reference: [EC2 pricing](https://aws.amazon.com/ec2/instance-types/t3/), [ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/), [RDS pricing](https://aws.amazon.com/rds/postgresql/pricing/), [CloudShell pricing](https://aws.amazon.com/cloudshell/pricing/).

## Remaining limitations

No AWS permission blocker remains for this deployed Plan B. Two pre-existing UI polish issues remain: the dashboard's Open appointments tile does not reflect the schedule, and appointment cards are not listed chronologically. Use Scheduling and each card's displayed time for actual availability; booking, cancellation and capacity enforcement passed the live workload. No further load test or infrastructure expansion is needed for this handoff.
