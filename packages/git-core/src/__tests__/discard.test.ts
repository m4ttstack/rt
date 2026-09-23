import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { makeSandbox, type Sandbox } from "../../test-support/sandbox.ts";
import type { ClientContext } from "../client.ts";
import { listSubmodules, rawGitOr128 } from "../discard.ts";
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

  it("a failing Trash on the second file finishes the first and still rethrows", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.write("b.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("a.txt", "2\n");
      await sb.write("b.txt", "2\n");
      const trash = await fakeTrash();
      const failingSecond = {
        moveToTrash: async (abs: string) => {
          if (basename(abs) === "b.txt") throw new Error("Trash is full");
          await trash.moveToTrash(abs);
        },
      };
      await expect(
        createGitClient(sb.dir).discardChanges(
          [
            { path: "a.txt", kind: "modified", staged: false, unstaged: true },
            { path: "b.txt", kind: "modified", staged: false, unstaged: true },
          ],
          failingSecond,
        ),
      ).rejects.toThrow("Trash is full");
      expect(await readFile(join(sb.dir, "a.txt"), "utf8")).toBe("1\n");
      expect(await readFile(join(sb.dir, "b.txt"), "utf8")).toBe("2\n");
      expect(await status(sb)).toBe(" M b.txt\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("discards a staged new file in a repo with no commits yet (getIndexChanges' null-tree retry)", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("new.txt", "x\n");
      await sb.git(["add", "new.txt"]);
      const trash = await fakeTrash();
      await createGitClient(sb.dir).discardChanges([{ path: "new.txt", kind: "added", staged: true, unstaged: false }], trash);
      expect(existsSync(join(sb.dir, "new.txt"))).toBe(false);
      expect(await status(sb)).toBe("");
    } finally {
      await sb.cleanup();
    }
  });

  it("a failing Trash on an untracked file recreated at a staged rename's old path leaves that file's content alone", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("old.txt", "committed\n");
      await sb.commitAll("first");
      await sb.git(["mv", "old.txt", "new.txt"]);
      // Recreated as a brand-new untracked file at the rename's old name --
      // this path now appears twice: as new.txt's originalPath, and as its
      // own untracked ChangedFile.
      await sb.write("old.txt", "precious untracked\n");
      const trash = await fakeTrash();
      const failingOnOldTxt = {
        moveToTrash: async (abs: string) => {
          if (basename(abs) === "old.txt") throw new Error("Trash is full");
          await trash.moveToTrash(abs);
        },
      };
      await expect(
        createGitClient(sb.dir).discardChanges(
          [
            { path: "new.txt", kind: "renamed", staged: true, unstaged: false, originalPath: "old.txt" },
            { path: "old.txt", kind: "untracked", staged: false, unstaged: true },
          ],
          failingOnOldTxt,
        ),
      ).rejects.toThrow("Trash is full");
      expect(await readFile(join(sb.dir, "old.txt"), "utf8")).toBe("precious untracked\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("attaches a recovery failure as the propagated Trash error's cause, never replacing it", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.write("b.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("a.txt", "2\n");
      await sb.write("b.txt", "2\n");
      const trashError = new Error("Trash is full");
      const failing = {
        moveToTrash: async (abs: string) => {
          if (basename(abs) !== "b.txt") return;
          // The recovery step's own git calls (run for a.txt, right after
          // this throws) need to fail too, to reach the cause-attachment path.
          await rm(join(sb.dir, ".git"), { recursive: true, force: true });
          throw trashError;
        },
      };
      let caught: unknown;
      try {
        await createGitClient(sb.dir).discardChanges(
          [
            { path: "a.txt", kind: "modified", staged: false, unstaged: true },
            { path: "b.txt", kind: "modified", staged: false, unstaged: true },
          ],
          failing,
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(trashError);
      expect((caught as Error).cause).toBeInstanceOf(Error);
    } finally {
      await sb.cleanup();
    }
  });
});

describe("rawGitOr128 (shared exit-128 gate for getIndexChanges / listSubmodules)", () => {
  it("returns null on a real exit-128 failure", async () => {
    const sb = await makeSandbox();
    try {
      const result = await rawGitOr128(sb.dir, ["rev-parse", "--verify", "refs/heads/does-not-exist"]);
      expect(result).toBeNull();
    } finally {
      await sb.cleanup();
    }
  });

  it("rethrows a real non-128 failure instead of swallowing it", async () => {
    const sb = await makeSandbox();
    try {
      await expect(rawGitOr128(sb.dir, ["totally-bogus-subcommand"])).rejects.toThrow(/exited 1/);
    } finally {
      await sb.cleanup();
    }
  });
});

describe("listSubmodules exit-code gate", () => {
  // git refuses `submodule status` outside a working tree ("cannot be used
  // without a working tree", exit 1) -- a real, reachable non-128 failure at
  // the exact call a catch-all previously swallowed. Pointing ctx.dir at the
  // repo's own .git directory (with a .gitmodules file placed there so the
  // pathExists check skips straight to the gated call, never touching
  // rev-parse) reaches it directly.
  it("rethrows submodule status's real non-128 exit instead of returning no submodules", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      const gitDir = join(sb.dir, ".git");
      await writeFile(join(gitDir, ".gitmodules"), "");
      const ctx = { dir: gitDir } as ClientContext;
      await expect(listSubmodules(ctx)).rejects.toThrow(/exited 1/);
    } finally {
      await sb.cleanup();
    }
  });
});
