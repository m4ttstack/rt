import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { makeSandbox, type Sandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function fakeTrash(): Promise<{ moveToTrash: (abs: string) => Promise<void>; moved: string[] }> {
  const bin = await mkdtemp(join(tmpdir(), "git-core-trash-"));
  const moved: string[] = [];
  return {
    moved,
    moveToTrash: async (abs) => {
      moved.push(abs);
      await rename(abs, join(bin, `${moved.length}-${basename(abs)}`));
    },
  };
}

async function status(sb: Sandbox): Promise<string> {
  return sb.git(["status", "--porcelain=v1", "--untracked-files=all"]);
}

describe("discardChanges (GHD GitStore.discardChanges)", () => {
  it("restores a modified file and trashes the edited copy", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("a.txt", "2\n");
      const trash = await fakeTrash();
      const client = createGitClient(sb.dir);
      await client.discardChanges([{ path: "a.txt", kind: "modified", staged: false, unstaged: true }], trash);
      expect(await readFile(join(sb.dir, "a.txt"), "utf8")).toBe("1\n");
      expect(trash.moved).toEqual([join(sb.dir, "a.txt")]);
      expect(await status(sb)).toBe("");
    } finally {
      await sb.cleanup();
    }
  });

  it("removes an untracked file by trashing it", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("new.txt", "x\n");
      const trash = await fakeTrash();
      await createGitClient(sb.dir).discardChanges([{ path: "new.txt", kind: "untracked", staged: false, unstaged: true }], trash);
      expect(existsSync(join(sb.dir, "new.txt"))).toBe(false);
      expect(await status(sb)).toBe("");
    } finally {
      await sb.cleanup();
    }
  });

  it("unstages and removes a staged new file", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("added.txt", "x\n");
      await sb.git(["add", "added.txt"]);
      const trash = await fakeTrash();
      await createGitClient(sb.dir).discardChanges([{ path: "added.txt", kind: "added", staged: true, unstaged: false }], trash);
      expect(existsSync(join(sb.dir, "added.txt"))).toBe(false);
      expect(await status(sb)).toBe("");
    } finally {
      await sb.cleanup();
    }
  });

  it("undoes a staged rename, restoring the old path", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("old.txt", "1\n");
      await sb.commitAll("first");
      await sb.git(["mv", "old.txt", "new.txt"]);
      const trash = await fakeTrash();
      await createGitClient(sb.dir).discardChanges(
        [{ path: "new.txt", kind: "renamed", staged: true, unstaged: false, originalPath: "old.txt" }],
        trash,
      );
      expect(existsSync(join(sb.dir, "new.txt"))).toBe(false);
      expect(await readFile(join(sb.dir, "old.txt"), "utf8")).toBe("1\n");
      expect(await status(sb)).toBe("");
    } finally {
      await sb.cleanup();
    }
  });

  it("restores a deleted file without touching the Trash", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.git(["rm", "-q", "a.txt"]);
      const trash = await fakeTrash();
      await createGitClient(sb.dir).discardChanges([{ path: "a.txt", kind: "deleted", staged: true, unstaged: false }], trash);
      expect(trash.moved).toEqual([]);
      expect(await readFile(join(sb.dir, "a.txt"), "utf8")).toBe("1\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("a failing Trash leaves the tree and the index exactly as they were", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("a.txt", "2\n");
      await sb.git(["add", "a.txt"]);
      await sb.write("a.txt", "3\n");
      const before = await status(sb);
      const failing = { moveToTrash: async () => { throw new Error("Trash is full"); } };
      await expect(
        createGitClient(sb.dir).discardChanges([{ path: "a.txt", kind: "modified", staged: true, unstaged: true }], failing),
      ).rejects.toThrow("Trash is full");
      expect(await status(sb)).toBe(before);
      expect(await readFile(join(sb.dir, "a.txt"), "utf8")).toBe("3\n");
    } finally {
      await sb.cleanup();
    }
  });
});
