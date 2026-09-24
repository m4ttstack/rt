import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../state/db.ts";
import { createGitBadges } from "../git-badges-store.ts";
import { toBadge } from "../../git-badge.ts";
import { createGitStatusSweep } from "../git-status-sweep.ts";
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
      fetch: async (_remote: string | undefined, signal: AbortSignal) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        fetched.push(dir);
      },
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

  test("skipFetch runs a snapshot-only pass, even with the cadence due", async () => {
    const fetched: string[] = [];
    const fakeClient = (dir: string) => ({
      snapshot: async () => ({ branch: "main", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true }),
      fetchState: async () => ({ lastFetchedAt: null }),
      fetch: async () => { fetched.push(dir); },
    }) as any;
    const sweep = sweepWith({
      repoIndex: () => ({ r: "/main" }),
      readConfig: () => ({ sweep: true, sweepIntervalSec: 300, fetchIntervalSec: 0 }),
      makeClient: fakeClient,
      listWorktrees: async () => [{ path: "/main", branch: "main", headSha: null, isBare: false }],
    });
    await sweep.sweepNow({ skipFetch: true });
    expect(fetched).toEqual([]);
  });

  test("a fetch that never resolves and ignores its signal does not spawn a second fetch for the same repo on the next skip-cadence-eligible pass", async () => {
    const fetched: string[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    // Shrinks only the sweep's own 60s race timer so the test does not
    // block on a real 60s wall-clock wait; every other setTimeout is untouched.
    (globalThis as any).setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) =>
      originalSetTimeout(fn, ms === 60_000 ? 10 : ms, ...rest)) as typeof setTimeout;
    try {
      const fakeClient = (dir: string) => ({
        snapshot: async () => ({ branch: "main", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true }),
        fetchState: async () => ({ lastFetchedAt: null }),
        // A client whose fetch does not honor the abort signal at all: the
        // in-flight guard can only clear once this promise itself settles,
        // and it never does.
        fetch: () => { fetched.push(dir); return new Promise(() => {}); },
      }) as any;
      const sweep = sweepWith({
        repoIndex: () => ({ r: "/main" }),
        readConfig: () => ({ sweep: true, sweepIntervalSec: 0, fetchIntervalSec: 0.001 }),
        makeClient: fakeClient,
        listWorktrees: async () => [{ path: "/main", branch: "main", headSha: null, isBare: false }],
      });
      await sweep.sweepNow();
      await sweep.sweepNow();
      expect(fetched).toEqual(["/main"]);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("a fetch that honors its signal clears the in-flight guard promptly on timeout, allowing a later pass to retry", async () => {
    const fetched: string[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) =>
      originalSetTimeout(fn, ms === 60_000 ? 10 : ms, ...rest)) as typeof setTimeout;
    try {
      const fakeClient = (dir: string) => ({
        snapshot: async () => ({ branch: "main", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true }),
        fetchState: async () => ({ lastFetchedAt: null }),
        // Mirrors rawGit: an aborted signal rejects the fetch promptly, which
        // is what lets fetchesInFlight clear before the next pass runs.
        fetch: (_remote: string | undefined, signal: AbortSignal) => {
          fetched.push(dir);
          return new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        },
      }) as any;
      const sweep = sweepWith({
        repoIndex: () => ({ r: "/main" }),
        readConfig: () => ({ sweep: true, sweepIntervalSec: 0, fetchIntervalSec: 0.001 }),
        makeClient: fakeClient,
        listWorktrees: async () => [{ path: "/main", branch: "main", headSha: null, isBare: false }],
      });
      await sweep.sweepNow();
      await sweep.sweepNow();
      expect(fetched).toEqual(["/main", "/main"]);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
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
