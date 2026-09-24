/**
 * The mattstack.app bundle layout, as deck sees it.
 *
 * Parity anchor: @mattstack/rt-client's lib/bundle-layout.ts bundleRootFromExec,
 * generalized here to also recognize Contents/Helpers -- rt ships at
 * Contents/MacOS/rt, but deck ships at Contents/Helpers/deck (deps.lock
 * kind:"helper"), and rt's own version only matches "MacOS".
 */

import { existsSync, realpathSync } from 'fs';
import { basename, dirname, isAbsolute, join } from 'path';

/** The shim in the dev bundle runs deck under bun, where execPath is bun
    itself, so it passes the bundle root explicitly. Trusted only when it
    names a real bundle. */
function bundleRootFromEnv(value: string | undefined): string | null {
  if (!value || !isAbsolute(value) || !value.endsWith('.app')) return null;
  return existsSync(join(value, 'Contents', 'Info.plist')) ? value : null;
}

/** The .app root containing execPath (resolved through symlinks), or null outside a bundle. */
export function bundleRootFromExec(execPath?: string): string | null {
  if (execPath === undefined) {
    const fromEnv = bundleRootFromEnv(process.env.DECK_BUNDLE_ROOT);
    if (fromEnv) return fromEnv;
  }
  let real: string;
  try {
    real = realpathSync(execPath ?? process.execPath);
  } catch {
    return null;
  }
  const binDir = dirname(real);
  const contents = dirname(binDir);
  const root = dirname(contents);
  const binDirName = basename(binDir);
  if (binDirName !== 'Helpers' && binDirName !== 'MacOS') return null;
  if (basename(contents) !== 'Contents') return null;
  if (!root.endsWith('.app') || !existsSync(join(contents, 'Info.plist')))
    return null;
  return root;
}

/** Absolute path to the bundle's Helpers directory, or null outside a bundle. */
export function bundleHelpersDir(execPath?: string): string | null {
  const root = bundleRootFromExec(execPath);
  return root ? join(root, 'Contents', 'Helpers') : null;
}
