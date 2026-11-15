# Actual AWS verification — November 15, 2026

The live website is <https://dpryd7fgeqjpy.cloudfront.net>. Verification used the authenticated Academy AWS console, real service API responses, the public CloudFront endpoint, and the authenticated application browser. Permission simulations were not used as deployment evidence.

| Check                         | Observed result                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Region / stack                | `us-east-1` / `cch-plan-b-demo`, `UPDATE_COMPLETE`                                                                       |
| Dedicated VPC                 | `10.43.0.0/16`                                                                                                           |
| Private subnets               | `10.43.10.0/24` in `us-east-1a`; `10.43.11.0/24` in `us-east-1b`                                                         |
| Application instances         | Two running `t3.micro`, different AZs, no public IPs                                                                     |
| ALB / targets                 | Internal ALB active; both targets healthy on `/api/ready`                                                                |
| Auto Scaling                  | Minimum 2, desired 2, maximum 3                                                                                          |
| CloudFront                    | Distribution and VPC origin deployed; public HTTPS works                                                                 |
| Database                      | PostgreSQL 17.7, `db.t3.micro`, encrypted 20 GiB, private, Single-AZ                                                     |
| Database identity / transport | Restricted `cch_app`; verified RDS TLS certificate                                                                       |
| Bootstrap                     | Pinned Amazon-owned AL2023, checksummed offline release, S3 gateway endpoint                                             |
| IAM                           | Existing approved profile and CloudFront managed role reused; no application policy changes                              |
| Readiness                     | Actual public HTTP 200, PostgreSQL ready                                                                                 |
| Monitoring                    | Three alarms OK; actual EC2, ALB, and RDS datapoints                                                                     |
| Application logs              | Private S3 log batches from both hosts; no direct CloudWatch Logs streaming                                              |
| Shared state                  | All 441 successful-run test request IDs correlated across both application hosts; capacity and booking assertions passed |
| Browser                       | Organizer plus two attendee logins, core demonstration flows, refresh persistence, no recorded browser errors            |
| Screenshots                   | 22 actual captures covering the 19 requested feature requirements; local only                                            |
| Backup                        | Private logical snapshot restored locally; exact equality of 88 records and summary                                      |

The raw resource IDs, restrictive security-group descriptions, target health, monitoring datapoints, and log correlations are stored in the private local recovery bundle. The public [evidence summary](evidence/plan-b-aws-live.json) excludes credentials, AWS account identifiers, and private record contents.

The database is not Multi-AZ. No instance-failure injection was performed. EC2 memory metrics and ASG metric collection are unavailable; ASG capacity was checked directly. Minor presentation/UI observations and operating-cost limits are documented in [the handoff](aws-deployment-handoff.md).
