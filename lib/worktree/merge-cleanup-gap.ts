/**
 * Why merge-driven worktree cleanup cannot run for a repo, if it can't. The
 * merge reactor and the stale sweep both need the branch cache to hold PR
 * state, which takes a `branches` tracking grant and a forge token; either one
 * missing leaves merged trees claimed with nothing said anywhere.
 */

import { forgeTokenFor, type Forge } from "../enrich.ts";
import { grants, type CacheKind, type RepoTracking, type TrackingMode } from "../repo-tracking.ts";
import { runCapture } from "../subprocess.ts";

/** `mode`/`caches` are the grant the repo has now, so a fix can add `branches` without dropping the rest. */
export type MergeCleanupGap =
  | { reason: "no-branches-grant"; forge: Forge; mode: TrackingMode | "off"; caches: CacheKind[] }
  | { reason: "no-token"; forge: Forge };

/** A null `tracking` or `secrets` (a failed read) skips only the check that needs it. */
export async function mergeCleanupGap(
  repoName: string,
  repoPath: string,
  tracking: RepoTracking | null,
  secrets: { gitlabToken?: string; githubToken?: string } | null,
): Promise<MergeCleanupGap | null> {
  const remote = await runCapture(["git", "config", "--get", "remote.origin.url"], { cwd: repoPath, timeoutMs: 5000 });
  const remoteUrl = remote.exitCode === 0 ? remote.stdout.trim() || undefined : undefined;
  const forge = await forgeTokenFor(remoteUrl, secrets ?? {});
  if (!forge) return null;
  if (tracking) {
    const g = grants(tracking, repoName);
    if (!g.caches.has("branches")) return { reason: "no-branches-grant", forge: forge.forge, mode: g.mode, caches: [...g.caches] };
  }
  return secrets && !forge.token ? { reason: "no-token", forge: forge.forge } : null;
}
