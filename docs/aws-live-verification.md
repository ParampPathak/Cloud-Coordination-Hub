# AWS live verification — preflight only

Checked on 13 November 2026 in us-east-1. Application baseline: c6c90046f93cd66abe02df21de5bb879c5ddef07 on main.

**The final two-AZ stack has not been deployed in the inspected Academy account. There is no verified final-stack URL, AWS feature test, live 50-user result, or failover result.** An existing single-instance website is described below; it is not the final architecture. The existing performance reports remain local evidence only.

## Read-only observations

The authenticated AWS Console and its CloudShell were checked against STS before inventory. The Academy embedded terminal initially returned a different account and was excluded from the project inventory. No credentials were printed, copied into the application, or committed.

At the last check, the Sandbox was Ready with 02:11 remaining and displayed $0.10 used of $20. Budget reporting can lag. The lab was started by the user and has not been ended by this work.

| Item                        | Observed result                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| Project compute and storage | No EC2 instances, EBS volumes, owned AMIs, ASGs, or ALBs                                                 |
| Database                    | No DynamoDB tables                                                                                       |
| Network                     | Existing default VPC and six default subnets; no project VPC                                             |
| CloudFormation              | One Academy-managed stack; preserve it                                                                   |
| Certificates and DNS        | No ACM certificates or Route 53 hosted zones; user has no domain                                         |
| GitHub hostname             | No CNAME file or configured homepage; Pages disabled; ApplicationOrigin is a placeholder                 |
| CDN                         | No CloudFront distributions or VPC origins                                                               |
| Monitoring                  | No log groups or dashboards                                                                              |
| Quota                       | EC2 API reports 256 standard on-demand vCPUs; Academy separately restricts the account to nine instances |
| CloudShell build tools      | Working Docker server 25.0.18; host Node 20.20.2 is unsuitable for this Node 24 application              |
| Base image                  | Available Amazon-owned AL2023 x86-64 image discovered using the public SSM parameter                     |

## Access blockers

The only existing instance profiles are EMR_EC2_DefaultRole and myS3Role. The former has broad DynamoDB permissions but no CloudWatch Logs delivery permissions. Its PassRole simulation returned implicitDeny with missing context values, so permission to attach it is not established. The latter's PassRole simulation returned allowed, but its inline policy grants S3 access only. Neither profile grants logs:CreateLogStream or logs:PutLogEvents. These results are policy simulations and inspection, not attempted writes.

The Sandbox advertises read-only IAM. Policy attachment/update simulations returned implicitDeny. An instructor or administrator must supply an EC2-trusted instance profile with the table-scoped actions and log-stream permissions in infrastructure/required-existing-role-policy.json, and permit the deployment principal to pass that exact role to EC2. Optional SSM management requires its documented permissions and connectivity separately. Do not embed temporary console credentials in an instance or AMI to work around this restriction.

The published lab restrictions specify Amazon-provided AMIs. Although CreateImage simulation returned allowed, use of a custom offline application AMI has not been established under the RunInstances conditions. Confirm that the existing offline AMI release process is permitted before spending credits on a builder.

## Prepared changes

The templates now use Academy-supported gp2 EBS. The production Docker image and CD preparation artifact include the built maintenance scripts required for migration and summary repair.

An optional generated CloudFront template is available; see [the proposal](AWS_CLOUDFRONT_PROPOSAL.md). It supplies a managed HTTPS hostname but changes the original ingress design. It requires separate architecture and spending approval. Schema validation does not prove runtime connectivity, permissions, deployment success, or application correctness.

## Pending live checks

All requested browser workflows, demo accounts, shared sessions, persistence, actual CloudWatch delivery, isolated 50-user testing, controlled failure testing, and private verified backups remain pending deployment. No passwords or test users have been created. The existing local load runner remains restricted to local targets.

Do not substitute local latency measurements into AWS results. Do not treat Retain or PITR as protection against an Academy account reset. Do not End Lab as part of testing.

## Resumed session — 13 November 2026

The user explicitly authorized starting the stopped lab. It reached Ready with a three-hour timer and displayed $0.10 used of $20. STS matched the account displayed by the authenticated Console in us-east-1. The private administrator request records the account ID; do not assume the account mentioned in an older handoff is active.

A fresh inventory again found no project EC2 instances, EBS volumes, ALBs, ASGs, DynamoDB tables, owned AMIs, CloudFront distributions, certificates, DNS zones, or log groups. The Academy-managed stack and default VPC were preserved. Both existing EC2 instance profiles and their attached/inline policies were inspected again. The access gap described above remains. No IAM modification, billable stack deployment, new database, public ingress, or failure test was performed.

The existing site https://d3uzptvxprgs0y.cloudfront.net/ serves a sign-in page. Its health endpoint returned status ok, database Local SQLite, deployment ec2, and https true; its readiness endpoint returned status ready and database Local SQLite. Its distribution is not in the inspected account's global CloudFront inventory. These responses do not establish ownership of its origin, tested accounts, or the final multi-AZ architecture. The page was not treated as proof that the final deployment is complete.

The production image for application commit 71fa096545f147c6ad5a7fdf1414163192c731da was built in CloudShell from a clean public main clone using the maintained Dockerfile. Node reported v24.22.3. A temporary isolated container passed readiness, health, frontend delivery, and maintenance-script presence checks with no network, a read-only root filesystem, temporary SQLite storage, dropped capabilities and no new privileges. That container was removed. This is a packaging check, not a DynamoDB or live capacity result. The image was exported to a 302,132,736-byte offline tar; SHA-256 bba560ede46984b3f6410b9dac77b60c3276d2e5466aefafb9945134fbddaf23. No passwords, users, AWS keys or backups were supplied to the image build.

The current commit's [CI](https://github.com/ParampPathak/Cloud-Coordination-Hub/actions/runs/43522408230) and [CD preparation](https://github.com/ParampPathak/Cloud-Coordination-Hub/actions/runs/43522758992) succeeded. Neither workflow deploys AWS infrastructure.

An administrator request containing a table/log-scoped policy, EC2 trust, and exact-role PassRole permission was saved privately under artifacts/aws-admin-request/. This is prepared configuration, not a grant already applied. The offline AMI launch restriction still needs resolution; an Amazon-owned Docker-capable AMI with reviewed private artifact bootstrap is a possible alternative, not an implemented workaround.

Organizer and attendee account creation remains part of the deployment task. Do not ask the user to provide accounts that this task is supposed to provision. Once the correct database and access are available, use the trusted provisioning CLI, generate separate strong random passwords, save them privately outside Git, and verify both roles before capturing presentation features.

The offline release was downloaded outside the Sandbox and verified locally. Compressed archive: 95,415,873 bytes; SHA-256 aa527045099026e5cb45d7e3d29b727fd84978b170dd7f26aadd2878f85598d5. Its member list and embedded image checksum were checked again locally. It contains the image, checksum, offline installer, release metadata and isolated packaging-check result only. The local Cloud Computing workspace keeps it under artifacts/aws-release/. This is a reset-safe software artifact, not a backup of production application data. No production database backup was created because this account has no application table.

At the final preflight observation the lab remained Ready with 02:33 remaining and still displayed $0.10 used of $20. No new billable infrastructure was created. The earlier cost allowance remains a proposal: it must be recalculated for the actual image/bootstrap and remaining session before explicit spending approval. No approval to execute a final change set has been obtained.
