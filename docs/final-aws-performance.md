# Final AWS performance — not run

The full two-AZ ALB/ASG/shared-DynamoDB deployment is blocked at IAM preflight. No real 50-user AWS workload or controlled failure test has run.

| Required measurement                                     | Current result            |
| -------------------------------------------------------- | ------------------------- |
| Concurrent authenticated AWS users                       | Not tested                |
| Request totals, expected conflicts and unexpected errors | Not measured              |
| API p50, p95 and p99                                     | Not measured              |
| CPU, memory and CPU credits                              | No final-stack datapoints |
| DynamoDB throttling and consistency under load           | Not tested                |
| ALB latency and two healthy targets                      | No final ALB deployed     |
| Overcapacity and duplicate booking violations            | Not measured on AWS       |
| Failover detection, interruption and replacement times   | Not measured              |

Local results in the optimization report and the isolated CloudShell container packaging check must not be presented as AWS capacity or high-availability measurements. The existing local load runner's production-target restrictions are unchanged. A separate guarded AWS runner is still required before the live workload can be executed.
