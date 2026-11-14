"""Retry throttled read-only simulations; never retry an AccessDenied operation."""
import boto3,json,time,pathlib
from botocore.config import Config
p=pathlib.Path('/tmp/cch-options-audit.json')
d=json.loads(p.read_text());s=boto3.Session(region_name=d['region'])
assert s.client('sts').get_caller_identity()['Account']==d['account']
i=s.client('iam',config=Config(retries={'max_attempts':0}))
def sim(principal,actions,resource,context=None):
 for attempt in range(4):
  time.sleep(0.55)
  try:
   z=i.simulate_principal_policy(PolicySourceArn=principal,ActionNames=actions,ResourceArns=[resource],ContextEntries=context or [])
   return [{k:x[k] for k in ['EvalActionName','EvalResourceName','EvalDecision','MissingContextValues','PermissionsBoundaryDecisionDetail','OrganizationsDecisionDetail'] if k in x} for x in z['EvaluationResults']]
  except Exception as e:
   code=getattr(e,'response',{}).get('Error',{}).get('Code',type(e).__name__)
   if code!='Throttling' or attempt==3:return {'error':code}
   time.sleep(1+attempt)
a=d['account'];r=d['region'];op=d['operatorArn']
for row in d['roles']:
 choices={'dynamodb':(['dynamodb:GetItem','dynamodb:Query','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem'],f'arn:aws:dynamodb:{r}:{a}:table/cloud-coordination-hub'),
  'logs':(['logs:CreateLogStream','logs:PutLogEvents'],f'arn:aws:logs:{r}:{a}:log-group:/cch/cch-final:log-stream:probe'),
  'metrics':(['cloudwatch:PutMetricData'],'*'),'s3':(['s3:GetObject','s3:PutObject'],f'arn:aws:s3:::cch-options-proposal-{a}/release/probe')}
 for field,(actions,resource) in choices.items():
  if row[field]=={'error':'Throttling'}:row[field]=sim(row['arn'],actions,resource)
 if row['operatorPassToEc2']=={'error':'Throttling'}:
  row['operatorPassToEc2']=sim(op,['iam:PassRole'],row['arn'],[{'ContextKeyName':'iam:PassedToService','ContextKeyType':'string','ContextKeyValues':['ec2.amazonaws.com']}])
 print(json.dumps({'roleCompleted':row['name']}),flush=True)
 if row['name'] in ['lambda-run-role','myBasicLambdaRole']:
  row['operatorPassToLambda']=sim(op,['iam:PassRole'],row['arn'],[{'ContextKeyName':'iam:PassedToService','ContextKeyType':'string','ContextKeyValues':['lambda.amazonaws.com']}])
 p.write_text(json.dumps(d,default=str,indent=2))
actions=['ec2:CreateVpc','ec2:CreateSubnet','ec2:CreateRouteTable','ec2:CreateInternetGateway','ec2:AttachInternetGateway','ec2:CreateSecurityGroup','ec2:AuthorizeSecurityGroupIngress','ec2:CreateVpcEndpoint','ec2:CreateLaunchTemplate','ec2:RunInstances','ec2:CreateNetworkInterface','elasticloadbalancing:CreateLoadBalancer','elasticloadbalancing:CreateTargetGroup','elasticloadbalancing:CreateListener','elasticloadbalancing:RegisterTargets','autoscaling:CreateAutoScalingGroup','autoscaling:PutScalingPolicy','cloudformation:CreateStack','cloudformation:CreateChangeSet','cloudfront:CreateVpcOrigin','cloudfront:CreateDistribution','s3:CreateBucket','rds:CreateDBInstance','rds:CreateDBSubnetGroup','logs:CreateLogGroup','cloudwatch:PutDashboard','cloudwatch:PutMetricAlarm','lambda:CreateFunction','lambda:AddPermission','lambda:InvokeFunction','s3:PutBucketNotification','cloudshell:CreateEnvironment']
if d['operatorServiceSimulation']=={'error':'Throttling'}:d['operatorServiceSimulation']=sim(op,actions,'*')
else:d['additionalServiceSimulation']=sim(op,actions[-6:],'*')
d['contextualPostgresSimulation']=sim(op,['rds:CreateDBInstance'],f'arn:aws:rds:{r}:{a}:db:cch-final-postgres',[
 {'ContextKeyName':'rds:DatabaseClass','ContextKeyType':'string','ContextKeyValues':['db.t3.micro']},
 {'ContextKeyName':'rds:DatabaseEngine','ContextKeyType':'string','ContextKeyValues':['postgres']},
 {'ContextKeyName':'rds:StorageSize','ContextKeyType':'numeric','ContextKeyValues':['20']}])
d['operatorS3ObjectSimulation']=sim(op,['s3:GetObject','s3:PutObject'],f'arn:aws:s3:::cch-options-proposal-{a}/release/probe')
p.write_text(json.dumps(d,default=str,indent=2));print(json.dumps({'completed':True,'file':str(p)}),flush=True)
