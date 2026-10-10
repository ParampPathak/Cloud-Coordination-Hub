// Illustrative unit prices, not an AWS quote. Check current region/account rates before approval.
const hours = Number(process.argv[2] ?? 20);
const instances = Number(process.argv[3] ?? 1);
if (
  !Number.isFinite(hours) ||
  hours <= 0 ||
  !Number.isInteger(instances) ||
  instances < 1 ||
  instances > 9
)
  throw new Error('Usage: node scripts/cost-estimate.mjs HOURS INSTANCES');
const rows = [
  ['EC2 (illustrative $0.0104 / instance-hour)', hours * instances * 0.0104],
  ['ALB (illustrative $0.0225 / hour)', hours * 0.0225],
  ['ALB LCU (illustrative 1 LCU at $0.008 / hour)', hours * 0.008],
  [
    'Two public IPv4 addresses ($0.005 / address-hour assumption)',
    hours * 2 * 0.005,
  ],
  [
    '12 GiB gp3 per instance (illustrative $0.08 / GiB-month, 730h)',
    (hours / 730) * instances * 12 * 0.08,
  ],
];
for (const [name, cost] of rows) console.log(`${name}: $${cost.toFixed(2)}`);
console.log(
  `Illustrative compute/network/storage subtotal (${hours}h): $${rows.reduce((sum, row) => sum + row[1], 0).toFixed(2)}`,
);
console.log(
  'Excluded: DynamoDB requests/storage/PITR, snapshots/AMI storage, traffic, dashboard/logging, optional Logs endpoint, optional CloudTrail/S3, DNS/certificate prerequisites, taxes. Two-AZ Logs endpoint assumption adds 2 × $0.01 × hours plus data processing. Verify live pricing later. This script makes no network calls.',
);
