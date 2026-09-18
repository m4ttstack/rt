import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../state/db.ts";
import { createGitBadges } from "../git-badges-store.ts";
import { createGitStatusSweep, toBadge } from "../git-status-sweep.ts";
import { makeSandbox } from "../../../packages/git-core/test-support/sandbox.ts";
import { createGitClient } from "../../../packages/git-core/src/index.ts";

function freshStore() {
  return createGitBadges(openStateDb(join(mkdtempSync(join(tmpdir(), "sweep-")), "state.db"), "daemon"));
}

const silentLog = { info() {}, warn() {}, debug() {}, error() {} } as any;

function sweepWith(overrides: Partial<Parameters<typeof createGitStatusSweep>[0]>) {
  return createGitStatusSweep({
    repoIndex: () => ({}),
    store: freshStore(),
    log: silentLog,
    emit: () => {},
    readConfig: () => ({ sweep: true, sweepIntervalSec: 300, fetchIntervalSec: 0 }),
    ...overrides,
  });
}

describe("git status sweep", () => {
  test("sweeps a real repo into badges and emits git-status on change", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "one\n");
      await sb.commitAll("init");
      await sb.write("a.txt", "two\n");
      const store = freshStore();
      const events: Array<{ type: string; data: any }> = [];
      const sweep = sweepWith({
        repoIndex: () => ({ "path:repo": sb.dir }),
        store,
        emit: (type, data) => events.push({ type, data }),
        listWorktrees: async () => [{ path: sb.dir, branch: "main", headSha: null, isBare: false }],
      });
      const { changed } = await sweep.sweepNow();
      expect(changed).toEqual(["path:repo"]);
      expect(events).toEqual([{ type: "git-status", data: { repos: ["path:repo"] } }]);
      const badge = store.readAll().get("path:repo")![0]!;
      expect(badge.branch).toBe("main");
      expect(badge.unstaged).toBe(1);
      expect(badge.clean).toBe(false);
      expect(sweep.lastSweepAt()).not.toBeNull();
    } finally {
      await sb.cleanup();
    }
  });

  test("an unchanged second sweep emits nothing", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "one\n");
      await sb.commitAll("init");
      const events: string[] = [];
      const sweep = sweepWith({
        repoIndex: () => ({ "path:repo": sb.dir }),
        emit: (type) => events.push(type),
        listWorktrees: async () => [{ path: sb.dir, branch: "main", headSha: null, isBare: false }],
      });
      await sweep.sweepNow();
      const before = events.length;
      await sweep.sweepNow();
      expect(events.length).toBe(before);
    } finally {
      await sb.cleanup();
    }
  });

  test("per-repo opt-out skips the repo", async () => {
    const store = freshStore();
    let listed = 0;
    const sweep = sweepWith({
      repoIndex: () => ({ "remote:example.com%2Fa%2Fb": "/nope" }),
      store,
      readConfig: (repoIdentity) =>
        repoIdentity === "example.com/a/b"
          ? { sweep: false, sweepIntervalSec: 300, fetchIntervalSec: 0 }
          : { sweep: true, sweepIntervalSec: 300, fetchIntervalSec: 0 },
      listWorktrees: async () => { listed++; return []; },
    });
    await sweep.sweepNow();
    expect(listed).toBe(0);
  });

  test("a failing repo records an error, keeps prior badges, and does not kill the pass", async () => {
    const store = freshStore();
    store.replaceRepo("bad", [toBadge("/w", { branch: "main", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true }, { lastFetchedAt: null }, "2026-09-17T00:00:00.000Z")]);
    const sweep = sweepWith({
      repoIndex: () => ({ bad: "/definitely/missing" }),
      store,
      listWorktrees: async () => null,
    });
    await sweep.sweepNow();
    expect(sweep.errors().get("bad")).toBeTruthy();
    expect(store.readAll().get("bad")!.length).toBe(1);
  });

  test("tick respects the cadence floor and the global gate", async () => {
    let passes = 0;
    const config = { sweep: true, sweepIntervalSec: 3600, fetchIntervalSec: 0 };
    const sweep = sweepWith({
      repoIndex: () => { passes++; return {}; },
      readConfig: () => config,
    });
    await sweep.tick();
    await sweep.tick();
    expect(passes).toBe(1);
    config.sweep = false;
    await sweep.tick();
    expect(passes).toBe(1);
  });

  test("a repo removed from the index is dropped and announced", async () => {
    const store = freshStore();
    store.replaceRepo("gone", [toBadge("/w", { branch: "x", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true }, { lastFetchedAt: null }, "2026-09-17T00:00:00.000Z")]);
    const events: any[] = [];
    const sweep = sweepWith({ store, emit: (t, d) => events.push({ t, d }) });
    await sweep.sweepNow();
    expect(events).toEqual([{ t: "git-status", d: { repos: ["gone"] } }]);
  });

  test("tick's global gate blocks a sweep even with a zero cadence floor", async () => {
    let passes = 0;
    const sweep = sweepWith({
      repoIndex: () => { passes++; return {}; },
      readConfig: () => ({ sweep: false, sweepIntervalSec: 0, fetchIntervalSec: 0 }),
    });
    await sweep.tick();
    expect(passes).toBe(0);
  });

  test("two sweepNow calls issued without awaiting between them share one pass", async () => {
    let calls = 0;
    const sweep = sweepWith({
      repoIndex: () => { calls++; return {}; },
    });
    const first = sweep.sweepNow();
    const second = sweep.sweepNow();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  test("a repo that fails then succeeds has its error entry cleared", async () => {
    const store = freshStore();
    let attempt = 0;
    const sweep = sweepWith({
      repoIndex: () => ({ repo: "/whatever" }),
      store,
      listWorktrees: async () => {
        attempt++;
        return attempt === 1 ? null : [{ path: "/whatever", branch: "main", headSha: null, isBare: false }];
      },
      makeClient: () => ({
        dir: "/whatever",
        snapshot: async () => ({ branch: "main", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true }),
        fetchState: async () => ({ lastFetchedAt: null }),
      }) as any,
    });
    await sweep.sweepNow();
    expect(sweep.errors().get("repo")).toBeTruthy();
    await sweep.sweepNow();
    expect(sweep.errors().has("repo")).toBe(false);
  });

  test("fetch runs once per cadence on the main worktree only", async () => {
    const fetched: string[] = [];
    const fakeClient = (dir: string) => ({
      snapshot: async () => ({ branch: "main", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true }),
      fetchState: async () => ({ lastFetchedAt: null }),
      fetch: async () => { fetched.push(dir); },
    }) as any;
    const sweep = sweepWith({
      repoIndex: () => ({ r: "/main" }),
      readConfig: () => ({ sweep: true, sweepIntervalSec: 300, fetchIntervalSec: 900 }),
      makeClient: fakeClient,
      listWorktrees: async () => [
        { path: "/main", branch: "main", headSha: null, isBare: false },
        { path: "/wt2", branch: "b", headSha: null, isBare: false },
      ],
    });
    await sweep.sweepNow();
    await sweep.sweepNow();
    expect(fetched).toEqual(["/main"]);
  });

  test("a fetch failure does not stop the snapshot", async () => {
    const sweep = sweepWith({
      repoIndex: () => ({ r: "/main" }),
      readConfig: () => ({ sweep: true, sweepIntervalSec: 300, fetchIntervalSec: 900 }),
      makeClient: ((dir: string) => ({
        snapshot: async () => ({ branch: "main", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true }),
        fetchState: async () => ({ lastFetchedAt: null }),
        fetch: async () => { throw new Error("network down"); },
      })) as any,
      listWorktrees: async () => [{ path: "/main", branch: "main", headSha: null, isBare: false }],
    });
    const { changed } = await sweep.sweepNow();
    expect(changed).toEqual(["r"]);
    expect(sweep.errors().get("r")).toBeUndefined();
  });
});
