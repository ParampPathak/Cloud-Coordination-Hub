# Frontend release handoff for the existing Plan B stack

Use the Git commit linked in the handoff message. From a clean checkout of that commit, record the SHA with `git rev-parse HEAD`. The changed application files are `frontend/App.tsx`, `frontend/Groups.tsx`, `frontend/Scheduling.tsx`, and `frontend/styles.css`.

## Build and verify

Run from a clean checkout on a Docker-capable Linux x86-64 build machine with Node 24.

```bash
npm ci
npm run check
npm run infra:validate:postgres
bash scripts/prepare-plan-b-release.sh
release="artifacts/plan-b-release-$(git rev-parse HEAD)"
(cd "$release" && sha256sum -c upload-checksums.txt)
```

Keep the Vite JS and CSS names from the built `dist/frontend/index.html` or the same file at `/app/dist/frontend/index.html` in the release image for the post-rollout checks. The release script builds and packages locally. It does not publish the archive.

## Roll out through the existing stack

Use the already authorized operator session in `us-east-1`. Confirm the account with STS and verify that `cch-plan-b-demo` is the active stack with two healthy targets before updating. Schedule a demo-free window. The current CloudFormation policy rolls one instance per batch with a five-minute pause and keeps at least one instance in service. It does not wait for application readiness signals. During the mixed-version interval, old and new targets can serve different Vite asset hashes.

1. Save the current `ReleaseKey` and `ReleaseSha256` for rollback. Verify the original S3 object is still present. Read `ArtifactBucket` from this stack. Upload the verified `plan-b-release.tgz` to that private bucket at `releases/<archive-SHA256>/plan-b-release.tgz` with the existing encryption settings. Retain the prior archive and the existing bootstrap.
2. Create an **UPDATE** change set with the current template. Set only `ReleaseKey` and `ReleaseSha256` to the new values and use the previous values for all other parameters. The existing launch template embeds these inputs and the ASG consumes its latest version. Review that the diff is confined to the application launch template and rolling ASG update. Stop on any database, network, IAM or distribution change.
3. Execute the reviewed change set. Watch stack events, ASG activity and ALB target health during the roll. Monitor the public `/api/ready` and 5xx errors. The initial-provisioning stages in `scripts/deploy-plan-b.py` are for bootstrapping a fresh stack. This update reuses the existing PostgreSQL runtime configuration, RDS CA and S3 bootstrap. Skip database initialization, migration, seeding and account provisioning.

Useful checks from the authorized shell:

```bash
export AWS_DEFAULT_REGION=us-east-1 AWS_PAGER=
stack=cch-plan-b-demo
aws sts get-caller-identity
target=$(aws cloudformation describe-stack-resource --stack-name "$stack" --logical-resource-id Targets --query 'StackResourceDetail.PhysicalResourceId' --output text)
group=$(aws cloudformation describe-stack-resource --stack-name "$stack" --logical-resource-id ApplicationGroup --query 'StackResourceDetail.PhysicalResourceId' --output text)
url=$(aws cloudformation describe-stacks --stack-name "$stack" --query "Stacks[0].Outputs[?OutputKey=='ApplicationUrl'].OutputValue | [0]" --output text)
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$group" --query 'AutoScalingGroups[0].Instances[*].[InstanceId,AvailabilityZone,LifecycleState,HealthStatus,LaunchTemplate.Version]'
aws elbv2 describe-target-health --target-group-arn "$target" --query 'TargetHealthDescriptions[*].[Target.Id,TargetHealth.State,TargetHealth.Reason]'
curl -fsS "$url/api/ready"
curl -fsS "$url/" | tee /tmp/cch-release-index.html
```

After `UPDATE_COMPLETE`, match both healthy ALB targets to the two in-service ASG instances on the new launch-template version. Verify the public readiness response reports PostgreSQL. Check the returned HTML against the built asset names and fetch the exact JS and CSS URLs over CloudFront with HTTP 200 and the expected content types. Repeat requests across fresh connections and check in a private browser window. The current stack's CloudFront cache policy uses zero TTLs. Check the active settings if stale HTML persists, and invalidate only affected paths if caching is enabled and the operator has approval. [CloudFront invalidation guidance](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html)

## Roll back

If CloudFormation rolls back automatically, wait for stack stability and recheck target health and the previous asset hashes. If the update completed and verification fails, create a new UPDATE change set using the recorded prior `ReleaseKey` and `ReleaseSha256`. Apply the same review and monitoring and confirm both targets and CloudFront serve the prior build. Keep the same database and runtime configuration throughout. If CloudFormation enters `UPDATE_ROLLBACK_FAILED`, review its failure events before taking further action. [CloudFormation rolling update behavior](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-updatepolicy.html)
