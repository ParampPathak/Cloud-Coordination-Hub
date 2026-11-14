# AWS poster updates — no live measurements yet

The 13 November 2026 AWS preflight did not produce a running application. Keep all existing measurements explicitly labelled as local SQLite or DynamoDB Local results.

The existing public demo responds using single-instance EC2 and Local SQLite. Do not present it as a verified final-stack URL, successful multi-AZ deployment, verified CloudWatch logs, support for 50 simultaneous AWS users, or measured failover recovery. Those requirements remain untested.

The proposed hostname alternative is: Users → CloudFront HTTPS using an AWS-managed hostname → private ALB → private two-AZ EC2 ASG → shared DynamoDB. Label this as proposed until deployed and verified. The original HTTPS ALB design still requires a matching certificate and a hostname whose DNS is controlled by the team.

No new numerical AWS performance or high-availability statistic is available to replace the local-only poster claims. No poster or PowerPoint has been edited.
