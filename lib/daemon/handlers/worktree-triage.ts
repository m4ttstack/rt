import type { Logger } from "pino";
import type { RunningRunScan } from "../../runs/store.ts";
import type { TreeRecord } from "../../worktree/registry.ts";
import { triageRepo } from "../../worktree/triage/facts.ts";
import { triageCounts, type TriageRow } from "../../worktree/triage/verdict.ts";
import { loadRepoTracking } from "../../repo-tracking.ts";
import { loadSecrets } from "../../linear.ts";
import { mergeCleanupGap, type MergeCleanupGap } from "../../worktree/merge-cleanup-gap.ts";
import { targetRepos } from "./worktree.ts";

export interface WorktreeTriageOpts {
  findRunningRunByWorktree: (worktree: string) => RunningRunScan;
  jobTreeHold: (rec: TreeRecord) => string | null;
  kick: () => void;
  emit: (type: string, data: unknown) => void;
}

export function createWorktreeTriageHandlers(
  ctx: { repoIndex: () => Record<string, string>; cache: { entries: Record<string, any> }; log: Logger },
  opts: WorktreeTriageOpts,
) {
  const deps = () => ({ cacheEntries: ctx.cache.entries, jobTreeHold: opts.jobTreeHold, findRunningRun: opts.findRunningRunByWorktree });
  return {
    "worktree:triage": async (payload: any) => {
      const repos = targetRepos(ctx, payload?.repoName);
      if (repos.length === 0 && payload?.repoName) return { ok: false as const, error: "repo-unknown" };
      const rows: TriageRow[] = [];
      const banners: Array<{ repo: string; path: string } & MergeCleanupGap> = [];
      const tracking = (() => { try { return loadRepoTracking(); } catch { return null; } })();
      const secrets = await loadSecrets().catch(() => null);
      for (const [repo, path] of repos) {
        try {
          rows.push(...(await triageRepo(repo, path, deps())));
        } catch (err) {
          ctx.log.warn({ err, repo }, "worktree:triage: repo failed");
        }
        const gap = await mergeCleanupGap(repo, path, tracking, secrets);
        if (gap) banners.push({ repo, path, ...gap });
      }
      return { ok: true as const, data: { rows, banners, counts: triageCounts(rows) } };
    },
  };
}
