/**
 * The mattstack.app bundle layout, as deck sees it.
 *
 * Parity anchor: @mattstack/rt-client's lib/bundle-layout.ts bundleRootFromExec,
 * generalized here to also recognize Contents/Helpers -- rt ships at
 * Contents/MacOS/rt, but deck ships at Contents/Helpers/deck (deps.lock
 * kind:"helper"), and rt's own version only matches "MacOS".
 */

import { basename, dirname, join } from "path";
import { existsSync, realpathSync } from "fs";

/** The .app root containing execPath (resolved through symlinks), or null outside a bundle. */
export function bundleRootFromExec(execPath: string = process.execPath): string | null {
  let real: string;
  try {
    real = realpathSync(execPath);
  } catch {
    return null;
  }
  const binDir = dirname(real);
  const contents = dirname(binDir);
  const root = dirname(contents);
  const binDirName = basename(binDir);
  if (binDirName !== "Helpers" && binDirName !== "MacOS") return null;
  if (basename(contents) !== "Contents") return null;
  if (!root.endsWith(".app") || !existsSync(join(contents, "Info.plist"))) return null;
  return root;
}

/** Absolute path to the bundle's Helpers directory, or null outside a bundle. */
export function bundleHelpersDir(execPath: string = process.execPath): string | null {
  const root = bundleRootFromExec(execPath);
  return root ? join(root, "Contents", "Helpers") : null;
}
