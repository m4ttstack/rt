import { describe, expect, test } from "bun:test";
import { createGitStatusHandlers } from "../handlers/git-status.ts";
import type { GitWorktreeBadge } from "../../../packages/rt-client/src/commands.ts";

const badge: GitWorktreeBadge = {
  worktree: "/w", branch: "main", detached: false,
  staged: 1, unstaged: 0, untracked: 0, conflicted: 0, clean: false,
  ahead: 0, behind: 2, upstream: "origin/main",
  lastFetchedAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:01:00.000Z",
};

function fakes(overrides: { refreshCalls?: string[] } = {}) {
  const refreshCalls = overrides.refreshCalls ?? [];
  const sweepNowOpts: unknown[] = [];
  return {
    refreshCalls,
    sweepNowOpts,
    store: { readAll: () => new Map([["repoB", [badge]], ["repoA", [badge]]]) } as any,
    sweep: {
      sweepNow: async (opts?: unknown) => { refreshCalls.push("sweep"); sweepNowOpts.push(opts); return { changed: [] }; },
      lastSweepAt: () => "2026-09-17T00:01:00.000Z",
      errors: () => new Map([["repoC", "git worktree list failed"]]),
      tick: async () => {},
    } as any,
  };
}

describe("repos:status handler", () => {
  test("returns rows sorted by repo, unions error-only repos, includes sweptAt", async () => {
    const f = fakes();
    const handlers = createGitStatusHandlers({ store: f.store, sweep: f.sweep });
    const res = await handlers["repos:status"]({});
    expect(res.ok).toBe(true);
    const data = (res as any).data;
    expect(data.repos.map((r: any) => r.repo)).toEqual(["repoA", "repoB", "repoC"]);
    expect(data.repos[2]).toEqual({ repo: "repoC", worktrees: [], error: "git worktree list failed" });
    expect(data.repos[0].error).toBeNull();
    expect(data.sweptAt).toBe("2026-09-17T00:01:00.000Z");
    expect(f.refreshCalls).toEqual([]);
  });

  test("refresh: true runs a sweep before reading", async () => {
    const f = fakes();
    const handlers = createGitStatusHandlers({ store: f.store, sweep: f.sweep });
    await handlers["repos:status"]({ refresh: true });
    expect(f.refreshCalls).toEqual(["sweep"]);
  });

  test("refresh: true requests a snapshot-only pass (skipFetch)", async () => {
    const f = fakes();
    const handlers = createGitStatusHandlers({ store: f.store, sweep: f.sweep });
    await handlers["repos:status"]({ refresh: true });
    expect(f.sweepNowOpts).toEqual([{ skipFetch: true }]);
  });
});
