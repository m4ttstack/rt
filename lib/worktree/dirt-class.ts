/**
 * Uncommitted-state classifier for the triage panel. Sorts a tree's dirty
 * files into none, junk (untracked, matches the repo's declared globs),
 * lockfile (a workspace-own version bump in bun.lock) or real.
 * `discardable` is empty for every kind except junk and lockfile, where it
 * is the exact set `discard: "classified"` may remove.
 */

import { runGit } from "./git-async.ts";

export type DirtKind = "none" | "junk" | "lockfile" | "real";
export interface DirtClass { kind: DirtKind; files: string[]; discardable: string[] }

// pnpm-lock.yaml has no workspace-own version line: every per-dependency entry
// there also has a "version: x.y.z" line, so a version-only pnpm diff is
// always a dependency bump, never safely discardable. bun.lock is the only
// lockfile whose version-only diff form (workspace version, own package)
// stays exclusively self-referential.
const LOCKFILES = new Set(["bun.lock"]);
const VERSION_LINE = /^[+-]\s*"?version"?:\s*"?[^"\s]+"?,?\s*$/;

export function isVersionOnlyLockDiff(unifiedDiff: string): boolean {
  const changed = unifiedDiff
    .split("\n")
    .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"));
  return changed.length > 0 && changed.every((l) => VERSION_LINE.test(l));
}

/** NUL-separated so a path with spaces or quotes arrives verbatim; the
 *  trailing NUL git emits produces one empty tail entry, dropped by filter. */
async function lines0(cwd: string, args: string[]): Promise<string[] | null> {
  const r = await runGit(cwd, [...args, "-z"]);
  return r.exitCode === 0 ? r.stdout.split("\0").filter(Boolean) : null;
}

export async function classifyDirtForTriage(treePath: string, junkGlobs: string[]): Promise<DirtClass> {
  const tracked = await lines0(treePath, ["diff", "--name-only", "HEAD"]);
  const untracked = await lines0(treePath, ["ls-files", "--others", "--exclude-standard"]);
  if (tracked === null || untracked === null) return { kind: "real", files: ["<status-failed>"], discardable: [] };
  const files = [...tracked, ...untracked];
  if (files.length === 0) return { kind: "none", files, discardable: [] };

  const globs = junkGlobs.map((g) => new Bun.Glob(g));
  const junk = untracked.filter((f) => globs.some((g) => g.match(f)));
  if (junk.length !== untracked.length) return { kind: "real", files, discardable: [] };
  if (tracked.length === 0) return { kind: "junk", files, discardable: junk };

  if (!tracked.every((f) => LOCKFILES.has(f))) return { kind: "real", files, discardable: [] };
  for (const f of tracked) {
    const diff = await runGit(treePath, ["diff", "-U0", "HEAD", "--", f]);
    if (diff.exitCode !== 0 || !isVersionOnlyLockDiff(diff.stdout)) return { kind: "real", files, discardable: [] };
  }
  return { kind: "lockfile", files, discardable: [...tracked, ...junk] };
}
