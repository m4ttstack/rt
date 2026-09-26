/**
 * Every git MCP tool runs through this before touching git: agents reach
 * these tools with no permission prompt, so the guard is the only thing
 * standing between an arbitrary path and a git invocation there.
 *
 * The registry (`findTreeByPath`) compares paths as exact strings and never
 * realpaths what it stores, so a symlinked record (macOS /tmp vs /private/tmp,
 * /var vs /private/var, a user symlink) would otherwise be refused even
 * though it names the same tree. `findTreeByRealpath` is the fallback that
 * catches that case by realpathing each stored record before comparing.
 */
import { realpathSync } from "fs";
import { isAbsolute } from "path";
import { loadRepoIndex } from "../repo-index.ts";
import { findTreeByPath } from "../worktree/registry.ts";
import { listKvValues } from "../state/index.ts";

export interface TreeGuardDeps {
  repoIndex: () => Record<string, string>;
  treeByPath: (p: string) => { repoName: string; tree: string } | null;
  realpath: (p: string) => string;
}

/** Namespace `findTreeByPath` (lib/worktree/registry.ts) and `migrateWorktreeRegistry` (lib/repo-index.ts) also key on; kept here since registry.ts does not export it. */
const WORKTREE_REGISTRY_NS = "worktree-registry";

export function findTreeByRealpath(
  path: string,
  byRepo: Record<string, Array<{ name: string; path: string }>>,
  realpath: (p: string) => string,
): { repoName: string; tree: string } | null {
  for (const [repoName, trees] of Object.entries(byRepo)) {
    for (const t of trees) {
      let real: string;
      try {
        real = realpath(t.path);
      } catch {
        continue;
      }
      if (real === path) return { repoName, tree: t.name };
    }
  }
  return null;
}

export const realTreeGuardDeps: TreeGuardDeps = {
  repoIndex: loadRepoIndex,
  treeByPath: (p) =>
    findTreeByPath(p) ??
    findTreeByRealpath(p, listKvValues<Array<{ name: string; path: string }>>(WORKTREE_REGISTRY_NS), realpathSync),
  realpath: (p) => realpathSync(p),
};

export const UNREGISTERED_TREE =
  "tree must be an absolute path to a checkout or worktree of a repo registered with rt (rt repos register in its checkout first)";

export function checkRegisteredTree(
  tree: unknown,
  deps: TreeGuardDeps = realTreeGuardDeps,
): { ok: true; path: string; repoName: string } | { ok: false; error: string } {
  if (typeof tree !== "string" || !isAbsolute(tree)) return { ok: false, error: UNREGISTERED_TREE };
  let path: string;
  try {
    path = deps.realpath(tree);
  } catch {
    return { ok: false, error: `tree ${tree} does not exist` };
  }
  for (const [repoName, checkout] of Object.entries(deps.repoIndex())) {
    let real: string;
    try {
      real = deps.realpath(checkout);
    } catch {
      continue;
    }
    if (real === path) return { ok: true, path, repoName };
  }
  const hit = deps.treeByPath(path);
  if (hit) return { ok: true, path, repoName: hit.repoName };
  return { ok: false, error: UNREGISTERED_TREE };
}
