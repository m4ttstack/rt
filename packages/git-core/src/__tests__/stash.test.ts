import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

describe("stashes", () => {
  it("empty when no stash", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      expect(await createGitClient(sb.dir).stashes()).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("parses message and branch, index 0 is newest", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("a.txt", "2\n");
      await sb.git(["stash", "push", "-m", "older work"]);
      await sb.write("a.txt", "3\n");
      await sb.git(["stash", "push", "-m", "newer work"]);
      const stashes = await createGitClient(sb.dir).stashes();
      expect(stashes.length).toBe(2);
      expect(stashes[0]).toEqual({ index: 0, branch: "main", message: "newer work" });
      expect(stashes[1]).toEqual({ index: 1, branch: "main", message: "older work" });
    } finally {
      await sb.cleanup();
    }
  });
});
