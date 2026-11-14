"""Plan B deployment stages. Read-only default; explicit stages write only this new project.
Run under the authorized operator in standard CloudShell, never on application nodes.
No IAM policies or custom application roles are created or modified by this script.
"""
import argparse, hashlib, json, os, secrets, time
from pathlib import Path
from urllib.parse import quote
import boto3
from botocore.config import Config

p=argparse.ArgumentParser();p.add_argument('stage',choices=['preflight','stage','plan','execute','status','start']);p.add_argument('--release-directory',default='');args=p.parse_args()
private=Path.home()/'cch-plan-b-private';private.mkdir(mode=0o700,exist_ok=True);os.chmod(private,0o700)
statefile=private/'state.json'
state=json.loads(statefile.read_text()) if statefile.exists() else {}
s=boto3.Session(region_name='us-east-1');cfg=Config(retries={'max_attempts':2,'mode':'standard'})
def client(name):return s.client(name,config=cfg)
def save():
 statefile.write_text(json.dumps(state,indent=2,default=str));os.chmod(statefile,0o600)
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
identity=client('sts').get_caller_identity();account=identity['Account']
if state.get('account',account)!=account:raise SystemExit('Account changed; stop and review existing state.')
state['account']=account;state['region']='us-east-1';state.setdefault('stackName','cch-plan-b-demo')
operator='arn:aws:iam::'+account+':role/'+identity['Arn'].split(':assumed-role/',1)[1].split('/')[0]
state['operatorRoleArn']=operator
if args.stage=='preflight':
 ec=client('ec2');ssm=client('ssm');iam=client('iam')
 state['ami']=ssm.get_parameter(Name='/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64')['Parameter']['Value']
 image=ec.describe_images(ImageIds=[state['ami']],Owners=['amazon'])['Images'][0]
 state['amiName']=image['Name'];state['owner']=image['OwnerId'];state['root']=image['RootDeviceName']
 if state['root']!='/dev/xvda':raise SystemExit('Unexpected AMI root; review required.')
 azs=[z for z in ec.describe_availability_zones()['AvailabilityZones'] if z['State']=='available' and z['ZoneId']!='use1-az3']
 state['azs']=[z['ZoneName'] for z in azs[:2]]
 if len(state['azs'])!=2:raise SystemExit('Two supported AZs unavailable.')
 state['prefixList']=ec.describe_managed_prefix_lists(Filters=[{'Name':'prefix-list-name','Values':['com.amazonaws.global.cloudfront.origin-facing']}])['PrefixLists'][0]['PrefixListId']
 state.setdefault('bucket','cch-plan-b-'+secrets.token_hex(10));state['profile']='myS3Role'
 profile=iam.get_instance_profile(InstanceProfileName=state['profile'])['InstanceProfile']
 state['appRoleArn']=profile['Roles'][0]['Arn']
 actions=['s3:CreateBucket','s3:PutBucketPublicAccessBlock','s3:PutEncryptionConfiguration','s3:PutBucketPolicy','s3:PutBucketVersioning','s3:PutBucketTagging']
 check=iam.simulate_principal_policy(PolicySourceArn=operator,ActionNames=actions,ResourceArns=['arn:aws:s3:::'+state['bucket']])['EvaluationResults']
 for row in check:
  if row['EvalDecision']!='allowed' or row.get('MissingContextValues'):raise SystemExit('Unestablished staging permission: '+row['EvalActionName'])
 save();print(json.dumps({'readOnly':True,'accountMatched':True,'ami':state['ami'],'amiName':state['amiName'],'azs':state['azs'],'prefixList':state['prefixList'],'profile':state['profile'],'stagingPermissions':'allowed'}))
elif args.stage=='stage':
 if 'ami' not in state:raise SystemExit('Run preflight first.')
 release=Path(args.release_directory).resolve();archive=release/'plan-b-release.tgz'
 if not archive.is_file():raise SystemExit('Verified release archive required.')
 s3=client('s3');bucket=state['bucket']
 if not state.get('bucketCreated'):
  s3.create_bucket(Bucket=bucket);state['bucketCreated']=True;save()
  s3.put_public_access_block(Bucket=bucket,PublicAccessBlockConfiguration={k:True for k in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']})
  s3.put_bucket_encryption(Bucket=bucket,ServerSideEncryptionConfiguration={'Rules':[{'ApplyServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]})
  s3.put_bucket_versioning(Bucket=bucket,VersioningConfiguration={'Status':'Enabled'})
  s3.put_bucket_tagging(Bucket=bucket,Tagging={'TagSet':[{'Key':'Project','Value':'Cloud-Coordination-Hub-Plan-B'}]})
  # The app role already has broad S3 permissions; explicitly deny it all owner setup material.
  policy={'Version':'2012-10-17','Statement':[{'Sid':'DenyNonTLS','Effect':'Deny','Principal':'*','Action':'s3:*','Resource':['arn:aws:s3:::'+bucket,'arn:aws:s3:::'+bucket+'/*'],'Condition':{'Bool':{'aws:SecureTransport':'false'}}},{'Sid':'DenyApplicationOwnerMaterial','Effect':'Deny','Principal':'*','Action':'s3:*','Resource':'arn:aws:s3:::'+bucket+'/operator/*','Condition':{'ArnEquals':{'aws:PrincipalArn':state['appRoleArn']}}}]}
  s3.put_bucket_policy(Bucket=bucket,Policy=json.dumps(policy))
 state['releaseKey']='releases/'+digest(archive)+'/plan-b-release.tgz';state['releaseSha']=digest(archive)
 bootstrap=Path('scripts/bootstrap-plan-b.sh');state['bootstrapKey']='releases/'+digest(bootstrap)+'/bootstrap-plan-b.sh';state['bootstrapSha']=digest(bootstrap)
 s3.upload_file(str(archive),bucket,state['releaseKey'],ExtraArgs={'ServerSideEncryption':'AES256'})
 s3.upload_file(str(bootstrap),bucket,state['bootstrapKey'],ExtraArgs={'ServerSideEncryption':'AES256'})
 state['runtimeKey']='config/application.json';state['releaseDirectory']=str(release)
 state.setdefault('masterPassword',secrets.token_urlsafe(36));state.setdefault('appPassword',secrets.token_urlsafe(36));save()
 print(json.dumps({'stagedPrivateArtifacts':True,'publicAccessBlocked':True,'ownerMaterialDeniedToAppRole':True,'releaseSha256':state['releaseSha'],'bootstrapSha256':state['bootstrapSha']}))
elif args.stage=='plan':
 if not state.get('releaseSha') or not state.get('dockerVersion'):raise SystemExit('Stage release and set the validated exact dockerVersion in private state first.')
 template=json.loads(Path('infrastructure/hub-postgres.json').read_text())
 if template['Resources']['Database']['Properties']['DeletionProtection'] is not False:raise SystemExit('New-demo cleanup setting does not match user approval.')
 # Operator-only owner setup transport through S3; app role is denied this prefix by bucket policy.
 template['Resources']['S3Endpoint']['Properties']['PolicyDocument']['Statement'].append({'Effect':'Allow','Principal':'*','Action':['s3:GetObject','s3:PutObject'],'Resource':'arn:aws:s3:::'+state['bucket']+'/operator/*','Condition':{'ArnEquals':{'aws:PrincipalArn':operator}}})
 template['Outputs']['DatabaseIdentifier']={'Value':{'Ref':'Database'}}
 values={'EnvironmentName':'cch-plan-b-demo','AvailabilityZoneA':state['azs'][0],'AvailabilityZoneB':state['azs'][1],'ApplicationAmi':state['ami'],'ExistingInstanceProfile':state['profile'],'CloudFrontPrefixListId':state['prefixList'],'ArtifactBucket':state['bucket'],'ReleaseKey':state['releaseKey'],'ReleaseSha256':state['releaseSha'],'BootstrapKey':state['bootstrapKey'],'BootstrapSha256':state['bootstrapSha'],'RuntimeConfigKey':state['runtimeKey'],'DockerPackageVersion':state['dockerVersion'],'DatabaseMasterPassword':state['masterPassword'],'DesiredCapacity':'0','MinCapacity':'0','MaxCapacity':'3','PostgresEngineVersion':'17.7'}
 state['parameters']=[{'ParameterKey':k,'ParameterValue':v} for k,v in values.items()]
 state['template']=template;save()
 cf=client('cloudformation');result=cf.create_change_set(StackName=state['stackName'],ChangeSetName='initial-'+secrets.token_hex(4),ChangeSetType='CREATE',TemplateBody=json.dumps(template),Parameters=state['parameters'],Tags=[{'Key':'Project','Value':'Cloud-Coordination-Hub-Plan-B'}])
 state['changeSet']=result['Id'];save();print(json.dumps({'changeSetCreated':True,'stackName':state['stackName'],'appCapacity':0,'rdsDeletionProtection':False,'snapshotOnDeletion':True}))
elif args.stage=='execute':
 cf=client('cloudformation');change=cf.describe_change_set(ChangeSetName=state['changeSet'])
 if change['Status']!='CREATE_COMPLETE':raise SystemExit('Change set not ready: '+change['Status'])
 cf.execute_change_set(ChangeSetName=state['changeSet']);state['executedAt']=time.time();save();print('Approved Plan B change set execution requested; deployment is not yet verified.')
elif args.stage=='status':
 cf=client('cloudformation');stack=cf.describe_stacks(StackName=state['stackName'])['Stacks'][0]
 state['outputs']={x['OutputKey']:x['OutputValue'] for x in stack.get('Outputs',[])};save()
 events=cf.describe_stack_events(StackName=state['stackName'])['StackEvents'][:8]
 print(json.dumps({'stackStatus':stack['StackStatus'],'applicationUrl':state['outputs'].get('ApplicationUrl'),'events':[{'resource':e['LogicalResourceId'],'status':e['ResourceStatus'],'reason':e.get('ResourceStatusReason','')} for e in events]},default=str))
elif args.stage=='start':
 if not state.get('databaseConfigured'):raise SystemExit('Verify private database setup before starting instances.')
 params=[{'ParameterKey':x['ParameterKey'],'UsePreviousValue':True} for x in state['parameters']]
 for x in params:
  if x['ParameterKey'] in ['DesiredCapacity','MinCapacity']:x.pop('UsePreviousValue');x['ParameterValue']='2'
 client('cloudformation').update_stack(StackName=state['stackName'],UsePreviousTemplate=True,Parameters=params)
 print('Requested two private application instances; verify actual target readiness.')
