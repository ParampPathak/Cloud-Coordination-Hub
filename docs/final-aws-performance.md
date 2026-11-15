# Measured AWS performance

On November 15, 2026, the authorized bounded test ran against <https://dpryd7fgeqjpy.cloudfront.net> with **50 concurrent simulated users**. It used disposable accounts and isolated records on the actual CloudFront → internal ALB → two private EC2 → shared RDS PostgreSQL deployment.

| Measurement                                     |                            Actual result |
| ----------------------------------------------- | ---------------------------------------: |
| Test duration                                   |                            9.568 seconds |
| Total requests                                  |                                      441 |
| Successful 2xx responses                        |                                      373 |
| Expected 409 conflicts                          |                                       66 |
| Expected authorization responses                | 2: organizer-only 403 and logged-out 401 |
| Unexpected failures / server errors             |                                    0 / 0 |
| API p50                                         |                                   149 ms |
| API p95                                         |                                   561 ms |
| API p99                                         |                                 1,040 ms |
| Duplicate registrations / capacity violations   |            0 / 0, verified by assertions |
| Test requests matched to application host A / B |                                221 / 220 |

Each phase synchronized up to 50 users: login, event registration, appointment contention, voting, and dashboard requests. Group contention used 20 users for a four-seat group. The 66 expected conflicts comprised 49 rejected appointment contenders, 16 rejected group contenders, and one duplicate event-registration attempt. FIFO promotion after cancellation, rescheduling/cancellation, nine four-seat groups, group CSV export, and recorded votes all passed.

The first partial run stopped at an overlapping appointment fixture that the application correctly rejected. Its 159-request result is preserved locally. The runner was corrected to choose a free interval before the successful complete run; no application safeguards were relaxed. Disposable test accounts, resources, and related activity were archived before cleanup. Presentation accounts and records were preserved.

## Actual native AWS observations

CloudWatch data was collected for 22:40–22:55 UTC, covering the tests. During the 22:45 five-minute EC2 aggregation interval, average CPU was approximately 2.17% and 2.16% on the two instances. These are five-minute aggregates, not instantaneous test peaks. At 22:48 UTC, RDS CPU averaged 4.23%, and ALB target response time averaged 137 ms with a maximum observed datapoint of 920 ms. Healthy-target count was two. All three configured alarms were OK at final collection.

Application response request IDs were matched to private S3 log batches from both EC2 hosts, establishing that the real bounded workload reached both nodes. The private evidence retains datapoints and request correlations. Direct CloudWatch application-log streaming, EC2 memory metrics, and ASG metric collection were not configured; ASG 2/2/3 capacity was verified through the service API.

This phase-based test demonstrates correctness and the reported latency for a small bounded workload. It is not a sustained-throughput, failover, or long-term availability benchmark. The p95 result met the one-second target. [Sanitized machine-readable evidence](evidence/plan-b-aws-live.json) and [actual deployment verification](aws-live-verification.md) distinguish these AWS measurements from earlier local tests.
