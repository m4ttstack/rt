import type { Commands, RepoStatusRow } from "../../../packages/rt-client/src/commands.ts";
import type { CommandResult } from "./types.ts";
import type { GitBadgesStore } from "../git-badges-store.ts";
import type { GitStatusSweep } from "../git-status-sweep.ts";

export function createGitStatusHandlers(
  deps: { store: GitBadgesStore; sweep: GitStatusSweep },
): { "repos:status": (payload: unknown) => Promise<CommandResult<"repos:status">> } {
  return {
    "repos:status": async (rawPayload: unknown) => {
      const payload = rawPayload as Commands["repos:status"]["payload"] | undefined;
      if (payload?.refresh) await deps.sweep.sweepNow({ skipFetch: true });
      const badges = deps.store.readAll();
      const errors = deps.sweep.errors();
      const names = new Set([...badges.keys(), ...errors.keys()]);
      const repos: RepoStatusRow[] = [...names]
        .sort((a, b) => a.localeCompare(b))
        .map((repo) => ({
          repo,
          worktrees: badges.get(repo) ?? [],
          error: errors.get(repo) ?? null,
        }));
      return { ok: true as const, data: { repos, sweptAt: deps.sweep.lastSweepAt() } };
    },
  };
}
