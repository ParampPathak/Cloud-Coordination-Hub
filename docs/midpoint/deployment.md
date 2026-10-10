# Later AWS Academy deployment — do not execute during local-only work

**Current deployment status: NOT DEPLOYED. No AWS connection, credentials request, change set, EC2 instance, or resource creation was performed.** These instructions are for a separately authorized future session. Local application work does not depend on AWS access.

## What is prepared

`infrastructure/hub.yaml` defines a VPC, Internet Gateway, two public/two private subnets, route tables, ALB/groups/HTTPS listener/HTTP redirect, launch template, Auto Scaling Group and request-based scaling, encrypted retained DynamoDB table with PITR and TTL, DynamoDB gateway endpoint, seven-day CloudWatch log group and dashboard. Optional CloudWatch Logs interface endpoint and CloudTrail/private S3 bucket are disabled by default.

It creates **no IAM resources and no Cognito**, uses no NAT, and never downloads dependencies from private EC2 instances. It accepts an existing instance-profile **name** and prebuilt application AMI. CloudFormation does not need `CAPABILITY_IAM` or `CAPABILITY_NAMED_IAM` for this template.

## Required external prerequisites

1. Separate authorization to connect and deploy, plus a running AWS Academy Sandbox. Keep all work in its approved region. EC2, DynamoDB, CloudFormation, ELB, Auto Scaling, CloudWatch and optional CloudTrail/S3 must be permitted.
2. **Existing suitable EC2 instance profile.** Do not assume `LabInstanceProfile`, `LabRole`, IAM role creation, or policy attachment exists in this Cloud Architecting Sandbox. Read-only IAM may allow inspection but cannot repair missing permissions. The deploying identity must be permitted to attach/pass the existing role. If no suitable profile or PassRole is permitted, ask the instructor/Sandbox administrator for a supported pre-provisioned profile; do not replace role access with stored AWS keys.
3. **Existing permitted certificate in the selected region plus matching DNS.** `ExistingCertificateArn` is required. ACM was not listed among supported services, so certificate availability/import is unresolved. This stack does not create a certificate or DNS record. If unavailable, keep the local midpoint demonstration rather than deploy password login over HTTP. The application deliberately refuses production HTTP. Merely preparing a listener is not proof of functioning HTTPS.
4. **Prepared x86_64 Linux AMI** with Docker already installed, `cloud-coordination-hub:release` preloaded, `/opt/cloud-hub/run.sh` and `cloud-hub.service` installed. Check its root volume device matches `/dev/xvda`; amend the launch template if the approved AMI uses another device. No SSM, ECR, GitHub or internet access is assumed for private instances.
5. An account-approved t2/t3 type. The template's conservative allowlist is not proof every listed type is permitted. Confirm current instance usage plus ASG maximum plus any builder remains ≤9. Minimum ≤ desired ≤ maximum. Default desired one / maximum two; do not claim one-instance high availability.
6. AWS CLI v2 on the deployment workstation; Docker for release packaging; CloudFormation permission for the listed resource types; approved demo audience IPv4 CIDR. DNS/certificate control may need instructor help.

### Existing role permissions for an administrator to verify

The application needs `dynamodb:GetItem`, `Query`, `PutItem`, and `DeleteItem` scoped to the application table ARN. Transaction writes are authorized through the underlying item operations; do not invent an IAM `dynamodb:TransactWriteItems` permission. `PutItem` must cover both aggregates and activity records in this table. Local table initialization additionally needs `DescribeTable`/`CreateTable` only for DynamoDB Local, not the cloud runtime. [required-existing-role-policy.json](../../infrastructure/required-existing-role-policy.json) is a reference for an authorized administrator to adapt, with explicit region/account/table/environment placeholders and an optional logging statement. It is not attached or deployed by this repository.

Optional Docker awslogs delivery needs `logs:CreateLogStream` and `logs:PutLogEvents` on the configured log group streams. The deployer needs permitted `iam:PassRole` for the existing role and CloudFormation/EC2/ELB/Auto Scaling/DynamoDB/VPC/CloudWatch operations (plus S3/CloudTrail only if enabled). Auto Scaling/ELB service-linked roles must already be available or their creation permitted. These are **requirements**, not claims that the account grants them. Endpoint policies limit access but cannot grant missing identity permissions.

## Step 1: finish local verification and prepare an offline image

From the repository in PowerShell:

```powershell
npm ci
npm run check
npm run test:e2e
# After installing Docker Desktop, locally:
docker compose up -d dynamodb
npm run test:dynamodb
python -m pip install -r infrastructure/requirements.txt
cfn-lint infrastructure/hub.yaml
.\scripts\Prepare-Release.ps1
```

The release script runs checks, builds the image, saves `artifacts/cloud-hub-image.tar`, copies the installer, and writes a SHA-256 file. It does not upload, connect to AWS, or deploy. Node 24/build tooling exists in the build stage; only runtime dependencies and compiled output are in the final nonroot image. No `.env`, SQLite database, Git metadata or credentials enter the image.

## Step 2: connect to the Sandbox only after authorization

Start the Academy Sandbox through the course's lab interface. Use its currently issued **temporary** CLI credentials on your own workstation; session token is required. Do not paste them into chat, commit them, save them in `.env`, or use IAM-user access keys. Example PowerShell session-only entry (commands are not run by this task):

```powershell
$env:AWS_ACCESS_KEY_ID = [System.Net.NetworkCredential]::new('', (Read-Host 'Sandbox temporary access key ID' -AsSecureString)).Password
$env:AWS_SECRET_ACCESS_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'Sandbox temporary secret' -AsSecureString)).Password
$env:AWS_SESSION_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'Sandbox temporary session token' -AsSecureString)).Password
$env:AWS_DEFAULT_REGION = 'us-east-1' # Replace with the approved lab region.
aws sts get-caller-identity
```

Verify the returned account is the intended Sandbox. Check existing profile, permissions, certificate, AMI, region and instance quota using the lab console before proceeding. Do not print credentials or inspect all environment variables. Lab sessions expire; use refreshed temporary credentials if necessary. No permanent GitHub credentials or AWS secrets are required.

## Step 3: obtain a suitable release AMI

Prefer an instructor-provided prepared AMI. If a new builder is necessary, separately approve its type, network path, access method and cost. Choose a permitted x86_64 Linux image with Docker preinstalled. A temporary tightly restricted public builder can receive the three release files from the workstation over an approved access path; private application instances never use that path. Do not assume SSH or SSM is permitted in the Sandbox.

On that approved builder, with the bundle in a directory:

```bash
sudo bash install-offline.sh
```

The installer checks the image hash, loads the image and installs the service; it downloads nothing and does not call AWS. Remove temporary credentials, shell history containing sensitive information, test data, and `/etc/cloud-hub.env` if any was written. Do not bake a running application session/database. Stop the builder, create an approved AMI through the EC2 console, record its ID, and clean up the builder under the lab's rules. AMI snapshots remain billable until removed. Image capture and builder creation are cloud actions and were **not performed now**.

Release updates repeat local packaging and AMI preparation, then update `ApplicationAmi` through a reviewed change set. This creates immutable, reproducible app rollouts without runtime network downloads.

## Step 4: review parameters locally

```powershell
Copy-Item infrastructure/parameters.example.json infrastructure/parameters.local.json
# Edit parameters.local.json with actual, nonsensitive resource IDs and approved values.
node scripts/validate-infrastructure.mjs infrastructure/parameters.local.json
```

Replace every placeholder. Set `ApplicationOrigin` to the exact browser HTTPS origin without trailing slash, and `ExistingCertificateArn` to the matching permitted certificate. Default optional paid endpoints/trail remain false. No table name already in use by another stack should be reused. Changing a named table can replace it; retention will preserve the previous table and complicate cleanup.

If available, use an existing account CloudTrail rather than creating a duplicate trail. Enabling remote logs requires the explicit `EnableLogsEndpoint=true` parameter, existing role permissions, and endpoint charges across two AZs. Disabled remote logs mean local bounded Docker logs, **not** verified CloudWatch log delivery.

## Step 5: create and inspect a change set — no resource execution yet

After the prerequisite and cost review:

```powershell
aws cloudformation validate-template --template-body file://infrastructure/hub.yaml
.\scripts\Deploy-ChangeSet.ps1 -Action Create -AllowAws -Region us-east-1
.\scripts\Deploy-ChangeSet.ps1 -Action Inspect -AllowAws -Region us-east-1
```

Use the approved region instead of `us-east-1` when appropriate. The script is blocked without `-AllowAws`; it creates a change set but does not execute it automatically. Review every proposed resource, replacement, retained resource, endpoint choice, quota and cost. `CREATE` is for a new stack; use `-ChangeSetType UPDATE` for an existing one. For failed change sets, inspect `StatusReason`. A review-only new stack may show `REVIEW_IN_PROGRESS`; that is not a deployed application.

## Step 6: execute only after explicit deployment approval

```powershell
.\scripts\Deploy-ChangeSet.ps1 -Action Execute -AllowAws -Region us-east-1
aws cloudformation wait stack-create-complete --stack-name cch-midpoint --region us-east-1
aws cloudformation describe-stacks --stack-name cch-midpoint --region us-east-1 --query 'Stacks[0].Outputs'
```

For an update, use `stack-update-complete`. A completed stack is not proof of application health; UserData does not send a CloudFormation success signal. Use output `AlbDnsName` to point your already permitted hostname at the ALB with the existing DNS provider. Route 53 is not assumed. Verify certificate name/chain and the exact HTTPS origin before sending passwords. A raw ALB DNS hostname normally does not match your certificate.

## Step 7: provision organizer and verify deployment

From the trusted workstation with authorized temporary credentials and application table permissions, provision an organizer **after** the cloud table exists, without seeding sample data or writing credentials to EC2:

```powershell
# Use a fresh shell without a .env local DynamoDB override, or temporarily set it aside safely.
$env:DATABASE_DRIVER = 'dynamodb'
$env:ALLOW_AWS = 'true'
Remove-Item Env:DYNAMODB_ENDPOINT -ErrorAction SilentlyContinue
$env:DYNAMODB_TABLE = 'cloud-coordination-hub'
$env:AWS_REGION = 'us-east-1'
$env:HUB_USER_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'Initial organizer password' -AsSecureString)).Password
node dist/backend/scripts/create-user.js 'organizer@your-domain.edu' 'Project Organizer' organizer
Remove-Item Env:HUB_USER_PASSWORD -ErrorAction SilentlyContinue
```

`dotenv` can reload endpoint values from an existing `.env`, so ensure the trusted provisioning shell has no local-endpoint file active. This CLI prints the public email/role, never the password. If the workstation identity lacks data writes, the administrator must supply an approved provisioning mechanism; do not create public role-management endpoints.

Verify target health and readiness using actual outputs:

```powershell
aws elbv2 describe-target-health --target-group-arn REPLACE_WITH_OUTPUT_TARGET_GROUP_ARN --region us-east-1
Invoke-RestMethod https://YOUR_APPROVED_HOSTNAME/api/health
Invoke-RestMethod https://YOUR_APPROVED_HOSTNAME/api/ready
```

Then repeat the independent-user demo, check real DynamoDB records, log delivery if enabled, metrics and allowed CloudTrail events. Start with one instance; after approved quota/cost review, set minimum/desired two and maximum two to demonstrate multi-instance session sharing and resilience. Existing instances elsewhere still count against nine. Collect real response times, error rates and failure-recovery evidence; none is claimed now.

## Costs and cleanup

Run `node scripts/cost-estimate.mjs 20 1` for an **illustrative assumption-based** estimate. With its editable example unit prices, 20 hours of one small instance, one ALB, one LCU, two ALB public IPv4 addresses and 12 GiB gp3 prorating yields roughly **$1.04** compute/network/storage subtotal. This is not a current quote or an all-in estimate. It excludes DynamoDB/storage/PITR, traffic, dashboard/logging, AMI snapshots, builder time, optional trail/S3, DNS/certificates and taxes. An optional two-AZ Logs endpoint adds an illustrative $0.40/20h plus data processing. Sustained LCU/data transfer or autoscaling can increase costs. No free-tier eligibility is claimed.

Before approval, verify current regional rates and lab credits using [EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/), [ELB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/), [VPC pricing](https://aws.amazon.com/vpc/pricing/), [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/), [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/) and [CloudTrail pricing](https://aws.amazon.com/cloudtrail/pricing/). Use a short demo window, modest instances, desired one unless resilience is being measured, default optional services off, and explicit teardown. Stopping EC2 alone leaves the ALB and other resources billable.

After separate cleanup approval and any required data export:

```powershell
aws cloudformation delete-stack --stack-name cch-midpoint --region us-east-1
aws cloudformation wait stack-delete-complete --stack-name cch-midpoint --region us-east-1
```

The DynamoDB table and optional audit bucket are retained deliberately and may still incur costs. Review and separately delete them only after confirming no needed records/logs remain. Remove unused release AMIs and their snapshots, the image-builder instance/volumes, DNS records, and any unrelated manually created resources according to Sandbox rules. Do not delete the shared existing profile or certificate. Remove credential/environment variables from the workstation session and close it:

```powershell
Remove-Item Env:AWS_ACCESS_KEY_ID,Env:AWS_SECRET_ACCESS_KEY,Env:AWS_SESSION_TOKEN,Env:ALLOW_AWS -ErrorAction SilentlyContinue
```

## Common blockers

- **AccessDenied/PassRole:** existing profile or deployer permissions are insufficient; use the instructor-provided solution. IAM read-only cannot be bypassed by this stack.
- **Unhealthy targets:** inspect offline AMI image/tag/service/device, `/etc/cloud-hub.env`, optional log endpoint permissions, table name/region, Docker logs and readiness. Do not assume successful stack creation means successful app startup.
- **Private software downloads fail:** expected; no NAT. Supply a correctly prepared AMI rather than add unapproved connectivity.
- **Login 403:** browser origin differs from `ApplicationOrigin` (scheme/host/port), or a proxy removed Origin. Fix configuration/DNS, not the CSRF check.
- **HTTPS/certificate access unavailable:** stay local until an approved certificate path exists.
- **Expired lab session:** refresh temporary credentials through Academy after authorization. Never commit credentials or embed them in UserData.
- **Quota/unsupported instance type:** verify all account instances and selected type before change-set execution.
