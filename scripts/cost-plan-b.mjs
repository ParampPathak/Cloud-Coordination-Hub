// Offline model using public AWS rates checked 2026-11-13; not a spending cap.
const hours = Number(process.argv[2] ?? 3);
if (!Number.isFinite(hours) || hours <= 0 || hours > 744)
  throw Error('Use 0 < hours <= 744.');
const rows = {
  ec2TwoT3Micro: 2 * 0.0104 * hours,
  appGp2Two30GiB: (60 * 0.1 * hours) / 730,
  alb: 0.0225 * hours,
  albOneLcuAssumption: 0.008 * hours,
  postgresT3Micro: 0.018 * hours,
  rdsGp2TwentyGiB: (20 * 0.115 * hours) / 730,
};
const fixed = Object.values(rows).reduce((a, b) => a + b, 0);
console.log(
  JSON.stringify(
    {
      hours,
      currency: 'USD',
      ratesChecked: '2026-11-13',
      rows,
      fixedSubtotal: fixed,
      threeHourTrafficMonitoringStorageAllowance: 0.3,
      recommendedThreeHourReserve: 3,
      excluded:
        'RDS CPU surplus, cross-AZ traffic, excess snapshots/backups, taxes; allowances must be recalculated for longer runs. Default staged zero app capacity still bills ALB/RDS/storage. Stopping EC2 does not stop other costs.',
    },
    null,
    2,
  ),
);
