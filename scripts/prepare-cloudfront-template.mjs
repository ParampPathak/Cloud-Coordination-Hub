import { readFileSync, writeFileSync } from 'node:fs';
import { parseDocument, isMap, isSeq, isScalar } from 'yaml';
import assert from 'node:assert/strict';
import { format } from 'prettier';
// Derive the alternative from the maintained ALB/ASG template; never call AWS here.
const doc = parseDocument(readFileSync('infrastructure/hub.yaml', 'utf8'));
assert.equal(doc.errors.length, 0);
function convert(node) {
  let value;
  if (isMap(node))
    value = Object.fromEntries(
      node.items.map((pair) => [convert(pair.key), convert(pair.value)]),
    );
  else if (isSeq(node)) value = node.items.map(convert);
  else if (isScalar(node)) value = node.value;
  else value = node;
  if (node?.tag?.startsWith('!')) {
    const tag = node.tag.slice(1);
    if (tag === 'GetAtt' && typeof value === 'string') {
      const dot = value.indexOf('.');
      value = [value.slice(0, dot), value.slice(dot + 1)];
    }
    return { [tag === 'Ref' ? 'Ref' : `Fn::${tag}`]: value };
  }
  return value;
}
const template = convert(doc.contents),
  r = template.Resources;
template.Description =
  'OPTIONAL VARIANT: AWS-managed CloudFront HTTPS hostname, private VPC origin ALB, two-AZ EC2 ASG and shared DynamoDB. Requires separate architecture/cost approval; not deployed.';
for (const key of [
  'ApplicationOrigin',
  'ExistingCertificateArn',
  'AllowedClientCidr',
])
  delete template.Parameters[key];
template.Parameters.CloudFrontOriginPrefixList = {
  Type: 'String',
  AllowedPattern: 'pl-[a-f0-9]+',
  Description:
    'Read-only verified us-east-1 com.amazonaws.global.cloudfront.origin-facing prefix list ID.',
};
r.AlbSecurityGroup.Properties.GroupDescription =
  'Internal ALB accepts only CloudFront origin-facing traffic; no public origin';
r.AlbSecurityGroup.Properties.SecurityGroupIngress = [
  {
    IpProtocol: 'tcp',
    FromPort: 80,
    ToPort: 80,
    SourcePrefixListId: { Ref: 'CloudFrontOriginPrefixList' },
  },
];
r.LoadBalancer.Properties.Scheme = 'internal';
r.LoadBalancer.Properties.Subnets = [{ Ref: 'PrivateA' }, { Ref: 'PrivateB' }];
r.LoadBalancer.DependsOn = [
  'GatewayAttachment',
  'PrivateAssociationA',
  'PrivateAssociationB',
];
delete r.HttpsListener;
delete r.HttpRedirect;
r.PrivateHttpListener = {
  Type: 'AWS::ElasticLoadBalancingV2::Listener',
  Properties: {
    LoadBalancerArn: { Ref: 'LoadBalancer' },
    Port: 80,
    Protocol: 'HTTP',
    DefaultActions: [{ Type: 'forward', TargetGroupArn: { Ref: 'Targets' } }],
  },
};
r.AppVpcOrigin = {
  Type: 'AWS::CloudFront::VpcOrigin',
  DependsOn: ['PrivateHttpListener'],
  Properties: {
    VpcOriginEndpointConfig: {
      Name: { 'Fn::Sub': '${EnvironmentName}-origin' },
      Arn: { Ref: 'LoadBalancer' },
      HTTPPort: 80,
      HTTPSPort: 443,
      OriginProtocolPolicy: 'http-only',
      OriginSSLProtocols: ['TLSv1.2'],
    },
  },
};
r.AppNoCachePolicy = {
  Type: 'AWS::CloudFront::CachePolicy',
  Properties: {
    CachePolicyConfig: {
      Name: { 'Fn::Sub': '${EnvironmentName}-no-cache' },
      DefaultTTL: 0,
      MinTTL: 0,
      MaxTTL: 0,
      ParametersInCacheKeyAndForwardedToOrigin: {
        CookiesConfig: { CookieBehavior: 'none' },
        HeadersConfig: { HeaderBehavior: 'none' },
        QueryStringsConfig: { QueryStringBehavior: 'none' },
        EnableAcceptEncodingGzip: false,
        EnableAcceptEncodingBrotli: false,
      },
    },
  },
};
r.AppOriginRequestPolicy = {
  Type: 'AWS::CloudFront::OriginRequestPolicy',
  Properties: {
    OriginRequestPolicyConfig: {
      Name: { 'Fn::Sub': '${EnvironmentName}-forward-viewer' },
      CookiesConfig: { CookieBehavior: 'all' },
      HeadersConfig: { HeaderBehavior: 'allExcept', Headers: ['host'] },
      QueryStringsConfig: { QueryStringBehavior: 'all' },
    },
  },
};
r.AppDistribution = {
  Type: 'AWS::CloudFront::Distribution',
  Properties: {
    DistributionConfig: {
      Enabled: true,
      Comment: {
        'Fn::Sub':
          '${EnvironmentName}: HTTPS via AWS-managed hostname; private ALB origin',
      },
      HttpVersion: 'http2',
      IPV6Enabled: true,
      PriceClass: 'PriceClass_100',
      ViewerCertificate: { CloudFrontDefaultCertificate: true },
      CustomErrorResponses: [
        400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504,
      ].map((ErrorCode) => ({ ErrorCode, ErrorCachingMinTTL: 0 })),
      Origins: [
        {
          Id: 'private-app',
          DomainName: { 'Fn::GetAtt': ['LoadBalancer', 'DNSName'] },
          VpcOriginConfig: {
            VpcOriginId: { 'Fn::GetAtt': ['AppVpcOrigin', 'Id'] },
            OriginReadTimeout: 30,
            OriginKeepaliveTimeout: 5,
          },
        },
      ],
      DefaultCacheBehavior: {
        TargetOriginId: 'private-app',
        ViewerProtocolPolicy: 'redirect-to-https',
        AllowedMethods: [
          'GET',
          'HEAD',
          'OPTIONS',
          'PUT',
          'PATCH',
          'POST',
          'DELETE',
        ],
        CachedMethods: ['GET', 'HEAD'],
        CachePolicyId: { Ref: 'AppNoCachePolicy' },
        OriginRequestPolicyId: { Ref: 'AppOriginRequestPolicy' },
        Compress: false,
      },
    },
  },
};
const userData =
  r.LaunchTemplate.Properties.LaunchTemplateData.UserData['Fn::Base64'][
    'Fn::Sub'
  ];
assert(userData.includes('APP_ORIGIN=${ApplicationOrigin}'));
r.LaunchTemplate.Properties.LaunchTemplateData.UserData['Fn::Base64'][
  'Fn::Sub'
] = userData.replace(
  'APP_ORIGIN=${ApplicationOrigin}',
  'APP_ORIGIN=https://${AppDistribution.DomainName}',
);
r.ApplicationGroup.DependsOn = [
  'PrivateHttpListener',
  'DynamoEndpoint',
  'PrivateAssociationA',
  'PrivateAssociationB',
];
template.Outputs.ApplicationUrl = {
  Value: { 'Fn::Sub': 'https://${AppDistribution.DomainName}' },
};
template.Outputs.CloudFrontDistribution = { Value: { Ref: 'AppDistribution' } };
template.Outputs.CloudFrontVpcOrigin = {
  Value: { 'Fn::GetAtt': ['AppVpcOrigin', 'Id'] },
};
assert.equal(r.LoadBalancer.Properties.Scheme, 'internal');
assert.equal(r.AppNoCachePolicy.Properties.CachePolicyConfig.MaxTTL, 0);
assert.equal(
  r.AppOriginRequestPolicy.Properties.OriginRequestPolicyConfig.CookiesConfig
    .CookieBehavior,
  'all',
);
assert(!JSON.stringify(template).includes('${ApplicationOrigin}'));
const destination = 'infrastructure/hub-cloudfront.json';
const output = await format(JSON.stringify(template), {
  filepath: destination,
});
if (process.argv.includes('--check')) {
  assert.equal(
    readFileSync(destination, 'utf8').replaceAll('\r\n', '\n'),
    output,
    'Regenerate the optional CloudFront template after changing hub.yaml.',
  );
  console.log('Optional CloudFront template matches hub.yaml. No AWS calls.');
} else {
  writeFileSync(destination, output);
  console.log(
    'Prepared optional CloudFront/VPC-origin template. No AWS calls or deployment.',
  );
}
