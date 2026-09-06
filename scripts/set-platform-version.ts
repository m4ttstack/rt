// Sets the platform version across the four published packages in one
// commit, so ui/server/tokyo/tui-kit always release together. Also
// rewrites app-kit's internal peer on mantine-tokyo to the same version,
// since that peer is the one place a published package depends on
// another published package in this workspace.
import { readFileSync, writeFileSync } from 'fs';

const TOKYO_PEER = '@mattstack/mantine-tokyo';
const PACKAGE_DIRS = ['ui', 'server', 'tokyo', 'tui-kit'] as const;

function readPkg(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writePkg(path: string, pkg: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
}

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: bun scripts/set-platform-version.ts <version>');
  process.exit(1);
}

const rows: { name: string; path: string; from: string; to: string }[] = [];

for (const dir of PACKAGE_DIRS) {
  const path = `packages/${dir}/package.json`;
  const pkg = readPkg(path);
  const from = String(pkg.version);
  pkg.version = version;

  if (dir === 'ui') {
    const peers = pkg.peerDependencies as Record<string, string> | undefined;
    if (peers?.[TOKYO_PEER]) {
      peers[TOKYO_PEER] = `^${version}`;
    }
  }

  writePkg(path, pkg);
  rows.push({ name: String(pkg.name), path, from, to: version });
}

const nameWidth = Math.max(...rows.map(r => r.name.length), 'package'.length);
console.log('Platform version set to', version);
console.log('');
console.log('package'.padEnd(nameWidth), ' from'.padEnd(10), ' to');
for (const r of rows) {
  console.log(r.name.padEnd(nameWidth), r.from.padStart(9), ' ', r.to);
}
console.log('');
console.log(`packages/ui peer ${TOKYO_PEER}: ^${version}`);
