// Converts captured PNGs from Chromium's embedded display profile into sRGB.
//
// Screenshots come out of the browser tagged with a Skia profile, and their
// raw pixels are in THAT space -- a panel authored as #eff0f5 samples as
// #edeef3. Anyone pixel-diffing a reference against the artboard source, or
// against a value lifted from tokyo-theme.css, gets a flat 2-9 unit offset
// that belongs to the capture rather than to the code. Converting through the
// embedded profile recovers the authored value exactly.
//
// Run after capture.sh, before committing.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: normalize-captures.mjs <dir-of-pngs>');
  process.exit(2);
}

const pngs = readdirSync(dir).filter(f => f.endsWith('.png'));
if (pngs.length === 0) {
  console.error(`no PNGs in ${dir}`);
  process.exit(1);
}

for (const name of pngs) {
  const path = join(dir, name);
  // sips is macOS-native and does the conversion in place, honouring the
  // embedded profile rather than reinterpreting the pixels.
  execFileSync(
    'sips',
    ['--matchTo', '/System/Library/ColorSync/Profiles/sRGB Profile.icc', path],
    {
      stdio: 'ignore',
    }
  );
  console.log(`normalized ${name}`);
}
