import { describe, expect, it } from "bun:test";
import { makeSandbox, type Sandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

// Every read method must succeed (not throw) on every repo state below.
type Scenario = { name: string; setup: (sb: Sandbox) => Promise<void> };

const SCENARIOS: Scenario[] = [
  { name: "empty repo, no commits", setup: async () => {} },
  {
    name: "one commit, clean",
    setup: async (sb) => {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
    },
  },
  {
    name: "detached HEAD",
    setup: async (sb) => {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      const sha = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.git(["checkout", "--detach", sha]);
    },
  },
  {
    name: "mid-merge conflict",
    setup: async (sb) => {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.git(["checkout", "-b", "feature"]);
      await sb.write("a.txt", "f\n");
      await sb.commitAll("feature");
      await sb.git(["checkout", "main"]);
      await sb.write("a.txt", "m\n");
      await sb.commitAll("main");
      await expect(sb.git(["merge", "feature"])).rejects.toThrow();
      expect((await sb.git(["diff", "--name-only", "--diff-filter=U"])).trim()).toBe("a.txt");
    },
  },
  {
    name: "mid-rebase conflict",
    setup: async (sb) => {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.git(["checkout", "-b", "feature"]);
      await sb.write("a.txt", "f\n");
      await sb.commitAll("feature");
      await sb.git(["checkout", "main"]);
      await sb.write("a.txt", "m\n");
      await sb.commitAll("main");
      await sb.git(["checkout", "feature"]);
      await expect(sb.git(["rebase", "main"])).rejects.toThrow();
      expect((await sb.git(["diff", "--name-only", "--diff-filter=U"])).trim()).toBe("a.txt");
    },
  },
  {
    name: "unborn branch with staged file",
    setup: async (sb) => {
      await sb.write("a.txt", "1\n");
      await sb.git(["add", "a.txt"]);
    },
  },
];

describe("conformance: every read survives every repo state", () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const sb = await makeSandbox();
      try {
        await scenario.setup(sb);
        const client = createGitClient(sb.dir);
        const snapshot = await client.snapshot();
        expect(Array.isArray(snapshot.files)).toBe(true);
        expect(Array.isArray(await client.branches())).toBe(true);
        expect(Array.isArray(await client.tags())).toBe(true);
        expect(Array.isArray(await client.log())).toBe(true);
        expect(Array.isArray(await client.stashes())).toBe(true);
        expect(await client.fetchState()).toHaveProperty("lastFetchedAt");
        for (const file of snapshot.files) {
          const diff = await client.diffFile(file.path, { staged: false });
          expect(["text", "binary", "submodule"]).toContain(diff.kind);
        }
      } finally {
        await sb.cleanup();
      }
    });
  }
});

// Mutation verbs against the same hostile states: every call below must
// either resolve with a typed refusal or reject with a descriptive error --
// never hang or leave the repo corrupted. Some of these hostile states break
// a verb in ways the plan for this suite did not anticipate; each such case
// is named for the actual behavior, verified directly against real git.
describe("conformance: mutation verbs against hostile states fail cleanly", () => {
  it("empty repo (unborn HEAD): undoLastCommit throws git's own revision error, not the typed 'initial' refusal (there is no HEAD yet to inspect)", async () => {
    const sb = await makeSandbox();
    try {
      const client = createGitClient(sb.dir);
      await expect(client.undoLastCommit()).rejects.toThrow(/ambiguous argument 'HEAD'|unknown revision/i);
    } finally {
      await sb.cleanup();
    }
  });

  it("empty repo (unborn HEAD): stashPush throws (git refuses stash before the initial commit exists) rather than reporting created:false", async () => {
    const sb = await makeSandbox();
    try {
      const client = createGitClient(sb.dir);
      await expect(client.stashPush()).rejects.toThrow(/initial commit/i);
    } finally {
      await sb.cleanup();
    }
  });

  // Re-pinned 2026-09-21 when getStagingDiff moved to `git diff HEAD --
  // <path>` for a non-untracked/renamed path (rt's own adoption of GHD's
  // staging model: the displayed diff is worktree vs HEAD, not vs the
  // index). With no HEAD to name yet, that command itself fails -- verified
  // directly against real git ("fatal: bad revision 'HEAD'"), same
  // methodology as every other case in this file. Not reachable from the
  // mission view in practice: any file in an unborn repo is untracked (no
  // HEAD to be "modified" relative to), so getStagingDiff's untracked check
  // catches it first and never reaches this branch for a real Change row.
  it("empty repo (unborn HEAD): stagingDiff on a missing (non-untracked) path throws git's own bad-revision error, no HEAD to diff against yet", async () => {
    const sb = await makeSandbox();
    try {
      const client = createGitClient(sb.dir);
      await expect(client.stagingDiff("missing.txt")).rejects.toThrow(/bad revision 'HEAD'/i);
    } finally {
      await sb.cleanup();
    }
  });

  it("detached HEAD: undoLastCommit is allowed and works", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("a.txt", "2\n");
      await sb.commitAll("second");
      const sha = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.git(["checkout", "--detach", sha]);
      const client = createGitClient(sb.dir);
      const result = await client.undoLastCommit();
      expect(result).toEqual({ ok: true, undoneSha: sha });
    } finally {
      await sb.cleanup();
    }
  });

  it("detached HEAD: stash push/pop round-trips a working tree change", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      const sha = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.git(["checkout", "--detach", sha]);
      await sb.write("a.txt", "2\n");
      const client = createGitClient(sb.dir);
      const pushed = await client.stashPush();
      expect(pushed.created).toBe(true);
      expect((await sb.git(["status", "--porcelain"])).trim()).toBe("");
      await client.stashPop(0);
      expect((await sb.git(["diff", "--", "a.txt"])).length).toBeGreaterThan(0);
    } finally {
      await sb.cleanup();
    }
  });

  // Re-pinned 2026-09-21 alongside the unborn-HEAD case above, same root
  // cause: `git diff --` (no ref) on a conflicted path uses git's special
  // "combined diff" format (a triple-`@@@` hunk header) the vendored
  // parser can't understand, which is what made this throw before.
  // `git diff HEAD --` names one real ref, so git falls back to an
  // ordinary two-file unified diff instead -- parseable, just showing the
  // conflict markers as literal +/- content (conflict resolution isn't
  // mission's scope; this is a parseable, if unglamorous, degradation
  // rather than a crash). Verified directly against real git.
  it("mid-merge conflict: stagingDiff on the conflicted path now resolves cleanly, showing the conflict markers as literal diff content", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.git(["checkout", "-b", "feature"]);
      await sb.write("a.txt", "f\n");
      await sb.commitAll("feature");
      await sb.git(["checkout", "main"]);
      await sb.write("a.txt", "m\n");
      await sb.commitAll("main");
      await expect(sb.git(["merge", "feature"])).rejects.toThrow();
      const client = createGitClient(sb.dir);
      const diff = await client.stagingDiff("a.txt");
      expect(diff.kind).toBe("text");
      const text = diff.hunks.flatMap((h) => h.lines.map((l) => l.text));
      expect(text).toContain("+<<<<<<< HEAD");
      expect(text).toContain("+=======");
      expect(text).toContain("+>>>>>>> feature");
      // Still mid-merge afterward: a read never touches the repo.
      expect((await sb.git(["diff", "--name-only", "--diff-filter=U"])).trim()).toBe("a.txt");
    } finally {
      await sb.cleanup();
    }
  });

  it("mid-merge conflict: git itself refuses to commit (the surface rt's commitStaged wraps), surfacing its own refusal text", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.git(["checkout", "-b", "feature"]);
      await sb.write("a.txt", "f\n");
      await sb.commitAll("feature");
      await sb.git(["checkout", "main"]);
      await sb.write("a.txt", "m\n");
      await sb.commitAll("main");
      await expect(sb.git(["merge", "feature"])).rejects.toThrow();
      await expect(sb.git(["commit", "-m", "attempt during conflict"])).rejects.toThrow(/unmerged|conflict/i);
    } finally {
      await sb.cleanup();
    }
  });
});
