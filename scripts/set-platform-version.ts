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

// A published package can never move backward: npm has no unpublish-and-
// retry story once a version is out. -1 means `to` is older than `from`.
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return (pa[i] as number) - (pb[i] as number);
  }
  return 0;
}

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: bun scripts/set-platform-version.ts <version>');
  process.exit(1);
}

const paths = PACKAGE_DIRS.map(dir => `packages/${dir}/package.json`);
const currentVersions = paths.map(path => String(readPkg(path).version));
for (let i = 0; i < paths.length; i++) {
  if (compareVersions(version, currentVersions[i] as string) < 0) {
    console.error(
      `${version} is older than ${currentVersions[i]} already set in ${paths[i]}. ` +
        'A platform version must never decrease a published package.'
    );
    process.exit(1);
  }
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
