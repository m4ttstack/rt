import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeSandbox, type Sandbox } from "../../test-support/sandbox.ts";
import { createGitClient, createDesktopStashMessage, isLocalChangesOverwrittenError } from "../index.ts";

async function seeded(): Promise<Sandbox> {
  const sb = await makeSandbox();
  await sb.git(["config", "user.email", "test@example.com"]);
  await sb.git(["config", "user.name", "Test"]);
  await sb.git(["config", "commit.gpgsign", "false"]);
  await sb.write("a.txt", "1\n2\n3\n4\n5\n");
  await sb.commitAll("first");
  return sb;
}

async function stashMessages(sb: Sandbox): Promise<string[]> {
  return (await sb.git(["log", "-g", "--format=%gs", "refs/stash", "--"])).split("\n").filter(Boolean);
}

describe("desktop stash port", () => {
  it("formats Desktop's marker byte for byte", () => {
    expect(createDesktopStashMessage("feature/a-b")).toBe("!!GitHub_Desktop<feature/a-b>");
  });

  it("lists nothing when the repo has no stash", async () => {
    const sb = await seeded();
    try {
      expect(await createGitClient(sb.dir).desktopStashes()).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("creates a tagged stash that includes untracked files and empties the tree", async () => {
    const sb = await seeded();
    try {
      await sb.write("a.txt", "1\n2\n3\n4\nfive\n");
      await sb.write("new.txt", "untracked\n");
      const client = createGitClient(sb.dir);
      expect(await client.createDesktopStashEntry("main", ["new.txt"])).toBe(true);
      expect(await stashMessages(sb)).toEqual(["On main: !!GitHub_Desktop<main>"]);
      expect(await sb.git(["status", "--porcelain"])).toBe("");
      expect(existsSync(join(sb.dir, "new.txt"))).toBe(false);
      const [entry] = await client.desktopStashes();
      expect(entry?.branchName).toBe("main");
      expect(entry?.name).toBe("refs/stash@{0}");
      expect(entry?.parents.length).toBe(2);
      const files = (await client.stashedFiles(entry!.stashSha)).map((f) => f.path).sort();
      expect(files).toEqual(["a.txt", "new.txt"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("returns false and makes no entry when there is nothing to stash", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      expect(await client.createDesktopStashEntry("main", [])).toBe(false);
      expect(await client.desktopStashes()).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("skips stashes Desktop did not make, and finds the newest per branch", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "one\n");
      await client.createDesktopStashEntry("feature/a-b", []);
      await sb.write("a.txt", "two\n");
      await sb.git(["stash", "push", "-m", "plain"]);
      await sb.write("a.txt", "three\n");
      await client.createDesktopStashEntry("feature/a-b", []);
      const entries = await client.desktopStashes();
      expect(entries.map((e) => e.branchName)).toEqual(["feature/a-b", "feature/a-b"]);
      const newest = await client.lastDesktopStashEntryForBranch("feature/a-b");
      expect(newest?.stashSha).toBe(entries[0]!.stashSha);
      expect(await client.lastDesktopStashEntryForBranch("main")).toBeNull();
    } finally {
      await sb.cleanup();
    }
  });

  it("drop and pop resolve by sha after another stash shifts the stack", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "mine\n");
      await client.createDesktopStashEntry("main", []);
      const mine = (await client.lastDesktopStashEntryForBranch("main"))!;
      await sb.write("b.txt", "someone else\n");
      await sb.git(["add", "b.txt"]);
      await sb.git(["stash", "push", "-m", "another session"]);
      await client.popStashEntry(mine.stashSha);
      expect(await Bun.file(join(sb.dir, "a.txt")).text()).toBe("mine\n");
      expect(await stashMessages(sb)).toEqual(["On main: another session"]);

      await sb.git(["checkout", "--", "a.txt"]);
      await sb.write("a.txt", "again\n");
      await client.createDesktopStashEntry("main", []);
      const again = (await client.lastDesktopStashEntryForBranch("main"))!;
      await sb.write("c.txt", "c\n");
      await sb.git(["add", "c.txt"]);
      await sb.git(["stash", "push", "-m", "on top"]);
      await client.dropDesktopStashEntry(again.stashSha);
      expect(await stashMessages(sb)).toEqual(["On main: on top", "On main: another session"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("a pop that conflicts leaves the conflict in the tree and drops the entry", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "stashed\n");
      await client.createDesktopStashEntry("main", []);
      const entry = (await client.lastDesktopStashEntryForBranch("main"))!;
      await sb.write("a.txt", "committed\n");
      await sb.commitAll("conflicting");
      await client.popStashEntry(entry.stashSha);
      expect(await client.desktopStashes()).toEqual([]);
      expect(await sb.git(["status", "--porcelain"])).toContain("UU a.txt");
    } finally {
      await sb.cleanup();
    }
  });

  it("a pop git refuses keeps the entry and throws", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "stashed\n");
      await client.createDesktopStashEntry("main", []);
      const entry = (await client.lastDesktopStashEntryForBranch("main"))!;
      await sb.write("a.txt", "dirty\n");
      await expect(client.popStashEntry(entry.stashSha)).rejects.toThrow("would be overwritten");
      expect((await client.desktopStashes()).length).toBe(1);
    } finally {
      await sb.cleanup();
    }
  });

  it("pop and drop of a sha that is gone do nothing", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await client.popStashEntry("0".repeat(40));
      await client.dropDesktopStashEntry("0".repeat(40));
      expect(await client.desktopStashes()).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("recognizes both of git's checkout-overwrite refusals", async () => {
    const sb = await seeded();
    try {
      await sb.git(["checkout", "-b", "other"]);
      await sb.write("a.txt", "other\n");
      await sb.write("b.txt", "tracked on other\n");
      await sb.commitAll("other");
      await sb.git(["checkout", "main"]);
      const client = createGitClient(sb.dir);

      await sb.write("a.txt", "dirty\n");
      const tracked = await client.checkoutBranch("other").then(() => null, (e: unknown) => e);
      expect(isLocalChangesOverwrittenError(tracked)).toBe(true);

      await sb.git(["checkout", "--", "a.txt"]);
      await sb.write("b.txt", "untracked here\n");
      const untracked = await client.checkoutBranch("other").then(() => null, (e: unknown) => e);
      expect(isLocalChangesOverwrittenError(untracked)).toBe(true);

      expect(isLocalChangesOverwrittenError(new Error("fatal: something else"))).toBe(false);
      expect(isLocalChangesOverwrittenError("not an error")).toBe(false);
    } finally {
      await sb.cleanup();
    }
  });
});
