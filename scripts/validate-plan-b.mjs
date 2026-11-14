// Offline checks only. cfn-lint validates provider schemas separately.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const t = JSON.parse(readFileSync('infrastructure/hub-postgres.json', 'utf8')),
  r = t.Resources;
assert(
  !Object.values(r).some(
    (x) => x.Type.startsWith('AWS::IAM::') || x.Type === 'AWS::EC2::NatGateway',
  ),
);
assert.equal(r.Database.Properties.MultiAZ, false);
assert.equal(r.Database.Properties.PubliclyAccessible, false);
assert.equal(r.Database.Properties.StorageEncrypted, true);
assert.equal(r.Database.Properties.DeletionProtection, true);
assert.equal(r.Database.DeletionPolicy, 'Snapshot');
assert.equal(r.DatabaseParameters.Properties.Parameters['rds.force_ssl'], '1');
assert.equal(r.LoadBalancer.Properties.Scheme, 'internal');
assert.equal(r.VpcOrigin.Type, 'AWS::CloudFront::VpcOrigin');
assert.equal(
  r.Distribution.Properties.DistributionConfig.DefaultCacheBehavior
    .ViewerProtocolPolicy,
  'redirect-to-https',
);
assert.equal(r.NoCache.Properties.CachePolicyConfig.MaxTTL, 0);
assert.equal(
  r.OriginRequests.Properties.OriginRequestPolicyConfig.CookiesConfig
    .CookieBehavior,
  'all',
);
assert.equal(t.Parameters.DesiredCapacity.Default, 0);
for (const name of ['PrivateA', 'PrivateB'])
  assert.equal(r[name].Properties.MapPublicIpOnLaunch, false);
assert.notDeepEqual(
  r.PrivateA.Properties.AvailabilityZone,
  r.PrivateB.Properties.AvailabilityZone,
);
assert(!Object.values(r).some((x) => x.Type === 'AWS::EC2::Route'));
assert.equal(
  r.LaunchTemplate.Properties.LaunchTemplateData.NetworkInterfaces[0]
    .AssociatePublicIpAddress,
  false,
);
assert.equal(
  r.LaunchTemplate.Properties.LaunchTemplateData.MetadataOptions.HttpTokens,
  'required',
);
assert.equal(
  r.LaunchTemplate.Properties.LaunchTemplateData.CreditSpecification.CpuCredits,
  'standard',
);
assert.equal(
  r.LaunchTemplate.Properties.LaunchTemplateData.BlockDeviceMappings[0].Ebs
    .VolumeType,
  'gp2',
);
const data = JSON.stringify(
  r.LaunchTemplate.Properties.LaunchTemplateData.UserData,
);
assert(!data.includes('DatabaseMasterPassword'));
assert(data.includes('BootstrapSha256'));
assert.equal(r.DatabaseSecurityGroup.Properties.SecurityGroupIngress.length, 1);
assert.deepEqual(
  r.DatabaseSecurityGroup.Properties.SecurityGroupIngress[0]
    .SourceSecurityGroupId,
  { Ref: 'AppSecurityGroup' },
);
// Template dependency graph must have no implicit/explicit resource cycle.
const graph = new Map();
function deps(value, found) {
  if (!value || typeof value !== 'object') return;
  if (value.Ref && r[value.Ref]) found.add(value.Ref);
  if (value['Fn::GetAtt']) found.add(value['Fn::GetAtt'][0]);
  if (value['Fn::Sub'] && typeof value['Fn::Sub'] === 'string')
    for (const match of value['Fn::Sub'].matchAll(
      /\$\{([A-Za-z0-9]+)(?:\.[^}]+)?\}/g,
    ))
      if (r[match[1]]) found.add(match[1]);
  for (const item of Object.values(value)) deps(item, found);
}
for (const [name, res] of Object.entries(r)) {
  const found = new Set();
  deps(res.Properties, found);
  for (const dep of [res.DependsOn ?? []].flat()) found.add(dep);
  graph.set(name, found);
}
const done = new Set(),
  active = new Set();
function visit(n) {
  if (done.has(n)) return;
  assert(!active.has(n), `CloudFormation cycle at ${n}`);
  active.add(n);
  for (const dep of graph.get(n) ?? []) visit(dep);
  active.delete(n);
  done.add(n);
}
for (const name of graph.keys()) visit(name);
console.log(
  'Plan B offline invariants and dependency graph passed; no AWS resources created.',
);
