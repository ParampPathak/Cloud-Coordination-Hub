# Optional AWS-managed HTTPS hostname

**Prepared proposal only. Not deployed or approved.** This alternative addresses the absence of an owned domain; it does not resolve the IAM and offline-AMI prerequisites in [the preflight report](aws-live-verification.md).

## Architecture difference

The maintained hub.yaml template requires a matching regional ACM certificate and controlled DNS for its public HTTPS ALB. The repository does not contain a provisioned hostname, and GitHub Pages is disabled.

The optional hub-cloudfront.json template instead uses CloudFront's managed cloudfront.net hostname and default certificate. Browser traffic is HTTPS with HTTP redirects. CloudFront accesses an internal ALB through a VPC origin over private HTTP. The two-AZ private ASG, shared DynamoDB, health checks, capacity limits, and original application controls are retained. This is a change to the requested HTTPS-on-ALB architecture and must be approved explicitly.

The origin ALB accepts port 80 from the regional CloudFront origin-facing managed prefix list. It has no public ingress route or public HTTP origin. The application still accepts traffic only from the ALB security group. CloudFront requires its VPC-origin service-linked role and service-managed network interfaces/security group; approval must include these changes. Do not modify the AWS-managed security group.

Application caching is disabled and supported error responses have a zero error-cache TTL. After deployment, verify that private API responses and failures cannot be served across users. All cookies and query strings and viewer headers except Host are forwarded, preserving authentication and Origin checks. Verify actual login, secure cookies, redirects, CSRF, and cross-instance sessions after deployment; template validation cannot verify them. The default CloudFront certificate uses AWS's default viewer security policy; this proposal does not claim an enforced TLS 1.2 minimum.

## Reproduce and validate without AWS changes

Run node scripts/prepare-cloudfront-template.mjs to regenerate the JSON from hub.yaml, then node scripts/prepare-cloudfront-template.mjs --check. CI checks that the generated file is current and validates its CloudFormation schema alongside the original templates. These commands do not call AWS.

After access is resolved, prepare an offline Node 24 production image without credentials, users, or backups. Do not run the application with CloudShell's host Node 20. Fill only actual verified AMI/profile/prefix-list values in a private parameter file; do not deploy example placeholders. Review the resulting change set and cost proposal before execution. Use ASG minimum/desired two and maximum three. Enable log delivery only when both role permissions and the private Logs endpoint are available.

## Preliminary three-hour cost allowance

This is a planning allowance, not approval or a hard cap. It conservatively exceeds the 02:11 remaining at the last lab check. Recalculate for the actual session, resource plan, regional rates, and current credit balance immediately before requesting spending approval.

| Component and assumption                                                        | Approximate USD |
| ------------------------------------------------------------------------------- | --------------: |
| Two t3.micro instances, 3 hours at $0.0104/hour each                            |           0.063 |
| Two 12 GiB gp2 volumes, $0.10/GiB-month using 730 hours/month                   |           0.010 |
| Internal ALB, 3 hours at $0.0225 plus one $0.008 LCU/hour                       |           0.092 |
| CloudFront requests and transfer allowance                                      |           0.100 |
| DynamoDB requests, storage and PITR allowance                                   |           0.200 |
| CloudWatch dashboard, metrics, alarms and small log volume allowance            |           0.100 |
| Logs endpoint in two AZs, $0.01/ENI-hour, excluding small data-processing usage |           0.060 |
| Temporary image builder including compute, volume and public IPv4 allowance     |           0.150 |
| AMI snapshot storage allowance                                                  |           0.010 |
| Optional private image artifact S3 storage/requests allowance                   |           0.010 |
| CPU surplus and brief third-instance headroom allowance                         |           0.700 |
| **Rounded planning reserve**                                                    |        **2.00** |

There are no NAT gateways. The internal ALB and private app instances have no charged public IPv4 addresses; the temporary builder allowance includes one. DynamoDB gateway endpoints have no hourly charge. Optional SSM endpoints, CloudTrail, DNS registration, paid CDN plans, extra builders or instance upgrades are excluded and must not be added without a revised estimate. CloudFront VPC origins have no additional feature fee, but normal CDN charges apply. Request/transfer allowances assume a short classroom test, not unbounded public usage. No free-tier benefit is assumed.

EC2, ALB, endpoints, volumes, snapshots, retained DynamoDB data/PITR, and stored artifacts can continue charging after tests. A budget notification does not stop charges. Review cleanup separately; do not delete records or end the lab without the required authorization and verified private backup.

Sources: [EC2 T3](https://aws.amazon.com/ec2/instance-types/t3/), [ELB](https://aws.amazon.com/elasticloadbalancing/pricing/), [EBS](https://aws.amazon.com/ebs/pricing/), [VPC IPv4](https://aws.amazon.com/vpc/pricing/), [PrivateLink](https://aws.amazon.com/privatelink/pricing/), [CloudFront](https://aws.amazon.com/cloudfront/pricing/), [DynamoDB](https://aws.amazon.com/dynamodb/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/). Runtime charges and account restrictions remain to be verified.

References: [CloudFront default certificate](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesGeneral.html), [VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html), [service-linked role](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-service-linked-roles.html).
