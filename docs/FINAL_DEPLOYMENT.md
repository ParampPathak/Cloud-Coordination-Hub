# Final deployment, recovery and class demonstration

The application and template are prepared; **no AWS stack was deployed during this implementation**. The user selected local verification. An active Academy console in us-east-1 was observed in Brave, displaying $0.00 current-month cost; this does not establish remaining lab budget or available permissions. No resource changes were made. Do not reuse old instance IDs, IPs, volumes or credentials after a reset.

## Preflight before any spending

Record remaining Academy budget/session duration privately. Inventory existing stacks/instances/volumes/AMIs/tables/ALBs and ownership. Verify actual EC2 types and total quota, including builders and teammates' resources; VPC/ALB/CloudFormation/DynamoDB transaction/PITR/Logs/dashboard/alarm permissions; optional SSM; existing instance profile and PassRole. The template's allowed values do not prove account permission.

Supply a valid ACM certificate in the ALB region, matching a domain whose DNS you control. `ApplicationOrigin` must be that exact HTTPS origin; point DNS at the resulting ALB. The ALB hostname alone does not provide a matching certificate. No insecure HTTP fallback exists in the final HA stack.

Review current regional pricing and the available lab time. `node scripts/cost-estimate.mjs 4 2` is an illustrative subtotal, not a quote. Include two EC2/EBS instances, ALB/LCUs/two public IPv4 addresses, AMIs/snapshots, DynamoDB requests/storage/PITR, dashboard/alarms/metrics/log ingestion and interface endpoints. Logs adds one endpoint service across two AZs; optional management adds two services across two AZs. No NAT is used. Interface endpoint opt-ins default false to avoid silent costs; enable logging for the observability evaluation after review.

## Offline AMI and deployment

1. On a Docker-capable workstation run `scripts/Prepare-Release.ps1`. It checks the project and exports the release image/checksum/offline installer into `artifacts/`.
2. Use a disposable approved x86_64 Linux builder with Docker installed. Transfer only the image, checksum and installer; run `install-offline.sh`. It downloads nothing. Verify the preloaded image and `cloud-hub.service`. Never bake credentials, runtime `.env`, keys, users, data or backups.
3. Stop the builder, create a same-region AMI, and record its release commit. Retain a previously tested AMI for rollback. Remove the disposable builder when safe, accounting for quotas/costs.
4. Copy `infrastructure/parameters.example.json` to ignored `parameters.local.json`. Replace placeholders. Default ASG is **min 2 / desired 2 / max 3** across two private subnets. Enable `EnableLogsEndpoint=true` after cost/profile review. Optional `EnableManagementEndpoints=true` requires a recent SSM agent and approved profile support. Supply optional existing SNS `AlarmTopicArn` for notifications; no subscriptions are created by this stack.
5. Set the audience CIDR to permit all students, intentionally `0.0.0.0/0` if public. An operator-only `/32` will exclude classmates. The backend remains accessible only from the ALB security group.

```powershell
node scripts/validate-infrastructure.mjs infrastructure/parameters.local.json
cfn-lint infrastructure/hub.yaml infrastructure/single-ec2.yaml
./scripts/Deploy-ChangeSet.ps1 -Action Create -StackName cch-final -ParametersFile infrastructure/parameters.local.json -AllowAws
./scripts/Deploy-ChangeSet.ps1 -Action Inspect -StackName cch-final -AllowAws
# Only after deployment authorization, resource/cost review and backup:
./scripts/Deploy-ChangeSet.ps1 -Action Execute -StackName cch-final -AllowAws
```

The stack creates no IAM role: use the approved existing profile and table/log scope in `required-existing-role-policy.json`. DynamoDB transactional Put operations use PutItem permissions, as described in [AWS transaction IAM documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html). Optional SSM also needs approved managed-instance/channel permissions and [private service connectivity](https://docs.aws.amazon.com/systems-manager/latest/userguide/troubleshooting-ssm-agent.html).

Private instances start the preloaded image using UserData/systemd and instance-role credentials via IMDSv2. No registry, package repository, GitHub, NAT or unrestricted internet bootstrap is required. Docker awslogs needs its private endpoint and log permissions. Startup retries on failure; readiness checks database connectivity. AMI/Docker execution was unavailable locally and must be verified live. Rolling updates keep one instance in service and replace one at a time; that is not a zero-downtime guarantee. Roll back failed updates to the prior tested AMI/config and retain the database.

## Verify networking, security and observability

Public subnets route through the Internet Gateway. Each private subnet has an explicit association and no default internet route. Both private route tables use the table-scoped DynamoDB gateway endpoint. Application inbound is port 3000 from the ALB security group only: no public IP, backend exposure or SSH ingress. Optional Logs/SSM endpoints use private DNS and HTTPS from application instances.

After deployment, DNS and certificate propagation:

```powershell
./scripts/verify-aws.ps1 -StackName cch-final -Region us-east-1 -AllowAws
```

This read-only verifier requires two healthy targets in two AZs, no public instance IP, private routes, available DynamoDB endpoint, HTTPS readiness and actual recent log events. It fails when no logs arrive. Separately inspect stack-specific **metric datapoints**, startup logs and endpoint associations, certificate chain, HTTP redirect, secure cookies and signup/role flows. Metric definitions alone are not delivery evidence.

Dashboard widgets cover requests/4xx/5xx, target p50/p95, healthy/unhealthy targets, CPU/status checks, ASG capacity, API/database failures, booking conflicts and host memory. Runtime JSON samples emit memory every 60 seconds; allow ingestion time. This is a runtime host-counter implementation, not a claimed CloudWatch Agent installation. Logs contain route templates/request IDs/status/duration and error category/type; not passwords, cookies, bodies, query values, booking reasons or participant names.

Six alarms: unhealthy targets ≥1 for two minutes; target 5xx ≥5/minute for two minutes; CPU >75% for five minutes (scaling target 60%); p95 >1 second for three minutes; healthy targets <2 for two minutes; EC2 status-check failures ≥1 for two minutes. Missing healthy-target data breaches the availability alarm; expected booking conflicts are diagnostic, not server errors. Without an SNS topic, alarms remain visible in CloudWatch but send no notifications.

## Data and recovery after End Lab

Production instances share one DynamoDB table (`pk`/`sk`, on-demand, encryption, PITR, session TTL, retain on stack deletion/replacement). Never run independent SQLite files behind the final ALB. SQLite remains local/single-instance.

Stop application writes before migration. Use the README's `data:migrate` workflow to retain a consistent private SQLite backup and conditionally import into a fresh table. Compare first, insert missing records only, verify every source record, and switch traffic only after success. Batches are atomic/resumable; the full migration is not one transaction. Existing differing records are refused. No actual user database was migrated in this task. Unknown legacy timestamps remain unknown; existing overlapping/self bookings remain available for explicit review. Do not mix old binaries or external unguarded slot writes with the new guards.

For cloud data, create and verify an approved backup/export outside any Academy reset boundary before End Lab. PITR/retain settings do not guarantee survival of an account-wide reset. PITR restores a **new** table: reconcile it through a reviewed CloudFormation import/update procedure, not blind creation/deletion of a table with the same name. Verify users, roles, sessions, registrations, votes and bookings. Keep backups encrypted/private and out of Git/AMIs.

Provision a uniquely named organizer with the built CLI and an environment-supplied password on an approved management path, then remove the variable. Public signup creates attendees only. The local seed refuses AWS and populated storage. For the public demo, create sample resources through the organizer account rather than exposing shared administrator credentials.

## Live load and failure rehearsal still required

The committed 50-user runner deliberately accepts only isolated local databases and has no production target option. Desktop results cannot establish t3.micro adequacy. On a separately authorized disposable AWS stack/table, repeat the documented HTTP workload with isolated accounts and gather ALB latency/error/request counts, EC2 CPU/credits/status, host memory, DynamoDB throttles/conflicts and ASG capacity. Measure before changing instance types or spending more.

For controlled HA testing, require two healthy targets and sufficient quota/budget. Verify both receive traffic without sticky sessions. Preserve test records/sessions and keep HTTPS probes running; stop one application process through approved management, observe ALB removal, healthy-target traffic, ASG replacement and replacement readiness. Record actual failures/timing, including health/grace periods. Never terminate the last healthy instance. Use instance termination only under explicit test authorization and the same safeguards. Recheck records and sessions through the replacement. No live HA result or zero-downtime claim is made here.

Application aggregates serialize popular event/poll/group writes; snapshots query entity partitions. Pagination/indexing should be added if data grows beyond classroom bounds. Rate limit counters are process-local abuse controls, not essential state or a guaranteed cluster-wide quota.

## Short evaluation flow

1. Open HTTPS in an ordinary desktop/mobile browser, create an attendee and sign in.
2. Create a capacity-two event; three sessions register. Cancel one confirmed place and show FIFO promotion.
3. Preview/save 2–4 PM office hours at 15 minutes; book with a reason, show full availability, cancel/reschedule and inspect owner details.
4. Create nine groups of four; show automatic assignment, student selection, organizer transfer and CSV export.
5. Publish a poll and vote from independent accounts; show result/privacy policies.
6. Show the actual VPC/subnets/ALB/ASG/shared table and CloudWatch logs/dashboard; distinguish verified live evidence from the recorded local tests.

## Cleanup

Verify backups and shared-resource ownership first. With explicit cleanup authorization, delete the reviewed stack. Retained DynamoDB/audit data continues incurring charges until separately handled. Check ownership/recovery before removing builders, AMIs, snapshots or test resources. End Lab is not a verified backup procedure.

## November 13 upgrade checklist

Retain the two-AZ HTTPS ALB → private EC2 ASG (2/2/3) → shared DynamoDB design. This update adds no service; it adds an explicit deployment mode, a table-level UpdateItem permission for transactional summary counters, and log-derived page-query/timeout metrics. No AWS resources were created, changed or failure-tested. Current Sandbox budget/session, certificate, quotas, IAM and real target health were not verified; historical console observations above are not a current preflight. No AWS CLI was available in this execution environment.

Before rollout: back up storage; stop **all** old writers; preview/rebuild a populated DynamoDB table's summary using `scripts/rebuild-summary.ts` and the explicit apply opt-in; update the existing instance-role policy to include table-scoped UpdateItem; build/bake the new release and confirm `DEPLOYMENT_MODE=aws-multi`. Readiness fails for an unmigrated populated table. New empty tables initialize automatically. EC2 SQLite uses `DEPLOYMENT_MODE=ec2` from its env example and periodic session cleanup. Do not seed demo accounts into AWS or include local test artifacts in an AMI.

Deploy only after the existing authorization/cost review. Validate the extra CloudWatch metric filters and their ingestion cost. The dashboard adds query candidate rows, query duration and connection-idle timeout metrics; these are not total DynamoDB consumed-capacity metrics. End-to-end browser timeouts may not reach the server, so a server timeout counter cannot count every client timeout. Verify actual logs before claiming these widgets work.

Do not infer t3.micro sizing from local results. Measure memory, CPU credits, p95/p99, request/transaction conflicts and managed DynamoDB capacity live; retain the existing permitted type/capacity options pending that evidence. No live high-availability, ACM/HTTPS, ALB/ASG failover, or CloudWatch delivery result is claimed. Optional email reminders/reset remain unavailable without a real configured delivery provider.
