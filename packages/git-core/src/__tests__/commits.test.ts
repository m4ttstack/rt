import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function seeded() {
  const sb = await makeSandbox();
  await sb.write("a.txt", "one\n");
  await sb.commitAll("first");
  return sb;
}

// Porcelain status lines carry meaning in leading columns, so trim only the
// trailing newline; String.trim() would eat a leading " " code.
function porcelainLine(out: string): string {
  return out.replace(/\n+$/, "");
}

describe("undoLastCommit", () => {
  it("undoes an unpushed commit, keeping changes unstaged", async () => {
    const sb = await seeded();
    try {
      const beforeCount = (await sb.git(["log", "--format=%H"])).trim().split("\n").length;
      await sb.write("a.txt", "two\n");
      await sb.commitAll("second");
      const secondSha = (await sb.git(["rev-parse", "HEAD"])).trim();
      const result = await createGitClient(sb.dir).undoLastCommit();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.undoneSha).toBe(secondSha);
        const afterCount = (await sb.git(["log", "--format=%H"])).trim().split("\n").length;
        expect(afterCount).toBe(beforeCount);
        const status = await sb.git(["status", "--porcelain"]);
        expect(porcelainLine(status)).toBe(" M a.txt");
      }
    } finally {
      await sb.cleanup();
    }
  });

  it("refuses a pushed commit", async () => {
    const sb = await seeded();
    try {
      await sb.addBareRemote();
      await sb.git(["push", "origin", "main"]);
      await sb.git(["branch", "--set-upstream-to", "origin/main"]);
      const headBefore = (await sb.git(["rev-parse", "HEAD"])).trim();
      const result = await createGitClient(sb.dir).undoLastCommit();
      expect(result).toEqual({ ok: false, reason: "pushed" });
      const headAfter = (await sb.git(["rev-parse", "HEAD"])).trim();
      expect(headAfter).toBe(headBefore);
    } finally {
      await sb.cleanup();
    }
  });

  it("refuses the initial commit", async () => {
    const sb = await seeded();
    try {
      const result = await createGitClient(sb.dir).undoLastCommit();
      expect(result).toEqual({ ok: false, reason: "initial" });
    } finally {
      await sb.cleanup();
    }
  });

  it("refuses a merge commit", async () => {
    const sb = await seeded();
    try {
      await sb.git(["checkout", "-b", "feature"]);
      await sb.write("b.txt", "feature\n");
      await sb.commitAll("on feature");
      await sb.git(["checkout", "main"]);
      await sb.write("c.txt", "main\n");
      await sb.commitAll("on main");
      await sb.git(["merge", "--no-ff", "-m", "merge feature", "feature"]);
      const result = await createGitClient(sb.dir).undoLastCommit();
      expect(result).toEqual({ ok: false, reason: "merge" });
    } finally {
      await sb.cleanup();
    }
  });
});

describe("resetToCommit", () => {
  it("hard/soft/mixed restore the tree with matching index state", async () => {
    const sb = await seeded();
    try {
      const first = (await sb.git(["rev-parse", "HEAD"])).trim();
      const client = createGitClient(sb.dir);

      await sb.write("a.txt", "two\n");
      await sb.commitAll("second");
      await client.resetToCommit(first, "hard");
      expect(porcelainLine(await sb.git(["status", "--porcelain"]))).toBe("");
      expect(await Bun.file(`${sb.dir}/a.txt`).text()).toBe("one\n");

      await sb.write("a.txt", "three\n");
      await sb.commitAll("third");
      await client.resetToCommit(first, "soft");
      expect(porcelainLine(await sb.git(["status", "--porcelain"]))).toBe("M  a.txt");

      await sb.git(["reset", "--hard"]);
      await sb.write("a.txt", "four\n");
      await sb.commitAll("fourth");
      await client.resetToCommit(first, "mixed");
      expect(porcelainLine(await sb.git(["status", "--porcelain"]))).toBe(" M a.txt");
    } finally {
      await sb.cleanup();
    }
  });
});
