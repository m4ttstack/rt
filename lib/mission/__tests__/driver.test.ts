import { describe, expect, test } from "bun:test";
import {
  DiffSelection,
  type BranchInfo,
  type GitClient,
  type RepoSnapshot,
  type StagingDiff,
} from "../../../packages/git-core/src/index.ts";
import { DiffLine, DiffLineType } from "../../../packages/git-core/src/vendor/ghd/diff-line.ts";
import { DiffHunk, DiffHunkExpansionType, DiffHunkHeader } from "../../../packages/git-core/src/vendor/ghd/raw-diff.ts";
import type { GitWorktreeBadge } from "../../../packages/rt-client/src/commands.ts";
import type { BranchGuardVerdict } from "../../branch-guard.ts";
import type { DaemonEvent, DaemonSubscription } from "../../daemon-client.ts";
import type { SessionIntent } from "../../ui/protocol.ts";
import type { SessionEnd, SessionHandle } from "../../ui/spawn.ts";
import { SessionDied } from "../../runner/runner.ts";
import { MissionDriver, resolveCompactedSelIdx, type MissionDeps } from "../driver.ts";
import type { MissionModel } from "../model.ts";

// ─── translation helper fixtures ────────────────────────────────────────────

/**
 * Two hunks with interleaved context lines and a non-zero second
 * unifiedDiffStart -- the shape where the wire model's compacted selIdx
 * (an ordinal over add/del lines only) and git-core's own absolute index
 * (hunk.unifiedDiffStart + array position, header and context counted)
 * genuinely diverge, not just by an off-by-one.
 *
 * Hunk A (unifiedDiffStart 0): header@0, context@1, add@2, context@3, delete@4.
 * Hunk B (unifiedDiffStart 5): header@0(rel)/5(abs), context@1(rel)/6(abs),
 * delete@2(rel)/7(abs), add@3(rel)/8(abs).
 * Compacted order over add/del only: 0=hunkA add(abs 2), 1=hunkA delete(abs 4),
 * 2=hunkB delete(abs 7), 3=hunkB add(abs 8).
 */
function twoHunkDiff(): StagingDiff {
  const hunkALines = [
    new DiffLine("@@ -1,2 +1,2 @@", DiffLineType.Hunk, 1, null, null),
    new DiffLine(" context one", DiffLineType.Context, 2, 1, 1),
    new DiffLine("+added one", DiffLineType.Add, 3, null, 2),
    new DiffLine(" context two", DiffLineType.Context, 4, 2, 3),
    new DiffLine("-deleted one", DiffLineType.Delete, 5, 3, null),
  ];
  const hunkA = new DiffHunk(new DiffHunkHeader(1, 3, 1, 3), hunkALines, 0, hunkALines.length - 1, DiffHunkExpansionType.None);

  const hunkBLines = [
    new DiffLine("@@ -10,2 +10,2 @@", DiffLineType.Hunk, 6, null, null),
    new DiffLine(" context three", DiffLineType.Context, 7, 10, 10),
    new DiffLine("-deleted two", DiffLineType.Delete, 8, 11, null),
    new DiffLine("+added two", DiffLineType.Add, 9, null, 11),
  ];
  const hunkB = new DiffHunk(new DiffHunkHeader(10, 2, 10, 2), hunkBLines, 5, 5 + hunkBLines.length - 1, DiffHunkExpansionType.None);

  return { path: "two-hunk.txt", kind: "text", untracked: false, hunks: [hunkA, hunkB] };
}

describe("resolveCompactedSelIdx", () => {
  test("diverges from the absolute index across hunk boundaries (mandatory binding-seam test)", () => {
    const diff = twoHunkDiff();

    expect(resolveCompactedSelIdx(diff, 0)).toEqual({ absoluteIndex: 2, hunkStart: 0, hunkLength: 5 });
    expect(resolveCompactedSelIdx(diff, 1)).toEqual({ absoluteIndex: 4, hunkStart: 0, hunkLength: 5 });
    expect(resolveCompactedSelIdx(diff, 2)).toEqual({ absoluteIndex: 7, hunkStart: 5, hunkLength: 4 });
    expect(resolveCompactedSelIdx(diff, 3)).toEqual({ absoluteIndex: 8, hunkStart: 5, hunkLength: 4 });

    // The visible divergence: compacted ordinal 2 is nowhere near absolute
    // index 7 -- the hunk header and two context lines are invisible to the
    // wire model's counting but very much occupy real positions git-core counts.
    expect(2).not.toBe(7);
  });

  test("throws for an out-of-range selIdx rather than silently misaddressing a line", () => {
    const diff = twoHunkDiff();
    expect(() => resolveCompactedSelIdx(diff, 4)).toThrow();
  });
});

// One hunk, three selectable lines (add, add, delete) at unifiedDiffStart 0
// -- used for driver-level stage/discard round-trips where the hunk's own
// span (not cross-hunk divergence, covered above) is what matters.
function oneHunkDiff(path = "a.txt"): StagingDiff {
  const lines = [
    new DiffLine("@@ -1,3 +1,4 @@", DiffLineType.Hunk, 1, null, null),
    new DiffLine(" package mission", DiffLineType.Context, 2, 1, 1),
    new DiffLine('+import "encoding/json"', DiffLineType.Add, 3, null, 2),
    new DiffLine("+", DiffLineType.Add, 4, null, 3),
    new DiffLine(" type Badge struct {", DiffLineType.Context, 5, 2, 4),
    new DiffLine("-type OldBadge struct {", DiffLineType.Delete, 6, 3, null),
  ];
  const hunk = new DiffHunk(new DiffHunkHeader(1, 3, 1, 4), lines, 0, lines.length - 1, DiffHunkExpansionType.None);
  return { path, kind: "text", untracked: false, hunks: [hunk] };
}

// ─── fake GitClient ──────────────────────────────────────────────────────────

interface FakeClientCalls {
  stagingDiff: string[];
  stageSelection: { diff: StagingDiff; selection: DiffSelection }[];
  discardSelection: { diff: StagingDiff; selection: DiffSelection }[];
  checkoutBranch: string[];
  createBranch: { name: string; opts?: { from?: string; checkout?: boolean } }[];
  stageFileFully: { path: string; originalPath?: string }[];
  resetToCommit: { sha: string; mode: string }[];
}

function baseSnapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return { branch: "main", detached: false, upstream: "origin/main", ahead: 0, behind: 0, files: [], clean: true, ...overrides };
}

function makeFakeClient(overrides: {
  snapshot?: () => Promise<RepoSnapshot>;
  stagingDiff?: (path: string) => Promise<StagingDiff>;
  undoLastCommit?: GitClient["undoLastCommit"];
  branches?: () => Promise<BranchInfo[]>;
  remotes?: GitClient["remotes"];
  log?: GitClient["log"];
  resetToCommit?: GitClient["resetToCommit"];
  createBranch?: GitClient["createBranch"];
} = {}): GitClient & { calls: FakeClientCalls } {
  const calls: FakeClientCalls = { stagingDiff: [], stageSelection: [], discardSelection: [], checkoutBranch: [], createBranch: [], stageFileFully: [], resetToCommit: [] };
  const client: GitClient = {
    dir: "/repo",
    snapshot: overrides.snapshot ?? (async () => baseSnapshot()),
    diffFile: async () => ({ path: "", kind: "text", hunks: [] }),
    branches: overrides.branches ?? (async () => []),
    // Default names a real remote so the existing action-kind tests (push,
    // publish-branch, ...) keep reaching those kinds -- deriveAction reads
    // remoteName === null as "no remote at all" (publish-repo).
    remotes: overrides.remotes ?? (async () => [{ name: "origin" }]),
    tags: async () => [],
    log: overrides.log ?? (async () => []),
    stashes: async () => [],
    stashPush: async () => ({ created: false }),
    stashApply: async () => {},
    stashPop: async () => {},
    stashDrop: async () => {},
    fetchState: async () => ({ lastFetchedAt: null }),
    fetch: async () => {},
    stagingDiff: async (path: string) => {
      calls.stagingDiff.push(path);
      return overrides.stagingDiff ? overrides.stagingDiff(path) : oneHunkDiff(path);
    },
    stageSelection: async (diff, selection) => {
      calls.stageSelection.push({ diff, selection });
    },
    discardSelection: async (diff, selection) => {
      calls.discardSelection.push({ diff, selection });
    },
    undoLastCommit: overrides.undoLastCommit ?? (async () => ({ ok: true, undoneSha: "deadbeef" })),
    resetToCommit: async (sha: string, mode: "soft" | "mixed" | "hard") => {
      calls.resetToCommit.push({ sha, mode });
      if (overrides.resetToCommit) await overrides.resetToCommit(sha, mode);
    },
    stageFileFully: async (path: string, originalPath?: string) => {
      calls.stageFileFully.push({ path, originalPath });
    },
    checkoutBranch: async (name: string) => {
      calls.checkoutBranch.push(name);
    },
    createBranch: async (name: string, opts?: { from?: string; checkout?: boolean }) => {
      calls.createBranch.push({ name, opts });
      if (overrides.createBranch) await overrides.createBranch(name, opts);
    },
    createTag: async () => {},
    deleteTag: async () => {},
    pushTag: async () => {},
  };
  return Object.assign(client, { calls });
}

// ─── fake session harness (mirrors lib/runner/__tests__/runner.test.ts) ────

class FakeSession implements SessionHandle {
  pushed: MissionModel[] = [];
  private queue: SessionIntent[];
  exited: Promise<number>;
  private finish!: (code: number) => void;
  constructor(intents: SessionIntent[], private endResult: SessionEnd = { reason: "closed", code: 0 }) {
    this.queue = [...intents];
    this.exited = new Promise((r) => { this.finish = r; });
  }
  get intents(): AsyncIterable<SessionIntent> {
    const self = this;
    return { [Symbol.asyncIterator]() { return { next: () => self.next() }; } };
  }
  private next(): Promise<IteratorResult<SessionIntent>> {
    const it = this.queue.shift();
    if (it) return Promise.resolve({ value: it, done: false });
    return Promise.resolve({ value: undefined as never, done: true });
  }
  push(m: unknown): void { this.pushed.push(m as MissionModel); }
  async close(): Promise<SessionEnd> {
    this.finish(this.endResult.code);
    return this.endResult;
  }
}

/** Intents arrive on demand via `send`, so a test can drive the driver mid-session. */
class QueueSession implements SessionHandle {
  pushed: MissionModel[] = [];
  private queue: SessionIntent[] = [];
  private waiter: ((v: IteratorResult<SessionIntent>) => void) | null = null;
  exited: Promise<number>;
  private finish!: (code: number) => void;
  constructor(private endResult: SessionEnd = { reason: "closed", code: 0 }) {
    this.exited = new Promise((r) => { this.finish = r; });
  }
  get intents(): AsyncIterable<SessionIntent> {
    const self = this;
    return { [Symbol.asyncIterator]() { return { next: () => self.next() }; } };
  }
  private next(): Promise<IteratorResult<SessionIntent>> {
    const it = this.queue.shift();
    if (it) return Promise.resolve({ value: it, done: false });
    return new Promise((resolve) => { this.waiter = resolve; });
  }
  send(i: SessionIntent): void {
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      w({ value: i, done: false });
    } else {
      this.queue.push(i);
    }
  }
  push(m: unknown): void { this.pushed.push(m as MissionModel); }
  async close(): Promise<SessionEnd> {
    this.finish(this.endResult.code);
    return this.endResult;
  }
}

async function flushMicrotasks(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function badge(overrides: Partial<GitWorktreeBadge> = {}): GitWorktreeBadge {
  return {
    worktree: "/repo",
    branch: "main",
    detached: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    clean: true,
    ahead: 0,
    behind: 0,
    upstream: "origin/main",
    lastFetchedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Default `worktree:list` response: one tree, matching START's `/repo` so existing tests joining against `badge()` (also `worktree: "/repo"`) keep resolving to a real badge. */
function defaultTrees(): Array<{ path: string; name: string; branch: string | null; state: string }> {
  return [{ path: "/repo", name: "repo", branch: "main", state: "claimed" }];
}

function baseDeps(over: {
  session: SessionHandle;
  client?: GitClient;
  daemonQuery?: MissionDeps["daemonQuery"];
  subscribe?: MissionDeps["subscribe"];
  runAction?: MissionDeps["runAction"];
  commit?: MissionDeps["commit"];
  amend?: MissionDeps["amend"];
  guard?: MissionDeps["guard"];
  now?: MissionDeps["now"];
  resolveDefaultBranch?: MissionDeps["resolveDefaultBranch"];
  readPullRebase?: MissionDeps["readPullRebase"];
  buildGuards?: MissionDeps["buildGuards"];
}): MissionDeps {
  const client = over.client ?? makeFakeClient();
  return {
    openSession: async () => over.session,
    client: () => client,
    daemonQuery:
      over.daemonQuery ??
      (async (cmd: string) =>
        cmd === "worktree:list"
          ? { ok: true, data: { trees: defaultTrees() } }
          : { ok: true, data: { repos: [{ repo: "repo-tools", error: null, worktrees: [badge()] }] } }),
    subscribe: over.subscribe ?? ((): DaemonSubscription => ({ close: () => {} })),
    runAction: over.runAction ?? (async () => ({ ok: true, detail: "" })),
    commit: over.commit ?? (() => "[main abc] msg"),
    amend: over.amend ?? (() => "[main abc] msg"),
    guard: over.guard ?? (async () => ({ verdict: "clear" }) as BranchGuardVerdict),
    now: over.now ?? (() => new Date("2026-09-18T00:00:00Z")),
    // START's worktree ("/repo") is never a real git checkout in this
    // file's tests, so the real getRemoteDefaultBranch would just fail and
    // return null anyway; stubbing it directly skips a real subprocess spawn
    // per test and makes the resolver itself spy-able (see the caching test
    // below).
    resolveDefaultBranch: over.resolveDefaultBranch ?? (() => null),
    readPullRebase: over.readPullRebase ?? (() => false),
    buildGuards: over.buildGuards ?? (async () => new Map()),
  };
}

const START = { repo: "repo-tools", worktree: "/repo" };

// ─── driver behavior ─────────────────────────────────────────────────────────

// GHD's own model (ratified 2026-09-21): mission:stage mutates the driver's
// own commit-intent SELECTION only -- it never touches the real git index,
// so none of these call client.stageSelection/stageFileFully at all. The
// index is rebuilt from selections once, at commit time (see "MissionDriver:
// commit rebuilds the index from selections" below).
describe("MissionDriver: staging (selection-only, ratified 2026-09-21)", () => {
  test("a line press toggles exactly that line's selection off, everything else stays at its All default", async () => {
    const client = makeFakeClient({
      snapshot: async () => baseSnapshot({ clean: false, files: [{ path: "a.txt", kind: "modified", staged: false, unstaged: true }] }),
    });
    const session = new FakeSession([
      { t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "line", selIdx: 1 } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, client });

    await new MissionDriver(deps, START).run();

    expect(client.calls.stageSelection).toHaveLength(0);
    const last = session.pushed.at(-1) as MissionModel;
    const bySelIdx = new Map(last.diff.lines.filter((l) => l.selIdx >= 0).map((l) => [l.selIdx, l.selected]));
    expect(bySelIdx.get(1)).toBe(false); // the pressed line, toggled off
    expect(bySelIdx.get(0)).toBe(true); // untouched, still at the All default
    expect(bySelIdx.get(2)).toBe(true);
  });

  test("pressing the same line again toggles it back on (a real toggle, not a one-way stage)", async () => {
    const client = makeFakeClient({
      snapshot: async () => baseSnapshot({ clean: false, files: [{ path: "a.txt", kind: "modified", staged: false, unstaged: true }] }),
    });
    const session = new FakeSession([
      { t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "line", selIdx: 1 } },
      { t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "line", selIdx: 1 } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, client });

    await new MissionDriver(deps, START).run();

    const last = session.pushed.at(-1) as MissionModel;
    const line = last.diff.lines.find((l) => l.selIdx === 1);
    expect(line?.selected).toBe(true);
  });

  test("hunk mode toggles the whole owning hunk's selectable lines off together (all were on, GHD's default)", async () => {
    const client = makeFakeClient({
      snapshot: async () => baseSnapshot({ clean: false, files: [{ path: "a.txt", kind: "modified", staged: false, unstaged: true }] }),
    });
    const session = new FakeSession([
      { t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "hunk", selIdx: 0 } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, client });

    await new MissionDriver(deps, START).run();

    expect(client.calls.stageSelection).toHaveLength(0);
    const last = session.pushed.at(-1) as MissionModel;
    for (const line of last.diff.lines.filter((l) => l.selIdx >= 0)) {
      expect(line.selected).toBe(false);
    }
  });

  test("toggle-file flips a fully-checked (default) file to fully unchecked", async () => {
    const client = makeFakeClient({
      snapshot: async () => baseSnapshot({ clean: false, files: [{ path: "a.txt", kind: "modified", staged: false, unstaged: true }] }),
    });
    const session = new FakeSession([
      { t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "toggle-file" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, client });

    await new MissionDriver(deps, START).run();

    expect(client.calls.stageSelection).toHaveLength(0);
    expect(client.calls.stageFileFully).toHaveLength(0);
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.changes[0]!.include).toBe("none");
  });

  test("toggle-file on a partially-selected file checks everything (tri-state click rule: partial/none -> all)", async () => {
    const client = makeFakeClient({
      snapshot: async () => baseSnapshot({ clean: false, files: [{ path: "a.txt", kind: "modified", staged: true, unstaged: true }] }),
    });
    const session = new FakeSession([
      { t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "line", selIdx: 0 } }, // -> partial
      { t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "toggle-file" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, client });

    await new MissionDriver(deps, START).run();

    const last = session.pushed.at(-1) as MissionModel;
    expect(last.changes[0]!.include).toBe("all");
  });
});

describe("MissionDriver: discard two-step confirm", () => {
  test("a second matching discard within the window executes discardSelection", async () => {
    const client = makeFakeClient();
    const times = [1_000, 2_000]; // 1s apart, inside the 5s window
    let call = 0;
    const session = new FakeSession([
      { t: "intent", name: "mission:discard", payload: { path: "a.txt", mode: "line", selIdx: 1 } },
      { t: "intent", name: "mission:discard", payload: { path: "a.txt", mode: "line", selIdx: 1 } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, client, now: () => new Date(times[call++]!) });

    await new MissionDriver(deps, START).run();

    expect((session.pushed[0] as MissionModel).notice).toBe("press d again to discard");
    expect(client.calls.discardSelection).toHaveLength(1);
    const { selection } = client.calls.discardSelection[0]!;
    expect(selection.isSelected(3)).toBe(true); // the armed target is what gets discarded
    expect((session.pushed.at(-1) as MissionModel).notice).toBe("");
  });

  test("a late second discard past the window re-arms instead of executing", async () => {
    const client = makeFakeClient();
    const times = [1_000, 20_000]; // 19s apart, outside the 5s window
    let call = 0;
    const session = new FakeSession([
      { t: "intent", name: "mission:discard", payload: { path: "a.txt", mode: "line", selIdx: 1 } },
      { t: "intent", name: "mission:discard", payload: { path: "a.txt", mode: "line", selIdx: 1 } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, client, now: () => new Date(times[call++]!) });

    await new MissionDriver(deps, START).run();

    expect(client.calls.discardSelection).toHaveLength(0);
    expect((session.pushed.at(-1) as MissionModel).notice).toBe("press d again to discard");
  });
});

describe("MissionDriver: discard disarm", () => {
  test("any non-discard intent disarms an armed discard, so the next d re-arms instead of executing", async () => {
    const client = makeFakeClient();
    const times = [1_000, 2_000]; // both discards inside the 5s window
    let call = 0;
    const session = new FakeSession([
      { t: "intent", name: "mission:discard", payload: { path: "a.txt", mode: "line", selIdx: 1 } },
      { t: "intent", name: "mission:select", payload: { filter: "" } },
      { t: "intent", name: "mission:discard", payload: { path: "a.txt", mode: "line", selIdx: 1 } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, client, now: () => new Date(times[call++]!) });

    await new MissionDriver(deps, START).run();

    expect(client.calls.discardSelection).toHaveLength(0);
    expect((session.pushed.at(-1) as MissionModel).notice).toBe("press d again to discard");
  });
});

describe("MissionDriver: badge resolution", () => {
  test("a missing badge for the current worktree never borrows another worktree's badge", async () => {
    const session = new FakeSession([{ t: "intent", name: "quit" }]);
    let opened: MissionModel | null = null;
    const client = makeFakeClient({
      // No upstream at all in the live snapshot either, so the synthetic
      // fallback badge genuinely has none -- this isolates "never borrows
      // /elsewhere's badge" from the live-snapshot fallback covered below.
      snapshot: async () => baseSnapshot({ upstream: null, ahead: null, behind: null }),
    });
    const deps = baseDeps({
      session,
      client,
      daemonQuery: async (cmd: string) =>
        cmd === "worktree:list"
          ? { ok: true, data: { trees: defaultTrees() } }
          : { ok: true, data: { repos: [{ repo: "repo-tools", error: null, worktrees: [badge({ worktree: "/elsewhere", ahead: 9 })] }] } },
    });
    deps.openSession = async (view, model) => {
      opened = model as MissionModel;
      return session;
    };

    await new MissionDriver(deps, START).run();

    // No upstream anywhere it's allowed to look, so publish-branch; borrowing
    // /elsewhere's badge (ahead 9, upstream set) would say push instead.
    expect(opened!.action.kind).toBe("publish-branch");
  });

  // Owner-confirmed real-repo defect: on a repo the daemon has never swept,
  // currentBadge() fell back to EMPTY_GIT_BADGE (null upstream), so the
  // action segment claimed "Publish branch · Never fetched" even when the
  // branch demonstrably has an upstream and is ahead. Fixed by falling back
  // to the live snapshot's own upstream/ahead/behind (already fetched on
  // every refresh, independent of the daemon) instead of a blank badge.
  test("a missing badge falls back to the live snapshot's own upstream/ahead/behind, not a blank badge", async () => {
    const session = new FakeSession([{ t: "intent", name: "quit" }]);
    let opened: MissionModel | null = null;
    const client = makeFakeClient({
      snapshot: async () => baseSnapshot({ upstream: "origin/main", ahead: 1, behind: 0 }),
    });
    const deps = baseDeps({
      session,
      client,
      daemonQuery: async (cmd: string) =>
        cmd === "worktree:list" ? { ok: true, data: { trees: defaultTrees() } } : { ok: true, data: { repos: [] } },
    });
    deps.openSession = async (view, model) => {
      opened = model as MissionModel;
      return session;
    };

    await new MissionDriver(deps, START).run();

    // Real upstream + ahead 1, behind 0 -> push, never the false
    // publish-branch/"Never fetched" the empty-badge fallback produced.
    expect(opened!.action.kind).toBe("push");
    expect(opened!.action.meta).toBe("Never fetched"); // still accurate: the DAEMON hasn't fetched
  });
});

describe("MissionDriver: real remote name, pull.rebase, and guards (RT-219)", () => {
  test("a repo with no remote shows Publish repository in the action segment", async () => {
    const session = new FakeSession([{ t: "intent", name: "quit" }]);
    let opened: MissionModel | null = null;
    const client = makeFakeClient({ remotes: async () => [] });
    const deps = baseDeps({ session, client });
    deps.openSession = async (_view, model) => {
      opened = model as MissionModel;
      return session;
    };

    await new MissionDriver(deps, START).run();

    expect(opened!.action.kind).toBe("publish-repo");
    expect(opened!.action.title).toBe("Publish repository");
  });

  test("a remote named something other than origin flows into runAction", async () => {
    let capturedOpts: { remote?: string; branch: string | null } | null = null;
    const session = new FakeSession([
      { t: "intent", name: "mission:action" },
      { t: "intent", name: "quit" },
    ]);
    const client = makeFakeClient({ remotes: async () => [{ name: "upstream" }] });
    const deps = baseDeps({
      session,
      client,
      daemonQuery: async (cmd: string) =>
        cmd === "worktree:list"
          ? { ok: true, data: { trees: defaultTrees() } }
          : { ok: true, data: { repos: [{ repo: "repo-tools", error: null, worktrees: [badge({ ahead: 1, behind: 0 })] }] } },
      runAction: async (_cwd, _kind, opts) => {
        capturedOpts = opts;
        return { ok: true, detail: "" };
      },
    });

    await new MissionDriver(deps, START).run();

    expect(capturedOpts!).toEqual({ remote: "upstream", branch: "main" });
  });

  test("pull.rebase=true renders the with-rebase title in the action segment", async () => {
    const session = new FakeSession([{ t: "intent", name: "quit" }]);
    let opened: MissionModel | null = null;
    const deps = baseDeps({
      session,
      daemonQuery: async (cmd: string) =>
        cmd === "worktree:list"
          ? { ok: true, data: { trees: defaultTrees() } }
          : { ok: true, data: { repos: [{ repo: "repo-tools", error: null, worktrees: [badge({ ahead: 0, behind: 1 })] }] } },
      readPullRebase: () => true,
    });
    deps.openSession = async (_view, model) => {
      opened = model as MissionModel;
      return session;
    };

    await new MissionDriver(deps, START).run();

    expect(opened!.action.kind).toBe("pull-rebase");
    expect(opened!.action.title).toBe("Pull origin with rebase");
  });

  test("a branch checked out in another worktree renders guardedBy in the branch modal rows", async () => {
    const session = new FakeSession([{ t: "intent", name: "quit" }]);
    let opened: MissionModel | null = null;
    const client = makeFakeClient({
      branches: async () => [
        { name: "main", current: true, sha: "a", upstream: null, upstreamGone: false, ahead: null, behind: null, committedAt: "2026-01-01T00:00:00Z" },
        { name: "feature-x", current: false, sha: "b", upstream: null, upstreamGone: false, ahead: null, behind: null, committedAt: "2026-01-01T00:00:00Z" },
      ],
    });
    const deps = baseDeps({
      session,
      client,
      buildGuards: async () => new Map([["feature-x", "feature-x is already checked out in another worktree at /elsewhere"]]),
    });
    deps.openSession = async (_view, model) => {
      opened = model as MissionModel;
      return session;
    };

    await new MissionDriver(deps, START).run();

    const row = opened!.branches.find((b) => b.name === "feature-x")!;
    expect(row.guardedBy).toContain("/elsewhere");
  });
});

describe("MissionDriver: detached HEAD", () => {
  test("sends the short head sha as current.branch when the snapshot has no branch", async () => {
    const client = makeFakeClient({
      snapshot: async () => baseSnapshot({ branch: null, detached: true, upstream: null, ahead: null, behind: null }),
      log: async () => [
        {
          sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          parents: [],
          authorName: "Test",
          authorEmail: "test@example.com",
          authorDate: "2026-09-18T00:00:00Z",
          subject: "detached tip",
          body: "",
        },
      ],
    });
    const session = new FakeSession([{ t: "intent", name: "quit" }]);
    let opened: MissionModel | null = null;
    const deps = baseDeps({ session, client });
    deps.openSession = async (view, model) => {
      opened = model as MissionModel;
      return session;
    };

    await new MissionDriver(deps, START).run();

    expect(opened!.current.detached).toBe(true);
    expect(opened!.current.branch).toBe("a1b2c3d");
  });
});

describe("MissionDriver: repo switch", () => {
  const twoRepoQuery = async (cmd: string) =>
    cmd === "worktree:list"
      ? { ok: true, data: { trees: defaultTrees() } }
      : {
          ok: true,
          data: {
            repos: [
              { repo: "repo-tools", error: null, worktrees: [badge()] },
              { repo: "other-repo", error: null, worktrees: [badge({ worktree: "/other/tree", branch: "dev" })] },
              { repo: "bare-repo", error: null, worktrees: [] },
            ],
          },
        };

  test("switches to the target repo's first known worktree", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:repo", payload: { repo: "other-repo" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, daemonQuery: twoRepoQuery });

    await new MissionDriver(deps, START).run();

    const last = session.pushed.at(-1) as MissionModel;
    expect(last.current.repo).toBe("other-repo");
    expect(last.current.worktree).toBe("/other/tree");
  });

  test("refuses a repo with no known worktree and does not half-switch", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:repo", payload: { repo: "bare-repo" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, daemonQuery: twoRepoQuery });

    await new MissionDriver(deps, START).run();

    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("no known worktree for bare-repo");
    expect(last.current.repo).toBe(START.repo);
    expect(last.current.worktree).toBe(START.worktree);
  });
});

// CodeRabbit finding on PR #353: getRemoteDefaultBranch runs up to two
// synchronous git subprocesses, and it was called directly from model(),
// which every push() invokes -- so typing in the filter, moving the
// selection, or any notice replayed those subprocesses on every keystroke.
// It is now resolved once in refresh() and cached on MissionDriver;
// model()/guardBranch() read the cache.
describe("MissionDriver: default branch resolution is cached, not per-push", () => {
  test("a scripted sequence of several pushes with no refresh in between calls the resolver exactly once", async () => {
    let calls = 0;
    const session = new FakeSession([
      { t: "intent", name: "mission:select", payload: { filter: "a" } },
      { t: "intent", name: "mission:select", payload: { filter: "ab" } },
      { t: "intent", name: "mission:select", payload: { filter: "abc" } },
      { t: "intent", name: "mission:select", payload: { filter: "" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      resolveDefaultBranch: () => {
        calls++;
        return "origin/main";
      },
    });

    await new MissionDriver(deps, START).run();

    // run()'s own initial refresh() is the one call the whole scripted
    // sequence of filter-only pushes above must not add to.
    expect(calls).toBe(1);
    expect(session.pushed.length).toBeGreaterThan(1); // several real pushes did happen, each reading the cache
    expect((session.pushed.at(-1) as MissionModel).filter).toBe("");
  });

  test("a worktree switch re-resolves (the cache tracks the worktree it describes, not a one-time value)", async () => {
    const twoRepoQuery = async (cmd: string) =>
      cmd === "worktree:list"
        ? { ok: true, data: { trees: defaultTrees() } }
        : {
            ok: true,
            data: {
              repos: [
                { repo: "repo-tools", error: null, worktrees: [badge()] },
                { repo: "other-repo", error: null, worktrees: [badge({ worktree: "/other/tree", branch: "dev" })] },
              ],
            },
          };
    const seen: string[] = [];
    const session = new FakeSession([
      { t: "intent", name: "mission:repo", payload: { repo: "other-repo" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      daemonQuery: twoRepoQuery,
      resolveDefaultBranch: (cwd: string) => {
        seen.push(cwd);
        return "origin/main";
      },
    });

    await new MissionDriver(deps, START).run();

    expect(seen).toEqual([START.worktree, "/other/tree"]); // initial refresh, then the repo-switch refresh
  });
});

describe("MissionDriver: commit", () => {
  test("calls commitStaged with the typed summary and pushes a cleared commit box", async () => {
    const commitCalls: [string, string][] = [];
    const session = new FakeSession([
      { t: "intent", name: "mission:commit", payload: { summary: "Fix the thing", amend: false } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      commit: (cwd: string, message: string) => {
        commitCalls.push([cwd, message]);
        return "[main abc] Fix the thing";
      },
    });

    await new MissionDriver(deps, START).run();

    expect(commitCalls).toEqual([[START.worktree, "Fix the thing"]]);
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.commit.summary).toBe("");
    expect(last.commit.description).toBe("");
    expect(last.commit.amending).toBe(false);
  });

  test("an empty summary refuses with a notice and never commits", async () => {
    let commitCalled = false;
    const session = new FakeSession([
      { t: "intent", name: "mission:commit", payload: { summary: "   ", amend: false } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      commit: () => {
        commitCalled = true;
        return "[main abc] never";
      },
    });

    await new MissionDriver(deps, START).run();

    expect(commitCalled).toBe(false);
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("a summary is required to commit");
  });

  test("guards the branch before an amend, and a refusal lands in Notice without amending", async () => {
    let amendCalled = false;
    const session = new FakeSession([
      { t: "intent", name: "mission:commit", payload: { summary: "Amend it", amend: true } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      amend: () => {
        amendCalled = true;
        return "[main abc] Amend it";
      },
      guard: async () => ({ verdict: "refuse", reason: "stack", detail: "main is a stack root; amend refused" }),
    });

    await new MissionDriver(deps, START).run();

    expect(amendCalled).toBe(false);
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("main is a stack root; amend refused");
  });

  // RT-221: the view clears its own local summary/description drafts the
  // moment it emits mission:commit (the only point a non-empty local draft
  // can ever go back to empty -- see mission.go's emitCommit/SetModel). A
  // refusal or failure must echo the rejected text back onto the wire
  // model so the now-empty view fields re-seed from it, or the typed
  // message is lost with no way to recover it.
  test("a branch-guard refusal on amend restores the typed summary and description to the commit box", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:commit", payload: { summary: "Amend it", description: "body text", amend: true } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      guard: async () => ({ verdict: "refuse", reason: "stack", detail: "main is a stack root; amend refused" }),
    });

    await new MissionDriver(deps, START).run();

    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("main is a stack root; amend refused");
    expect(last.commit.summary).toBe("Amend it");
    expect(last.commit.description).toBe("body text");
  });

  test("a commit that fails in git restores the typed summary and description to the commit box", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:commit", payload: { summary: "Fix the thing", description: "extra detail" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      commit: () => {
        throw new Error("nothing to commit");
      },
    });

    await new MissionDriver(deps, START).run();

    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("commit failed: nothing to commit");
    expect(last.commit.summary).toBe("Fix the thing");
    expect(last.commit.description).toBe("extra detail");
  });

  test("a commit-time index rebuild that fails restores the typed summary and description to the commit box", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:commit", payload: { summary: "Fix the thing", description: "extra detail" } },
      { t: "intent", name: "quit" },
    ]);
    const client = makeFakeClient({
      resetToCommit: async () => {
        throw new Error("index.lock exists");
      },
    });

    await new MissionDriver(baseDeps({ session, client }), START).run();

    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("commit failed: index.lock exists");
    expect(last.commit.summary).toBe("Fix the thing");
    expect(last.commit.description).toBe("extra detail");
  });
});

// GHD's own sequencing (ratified 2026-09-21): commit resets the whole index
// to HEAD, then rebuilds it from each file's own selection -- None needs no
// call, All is a whole-file stage, Partial fetches the file's own diff and
// applies exactly what's checked. The real-sandbox round trip lives in
// compose.test.ts; this is the fast, precise unit coverage of the dispatch
// itself against a fake client.
describe("MissionDriver: commit rebuilds the index from selections", () => {
  test("None -> no stage call at all; All -> stageFileFully; Partial -> stageSelection, in that per-file order", async () => {
    const client = makeFakeClient({
      snapshot: async () =>
        baseSnapshot({
          clean: false,
          files: [
            { path: "none.txt", kind: "modified", staged: false, unstaged: true },
            { path: "all.txt", kind: "modified", staged: false, unstaged: true },
            { path: "partial.txt", kind: "modified", staged: false, unstaged: true },
          ],
        }),
    });
    const session = new FakeSession([
      { t: "intent", name: "mission:stage", payload: { path: "none.txt", mode: "toggle-file" } }, // All -> None
      { t: "intent", name: "mission:stage", payload: { path: "partial.txt", mode: "line", selIdx: 1 } }, // All -> Partial
      { t: "intent", name: "mission:commit", payload: { summary: "rebuild from selections" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, client });

    await new MissionDriver(deps, START).run();

    expect(client.calls.resetToCommit).toEqual([{ sha: "HEAD", mode: "mixed" }]);
    expect(client.calls.stageFileFully.map((c) => c.path)).toEqual(["all.txt"]);
    expect(client.calls.stageSelection).toHaveLength(1);
    expect(client.calls.stageSelection[0]!.diff.path).toBe("partial.txt");
  });

  test("a rename's originalPath reaches both stageFileFully (All) and stageSelection (Partial)", async () => {
    const client = makeFakeClient({
      snapshot: async () =>
        baseSnapshot({
          clean: false,
          files: [
            { path: "renamed-all.txt", kind: "renamed", staged: false, unstaged: true, originalPath: "old-all.txt" },
            { path: "renamed-partial.txt", kind: "renamed", staged: false, unstaged: true, originalPath: "old-partial.txt" },
          ],
        }),
    });
    const session = new FakeSession([
      { t: "intent", name: "mission:stage", payload: { path: "renamed-partial.txt", mode: "line", selIdx: 1 } }, // All -> Partial
      { t: "intent", name: "mission:commit", payload: { summary: "rename rebuild" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, client });

    await new MissionDriver(deps, START).run();

    expect(client.calls.stageFileFully).toEqual([{ path: "renamed-all.txt", originalPath: "old-all.txt" }]);
    expect(client.calls.stageSelection[0]!.diff.path).toBe("renamed-partial.txt");
  });
});

// GHD's own model (ratified 2026-09-21): selections are the user's own
// commit intent, not derived state -- they must survive across refreshes
// for the whole session, not reset by whatever triggered the refresh.
describe("MissionDriver: selections persist across a refresh", () => {
  test("a selection made before a git-status-triggered refresh survives it", async () => {
    let statusHandler: ((ev: DaemonEvent) => void) | null = null;
    const client = makeFakeClient({
      snapshot: async () => baseSnapshot({ clean: false, files: [{ path: "a.txt", kind: "modified", staged: false, unstaged: true }] }),
    });
    const session = new QueueSession();
    const deps = baseDeps({
      session,
      client,
      subscribe: (onEvent) => {
        statusHandler = onEvent;
        return { close: () => {} };
      },
    });

    const runPromise = new MissionDriver(deps, START).run();
    await flushMicrotasks();

    session.send({ t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "toggle-file" } }); // All -> None
    await flushMicrotasks();
    expect((session.pushed.at(-1) as MissionModel).changes[0]!.include).toBe("none");

    expect(statusHandler).not.toBeNull();
    statusHandler!({ type: "git-status", data: {} }); // triggers refreshBadges, which reconciles selections
    await flushMicrotasks();

    expect((session.pushed.at(-1) as MissionModel).changes[0]!.include).toBe("none"); // survived the refresh

    session.send({ t: "intent", name: "quit" });
    await runPromise;
  });
});

describe("MissionDriver: checkout guard", () => {
  test("a refused checkout lands the refusal detail in Notice and never calls checkoutBranch", async () => {
    const client = makeFakeClient();
    const session = new FakeSession([
      { t: "intent", name: "mission:checkout", payload: { branch: "guarded-branch" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      client,
      guard: async () => ({ verdict: "refuse", reason: "worktree", detail: "guarded-branch is checked out elsewhere" }),
    });

    await new MissionDriver(deps, START).run();

    expect(client.calls.checkoutBranch).toHaveLength(0);
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("guarded-branch is checked out elsewhere");
  });

  test("a new-branch intent with no name is a silent no-op", async () => {
    const client = makeFakeClient();
    const session = new FakeSession([
      { t: "intent", name: "mission:checkout", payload: { new: true, from: "main" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, client });

    await new MissionDriver(deps, START).run();

    expect(client.calls.checkoutBranch).toHaveLength(0);
    expect(client.calls.createBranch).toHaveLength(0);
    expect(session.pushed).toHaveLength(0);
  });

  test("a new-branch intent creates the branch from the given base and checks it out", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:checkout", payload: { new: true, from: "main", name: "my-feature" } },
      { t: "intent", name: "quit" },
    ]);
    const client = makeFakeClient();
    await new MissionDriver(baseDeps({ session, client }), START).run();

    expect(client.calls.createBranch).toEqual([
      { name: "my-feature", opts: { from: "main", checkout: true } },
    ]);
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("");
  });

  test("a failed branch creation surfaces the git message as a notice", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:checkout", payload: { new: true, from: "main", name: "bad name" } },
      { t: "intent", name: "quit" },
    ]);
    const client = makeFakeClient({
      createBranch: async () => {
        throw new Error("invalid branch name: bad name");
      },
    });
    await new MissionDriver(baseDeps({ session, client }), START).run();

    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("invalid branch name: bad name");
  });
});

describe("MissionDriver: worktree", () => {
  test("a new-worktree intent with no name is a silent no-op", async () => {
    const calls: string[] = [];
    const session = new FakeSession([
      { t: "intent", name: "mission:worktree", payload: { new: true } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      daemonQuery: async (cmd: string) => {
        calls.push(cmd);
        return { ok: true, data: { trees: defaultTrees() } };
      },
    });

    await new MissionDriver(deps, START).run();

    expect(calls).not.toContain("worktree:provision");
    expect(session.pushed).toHaveLength(0); // never switched, never pushed
  });

  test("switching worktree re-seeds worktree:list and pushes a model whose Current joins the new path's real name and badge", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:worktree", payload: { path: "/repo2" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      daemonQuery: async (cmd: string) =>
        cmd === "worktree:list"
          ? {
              ok: true,
              data: {
                trees: [
                  { path: "/repo", name: "gandalf", branch: "main", state: "claimed" },
                  { path: "/repo2", name: "frodo", branch: "feature", state: "on-deck" },
                ],
              },
            }
          : {
              ok: true,
              data: {
                repos: [
                  {
                    repo: "repo-tools",
                    error: null,
                    worktrees: [badge({ worktree: "/repo" }), badge({ worktree: "/repo2", branch: "feature", ahead: 4 })],
                  },
                ],
              },
            },
    });

    await new MissionDriver(deps, START).run();

    const last = session.pushed.at(-1) as MissionModel;
    expect(last.current.worktree).toBe("/repo2");
    // The real `name` from worktree:list, not basename("/repo2") -- proves the join, not a hardcoded row.
    expect(last.current.worktreeName).toBe("frodo");
    const row = last.worktrees.find((w) => w.path === "/repo2");
    expect(row?.name).toBe("frodo");
    expect(row?.onDeck).toBe(true);
    expect(row?.badge.ahead).toBe(4);
  });
});

describe("MissionDriver: provisioning a worktree", () => {
  test("provisions with the typed branch name and switches the board to the new tree", async () => {
    const calls: Array<{ cmd: string; payload: Record<string, unknown> }> = [];
    const session = new FakeSession([
      { t: "intent", name: "mission:worktree", payload: { new: true, name: "my-feature" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      daemonQuery: async (cmd: string, payload?: Record<string, unknown>) => {
        calls.push({ cmd, payload: payload ?? {} });
        if (cmd === "worktree:provision") {
          return { ok: true, data: { tree: "rohan", path: "/trees/rohan", branch: "my-feature", readyPending: false } };
        }
        if (cmd === "worktree:list") return { ok: true, data: { trees: defaultTrees() } };
        return { ok: true, data: { repos: [] } };
      },
    });

    await new MissionDriver(deps, START).run();

    const provision = calls.find((c) => c.cmd === "worktree:provision");
    expect(provision?.payload).toMatchObject({ branch: "my-feature", owner: "glitter" });
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.current.worktree).toBe("/trees/rohan");
  });

  test("a refusal surfaces as a notice and leaves the board where it was", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:worktree", payload: { new: true, name: "my-feature" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      daemonQuery: async (cmd: string) => {
        if (cmd === "worktree:provision") return { ok: false, error: "busy" };
        if (cmd === "worktree:list") return { ok: true, data: { trees: defaultTrees() } };
        return { ok: true, data: { repos: [] } };
      },
    });

    await new MissionDriver(deps, START).run();

    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("another worktree operation is running; try again in a moment");
    expect(last.current.worktree).toBe(START.worktree);
  });

  test("a blank name never reaches the daemon", async () => {
    const calls: string[] = [];
    const session = new FakeSession([
      { t: "intent", name: "mission:worktree", payload: { new: true, name: "   " } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      daemonQuery: async (cmd: string) => {
        calls.push(cmd);
        if (cmd === "worktree:list") return { ok: true, data: { trees: defaultTrees() } };
        return { ok: true, data: { repos: [] } };
      },
    });

    await new MissionDriver(deps, START).run();

    expect(calls).not.toContain("worktree:provision");
  });
});

describe("MissionDriver: undo", () => {
  test("a typed refusal from undoLastCommit lands as 'refused: <reason>' in Notice", async () => {
    const client = makeFakeClient({ undoLastCommit: async () => ({ ok: false, reason: "pushed" }) });
    const session = new FakeSession([
      { t: "intent", name: "mission:undo" },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, client });

    await new MissionDriver(deps, START).run();

    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("refused: pushed");
  });
});

// A real (non-fixture) repo surfaced this: git-core's log entry carries a
// raw ISO authorDate, and the undo strip rendered it verbatim ("Committed
// 2026-09-20T19:21:02-05:00 ...") instead of a relative time. Preformatted
// here to match action.meta and MissionBranchRow.when's own convention (the
// driver formats once per refresh; the view renders whatever string it gets).
describe("MissionDriver: last commit's `when` is driver-formatted relative time", () => {
  test("formats log[0].authorDate through formatRelativeTime using deps.now()", async () => {
    const client = makeFakeClient({
      log: async () => [
        {
          sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          parents: [],
          authorName: "Test",
          authorEmail: "test@example.com",
          authorDate: "2026-09-17T23:58:00Z", // 2 minutes before baseDeps' now()
          subject: "fix parser",
          body: "",
        },
      ],
    });
    const session = new FakeSession([{ t: "intent", name: "quit" }]);
    let opened: MissionModel | null = null;
    const deps = baseDeps({ session, client });
    deps.openSession = async (_view, model) => {
      opened = model as MissionModel;
      return session;
    };

    await new MissionDriver(deps, START).run();

    expect(opened!.commit.lastCommit?.summary).toBe("fix parser");
    expect(opened!.commit.lastCommit?.when).toBe("2 minutes ago");
  });
});

describe("MissionDriver: action", () => {
  test("pushes a busy model before the result model", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:action" },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      daemonQuery: async () => ({
        ok: true,
        data: { repos: [{ repo: "repo-tools", error: null, worktrees: [badge({ ahead: 1, behind: 0 })] }] },
      }),
      runAction: async () => {
        await Promise.resolve();
        return { ok: true, detail: "" };
      },
    });

    await new MissionDriver(deps, START).run();

    expect(session.pushed.length).toBeGreaterThanOrEqual(2);
    expect(session.pushed[0]!.action.busy).toBe(true);
    const last = session.pushed.at(-1)!;
    expect(last.action.busy).toBe(false);
  });

  test("a rejected runAction still clears busyAction via the finally cleanup", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:action" },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      runAction: async () => {
        throw new Error("network exploded");
      },
    });

    await new MissionDriver(deps, START).run();

    // The finally-block push (busy cleared, no notice yet) must land before
    // the outer per-intent catch reports the error Notice.
    const cleanedUp = session.pushed.findIndex((m) => m.action.busy === false && m.notice === "");
    expect(cleanedUp).toBeGreaterThan(-1);
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.action.busy).toBe(false);
    expect(last.notice).toBe("error: network exploded");
  });
});

describe("MissionDriver: git-status subscription", () => {
  test("a git-status daemon event triggers a badge refresh push", async () => {
    const session = new QueueSession();
    let captured: ((ev: DaemonEvent) => void) | null = null;
    const deps = baseDeps({
      session,
      subscribe: (onEvent) => {
        captured = onEvent;
        return { close: () => {} };
      },
    });

    const runPromise = new MissionDriver(deps, START).run();
    await flushMicrotasks();

    const pushedBefore = session.pushed.length;
    expect(captured).not.toBeNull();
    captured!({ type: "git-status", data: {} });
    await flushMicrotasks();

    expect(session.pushed.length).toBeGreaterThan(pushedBefore);

    session.send({ t: "intent", name: "quit" });
    await runPromise;
  });

  test("a burst of synchronously-delivered git-status events collapses into a single in-flight refresh", async () => {
    const session = new QueueSession();
    let captured: ((ev: DaemonEvent) => void) | null = null;
    let daemonQueryCalls = 0;
    const deps = baseDeps({
      session,
      subscribe: (onEvent) => {
        captured = onEvent;
        return { close: () => {} };
      },
      daemonQuery: async () => {
        daemonQueryCalls++;
        return { ok: true, data: { repos: [] } };
      },
    });

    const runPromise = new MissionDriver(deps, START).run();
    await flushMicrotasks();
    const callsAfterSeed = daemonQueryCalls;

    // Both fire in the same synchronous tick, before the first refresh's
    // awaits have had a chance to run -- the second must be a no-op.
    captured!({ type: "git-status", data: {} });
    captured!({ type: "git-status", data: {} });
    await flushMicrotasks();

    expect(daemonQueryCalls).toBe(callsAfterSeed + 1);

    session.send({ t: "intent", name: "quit" });
    await runPromise;
  });

  test("a rejected badge refresh lands as an error Notice instead of an unhandled rejection", async () => {
    const session = new QueueSession();
    let captured: ((ev: DaemonEvent) => void) | null = null;
    let snapshotCalls = 0;
    const client = makeFakeClient({
      snapshot: async () => {
        snapshotCalls++;
        if (snapshotCalls === 1) return baseSnapshot();
        // The git-status-triggered refresh's own call.
        throw new Error("boom");
      },
    });
    const deps = baseDeps({
      session,
      client,
      subscribe: (onEvent) => {
        captured = onEvent;
        return { close: () => {} };
      },
    });

    const runPromise = new MissionDriver(deps, START).run();
    await flushMicrotasks();

    captured!({ type: "git-status", data: {} });
    await flushMicrotasks();

    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("error: boom");

    session.send({ t: "intent", name: "quit" });
    await runPromise;
  });
});

describe("MissionDriver: git-status refresh race", () => {
  test("a badge refresh in flight for the old worktree discards its result after a switch away", async () => {
    const session = new QueueSession();
    let captured: ((ev: DaemonEvent) => void) | null = null;
    let releaseStale: (() => void) | null = null;
    let snapshotCallsA = 0;
    const clientA = makeFakeClient({
      snapshot: async () => {
        snapshotCallsA++;
        if (snapshotCallsA === 1) return baseSnapshot({ branch: "initial-a" });
        // The git-status-triggered refresh's own call: blocks until released,
        // simulating a worktree switch landing while this fetch is in flight.
        return new Promise((resolve) => {
          releaseStale = () => resolve(baseSnapshot({ branch: "stale-a" }));
        });
      },
    });
    const clientB = makeFakeClient({ snapshot: async () => baseSnapshot({ branch: "fresh-b" }) });
    const deps = baseDeps({
      session,
      client: clientA,
      subscribe: (onEvent) => {
        captured = onEvent;
        return { close: () => {} };
      },
      daemonQuery: async (cmd: string) =>
        cmd === "worktree:list"
          ? {
              ok: true,
              data: {
                trees: [
                  { path: "/repo", name: "gandalf", branch: "main", state: "claimed" },
                  { path: "/repo2", name: "frodo", branch: "feature", state: "on-deck" },
                ],
              },
            }
          : {
              ok: true,
              data: { repos: [{ repo: "repo-tools", error: null, worktrees: [badge({ worktree: "/repo" }), badge({ worktree: "/repo2" })] }] },
            },
    });
    deps.client = (dir: string) => (dir === "/repo2" ? clientB : clientA);

    const runPromise = new MissionDriver(deps, START).run();
    await flushMicrotasks();

    // Fires the badge refresh, which captures worktree "/repo" and then
    // blocks on clientA's second snapshot() call.
    captured!({ type: "git-status", data: {} });
    await flushMicrotasks();
    expect(releaseStale).not.toBeNull();

    // A real switch lands while that refresh is still in flight.
    session.send({ t: "intent", name: "mission:worktree", payload: { path: "/repo2" } });
    await flushMicrotasks();
    const afterSwitch = session.pushed.at(-1) as MissionModel;
    expect(afterSwitch.current.worktree).toBe("/repo2");
    expect(afterSwitch.current.branch).toBe("fresh-b");

    // The stale refresh finally resolves -- it must not clobber the switch.
    releaseStale!();
    await flushMicrotasks();
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.current.worktree).toBe("/repo2");
    expect(last.current.branch).toBe("fresh-b");

    session.send({ t: "intent", name: "quit" });
    await runPromise;
  });

  test("a badge refresh in flight for the old selected path discards its diff after the selection changes", async () => {
    const session = new QueueSession();
    let captured: ((ev: DaemonEvent) => void) | null = null;
    let releaseStale: (() => void) | null = null;
    let staleDiffCalls = 0;
    const client = makeFakeClient({
      snapshot: async () =>
        baseSnapshot({
          clean: false,
          files: [
            { path: "a.txt", kind: "modified", staged: false, unstaged: true },
            { path: "b.txt", kind: "modified", staged: false, unstaged: true },
          ],
        }),
      stagingDiff: async (path: string) => {
        if (path !== "a.txt") return oneHunkDiff(path);
        staleDiffCalls++;
        if (staleDiffCalls === 1) return oneHunkDiff("a.txt"); // the initial seed's own fetch
        // The git-status-triggered refresh's own re-fetch: blocks until released.
        return new Promise((resolve) => {
          releaseStale = () => resolve(oneHunkDiff("a.txt"));
        });
      },
    });
    const deps = baseDeps({
      session,
      client,
      subscribe: (onEvent) => {
        captured = onEvent;
        return { close: () => {} };
      },
    });

    const runPromise = new MissionDriver(deps, START).run();
    await flushMicrotasks(); // seeds selectedPath to "a.txt" (the first change)

    captured!({ type: "git-status", data: {} }); // captures selectedPath "a.txt", blocks on its stagingDiff re-fetch
    await flushMicrotasks();
    expect(releaseStale).not.toBeNull();

    session.send({ t: "intent", name: "mission:select", payload: { path: "b.txt" } });
    await flushMicrotasks();
    const afterSelect = session.pushed.at(-1) as MissionModel;
    expect(afterSelect.diff.path).toBe("b.txt");

    releaseStale!();
    await flushMicrotasks();
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.diff.path).toBe("b.txt"); // the stale a.txt re-fetch must not clobber the new selection

    session.send({ t: "intent", name: "quit" });
    await runPromise;
  });
});

describe("MissionDriver: error boundary", () => {
  test("a handler throw lands as an error Notice and the session keeps processing later intents", async () => {
    const session = new FakeSession([
      // selIdx 99 doesn't exist in oneHunkDiff's single hunk, so
      // resolveCompactedSelIdx throws inside handleStage.
      { t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "line", selIdx: 99 } },
      { t: "intent", name: "mission:select", payload: { filter: "xyz" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session });

    await new MissionDriver(deps, START).run();

    const errorPush = session.pushed.find((m) => m.notice.startsWith("error: "));
    expect(errorPush).toBeDefined();
    expect(errorPush!.notice).toContain("selIdx 99 out of range");

    // The session survived the throw: the next intent still landed.
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.filter).toBe("xyz");
  });
});

describe("MissionDriver: session death", () => {
  test("a died/error SessionEnd throws a SessionDied for the command layer to report", async () => {
    const session = new FakeSession([], { reason: "died", code: 7 });
    const deps = baseDeps({ session });

    await expect(new MissionDriver(deps, START).run()).rejects.toThrow(SessionDied);
  });
});

describe("MissionDriver: notice lifecycle", () => {
  test("a stale Notice from a prior refusal clears on the next successful intent", async () => {
    const client = makeFakeClient();
    let guardCalls = 0;
    const session = new FakeSession([
      // Refused: guard fires only on the first checkout attempt below.
      { t: "intent", name: "mission:checkout", payload: { branch: "guarded-branch" } },
      // Unrelated, guard-free intent that must land as a clean success.
      { t: "intent", name: "mission:select", payload: { filter: "xyz" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      client,
      guard: async () => {
        guardCalls++;
        return { verdict: "refuse", reason: "worktree", detail: "guarded-branch is checked out elsewhere" };
      },
    });

    await new MissionDriver(deps, START).run();

    expect(guardCalls).toBe(1);
    expect((session.pushed[0] as MissionModel).notice).toBe("guarded-branch is checked out elsewhere");
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.filter).toBe("xyz");
    expect(last.notice).toBe("");
  });

  test("a worktree switch clears a lingering Notice instead of carrying it across", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:discard", payload: { path: "a.txt", mode: "toggle-file" } }, // arms, sets Notice
      { t: "intent", name: "mission:worktree", payload: { path: "/repo" } }, // same path, but a real switch attempt
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session });

    await new MissionDriver(deps, START).run();

    expect((session.pushed[0] as MissionModel).notice).toBe("press d again to discard");
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("");
  });
});

describe("MissionDriver: seed", () => {
  test("the initial seed builds and hands off exactly one model -- no push before the first intent is handled", async () => {
    let openSessionCalls = 0;
    const session = new FakeSession([{ t: "intent", name: "quit" }]);
    const deps = baseDeps({ session });
    deps.openSession = async (view, model) => {
      openSessionCalls++;
      return session;
    };

    await new MissionDriver(deps, START).run();

    expect(openSessionCalls).toBe(1);
    expect(session.pushed).toHaveLength(0);
  });

  test("seeds selectedPath to the first change so the diff pane opens populated", async () => {
    const client = makeFakeClient({
      snapshot: async () => baseSnapshot({ clean: false, files: [{ path: "a.txt", kind: "modified", staged: false, unstaged: true }] }),
    });
    const session = new FakeSession([{ t: "intent", name: "quit" }]);
    let opened: MissionModel | null = null;
    const deps = baseDeps({ session, client });
    deps.openSession = async (view, model) => {
      opened = model as MissionModel;
      return session;
    };

    await new MissionDriver(deps, START).run();

    expect(opened).not.toBeNull();
    expect(opened!.diff.path).toBe("a.txt");
    expect(opened!.diff.kind).toBe("text");
    expect(opened!.diff.lines.length).toBeGreaterThan(0);
  });
});
