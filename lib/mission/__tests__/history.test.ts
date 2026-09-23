import { describe, expect, test } from "bun:test";
import type { ChangesetData, Commit, CommittedFileChange, GitClient, StagingDiff } from "../../../packages/git-core/src/index.ts";
import { AppFileStatusKind } from "../../../packages/git-core/src/index.ts";
import { HistoryStore } from "../history.ts";

function fakeCommit(sha: string, summary = sha): Commit {
  const id = { name: "Pat", email: "pat@example.com", date: new Date("2026-09-20T00:00:00Z"), tzOffset: 0 };
  return { sha, shortSha: sha.slice(0, 7), summary, body: "", author: id, committer: id, parentSHAs: [], trailers: [], tags: [], coAuthors: [], authoredByCommitter: true, isMergeCommit: false };
}

function file(path: string, commitish = "x"): CommittedFileChange {
  return { path, status: { kind: AppFileStatusKind.Modified }, commitish, parentCommitish: `${commitish}^` };
}

function shas(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, "0")}`);
}

type HistoryClient = Pick<GitClient, "commits" | "localCommits" | "changedFiles" | "commitRangeChangedFiles" | "commitDiff" | "commitRangeDiff">;

function fakeClient(opts: { history: string[]; local?: string[]; files?: Record<string, string[]>; tags?: Record<string, string[]> }) {
  const calls = { commits: [] as Array<{ range?: string; limit?: number; skip?: number }>, local: [] as Array<number | undefined>, changed: [] as string[], range: [] as string[][], diff: [] as string[] };
  const byShas = (list: string[], limit = list.length, skip = 0) =>
    list.slice(skip, skip + limit).map((s) => ({ ...fakeCommit(s), tags: opts.tags?.[s] ?? [] }));
  const client: HistoryClient = {
    commits: async (range, limit, skip) => {
      calls.commits.push({ range, limit, skip });
      return byShas(opts.history, limit, skip);
    },
    localCommits: async (branch, skip) => {
      calls.local.push(skip);
      return branch ? byShas(opts.local ?? [], 100, skip ?? 0) : [];
    },
    changedFiles: async (sha) => {
      calls.changed.push(sha);
      return { files: (opts.files?.[sha] ?? ["a.ts"]).map((p) => file(p, sha)), linesAdded: 1, linesDeleted: 0 };
    },
    commitRangeChangedFiles: async (list) => {
      calls.range.push([...list]);
      return { files: [file("range.ts")], linesAdded: 2, linesDeleted: 1 };
    },
    commitDiff: async (f, sha) => {
      calls.diff.push(`${sha}:${f.path}`);
      return { path: f.path, kind: "text", untracked: false, hunks: [] };
    },
    commitRangeDiff: async (f, list) => {
      calls.diff.push(`${list.join("..")}:${f.path}`);
      return { path: f.path, kind: "text", untracked: false, hunks: [] };
    },
  };
  return { client: client as unknown as GitClient, calls };
}

const BRANCH = { name: "main", upstream: "origin/main" };

describe("HistoryStore", () => {
  test("first sync loads a batch, selects the first commit and its first file", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 3), files: { c000: ["x.ts", "y.ts"] } });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    expect(store.commits.map((c) => c.sha)).toEqual(["c000", "c001", "c002"]);
    expect(store.selection).toEqual(["c000"]);
    expect(store.selectedFile?.path).toBe("x.ts");
    expect(calls.diff).toEqual(["c000:x.ts"]);
    expect(store.hasMore).toBe(false);
  });

  test("an unchanged tip does not reload", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 3) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    const before = calls.commits.filter((c) => c.limit === 100).length;
    expect(await store.syncTip(client, BRANCH)).toBe(false);
    expect(calls.commits.filter((c) => c.limit === 100).length).toBe(before);
  });

  test("a requested reload re-reads every loaded commit in place, keeping paging depth and the selection", async () => {
    const opts = { history: shas("c", 250), tags: {} as Record<string, string[]> };
    const { client, calls } = fakeClient(opts);
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.loadNextBatch(client, BRANCH);
    await store.select(client, ["c150"]);
    const changesetLoads = calls.changed.length;

    opts.tags.c150 = ["v1"];
    store.requestReload();
    expect(await store.syncTip(client, BRANCH)).toBe(true);

    expect(calls.commits.at(-1)).toEqual({ range: "HEAD", limit: 200, skip: 0 });
    expect(store.commits.length).toBe(200);
    expect(store.commits.find((c) => c.sha === "c150")!.tags).toEqual(["v1"]);
    expect(store.selection).toEqual(["c150"]);
    expect(store.hasMore).toBe(true);
    expect(calls.changed.length).toBe(changesetLoads);
  });

  test("a requested reload is served once: the next unchanged-tip sync does not reload again", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 3) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    store.requestReload();
    await store.syncTip(client, BRANCH);
    const reads = calls.commits.length;
    expect(await store.syncTip(client, BRANCH)).toBe(false);
    expect(calls.commits.length).toBe(reads + 1);
  });

  test("a requested reload whose git read fails stays requested, so the next sync retries it", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 3) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    const read = client.commits;
    let failNext = true;
    client.commits = async (range, limit, skip, extra) => {
      if (failNext && limit !== 1) {
        failNext = false;
        throw new Error("git log failed");
      }
      return read(range, limit, skip, extra);
    };
    store.requestReload();
    await expect(store.syncTip(client, BRANCH)).rejects.toThrow("git log failed");
    expect(await store.syncTip(client, BRANCH)).toBe(true);
    expect(calls.commits.at(-1)).toEqual({ range: "HEAD", limit: 3, skip: 0 });
  });

  test("a new tip reloads and keeps a selection that is still present", async () => {
    const history = shas("c", 3);
    const { client } = fakeClient({ history });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.select(client, ["c001"]);
    history.unshift("new");
    expect(await store.syncTip(client, BRANCH)).toBe(true);
    expect(store.commits[0]!.sha).toBe("new");
    expect(store.selection).toEqual(["c001"]);
  });

  test("a new tip that drops the selected commit selects the first", async () => {
    const history = shas("c", 3);
    const { client } = fakeClient({ history });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.select(client, ["c002"]);
    history.splice(0, history.length, "z1", "z2");
    await store.syncTip(client, BRANCH);
    expect(store.selection).toEqual(["z1"]);
  });

  test("an unborn repo loads an empty history with nothing selected", async () => {
    const { client } = fakeClient({ history: [] });
    const store = new HistoryStore();
    await store.syncTip(client, null);
    expect(store.loaded).toBe(true);
    expect(store.commits).toEqual([]);
    expect(store.selection).toEqual([]);
    expect(store.changeset).toBeNull();
  });

  test("paging 250 commits requests each page once and never duplicates", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 250) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    expect(store.hasMore).toBe(true);
    await store.loadNextBatch(client, BRANCH);
    await store.loadNextBatch(client, BRANCH);
    await store.loadNextBatch(client, BRANCH);
    expect(store.commits.length).toBe(250);
    expect(new Set(store.commits.map((c) => c.sha)).size).toBe(250);
    expect(store.hasMore).toBe(false);
    expect(calls.commits.filter((c) => c.skip === 100).length).toBe(1);
    expect(calls.commits.filter((c) => c.skip === 200).length).toBe(1);
  });

  test("paging pulls from local commits first while the last loaded commit is local", async () => {
    const history = shas("c", 150);
    const { client, calls } = fakeClient({ history, local: history.slice(0, 120) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.loadNextBatch(client, BRANCH);
    expect(calls.local).toContain(100);
    expect(store.commits.length).toBe(120);
    expect(store.localShas.size).toBe(120);
    expect(new Set(store.commits.map((c) => c.sha)).size).toBe(120);
    // Pushed commits still follow a short local page.
    expect(store.hasMore).toBe(true);
  });

  test("a git page shorter than a full batch ends paging", async () => {
    const { client } = fakeClient({ history: shas("c", 150) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.loadNextBatch(client, BRANCH);
    expect(store.commits.length).toBe(150);
    expect(store.hasMore).toBe(false);
  });

  test("an unchanged tip still refreshes the unpushed set, as GHD's refreshHistorySection does", async () => {
    const opts = { history: shas("c", 3), local: ["c000", "c001"] };
    const { client, calls } = fakeClient(opts);
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    expect(store.localShas.size).toBe(2);
    opts.local = [];
    const reloads = calls.commits.filter((c) => c.limit === 100).length;
    expect(await store.syncTip(client, BRANCH)).toBe(true);
    expect(store.localShas.size).toBe(0);
    expect(calls.commits.filter((c) => c.limit === 100).length).toBe(reloads);
    expect(await store.syncTip(client, BRANCH)).toBe(false);
  });

  test("two concurrent loadNextBatch calls collapse into a single in-flight request", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 250) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    const [first, second] = [store.loadNextBatch(client, BRANCH), store.loadNextBatch(client, BRANCH)];
    await Promise.all([first, second]);
    expect(store.commits.length).toBe(200);
    expect(store.hasMore).toBe(true);
    expect(calls.commits.filter((c) => c.skip === 100).length).toBe(1);
    await store.loadNextBatch(client, BRANCH);
    expect(store.commits.length).toBe(250);
  });

  test("a syncTip reload drops a stale in-flight page instead of appending it", async () => {
    const history = shas("c", 250);
    const { client } = fakeClient({ history });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    const stalePage = history.slice(100, 200).map((s) => fakeCommit(s));
    let release!: (v: Commit[]) => void;
    const slow = new Promise<Commit[]>((r) => { release = r; });
    const original = client.commits;
    client.commits = (range, limit, skip) => (skip === 100 ? slow : original(range, limit, skip));
    const pending = store.loadNextBatch(client, BRANCH);
    const newHistory = shas("n", 3);
    history.splice(0, history.length, ...newHistory);
    await store.syncTip(client, BRANCH);
    release(stalePage);
    await pending;
    expect(store.commits.map((c) => c.sha)).toEqual(newHistory);
  });

  test("an earlier-started, later-resolving syncTip reload does not overwrite a newer one", async () => {
    const { client } = fakeClient({ history: shas("c", 3) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    const batchA = shas("a", 3).map((s) => fakeCommit(s));
    const batchB = shas("b", 3).map((s) => fakeCommit(s));
    let releaseA!: (v: Commit[]) => void;
    const slowBatchA = new Promise<Commit[]>((r) => { releaseA = r; });
    let tipCalls = 0;
    let batchCalls = 0;
    client.commits = async (_range, limit) => {
      if (limit === 1) return tipCalls++ === 0 ? [batchA[0]!] : [batchB[0]!];
      return ++batchCalls === 1 ? slowBatchA : batchB;
    };
    const first = store.syncTip(client, BRANCH);
    await new Promise((r) => setTimeout(r, 0));
    const second = await store.syncTip(client, BRANCH);
    releaseA(batchA);
    await first;
    expect(second).toBe(true);
    expect(store.tip).toBe("b000");
    expect(store.commits.map((c) => c.sha)).toEqual(["b000", "b001", "b002"]);
  });

  test("a page load starting after the tip probe resolves does not append onto a reload's new list", async () => {
    const history = shas("c", 250);
    const { client } = fakeClient({ history });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    const newHistory = shas("n", 3);
    let releaseSyncBatch!: (v: Commit[]) => void;
    const syncBatch = new Promise<Commit[]>((r) => { releaseSyncBatch = r; });
    let releasePage!: (v: Commit[]) => void;
    const page = new Promise<Commit[]>((r) => { releasePage = r; });
    const original = client.commits;
    client.commits = (range, limit, skip) => {
      if (limit === 100 && skip === 0) return syncBatch;
      if (skip === 100) return page;
      return original(range, limit, skip);
    };
    history.splice(0, history.length, ...newHistory);
    const sync = store.syncTip(client, BRANCH);
    await new Promise((r) => setTimeout(r, 0));
    const pending = store.loadNextBatch(client, BRANCH);
    releaseSyncBatch(newHistory.map((s) => fakeCommit(s)));
    await sync;
    releasePage(shas("c", 250).slice(100, 200).map((s) => fakeCommit(s)));
    await pending;
    expect(store.commits.map((c) => c.sha)).toEqual(newHistory);
    expect(store.hasMore).toBe(false);
  });

  test("a page load joins the current list, not a doomed one left over from a reload", async () => {
    const history = shas("c", 250);
    const { client } = fakeClient({ history });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    let release!: (v: Commit[]) => void;
    const slow = new Promise<Commit[]>((r) => { release = r; });
    const original = client.commits;
    let skip100Calls = 0;
    client.commits = (range, limit, skip) => {
      if (skip === 100) {
        skip100Calls++;
        return skip100Calls === 1 ? slow : original(range, limit, skip);
      }
      return original(range, limit, skip);
    };
    const stalePending = store.loadNextBatch(client, BRANCH);
    const newHistory = shas("n", 250);
    history.splice(0, history.length, ...newHistory);
    await store.syncTip(client, BRANCH);
    const fresh = store.loadNextBatch(client, BRANCH);
    expect(fresh).not.toBe(stalePending);
    await fresh;
    expect(store.commits.length).toBe(200);
    expect(store.commits.slice(0, 3).map((c) => c.sha)).toEqual(["n000", "n001", "n002"]);
    release([]);
    await stalePending;
    expect(store.commits.length).toBe(200);
  });

  test("an unchanged-tip syncTip does not disrupt an in-flight page load", async () => {
    const { client } = fakeClient({ history: shas("c", 250) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    let release!: (v: Commit[]) => void;
    const slow = new Promise<Commit[]>((r) => { release = r; });
    const original = client.commits;
    client.commits = (range, limit, skip) => (skip === 100 ? slow : original(range, limit, skip));
    const pending = store.loadNextBatch(client, BRANCH);
    expect(await store.syncTip(client, BRANCH)).toBe(false);
    release(shas("c", 250).slice(100, 200).map((s) => fakeCommit(s)));
    await pending;
    expect(store.commits.length).toBe(200);
    expect(store.hasMore).toBe(true);
  });

  test("a page load's rejection is caught by the caller, not an unhandled rejection", async () => {
    const { client } = fakeClient({ history: shas("c", 250) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    const original = client.commits;
    let fail = true;
    client.commits = (range, limit, skip) => {
      if (skip === 100 && fail) {
        fail = false;
        return Promise.reject(new Error("git log failed"));
      }
      return original(range, limit, skip);
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      let caught: unknown;
      try {
        await store.loadNextBatch(client, BRANCH);
      } catch (err) {
        caught = err;
      }
      expect((caught as Error)?.message).toBe("git log failed");
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).toEqual([]);
      await store.loadNextBatch(client, BRANCH);
      expect(store.commits.length).toBe(200);
      expect(store.hasMore).toBe(true);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("syncTip sets tip from the batch it loaded, not the earlier head probe", async () => {
    const history = shas("c", 3);
    const { client } = fakeClient({ history });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    history.unshift("new");
    const original = client.commits;
    client.commits = (range, limit, skip) => (limit === 1 ? Promise.resolve([fakeCommit("stale-head")]) : original(range, limit, skip));
    expect(await store.syncTip(client, BRANCH)).toBe(true);
    expect(store.tip).toBe("new");
    expect(store.tip).toBe(store.commits[0]!.sha);
  });

  test("a contiguous range loads the range changeset oldest first", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 4) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.select(client, ["c001", "c002"]);
    expect(store.isContiguous()).toBe(true);
    expect(calls.range).toEqual([["c002", "c001"]]);
    expect(store.changeset?.files[0]!.path).toBe("range.ts");
  });

  test("a non-contiguous selection loads nothing", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 4) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.select(client, ["c000", "c002"]);
    expect(store.isContiguous()).toBe(false);
    expect(store.changeset).toBeNull();
    expect(calls.range).toEqual([]);
  });

  test("a reload that breaks a kept multi-selection's contiguity clears the changeset", async () => {
    const history = shas("c", 4);
    const { client, calls } = fakeClient({ history });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.select(client, ["c001", "c002"]);
    expect(store.changeset?.files[0]!.path).toBe("range.ts");
    const rangeCallsBefore = calls.range.length;
    history.splice(0, 0, "new");
    history.splice(3, 0, "x000");
    await store.syncTip(client, BRANCH);
    expect(store.selection).toEqual(["c001", "c002"]);
    expect(store.isContiguous()).toBe(false);
    expect(store.changeset).toBeNull();
    expect(calls.range.length).toBe(rangeCallsBefore);
  });

  test("a kept multi-selection that becomes contiguous after a reload loads its changeset", async () => {
    const history = ["c000", "c001", "cX", "c002"];
    const { client, calls } = fakeClient({ history });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.select(client, ["c001", "c002"]);
    expect(store.isContiguous()).toBe(false);
    expect(store.changeset).toBeNull();
    const rangeCallsBefore = calls.range.length;
    history.splice(0, history.length, "new", "c000", "c001", "c002");
    await store.syncTip(client, BRANCH);
    expect(store.selection).toEqual(["c001", "c002"]);
    expect(store.isContiguous()).toBe(true);
    expect(store.changeset?.files[0]!.path).toBe("range.ts");
    expect(calls.range.length).toBe(rangeCallsBefore + 1);
  });

  test("a loaded contiguous range with a non-first file selected survives a reload unchanged", async () => {
    const history = shas("c", 4);
    const { client, calls } = fakeClient({ history });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    client.commitRangeChangedFiles = async (list) => {
      calls.range.push([...list]);
      return { files: [file("range-a.ts"), file("range-b.ts")], linesAdded: 2, linesDeleted: 1 };
    };
    await store.select(client, ["c001", "c002"]);
    await store.selectFile(client, "range-b.ts");
    expect(store.selectedFile?.path).toBe("range-b.ts");
    const changesetBefore = store.changeset;
    const rangeCallsBefore = calls.range.length;
    history.unshift("new");
    await store.syncTip(client, BRANCH);
    expect(store.selection).toEqual(["c001", "c002"]);
    expect(store.isContiguous()).toBe(true);
    expect(store.changeset).toBe(changesetBefore);
    expect(store.selectedFile?.path).toBe("range-b.ts");
    expect(calls.range.length).toBe(rangeCallsBefore);
  });

  test("a slow range changeset is dropped when a reload leaves the same selection non-contiguous", async () => {
    const history = shas("c", 4);
    const { client } = fakeClient({ history });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    let release!: (v: ChangesetData) => void;
    const slow = new Promise<ChangesetData>((r) => { release = r; });
    const original = client.commitRangeChangedFiles;
    client.commitRangeChangedFiles = (list) => (list.join(",") === "c002,c001" ? slow : original(list));
    const first = store.select(client, ["c001", "c002"]);
    history.splice(0, 0, "new");
    history.splice(3, 0, "x000");
    await store.syncTip(client, BRANCH);
    release({ files: [file("stale-range.ts")], linesAdded: 0, linesDeleted: 0 });
    await first;
    expect(store.selection).toEqual(["c001", "c002"]);
    expect(store.isContiguous()).toBe(false);
    expect(store.changeset).toBeNull();
  });

  test("a slow changeset for a superseded selection is dropped", async () => {
    const { client } = fakeClient({ history: shas("c", 3) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    let release!: (v: ChangesetData) => void;
    const slow = new Promise<ChangesetData>((r) => { release = r; });
    const original = client.changedFiles;
    client.changedFiles = (sha) => (sha === "c001" ? slow : original(sha));
    const first = store.select(client, ["c001"]);
    await store.select(client, ["c002"]);
    release({ files: [file("stale.ts")], linesAdded: 0, linesDeleted: 0 });
    await first;
    expect(store.selection).toEqual(["c002"]);
    expect(store.changeset?.files[0]!.path).toBe("a.ts");
  });

  test("a slow diff for a superseded file is dropped", async () => {
    const { client } = fakeClient({ history: shas("c", 1), files: { c000: ["a.ts", "b.ts"] } });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    let release!: (v: StagingDiff) => void;
    const slow = new Promise<StagingDiff>((r) => { release = r; });
    const original = client.commitDiff;
    client.commitDiff = (f, sha) => (f.path === "a.ts" ? slow : original(f, sha));
    const first = store.selectFile(client, "a.ts");
    await store.selectFile(client, "b.ts");
    release({ path: "a.ts", kind: "text", untracked: false, hunks: [] });
    await first;
    expect(store.diff?.path).toBe("b.ts");
  });

  test("a slow diff is dropped when the selection changes even though the pending path still matches", async () => {
    const { client } = fakeClient({ history: shas("c", 2), files: { c000: ["a.ts"], c001: ["a.ts"] } });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    let release!: (v: StagingDiff) => void;
    const slow = new Promise<StagingDiff>((r) => { release = r; });
    const original = client.commitDiff;
    client.commitDiff = (f, sha) => (sha === "c000" ? slow : original(f, sha));
    const first = store.selectFile(client, "a.ts");
    await store.select(client, ["c001"]);
    release({ path: "a.ts", kind: "text", untracked: true, hunks: [] });
    await first;
    expect(store.selection).toEqual(["c001"]);
    expect(store.diff?.untracked).toBe(false);
  });

  test("reset forgets everything so the next sync reloads", async () => {
    const { client } = fakeClient({ history: shas("c", 2) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    store.reset();
    expect(store.loaded).toBe(false);
    expect(store.commits).toEqual([]);
    expect(await store.syncTip(client, BRANCH)).toBe(true);
  });

  test("a reset during the HEAD probe leaves that sync with nothing to apply", async () => {
    const { client } = fakeClient({ history: shas("c", 3) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    let release!: (v: Commit[]) => void;
    const slow = new Promise<Commit[]>((r) => { release = r; });
    const original = client.commits;
    client.commits = (range, limit, skip) => (limit === 1 ? slow : original(range, limit, skip));
    const pending = store.syncTip(client, BRANCH);
    store.reset();
    release([fakeCommit("c000")]);
    expect(await pending).toBe(false);
    expect(store.loaded).toBe(false);
    expect(store.commits).toEqual([]);
  });

  test("the local set marks unpushed commits", async () => {
    const { client } = fakeClient({ history: shas("c", 3), local: ["c000"] });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    expect(store.localShas.has("c000")).toBe(true);
    expect(store.localShas.has("c001")).toBe(false);
  });
});
