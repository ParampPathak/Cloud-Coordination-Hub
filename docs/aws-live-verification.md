# AWS live verification — preflight only

Checked on 13 November 2026 in us-east-1. Application baseline: c6c90046f93cd66abe02df21de5bb879c5ddef07 on main.

**Deployment has not started. There is no verified application URL, AWS feature test, live 50-user result, or failover result.** The existing performance reports remain local evidence only.

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
