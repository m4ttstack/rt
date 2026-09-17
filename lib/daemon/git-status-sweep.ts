import type { Logger } from "pino";
import type { GitWorktreeBadge } from "../../packages/rt-client/src/commands.ts";
import type { FetchState, RepoSnapshot } from "../../packages/git-core/src/index.ts";
import { createGitClient } from "../../packages/git-core/src/index.ts";
import { listWorktreesAsync } from "../worktree/git-async.ts";
import { parseIdentity } from "../settings/identity.ts";
import type { RepoIndex } from "../repo-index.ts";
import type { GitBadgesStore } from "./git-badges-store.ts";

export interface GitStatusConfig {
  sweep: boolean;
  sweepIntervalSec: number;
}

export interface GitStatusSweepDeps {
  repoIndex: () => RepoIndex;
  store: GitBadgesStore;
  log: Pick<Logger, "info" | "warn" | "debug" | "error">;
  emit: (type: string, data: unknown) => void;
  /** repoIdentity is the RAW host/path form, or null for the global read. */
  readConfig: (repoIdentity: string | null) => GitStatusConfig;
  listWorktrees?: typeof listWorktreesAsync;
  makeClient?: typeof createGitClient;
  now?: () => Date;
}

export interface GitStatusSweep {
  tick(): Promise<void>;
  sweepNow(): Promise<{ changed: string[] }>;
  lastSweepAt(): string | null;
  errors(): Map<string, string>;
}

export function toBadge(
  worktree: string,
  snap: RepoSnapshot,
  fetch: FetchState,
  updatedAt: string,
): GitWorktreeBadge {
  const files = snap.files;
  return {
    worktree,
    branch: snap.branch,
    detached: snap.detached,
    staged: files.filter((f) => f.staged).length,
    unstaged: files.filter((f) => f.unstaged && f.kind !== "untracked").length,
    untracked: files.filter((f) => f.kind === "untracked").length,
    conflicted: files.filter((f) => f.kind === "conflicted").length,
    clean: snap.clean,
    ahead: snap.ahead,
    behind: snap.behind,
    upstream: snap.upstream,
    lastFetchedAt: fetch.lastFetchedAt,
    updatedAt,
  };
}

export function createGitStatusSweep(deps: GitStatusSweepDeps): GitStatusSweep {
  const listWorktrees = deps.listWorktrees ?? listWorktreesAsync;
  const makeClient = deps.makeClient ?? createGitClient;
  const now = deps.now ?? (() => new Date());
  const repoErrors = new Map<string, string>();
  let inFlight: Promise<{ changed: string[] }> | null = null;
  let lastCompletedAt: number | null = null;

  async function pass(): Promise<{ changed: string[] }> {
    const index = deps.repoIndex();
    const live = new Set(Object.keys(index));
    const changed: string[] = [];
    for (const [repo, mainPath] of Object.entries(index)) {
      const raw = parseIdentity(repo)?.id ?? null;
      if (!deps.readConfig(raw).sweep) continue;
      try {
        const trees = await listWorktrees(mainPath);
        if (trees === null) {
          repoErrors.set(repo, "git worktree list failed");
          continue;
        }
        const badges: GitWorktreeBadge[] = [];
        for (const tree of trees.filter((t) => !t.isBare)) {
          const client = makeClient(tree.path);
          const [snap, fetch] = await Promise.all([client.snapshot(), client.fetchState()]);
          badges.push(toBadge(tree.path, snap, fetch, now().toISOString()));
        }
        if (deps.store.replaceRepo(repo, badges).changed) changed.push(repo);
        repoErrors.delete(repo);
      } catch (err) {
        repoErrors.set(repo, err instanceof Error ? err.message : String(err));
        deps.log.warn({ err, repo }, "git status sweep failed for repo");
      }
    }
    const dropped = deps.store.dropRepos(live);
    for (const repo of dropped) repoErrors.delete(repo);
    const announce = [...changed, ...dropped];
    if (announce.length > 0) deps.emit("git-status", { repos: announce });
    lastCompletedAt = now().getTime();
    return { changed };
  }

  function sweepNow(): Promise<{ changed: string[] }> {
    if (inFlight) return inFlight;
    inFlight = pass().finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    sweepNow,
    async tick() {
      if (inFlight) return;
      const cfg = deps.readConfig(null);
      if (!cfg.sweep) return;
      if (lastCompletedAt !== null && now().getTime() - lastCompletedAt < cfg.sweepIntervalSec * 1000) return;
      await sweepNow();
    },
    lastSweepAt() {
      return lastCompletedAt === null ? null : new Date(lastCompletedAt).toISOString();
    },
    errors() {
      return new Map(repoErrors);
    },
  };
}
