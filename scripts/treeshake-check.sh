#!/usr/bin/env bash
# Tree-shaking gate: builds the minimal-consumer probe (Button + theme
# only, imported through the kit barrels) and fails if any kit module
# outside the expected floor is retained in the bundle. Catches the
# patterns that pin unused modules: top-level component mutations
# (X.displayName = ..., compound statics), unannotated factory calls
# (forwardRef/withProps/Object.assign without /* @__PURE__ */), and
# top-level property reads. See AGENTS.md section 4.
set -euo pipefail
cd "$(dirname "$0")/.."

bunx vite build --config scripts/treeshake-probe/vite.config.ts >/dev/null

node - <<'NODE'
const fs = require('fs');
const dir = 'scripts/treeshake-probe/dist/assets';
const mapFile = fs.readdirSync(dir).find(f => f.endsWith('.js.map'));
const map = JSON.parse(fs.readFileSync(`${dir}/${mapFile}`));

// The floor a Button-only consumer legitimately carries: the design-system
// (theme + its inputs), the styles entry, and RangePicker's module stub
// (pinned by its CJS `dayjs` import; costs ~3 kB gz, accepted).
const ALLOW = [
  /src\/ui\/design-system\//,
  /src\/ui\/styles\//,
  /src\/ui\/core\/range-picker\/RangePicker\.tsx$/,
];

const retained = map.sources
  .filter(s => s.includes('/src/ui/'))
  .filter(s => !ALLOW.some(re => re.test(s)));

if (retained.length > 0) {
  console.error('Tree-shaking gate FAILED. Unused kit modules retained in a minimal build:');
  retained.forEach(s => console.error('  ' + s.replace(/.*src\/ui\//, 'src/ui/')));
  console.error('\nLikely cause: a top-level mutation, unannotated factory call, or property read.');
  process.exit(1);
}
console.log('Tree-shaking gate passed.');
NODE
