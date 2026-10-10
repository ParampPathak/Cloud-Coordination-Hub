import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const extensions = /\.(?:json|js|mjs|ts|tsx|css|yaml|yml|html|md)$/;
const paths = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (extensions.test(entry.name)) paths.push(path);
  }
}
for (const entry of readdirSync('.', { withFileTypes: true }))
  if (
    entry.isFile() &&
    extensions.test(entry.name) &&
    entry.name !== 'package-lock.json'
  )
    paths.push(entry.name);
for (const directory of [
  'frontend',
  'backend',
  'shared',
  'scripts',
  'tests',
  'infrastructure',
  'docs',
  '.github',
])
  collect(directory);
const result = spawnSync(
  process.execPath,
  [
    'node_modules/prettier/bin/prettier.cjs',
    process.argv.includes('--check') ? '--check' : '--write',
    ...paths,
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
