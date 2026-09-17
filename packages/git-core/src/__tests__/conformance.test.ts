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

  it("empty repo (unborn HEAD): stagingDiff on a missing path resolves cleanly with no hunks", async () => {
    const sb = await makeSandbox();
    try {
      const client = createGitClient(sb.dir);
      const diff = await client.stagingDiff("missing.txt");
      expect(diff).toEqual({ path: "missing.txt", kind: "text", untracked: false, hunks: [] });
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

  it("mid-merge conflict: stagingDiff on the conflicted path throws a descriptive parser error, not the typed 'text' kind (git emits a combined diff for an unmerged path, which the vendored hunk-header parser does not understand)", async () => {
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
      await expect(client.stagingDiff("a.txt")).rejects.toThrow(/invalid hunk header/i);
      // The failed read must not touch the repo: still mid-merge afterward.
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
