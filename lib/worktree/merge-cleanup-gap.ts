/**
 * Why merge-driven worktree cleanup cannot run for a repo, if it can't. The
 * merge reactor and the stale sweep both need the branch cache to hold PR
 * state, which takes a `branches` tracking grant and a forge token; either one
 * missing leaves merged trees claimed with nothing said anywhere.
 */

import { forgeTokenFor, type Forge } from "../enrich.ts";
import { loadSecrets } from "../linear.ts";
import { grants, loadRepoTracking } from "../repo-tracking.ts";
import { runCapture } from "../subprocess.ts";

export type MergeCleanupGap = { reason: "untracked"; forge: Forge } | { reason: "no-token"; forge: Forge };

export async function mergeCleanupGap(repoName: string, repoPath: string): Promise<MergeCleanupGap | null> {
  const remote = await runCapture(["git", "config", "--get", "remote.origin.url"], { cwd: repoPath, timeoutMs: 5000 });
  const remoteUrl = remote.exitCode === 0 ? remote.stdout.trim() || undefined : undefined;
  let secrets: Awaited<ReturnType<typeof loadSecrets>>;
  try {
    secrets = await loadSecrets();
  } catch {
    return null;
  }
  const forge = await forgeTokenFor(remoteUrl, secrets);
  if (!forge) return null;
  if (!grants(loadRepoTracking(), repoName).caches.has("branches")) return { reason: "untracked", forge: forge.forge };
  return forge.token ? null : { reason: "no-token", forge: forge.forge };
}
