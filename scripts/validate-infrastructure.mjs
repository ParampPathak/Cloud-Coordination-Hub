import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseDocument } from 'yaml';
const document = parseDocument(
  readFileSync('infrastructure/hub.yaml', 'utf8'),
  {
    customTags: [
      '!Ref',
      '!Sub',
      '!GetAtt',
      '!GetAZs',
      '!Select',
      '!Join',
      '!Equals',
    ].map((tag) => ({ tag, resolve: (value) => value })),
  },
);
assert.equal(
  document.errors.length,
  0,
  document.errors.map((e) => e.message).join('\n'),
);
const template = document.toJS();
const resources = Object.values(template.Resources);
assert.equal(template.AWSTemplateFormatVersion, '2010-09-09');
assert(
  !resources.some(
    (r) =>
      r.Type.startsWith('AWS::IAM::') ||
      r.Type.startsWith('AWS::Cognito::') ||
      r.Type === 'AWS::EC2::NatGateway',
  ),
);
assert(
  resources.some((r) => r.Type === 'AWS::ElasticLoadBalancingV2::LoadBalancer'),
);
assert(resources.some((r) => r.Type === 'AWS::AutoScaling::AutoScalingGroup'));
assert.deepEqual(
  template.Parameters.InstanceType.AllowedValues.filter(
    (t) => !/^t[23]\./.test(t),
  ),
  [],
);
assert(Math.max(...template.Parameters.MaxCapacity.AllowedValues) <= 9);
assert.equal(template.Parameters.EnableLogsEndpoint.Default, 'false');
assert.equal(template.Parameters.EnableCloudTrail.Default, 'false');
assert.equal(template.Resources.DataTable.DeletionPolicy, 'Retain');
for (const subnet of ['PrivateA', 'PrivateB'])
  assert.equal(
    template.Resources[subnet].Properties.MapPublicIpOnLaunch,
    false,
  );
assert.equal(
  template.Resources.LaunchTemplate.Properties.LaunchTemplateData
    .MetadataOptions.HttpTokens,
  'required',
);
assert.equal(
  template.Resources.DynamoEndpoint.Properties.VpcEndpointType,
  'Gateway',
);
assert.equal(template.Resources.HttpsListener.Properties.Protocol, 'HTTPS');
assert(!JSON.stringify(template.Resources.LaunchTemplate).includes('apt-get'));
const workflow = parseDocument(
  readFileSync('.github/workflows/ci.yml', 'utf8'),
).toJS();
assert(!JSON.stringify(workflow).includes('aws-actions/'));
assert(!JSON.stringify(workflow).includes('id-token'));
if (process.argv[2]) {
  const parameters = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const input = Object.fromEntries(
    parameters.map((p) => [p.ParameterKey, p.ParameterValue]),
  );
  for (const [key, schema] of Object.entries(template.Parameters)) {
    const value = input[key] ?? schema.Default;
    assert(value !== undefined, `Missing required parameter ${key}`);
    if (schema.AllowedPattern)
      assert(
        new RegExp(`^(?:${schema.AllowedPattern})$`).test(String(value)),
        `Invalid ${key}`,
      );
    if (schema.AllowedValues)
      assert(
        schema.AllowedValues.map(String).includes(String(value)),
        `Invalid ${key}`,
      );
  }
  for (const key of Object.keys(input))
    assert(template.Parameters[key], `Unknown parameter ${key}`);
  assert(
    Number(input.MinCapacity ?? 1) <= Number(input.DesiredCapacity ?? 1),
    'MinCapacity must be <= DesiredCapacity',
  );
  assert(
    Number(input.DesiredCapacity ?? 1) <= Number(input.MaxCapacity ?? 2),
    'DesiredCapacity must be <= MaxCapacity',
  );
  assert(
    !Object.values(input).some((v) => /REPLACE|EXAMPLE/i.test(String(v))),
    'Replace all example values before deployment',
  );
}
console.log(
  'Offline YAML and Academy restriction checks passed. Run cfn-lint for CloudFormation schema validation. No AWS calls were made.',
);
