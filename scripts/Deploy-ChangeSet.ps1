param(
  [ValidateSet('Create','Inspect','Execute')][string]$Action = 'Create',
  [string]$StackName = 'cch-midpoint',
  [string]$ChangeSetName = 'cch-reviewed-release',
  [string]$ParametersFile = 'infrastructure/parameters.local.json',
  [string]$Region = 'us-east-1',
  [ValidateSet('CREATE','UPDATE')][string]$ChangeSetType = 'CREATE',
  [switch]$AllowAws
)
$ErrorActionPreference = 'Stop'
if (-not $AllowAws) { throw 'AWS access is disabled. This script requires separate deployment authorization and explicit -AllowAws. Nothing was connected or deployed.' }
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw 'Install AWS CLI v2 before using this future deployment script.' }
if ($Action -eq 'Create') {
  & node scripts/validate-infrastructure.mjs $ParametersFile
  if ($LASTEXITCODE -ne 0) { throw 'Local parameter validation failed.' }
  & aws cloudformation create-change-set --region $Region --stack-name $StackName --change-set-name $ChangeSetName --change-set-type $ChangeSetType --template-body file://infrastructure/hub.yaml --parameters "file://$ParametersFile"
  if ($LASTEXITCODE -ne 0) { throw 'Change-set creation failed; inspect the AWS CLI error.' }
  & aws cloudformation wait change-set-create-complete --region $Region --stack-name $StackName --change-set-name $ChangeSetName
  if ($LASTEXITCODE -ne 0) { throw 'Change set failed. Inspect describe-change-set before retrying.' }
  & aws cloudformation describe-change-set --region $Region --stack-name $StackName --change-set-name $ChangeSetName
  Write-Output 'Review every resource, replacement, retention rule, IAM-profile prerequisite, and cost. Execute is a separate action.'
} elseif ($Action -eq 'Inspect') {
  & aws cloudformation describe-change-set --region $Region --stack-name $StackName --change-set-name $ChangeSetName
} else {
  & aws cloudformation execute-change-set --region $Region --stack-name $StackName --change-set-name $ChangeSetName
}
if ($LASTEXITCODE -ne 0) { throw 'AWS command failed.' }
