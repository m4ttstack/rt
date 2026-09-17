import { describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function seeded() {
  const sb = await makeSandbox();
  await sb.write("a.txt", "one\n");
  await sb.commitAll("first");
  return sb;
}

describe("snapshot", () => {
  it("clean repo", async () => {
    const sb = await seeded();
    try {
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.branch).toBe("main");
      expect(s.detached).toBe(false);
      expect(s.upstream).toBeNull();
      expect(s.ahead).toBeNull();
      expect(s.behind).toBeNull();
      expect(s.clean).toBe(true);
      expect(s.files).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("untracked file", async () => {
    const sb = await seeded();
    try {
      await sb.write("new.txt", "x\n");
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.files).toEqual([
        { path: "new.txt", kind: "untracked", staged: false, unstaged: true },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("same file staged AND unstaged (MM)", async () => {
    const sb = await seeded();
    try {
      await sb.write("a.txt", "two\n");
      await sb.git(["add", "a.txt"]);
      await sb.write("a.txt", "three\n");
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.files).toEqual([
        { path: "a.txt", kind: "modified", staged: true, unstaged: true },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("staged rename carries originalPath", async () => {
    const sb = await seeded();
    try {
      await sb.git(["mv", "a.txt", "b.txt"]);
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.files).toEqual([
        { path: "b.txt", kind: "renamed", staged: true, unstaged: false, originalPath: "a.txt" },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("renamed and further modified (RM)", async () => {
    const sb = await seeded();
    try {
      await sb.git(["mv", "a.txt", "b.txt"]);
      await sb.write("b.txt", "changed\n");
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.files).toEqual([
        { path: "b.txt", kind: "renamed", staged: true, unstaged: true, originalPath: "a.txt" },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("staged add then deleted from the working tree (AD)", async () => {
    const sb = await seeded();
    try {
      await sb.write("new.txt", "x\n");
      await sb.git(["add", "new.txt"]);
      await rm(join(sb.dir, "new.txt"));
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.files).toEqual([
        { path: "new.txt", kind: "deleted", staged: true, unstaged: true },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("merge conflict is conflicted", async () => {
    const sb = await seeded();
    try {
      await sb.git(["checkout", "-b", "feature"]);
      await sb.write("a.txt", "feature\n");
      await sb.commitAll("feature change");
      await sb.git(["checkout", "main"]);
      await sb.write("a.txt", "main\n");
      await sb.commitAll("main change");
      await sb.git(["merge", "feature"]).catch(() => {});
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.files).toEqual([
        { path: "a.txt", kind: "conflicted", staged: false, unstaged: true },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("ahead/behind against a bare remote", async () => {
    const sb = await seeded();
    try {
      await sb.addBareRemote();
      await sb.git(["push", "-u", "origin", "main"]);
      await sb.write("a.txt", "local\n");
      await sb.commitAll("local-only");
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.upstream).toBe("origin/main");
      expect(s.ahead).toBe(1);
      expect(s.behind).toBe(0);
    } finally {
      await sb.cleanup();
    }
  });

  it("detached HEAD", async () => {
    const sb = await seeded();
    try {
      const sha = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.git(["checkout", "--detach", sha]);
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.detached).toBe(true);
      expect(s.branch).toBeNull();
    } finally {
      await sb.cleanup();
    }
  });

  it("empty repo (no commits yet)", async () => {
    const { makeSandbox } = await import("../../test-support/sandbox.ts");
    const sb = await makeSandbox();
    try {
      const s = await createGitClient(sb.dir).snapshot();
      expect(s.branch).toBe("main");
      expect(s.clean).toBe(true);
    } finally {
      await sb.cleanup();
    }
  });
});
