param([Parameter(Mandatory=$true)][string]$StackName,[string]$Region='us-east-1',[switch]$AllowAws)
$ErrorActionPreference='Stop'
if(-not $AllowAws){throw 'Read-only AWS verification requires -AllowAws and configured temporary credentials.'}
function Read-AwsJson([string[]]$Arguments){
  $result=& aws @Arguments --region $Region --output json
  if($LASTEXITCODE -ne 0){throw "AWS verification failed: $($Arguments[0]) $($Arguments[1])"}
  return ($result | ConvertFrom-Json)
}
$stack=Read-AwsJson @('cloudformation','describe-stacks','--stack-name',$StackName)
$outputs=@{}
foreach($item in $stack.Stacks[0].Outputs){$outputs[$item.OutputKey]=$item.OutputValue}
$targets=Read-AwsJson @('elbv2','describe-target-health','--target-group-arn',$outputs.TargetGroupArn)
if(@($targets.TargetHealthDescriptions | Where-Object {$_.TargetHealth.State -eq 'healthy'}).Count -lt 2){throw 'Fewer than two healthy targets.'}
$group=Read-AwsJson @('autoscaling','describe-auto-scaling-groups','--auto-scaling-group-names',$outputs.AutoScalingGroup)
if(@($group.AutoScalingGroups[0].Instances.AvailabilityZone | Select-Object -Unique).Count -lt 2){throw 'Instances are not spread over two AZs.'}
$ids=@($group.AutoScalingGroups[0].Instances.InstanceId)
$instances=Read-AwsJson (@('ec2','describe-instances','--instance-ids')+$ids)
foreach($instance in $instances.Reservations.Instances){if($instance.PublicIpAddress){throw 'An application instance has a public IP.'}}
$routes=Read-AwsJson @('ec2','describe-route-tables','--filters',"Name=vpc-id,Values=$($outputs.VpcId)")
$endpoints=Read-AwsJson @('ec2','describe-vpc-endpoints','--filters',"Name=vpc-id,Values=$($outputs.VpcId)")
if(-not @($endpoints.VpcEndpoints | Where-Object {$_.ServiceName -like '*.dynamodb' -and $_.State -eq 'available'}).Count){throw 'DynamoDB gateway endpoint is not available.'}
$privateIds=$outputs.PrivateSubnets.Split(',')
foreach($subnetId in $privateIds){
  $tables=@($routes.RouteTables | Where-Object {$_.Associations.SubnetId -contains $subnetId})
  if($tables.Count -ne 1){throw 'Private subnet has no explicit route-table association.'}
  if(@($tables[0].Routes | Where-Object {$_.DestinationCidrBlock -eq '0.0.0.0/0'}).Count){throw 'Private subnet unexpectedly has a default internet route.'}
}
$response=Invoke-WebRequest -Uri "$($outputs.ApplicationUrl)/api/ready"
if($response.StatusCode -ne 200){throw 'HTTPS readiness check failed.'}
$events=Read-AwsJson @('logs','filter-log-events','--log-group-name',$outputs.LogGroup,'--start-time',([DateTimeOffset]::UtcNow.AddMinutes(-15).ToUnixTimeMilliseconds().ToString()),'--limit','10')
if(-not $events.events.Count){throw 'No recent application log events. Verify logging endpoint/profile/runtime before claiming CloudWatch logging.'}
$metrics=Read-AwsJson @('cloudwatch','list-metrics','--namespace','AWS/ApplicationELB','--metric-name','RequestCount')
[pscustomobject]@{Stack=$StackName;HealthyTargets=$targets.TargetHealthDescriptions.Count;AvailabilityZones=($group.AutoScalingGroups[0].Instances.AvailabilityZone | Select-Object -Unique);HttpsReady=$true;RecentLogEvents=$events.events.Count;AlbMetricDefinitions=$metrics.Metrics.Count}
Write-Output 'Read-only checks complete. Inspect stack-specific metric datapoints and perform the separately authorized live failure/load tests; no instances were terminated.'
