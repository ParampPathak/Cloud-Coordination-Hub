# Classroom deployment checkpoint — 2026-11-15

Infrastructure exists in the replacement Academy Sandbox, but **the application website is not live or verified yet**. This record supersedes the earlier empty-account observation in classroom-guest-access.md. Earlier deployment reports refer to a different lab account and must not be treated as current application verification.

## Observed AWS results

- The actual initial CloudFormation change set contained 29 additions, with no modifications, replacements or deletions. It was executed after explicit replacement-account approval.
- The stack reached CREATE_COMPLETE. CloudFront distribution and VPC origin both report Deployed.
- RDS PostgreSQL reports available and is private. The approved CloudFront managed service-linked role was actually created.
- Auto Scaling desired capacity and instance count are both zero. Database recovery and account provisioning have not run. There are no healthy application instances to claim as a deployed website.
- The seven preserved demo account definitions and verified 88-record backup are staged in the operator-only private S3 prefix. The application role is explicitly denied that prefix.

## Verified software and remaining deployment

Application code 9c538c2 passed 112 default tests, 43 real local PostgreSQL integration tests (including 50 simultaneous guests across two application instances), and real mobile browser checks. Packaging commit fdb2e31 adds both classroom maintenance commands to the runtime image and makes release preparation verify them. GitHub CI passed. The corrected image was built and its commands verified under Node 24.22.3; the complete release is staged with SHA-256 cd78d26cd890841e149c10b655255e743dd00dd51bca5e577d7f9ac6a6426240.

A software-only UPDATE change set is prepared but not executed. It changes the launch template and its Auto Scaling/scaling-policy references. AWS marks the dependent empty group and scaling policy as conditional replacements. The database is absent from this change set. Keep execution deferred until private database recovery and runtime configuration are verified; inspect the group state and actual update outcome before starting the approved two instances.

The private Node 24 database management bundle and guarded restore/provisioning procedure are staged. Empty-database restore refuses overwrites and verifies all 88 records and summary before checking the existing seven accounts and creating the three dedicated organizers. No passwords or backups belong in Git.

## Pending maintenance-session approval

Automatic approval review rejected creation of the temporary CloudShell VPC maintenance environment as outside the 29-resource stack. A specific approval request is pending. No AWS IAM denial occurred for this attempted creation because it was blocked before execution. Do not retry through another API while approval is pending.

The proposed session uses the existing project private subnet and application security group with the current operator identity. It adds no IAM policies, security-group rules, NAT gateway, or extra project EC2 instance. AWS documents no additional CloudShell charge or private-VPC connection charge; ordinary data transfer remains subject to normal billing. See [CloudShell pricing](https://aws.amazon.com/cloudshell/pricing/) and [VPC environment limits](https://docs.aws.amazon.com/cloudshell/latest/userguide/limits.html).

After that approval: restore and verify the database, provision and test all three organizers without resetting existing users, stage guest-enabled runtime configuration, execute/review the corrected software update, start the approved two instances, and verify both ALB targets. Then perform the real AWS 50-guest test, collect current performance evidence, clean only archived disposable test data, and produce the verified public URL, QR code, student instructions and real application screenshots.

The new demo DB retains snapshot-on-deletion with deletion protection disabled, as explicitly approved. Project resources now incur charges even while app capacity is zero; use the existing USD 3 / three-hour allowance and review ongoing usage before extending it. Lab renewal is manual through supported Start Lab; no unattended renewal loop, End Lab or Reset is authorized. Presentation files remain unchanged.
