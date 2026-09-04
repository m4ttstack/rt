// Repoints probe/package.json's file:./vendor/ deps at whatever tarballs
// probe:install just packed — the filenames carry versions, so a workspace
// version bump would otherwise strand the probe on a tarball that no longer
// exists (app-server 0.1.1 → 0.1.2 broke it exactly this way).
import { readdirSync, readFileSync, writeFileSync } from 'fs';

const tgzs = readdirSync('probe/vendor').filter(f => f.endsWith('.tgz'));
const pkg = JSON.parse(readFileSync('probe/package.json', 'utf8'));
let changed = false;
for (const f of tgzs) {
  const m = f.match(/^(mattstack-[a-z-]+)-\d+\.\d+\.\d+\.tgz$/);
  if (!m) continue;
  const name = '@mattstack/' + m[1]!.replace(/^mattstack-/, '');
  const ref = `file:./vendor/${f}`;
  if (pkg.dependencies[name] && pkg.dependencies[name] !== ref) {
    pkg.dependencies[name] = ref;
    changed = true;
  }
}
if (changed)
  writeFileSync('probe/package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(
  changed
    ? 'probe deps repointed at freshly packed tarballs'
    : 'probe deps already current'
);
