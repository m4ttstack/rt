/**
 * The three external binaries the state-backup pipeline shells out to, and
 * where they come from: the copy inside mattstack.app first, then PATH.
 *
 * Bundle-first is what makes a fresh Mac work at all. None of the three ships
 * with macOS, so before the bundle carried them every install needed Homebrew
 * — and the daemon, whose sweep runs the same pipeline, inherits launchd's
 * PATH (/usr/bin:/bin:/usr/sbin:/sbin), which never sees a brew copy either.
 *
 * One module rather than a resolver per call site so the daemon sweep, the
 * CLI verbs and the setup row all resolve the same binary and report the same
 * remedy when none exists.
 */

import { findBundledTool, type Which } from "../bundled-tool.ts";

export const BACKUP_TOOLS = ["age", "zstd", "git-lfs"] as const;
export type BackupTool = (typeof BACKUP_TOOLS)[number];

/** Absolute path of `name`: bundled copy, else PATH, else null. */
export function findBackupTool(name: BackupTool, which?: Which): string | null {
  return findBundledTool(name, which);
}

/** `findBackupTool`, but throws the remedy rather than returning null. */
export function requireBackupTool(name: BackupTool, which?: Which): string {
  const found = findBackupTool(name, which);
  if (found) return found;
  throw new Error(`${name} not found. It ships inside mattstack.app — install the app, or: brew install ${name}`);
}
