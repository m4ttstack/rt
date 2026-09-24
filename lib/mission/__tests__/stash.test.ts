import { describe, expect, test } from "bun:test";
import type { DesktopStashEntry, GitClient, RepoSnapshot } from "../../../packages/git-core/src/index.ts";
import {
  StashStore,
  canStash,
  checkoutAndBringChanges,
  checkoutAndLeaveChanges,
  createStashAndDropPreviousEntry,
  untrackedPaths,
} from "../stash.ts";

function entry(sha: string, branchName = "main"): DesktopStashEntry {
  return { name: "refs/stash@{0}", stashSha: sha, branchName, tree: "t", parents: ["p"] };
}

function snap(over: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    branch: "main", detached: false, upstream: null, ahead: null, behind: null,
    files: [{ path: "a.txt", kind: "modified", staged: false, unstaged: true }], clean: false, ...over,
  };
}

function fake(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const client = {
    lastDesktopStashEntryForBranch: async (b: string) => (calls.push(`last ${b}`), null),
    createDesktopStashEntry: async (b: string, u: ReadonlyArray<string>) => (calls.push(`create ${b} [${u.join(",")}]`), true),
    dropDesktopStashEntry: async (s: string) => void calls.push(`drop ${s}`),
    popStashEntry: async (s: string) => void calls.push(`pop ${s}`),
    checkoutBranch: async (n: string) => void calls.push(`checkout ${n}`),
    stashedFiles: async (s: string) => (calls.push(`files ${s}`), [{ path: "a.txt", status: { kind: "Modified" } }]),
    commitDiff: async (f: { path: string }, s: string) => (calls.push(`diff ${f.path} ${s}`), { path: f.path, kind: "text", untracked: false, hunks: [] }),
    ...over,
  };
  return { client: client as unknown as GitClient, calls };
}

describe("canStash", () => {
  test("needs changes, a branch tip, and no conflicts", () => {
    expect(canStash(snap())).toBe(true);
    expect(canStash(snap({ files: [] }))).toBe(false);
    expect(canStash(snap({ branch: null, detached: true }))).toBe(false);
    expect(canStash(snap({ branch: null }))).toBe(false);
    expect(canStash(snap({ files: [{ path: "a", kind: "conflicted", staged: false, unstaged: true }] }))).toBe(false);
  });

  test("untrackedPaths lists only untracked files", () => {
    const s = snap({ files: [{ path: "a", kind: "modified", staged: false, unstaged: true }, { path: "n", kind: "untracked", staged: false, unstaged: true }] });
    expect(untrackedPaths(s)).toEqual(["n"]);
  });
});

describe("createStashAndDropPreviousEntry", () => {
  test("creates first, then drops the branch's previous entry", async () => {
    const { client, calls } = fake({ lastDesktopStashEntryForBranch: async () => entry("old") });
    expect(await createStashAndDropPreviousEntry(client, "main", ["n"])).toBe("");
    expect(calls).toEqual(["create main [n]", "drop old"]);
  });

  test("keeps the previous entry when nothing was stashed", async () => {
    const { client, calls } = fake({
      lastDesktopStashEntryForBranch: async () => entry("old"),
      createDesktopStashEntry: async () => false,
    });
    expect(await createStashAndDropPreviousEntry(client, "main", [])).toBe("");
    expect(calls).toEqual([]);
  });

  test("a failed create throws, and the previous entry is kept", async () => {
    const { client, calls } = fake({
      lastDesktopStashEntryForBranch: async () => entry("old"),
      createDesktopStashEntry: async () => {
        throw new Error("create boom");
      },
    });
    await expect(createStashAndDropPreviousEntry(client, "main", [])).rejects.toThrow("create boom");
    expect(calls).toEqual([]);
  });

  test("a failed drop after a successful create reports the drop, not the stash", async () => {
    const { client, calls } = fake({
      lastDesktopStashEntryForBranch: async () => entry("old"),
      dropDesktopStashEntry: async () => {
        throw new Error("drop boom");
      },
    });
    const notice = await createStashAndDropPreviousEntry(client, "main", []);
    expect(notice).toBe("Your changes were stashed, but the previous stash could not be removed: drop boom");
    expect(calls).toEqual(["create main []"]);
  });
});

describe("checkoutAndLeaveChanges", () => {
  test("stashes on the current branch, then checks out", async () => {
    const { client, calls } = fake();
    expect(await checkoutAndLeaveChanges(client, "other", snap())).toBe("");
    expect(calls).toEqual(["last main", "create main []", "checkout other"]);
  });

  test("a tree that became clean makes no stash and still switches", async () => {
    const { client, calls } = fake();
    await checkoutAndLeaveChanges(client, "other", snap({ files: [] }));
    expect(calls).toEqual(["checkout other"]);
  });

  test("a failed stash is reported and the checkout still runs", async () => {
    const { client, calls } = fake({ createDesktopStashEntry: async () => { throw new Error("boom"); } });
    expect(await checkoutAndLeaveChanges(client, "other", snap())).toBe("boom");
    expect(calls).toEqual(["last main", "checkout other"]);
  });

  test("a failed drop of the old entry is reported and the checkout still runs", async () => {
    const { client, calls } = fake({
      lastDesktopStashEntryForBranch: async (b: string) => (calls.push(`last ${b}`), entry("old")),
      dropDesktopStashEntry: async () => {
        throw new Error("drop boom");
      },
    });
    expect(await checkoutAndLeaveChanges(client, "other", snap())).toBe("Your changes were stashed, but the previous stash could not be removed: drop boom");
    expect(calls).toEqual(["last main", "create main []", "checkout other"]);
  });

  test("a failed checkout after a failed drop reports both", async () => {
    const { client } = fake({
      lastDesktopStashEntryForBranch: async () => entry("old"),
      dropDesktopStashEntry: async () => {
        throw new Error("drop boom");
      },
      checkoutBranch: async () => {
        throw new Error("checkout boom");
      },
    });
    await expect(checkoutAndLeaveChanges(client, "other", snap())).rejects.toThrow(
      "Your changes were stashed, but the previous stash could not be removed: drop boom · checkout boom",
    );
  });

  test("a failed checkout with nothing else to report rethrows the checkout error untouched", async () => {
    const other = new Error("checkout boom");
    const { client } = fake({ checkoutBranch: async () => { throw other; } });
    await expect(checkoutAndLeaveChanges(client, "other", snap())).rejects.toBe(other);
  });
});

describe("checkoutAndBringChanges", () => {
  const overwrite = Object.assign(new Error("checkout failed"), {
    stderr: "error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\n",
  });

  test("a checkout that succeeds carries the changes and stashes nothing", async () => {
    const { client, calls } = fake();
    await checkoutAndBringChanges(client, "other", snap());
    expect(calls).toEqual(["checkout other"]);
  });

  test("an overwrite refusal moves the changes through a stash tagged for the target", async () => {
    let first = true;
    const { client, calls } = fake({
      checkoutBranch: async (n: string) => {
        calls.push(`checkout ${n}`);
        if (first) {
          first = false;
          throw overwrite;
        }
      },
      lastDesktopStashEntryForBranch: async (b: string) => (calls.push(`last ${b}`), entry("tmp", b)),
    });
    await checkoutAndBringChanges(client, "other", snap({ files: [{ path: "n", kind: "untracked", staged: false, unstaged: true }] }));
    expect(calls).toEqual(["checkout other", "create other [n]", "last other", "checkout other", "pop tmp"]);
  });

  test("an overwrite refusal with nothing stashable rethrows the checkout error", async () => {
    const { client } = fake({
      checkoutBranch: async () => { throw overwrite; },
      createDesktopStashEntry: async () => false,
    });
    await expect(checkoutAndBringChanges(client, "other", snap())).rejects.toBe(overwrite);
  });

  test("any other checkout failure is rethrown untouched", async () => {
    const other = new Error("fatal: invalid reference");
    const { client, calls } = fake({ checkoutBranch: async () => { throw other; } });
    await expect(checkoutAndBringChanges(client, "other", snap())).rejects.toBe(other);
    expect(calls).toEqual([]);
  });
});

describe("StashStore", () => {
  test("loads the branch's entry and its files once per sha", async () => {
    const { client, calls } = fake({ lastDesktopStashEntryForBranch: async () => entry("s1") });
    const store = new StashStore();
    await store.load(client, "main");
    await store.load(client, "main");
    expect(store.entry?.stashSha).toBe("s1");
    expect(store.files?.map((f) => f.path)).toEqual(["a.txt"]);
    expect(calls.filter((c) => c.startsWith("files"))).toEqual(["files s1"]);
  });

  test("a null branch has no entry", async () => {
    const { client } = fake({ lastDesktopStashEntryForBranch: async () => entry("s1") });
    const store = new StashStore();
    await store.load(client, null);
    expect(store.entry).toBeNull();
  });

  test("select opens the view on the first file and loads its diff from the stash sha", async () => {
    const { client, calls } = fake({ lastDesktopStashEntryForBranch: async () => entry("s1") });
    const store = new StashStore();
    await store.load(client, "main");
    await store.select(client);
    expect(store.showing).toBe(true);
    expect(store.selectedFile?.path).toBe("a.txt");
    expect(store.diff?.path).toBe("a.txt");
    expect(calls).toContain("diff a.txt s1");
    store.hide();
    expect(store.showing).toBe(false);
  });

  test("the view closes when the entry disappears", async () => {
    let current: DesktopStashEntry | null = entry("s1");
    const { client } = fake({ lastDesktopStashEntryForBranch: async () => current });
    const store = new StashStore();
    await store.load(client, "main");
    await store.select(client);
    current = null;
    await store.load(client, "main");
    expect(store.entry).toBeNull();
    expect(store.showing).toBe(false);
    expect(store.files).toBeNull();
    expect(store.diff).toBeNull();
  });

  test("a new stash on the same branch reloads files and reselects while showing", async () => {
    let current = entry("s1");
    const { client, calls } = fake({ lastDesktopStashEntryForBranch: async () => current });
    const store = new StashStore();
    await store.load(client, "main");
    await store.select(client);
    current = entry("s2");
    await store.load(client, "main");
    expect(store.entry?.stashSha).toBe("s2");
    expect(store.showing).toBe(true);
    expect(calls).toContain("diff a.txt s2");
  });

  test("reset() clears all state and aborts in-flight loads", async () => {
    let resolveLoad: ((value: DesktopStashEntry | null) => void) = () => {};
    const { client } = fake({ lastDesktopStashEntryForBranch: async () => new Promise<DesktopStashEntry | null>((resolve) => { resolveLoad = resolve; }) });
    const store = new StashStore();
    const loadPromise = store.load(client, "main");
    await store.select(client);
    expect(store.showing).toBe(false);
    store.reset();
    expect(store.entry).toBeNull();
    expect(store.files).toBeNull();
    expect(store.showing).toBe(false);
    expect(store.selectedFile).toBeNull();
    expect(store.diff).toBeNull();
    resolveLoad(entry("s1"));
    await loadPromise;
    expect(store.entry).toBeNull();
  });

  test("showOversized marks a path and isOversizedShown checks it, cleared when sha changes", async () => {
    let current = entry("s1");
    const { client } = fake({ lastDesktopStashEntryForBranch: async () => current });
    const store = new StashStore();
    await store.load(client, "main");
    store.showOversized("a.txt");
    store.showOversized("b.txt");
    expect(store.isOversizedShown("a.txt")).toBe(true);
    expect(store.isOversizedShown("b.txt")).toBe(true);
    expect(store.isOversizedShown("c.txt")).toBe(false);
    current = entry("s2");
    await store.load(client, "main");
    expect(store.isOversizedShown("a.txt")).toBe(false);
    expect(store.isOversizedShown("b.txt")).toBe(false);
  });
});
