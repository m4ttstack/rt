/**
 * The home repo's `filter.lfs.*` config, kept pointed at a git-lfs that
 * exists.
 *
 * `git lfs install` writes PATH-relative commands ("git-lfs clean -- %f"),
 * which a fresh Mac cannot run: git-lfs is not on PATH there, and the daemon
 * (which does the pushing) inherits launchd's PATH, so it would not find a
 * Homebrew copy even on a machine that has one. So the commands carry an
 * absolute path.
 *
 * An absolute path can go stale — the app moving between /Applications and
 * ~/Applications, a flavor switch to mattstack-dev.app, a Homebrew copy
 * uninstalled after `rt state backup init` ran — and a filter command that
 * cannot be executed fails every `git add` in the home repo. The fix chosen
 * here is to rewrite the three keys from the current resolution on every init
 * AND every backup sweep, rather than exposing a stable ~/.local/bin symlink:
 * the rewrite is three `git config` reads per four-hour sweep, it needs no
 * PATH surface of its own (git-lfs stays `exposeByDefault: false`), and it
 * self-heals whichever of those drifts happened without the user doing
 * anything.
 *
 * Repair, never install: only keys that already exist are rewritten. A home
 * repo that never ran `rt state backup init` has no LFS filters, and writing
 * them here would turn on a filter nothing asked for.
 */

import { existsSync } from "fs";
import { join } from "path";

export const LFS_FILTER_KEYS = ["filter.lfs.clean", "filter.lfs.smudge", "filter.lfs.process"] as const;
export type LfsFilterKey = (typeof LFS_FILTER_KEYS)[number];

/** git runs a filter command through the shell, so the binary path is quoted rather than pasted bare. */
function shellQuote(path: string): string {
  return `"${path.replace(/(["\\$`])/g, "\\$1")}"`;
}

export function lfsFilterCommands(bin: string): Record<LfsFilterKey, string> {
  const q = shellQuote(bin);
  return {
    "filter.lfs.clean": `${q} clean -- %f`,
    "filter.lfs.smudge": `${q} smudge -- %f`,
    "filter.lfs.process": `${q} filter-process`,
  };
}

export interface LfsFilterResult {
  /** The binary the config now names, or null when none resolved. */
  bin: string | null;
  /** Keys actually rewritten by this call; empty on a repo already pointing at `bin`. */
  changed: LfsFilterKey[];
}

function gitConfig(repoDir: string, args: string[]): { code: number; stdout: string } {
  const proc = Bun.spawnSync(["git", "config", "--local", ...args], { cwd: repoDir, stderr: "pipe" });
  return { code: proc.exitCode ?? 1, stdout: proc.stdout.toString().trim() };
}

/**
 * Point every `filter.lfs.*` command the repo already declares at `bin`.
 * A null `bin` (nothing bundled, nothing on PATH) leaves the config as it is:
 * a stale path at least names what is missing, where an empty one would not.
 */
export function writeLfsFilterConfig(repoDir: string, bin: string | null): LfsFilterResult {
  if (!bin || !existsSync(join(repoDir, ".git"))) return { bin, changed: [] };

  const want = lfsFilterCommands(bin);
  const changed: LfsFilterKey[] = [];
  for (const key of LFS_FILTER_KEYS) {
    const current = gitConfig(repoDir, ["--get", key]);
    if (current.code !== 0 || current.stdout === "") continue; // not an LFS repo, or not this key
    if (current.stdout === want[key]) continue;
    if (gitConfig(repoDir, [key, want[key]]).code === 0) changed.push(key);
  }
  return { bin, changed };
}
