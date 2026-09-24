import type { Logger } from "pino";
import type { GitWorktreeBadge } from "../../packages/rt-client/src/commands.ts";
import { createGitClient } from "../../packages/git-core/src/index.ts";
import { toBadge } from "../git-badge.ts";
import { listWorktreesAsync } from "../worktree/git-async.ts";
import { parseIdentity } from "../settings/identity.ts";
import type { RepoIndex } from "../repo-index.ts";
import type { GitBadgesStore } from "./git-badges-store.ts";

export interface GitStatusConfig {
  sweep: boolean;
  sweepIntervalSec: number;
  fetchIntervalSec: number;
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

export interface SweepOptions {
  /** Skips the fetch gate entirely for this pass; badges still recompute from local refs. */
  skipFetch?: boolean;
}

export interface GitStatusSweep {
  tick(): Promise<void>;
  sweepNow(opts?: SweepOptions): Promise<{ changed: string[] }>;
  lastSweepAt(): string | null;
  errors(): Map<string, string>;
}

export function createGitStatusSweep(deps: GitStatusSweepDeps): GitStatusSweep {
  const listWorktrees = deps.listWorktrees ?? listWorktreesAsync;
  const makeClient = deps.makeClient ?? createGitClient;
  const now = deps.now ?? (() => new Date());
  const repoErrors = new Map<string, string>();
  const fetchTimes = new Map<string, number>();
  const fetchesInFlight = new Set<string>();
  let inFlight: Promise<{ changed: string[] }> | null = null;
  let lastCompletedAt: number | null = null;

  async function pass(opts?: SweepOptions): Promise<{ changed: string[] }> {
    const skipFetch = opts?.skipFetch ?? false;
    const index = deps.repoIndex();
    const live = new Set(Object.keys(index));
    const changed: string[] = [];
    for (const [repo, mainPath] of Object.entries(index)) {
      const raw = parseIdentity(repo)?.id ?? null;
      const cfg = deps.readConfig(raw);
      if (!cfg.sweep) continue;
      try {
        const lastFetch = fetchTimes.get(repo) ?? 0;
        if (
          !skipFetch &&
          !fetchesInFlight.has(repo) &&
          cfg.fetchIntervalSec > 0 &&
          now().getTime() - lastFetch >= cfg.fetchIntervalSec * 1000
        ) {
          // Stamped before the attempt: a hanging remote must not re-hang every pass.
          fetchTimes.set(repo, now().getTime());
          fetchesInFlight.add(repo);
          const controller = new AbortController();
          const fetchPromise = makeClient(mainPath).fetch(undefined, controller.signal);
          // Settle-driven cleanup: the abort below makes a timed-out fetch's
          // own child process die promptly, so this now fires close behind it
          // rather than whenever some unrelated future settlement occurs.
          fetchPromise.then(
            () => { fetchesInFlight.delete(repo); },
            () => { fetchesInFlight.delete(repo); },
          );
          let raceTimer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              fetchPromise,
              new Promise((_resolve, reject) => {
                raceTimer = setTimeout(() => {
                  controller.abort();
                  reject(new Error("fetch timed out"));
                }, 60_000);
                raceTimer.unref?.();
              }),
            ]);
          } catch (err) {
            deps.log.warn({ err, repo }, "background fetch failed; snapshotting with stale remote refs");
          } finally {
            clearTimeout(raceTimer);
          }
        }
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

  function sweepNow(opts?: SweepOptions): Promise<{ changed: string[] }> {
    if (inFlight) return inFlight;
    inFlight = pass(opts).finally(() => { inFlight = null; });
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
