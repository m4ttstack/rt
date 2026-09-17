import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

function porcelainLine(out: string): string {
  return out.replace(/\n+$/, "");
}

async function seeded() {
  const sb = await makeSandbox();
  await sb.write("a.txt", "one\n");
  await sb.commitAll("first");
  return sb;
}

describe("stashPush", () => {
  it("pushes with a message, listed at index 0, tree clean after", async () => {
    const sb = await seeded();
    try {
      await sb.write("a.txt", "two\n");
      const client = createGitClient(sb.dir);
      const result = await client.stashPush({ message: "wip work" });
      expect(result).toEqual({ created: true });
      const stashes = await client.stashes();
      expect(stashes[0]).toEqual({ index: 0, branch: "main", message: "wip work" });
      expect(porcelainLine(await sb.git(["status", "--porcelain"]))).toBe("");
    } finally {
      await sb.cleanup();
    }
  });

  it("returns created false and adds no entry when there is nothing to stash", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      const result = await client.stashPush();
      expect(result).toEqual({ created: false });
      expect(await client.stashes()).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("includeUntracked stashes an untracked file", async () => {
    const sb = await seeded();
    try {
      await sb.write("untracked.txt", "new\n");
      const client = createGitClient(sb.dir);
      const result = await client.stashPush({ includeUntracked: true });
      expect(result).toEqual({ created: true });
      expect(porcelainLine(await sb.git(["status", "--porcelain"]))).toBe("");
    } finally {
      await sb.cleanup();
    }
  });
});

describe("stashApply / stashPop / stashDrop", () => {
  it("apply restores changes and keeps the entry; pop restores and removes; drop removes without touching the tree", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "two\n");
      await client.stashPush({ message: "first change" });

      await client.stashApply(0);
      expect(await Bun.file(`${sb.dir}/a.txt`).text()).toBe("two\n");
      expect((await client.stashes()).length).toBe(1);

      await sb.git(["checkout", "--", "a.txt"]);
      await client.stashPop(0);
      expect(await Bun.file(`${sb.dir}/a.txt`).text()).toBe("two\n");
      expect(await client.stashes()).toEqual([]);

      await sb.write("a.txt", "three\n");
      await client.stashPush({ message: "second change" });
      await sb.write("a.txt", "two\n");
      await client.stashDrop(0);
      expect(await client.stashes()).toEqual([]);
      expect(await Bun.file(`${sb.dir}/a.txt`).text()).toBe("two\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("pop on an empty stash list rejects with an error mentioning the ref", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await expect(client.stashPop(0)).rejects.toThrow(/stash@\{0\}/);
    } finally {
      await sb.cleanup();
    }
  });
});
