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
      await sb.git(["merge", "feature"]).catch(() => {});
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
      await sb.git(["rebase", "main"]).catch(() => {});
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
