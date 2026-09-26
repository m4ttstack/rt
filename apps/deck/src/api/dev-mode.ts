import { readFileSync } from 'fs';
import { join } from 'path';

import { bundleRootFromExec } from '../services/bundle-layout.ts';

// rt-tray's build.sh stamps MSDevBuild into both flavors' Info.plist: true in
// mattstack-dev.app, false in mattstack.app. The running bundle is the only
// dev/prod switch; outside a bundle deck runs as production (fail closed).
const DEV_BUILD = /<key>MSDevBuild<\/key>\s*<true\s*\/>/;

export function isDevBundle(
  bundleRoot: string | null = bundleRootFromExec()
): boolean {
  if (!bundleRoot) return false;
  try {
    return DEV_BUILD.test(
      readFileSync(join(bundleRoot, 'Contents', 'Info.plist'), 'utf8')
    );
  } catch {
    return false;
  }
}

let memo: boolean | undefined;

/** The running process's flavor, which cannot change without a restart. */
export function isDevMode(): boolean {
  memo ??= isDevBundle();
  return memo;
}
