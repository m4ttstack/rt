import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

describe("repo-location env scrubbing", () => {
  it("a mutation on repo A lands in repo A even when GIT_DIR points at repo B", async () => {
    const repoA = await makeSandbox();
    const repoB = await makeSandbox();
    try {
      await repoA.write("a.txt", "one\n");
      await repoA.commitAll("first");
      await repoB.write("b.txt", "one\n");
      await repoB.commitAll("first");

      const previousGitDir = process.env.GIT_DIR;
      process.env.GIT_DIR = join(repoB.dir, ".git");
      try {
        const client = createGitClient(repoA.dir);
        await client.createBranch("feature");
      } finally {
        if (previousGitDir === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = previousGitDir;
      }

      const branchesA = await repoA.git(["branch", "--list"]);
      expect(branchesA).toContain("feature");
      const branchesB = await repoB.git(["branch", "--list"]);
      expect(branchesB).not.toContain("feature");
    } finally {
      await repoA.cleanup();
      await repoB.cleanup();
    }
  });
});
