"""Read-only AWS options audit: describes/simulations and EC2 DryRun only."""
import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.config import Config

p = argparse.ArgumentParser()
p.add_argument('--account', required=True)
p.add_argument('--region', default='us-east-1')
p.add_argument('--output', default='/tmp/cch-options-audit.json')
args = p.parse_args()
s = boto3.Session(region_name=args.region)
clients = {}
def client(name):
    if name not in clients:
        clients[name] = s.client(name, config=Config(retries={'max_attempts': 0}))
    return clients[name]

account = client('sts').get_caller_identity()['Account']
assert account == args.account, 'Wrong account: no further calls made.'
out = {'account': account, 'region': args.region,
       'observedUTC': datetime.now(timezone.utc).isoformat(), 'readOnly': True}
def safe(fn):
    try:
        return fn()
    except Exception as e:
        return {'error': getattr(e, 'response', {}).get('Error', {}).get('Code', type(e).__name__)}

def record(key, fn):
    out[key] = safe(fn)
    Path(args.output).write_text(json.dumps(out, default=str, indent=2))
    print(json.dumps({'section': key, 'saved': args.output}), flush=True)
    return out[key]

def items(service, operation, key, **kwargs):
    c = client(service)
    if c.can_paginate(operation):
        return [row for page in c.get_paginator(operation).paginate(**kwargs) for row in page.get(key, [])]
    return getattr(c, operation)(**kwargs).get(key, [])

iam = client('iam')
policies = {}
def policy(arn):
    if arn not in policies:
        def load():
            meta = iam.get_policy(PolicyArn=arn)['Policy']
            return {'arn': arn, 'document': iam.get_policy_version(PolicyArn=arn, VersionId=meta['DefaultVersionId'])['PolicyVersion']['Document']}
        policies[arn] = safe(load)
    return policies[arn]

def simulate(principal, actions, resource, context=None):
    def run():
        time.sleep(0.55)  # Pace read-only IAM simulations to avoid account throttling.
        result = iam.simulate_principal_policy(PolicySourceArn=principal,
            ActionNames=actions, ResourceArns=[resource], ContextEntries=context or [])
        return [{k: x[k] for k in ['EvalActionName','EvalResourceName','EvalDecision',
                  'MissingContextValues','PermissionsBoundaryDecisionDetail','OrganizationsDecisionDetail'] if k in x}
                for x in result['EvaluationResults']]
    return safe(run)

def role_audit():
    roles = items('iam', 'list_roles', 'Roles')
    rows = []
    operator = next(r['Arn'] for r in roles if r['RoleName'] == 'voclabs')
    out['operatorArn'] = operator
    for r in roles:
        name = r['RoleName']
        row = {'name': name, 'arn': r['Arn'], 'path': r['Path'], 'trust': r['AssumeRolePolicyDocument']}
        if name == 'voclabs':
            row['detail'] = {'notRetried': 'GetRole and GetRolePolicy are already confirmed explicitly denied for this protected role.'}
        else:
            row['detail'] = safe(lambda: iam.get_role(RoleName=name)['Role'])
        detail = row['detail']
        boundary = detail.get('PermissionsBoundary') or r.get('PermissionsBoundary')
        row['boundary'] = policy(boundary['PermissionsBoundaryArn']) if boundary else (
            'unknown-protected' if name == 'voclabs' else 'none' if 'error' not in detail else 'unknown-denied')
        row['tags'] = detail.get('Tags', [])
        attached = safe(lambda: items('iam', 'list_attached_role_policies', 'AttachedPolicies', RoleName=name))
        row['attached'] = [policy(x['PolicyArn']) for x in attached] if isinstance(attached, list) else attached
        inline = safe(lambda: items('iam', 'list_role_policies', 'PolicyNames', RoleName=name))
        row['inline'] = []
        if isinstance(inline, list):
            for n in inline:
                row['inline'].append({'name': n, 'document': {'notRetried':'Protected operator policy read already denied'} if name == 'voclabs' else safe(lambda: iam.get_role_policy(RoleName=name,PolicyName=n)['PolicyDocument'])})
        else:
            row['inline'] = inline
        row['dynamodb'] = simulate(r['Arn'], ['dynamodb:GetItem','dynamodb:Query','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem'],f'arn:aws:dynamodb:{args.region}:{account}:table/cloud-coordination-hub')
        row['logs'] = simulate(r['Arn'], ['logs:CreateLogStream','logs:PutLogEvents'],f'arn:aws:logs:{args.region}:{account}:log-group:/cch/cch-final:log-stream:probe')
        row['metrics'] = simulate(r['Arn'], ['cloudwatch:PutMetricData'], '*')
        row['s3'] = simulate(r['Arn'], ['s3:GetObject','s3:PutObject'],f'arn:aws:s3:::cch-options-proposal-{account}/release/probe')
        row['operatorPassToEc2'] = simulate(operator,['iam:PassRole'],r['Arn'],[{'ContextKeyName':'iam:PassedToService','ContextKeyType':'string','ContextKeyValues':['ec2.amazonaws.com']}])
        rows.append(row)
    return rows

record('roles', role_audit)
record('profiles', lambda: items('iam','list_instance_profiles','InstanceProfiles'))
record('policyDocuments', lambda: policies)
record('instances', lambda: [i for p in client('ec2').get_paginator('describe_instances').paginate() for r in p['Reservations'] for i in r['Instances']])
record('vpcs', lambda: client('ec2').describe_vpcs()['Vpcs'])
record('subnets', lambda: client('ec2').describe_subnets()['Subnets'])
record('securityGroups', lambda: client('ec2').describe_security_groups()['SecurityGroups'])
record('stacks', lambda: items('cloudformation','describe_stacks','Stacks'))
record('dynamoTables', lambda: client('dynamodb').list_tables()['TableNames'])
record('rds', lambda: items('rds','describe_db_instances','DBInstances'))
record('cache', lambda: items('elasticache','describe_cache_clusters','CacheClusters'))
record('lambdaFunctions', lambda: [{'name':f['FunctionName'],'role':f['Role']} for f in items('lambda','list_functions','Functions')])
record('ecsClusters', lambda: client('ecs').list_clusters()['clusterArns'])
record('s3Buckets', lambda: [{'Name':x['Name']} for x in client('s3').list_buckets()['Buckets']])
record('distributions', lambda: client('cloudfront').list_distributions().get('DistributionList',{}).get('Items',[]))
record('vpcOrigins', lambda: client('cloudfront').list_vpc_origins().get('VpcOriginList',{}))
record('certificates', lambda: client('acm').list_certificates()['CertificateSummaryList'])
record('zones', lambda: client('route53').list_hosted_zones()['HostedZones'])

def image_audit():
    paths = ['/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64',
             '/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended']
    result=[]
    for path in paths:
        data = safe(lambda: client('ssm').get_parameter(Name=path)['Parameter']['Value'])
        row={'parameter':path,'value':data}
        if isinstance(data,str):
            meta=json.loads(data) if data.startswith('{') else {'image_id':data}
            row['metadata']=meta
            row['image']=safe(lambda: client('ec2').describe_images(ImageIds=[meta['image_id']])['Images'][0])
        result.append(row)
    return result
record('amazonImages', image_audit)
record('ownedImages', lambda: client('ec2').describe_images(Owners=['self'])['Images'])
record('rdsPostgresOptions', lambda: items('rds','describe_orderable_db_instance_options','OrderableDBInstanceOptions',Engine='postgres',DBInstanceClass='db.t3.micro',Vpc=True))

operator=out.get('operatorArn')
if operator:
    actions=['ec2:CreateVpc','ec2:CreateSubnet','ec2:CreateRouteTable','ec2:CreateInternetGateway',
             'ec2:AttachInternetGateway','ec2:CreateSecurityGroup','ec2:AuthorizeSecurityGroupIngress',
             'ec2:CreateVpcEndpoint','ec2:CreateLaunchTemplate','ec2:RunInstances',
             'elasticloadbalancing:CreateLoadBalancer','elasticloadbalancing:CreateTargetGroup',
             'elasticloadbalancing:CreateListener','elasticloadbalancing:RegisterTargets',
             'autoscaling:CreateAutoScalingGroup','autoscaling:PutScalingPolicy',
             'cloudformation:CreateStack','cloudformation:CreateChangeSet',
             'cloudfront:CreateVpcOrigin','cloudfront:CreateDistribution',
             's3:CreateBucket','rds:CreateDBInstance','rds:CreateDBSubnetGroup',
             'logs:CreateLogGroup','cloudwatch:PutDashboard','cloudwatch:PutMetricAlarm']
    record('operatorServiceSimulation', lambda: simulate(operator,actions,'*'))
    record('cloudfrontServiceLinkedRoleSimulation', lambda: simulate(operator,['iam:CreateServiceLinkedRole'],f'arn:aws:iam::{account}:role/aws-service-role/vpcorigin.cloudfront.amazonaws.com/AWSServiceRoleForCloudFrontVPCOrigin',[{'ContextKeyName':'iam:AWSServiceName','ContextKeyType':'string','ContextKeyValues':['vpcorigin.cloudfront.amazonaws.com']}]))

def dryrun():
    images=out['amazonImages']
    ecs=next(x for x in images if '/ecs/' in x['parameter'])
    image=ecs['image']
    assert image['OwnerId']=='591542846629' or image.get('ImageOwnerAlias')=='amazon', 'Verify Amazon ownership before DryRun'
    default=next(v for v in out['vpcs'] if v['IsDefault'])
    subnet=next(x for x in out['subnets'] if x['VpcId']==default['VpcId'])
    group=next(x for x in out['securityGroups'] if x['VpcId']==default['VpcId'] and x['GroupName']=='default')
    try:
        client('ec2').run_instances(ImageId=image['ImageId'],InstanceType='t3.micro',MinCount=1,MaxCount=1,
            IamInstanceProfile={'Name':'myS3Role'},NetworkInterfaces=[{'DeviceIndex':0,'SubnetId':subnet['SubnetId'],'Groups':[group['GroupId']],'AssociatePublicIpAddress':False}],
            BlockDeviceMappings=[{'DeviceName':image['RootDeviceName'],'Ebs':{'VolumeType':'gp2','VolumeSize':30,'Encrypted':True,'DeleteOnTermination':True}}],
            MetadataOptions={'HttpTokens':'required'},DryRun=True)
        return {'unexpected':'DryRun returned without expected exception'}
    except Exception as e:
        err=getattr(e,'response',{}).get('Error',{})
        return {'api':'RunInstances','dryRun':True,'result':err.get('Code',type(e).__name__),
                'image':image['ImageId'],'profile':'myS3Role','privateIpOnly':True,
                'note':'Existing default subnet only; not proof of future network or successful bootstrap.'}
record('launchDryRun', dryrun)

def pricing():
    queries = {
        'ec2_t3_micro': ('AmazonEC2', {'instanceType':'t3.micro','operatingSystem':'Linux','tenancy':'Shared','preInstalledSw':'NA','capacitystatus':'Used','location':'US East (N. Virginia)'}),
        'ebs_gp2': ('AmazonEC2', {'volumeApiName':'gp2','location':'US East (N. Virginia)'}),
        'postgres_micro': ('AmazonRDS', {'instanceType':'db.t3.micro','databaseEngine':'PostgreSQL','deploymentOption':'Single-AZ','location':'US East (N. Virginia)'}),
        'postgres_gp2': ('AmazonRDS', {'databaseEngine':'PostgreSQL','deploymentOption':'Single-AZ','volumeType':'General Purpose','location':'US East (N. Virginia)'})
    }
    rows={}
    pricing_denied=False
    for name,(service,filters) in queries.items():
        if pricing_denied:
            rows[name]={"notAttempted":"Pricing access denied; do not repeat the denied API."}
            continue
        def query():
            result=client('pricing').get_products(ServiceCode=service,FormatVersion='aws_v1',
                Filters=[{'Type':'TERM_MATCH','Field':k,'Value':v} for k,v in filters.items()],MaxResults=50)
            prices=[]
            for raw in result['PriceList']:
                product=json.loads(raw)
                for term in product.get('terms',{}).get('OnDemand',{}).values():
                    for d in term['priceDimensions'].values():
                        prices.append({'unit':d['unit'],'usd':d['pricePerUnit'].get('USD'),'description':d['description']})
            return {'prices':prices,'morePages':bool(result.get('NextToken'))}
        rows[name]=safe(query)
        pricing_denied=isinstance(rows[name],dict) and rows[name].get("error") in ["AccessDenied", "AccessDeniedException"]
    return rows
record('pricing', pricing)
print(json.dumps({'status':'saved','file':args.output,'roleCount':len(out.get('roles',[]))}),flush=True)
