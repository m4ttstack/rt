import { describe, expect, it } from "bun:test";
import { rename, unlink } from "node:fs/promises";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";
import { DIFF_SOURCE_MAX_BYTES } from "../diff-sources.ts";

describe("diff sources", () => {
  it("modified: old is HEAD, new is the working tree", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("f.ts", "a\n");
      await sb.commitAll("base");
      await sb.write("f.ts", "b\n");
      const diff = await createGitClient(sb.dir).stagingDiff("f.ts", { withSources: true });
      expect(diff.sources).toEqual({ old: "a\n", new: "b\n" });
    } finally {
      await sb.cleanup();
    }
  });

  it("untracked: no old side", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("seed.txt", "s\n");
      await sb.commitAll("base");
      await sb.write("n.ts", "new\n");
      const diff = await createGitClient(sb.dir).stagingDiff("n.ts", { withSources: true });
      expect(diff.sources?.old).toBeUndefined();
      expect(diff.sources?.new).toBe("new\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("deleted: no new side", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("d.ts", "gone\n");
      await sb.commitAll("base");
      await unlink(`${sb.dir}/d.ts`);
      const diff = await createGitClient(sb.dir).stagingDiff("d.ts", { withSources: true });
      expect(diff.sources).toEqual({ old: "gone\n", new: undefined });
    } finally {
      await sb.cleanup();
    }
  });

  it("renamed: old side is the index", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.ts", "one\n");
      await sb.commitAll("base");
      await rename(`${sb.dir}/a.ts`, `${sb.dir}/b.ts`);
      await sb.git(["add", "-A"]);
      await sb.write("b.ts", "one\ntwo\n");
      const diff = await createGitClient(sb.dir).stagingDiff("b.ts", { withSources: true });
      expect(diff.sources).toEqual({ old: "one\n", new: "one\ntwo\n" });
    } finally {
      await sb.cleanup();
    }
  });

  it("over the cap: side omitted", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("big.txt", "x\n");
      await sb.commitAll("base");
      await sb.write("big.txt", "y".repeat(DIFF_SOURCE_MAX_BYTES + 1));
      const diff = await createGitClient(sb.dir).stagingDiff("big.txt", { withSources: true });
      expect(diff.sources?.old).toBe("x\n");
      expect(diff.sources?.new).toBeUndefined();
    } finally {
      await sb.cleanup();
    }
  });

  it("no opts: no sources", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("f.ts", "a\n");
      await sb.commitAll("base");
      await sb.write("f.ts", "b\n");
      const diff = await createGitClient(sb.dir).stagingDiff("f.ts");
      expect(diff.sources).toBeUndefined();
    } finally {
      await sb.cleanup();
    }
  });

  it("commit: old is the parent, new is the commit; root commit has no old side", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("c.ts", "v1\n");
      await sb.commitAll("one");
      const root = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.write("c.ts", "v2\n");
      await sb.commitAll("two");
      const head = (await sb.git(["rev-parse", "HEAD"])).trim();
      const client = createGitClient(sb.dir);
      const files = (await client.changedFiles(head)).files;
      const diff = await client.commitDiff(files[0]!, head, { withSources: true });
      expect(diff.sources).toEqual({ old: "v1\n", new: "v2\n" });
      const rootFiles = (await client.changedFiles(root)).files;
      const rootDiff = await client.commitDiff(rootFiles[0]!, root, { withSources: true });
      expect(rootDiff.sources).toEqual({ old: undefined, new: "v1\n" });
    } finally {
      await sb.cleanup();
    }
  });

  it("history range: old is the oldest commit's parent, new is the latest commit", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("r.ts", "v1\n");
      await sb.commitAll("one");
      await sb.write("r.ts", "v2\n");
      await sb.commitAll("two");
      const second = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.write("r.ts", "v3\n");
      await sb.commitAll("three");
      const third = (await sb.git(["rev-parse", "HEAD"])).trim();
      const client = createGitClient(sb.dir);
      const files = (await client.commitRangeChangedFiles([second, third])).files;
      const diff = await client.commitRangeDiff(files[0]!, [second, third], { withSources: true });
      expect(diff.sources).toEqual({ old: "v1\n", new: "v3\n" });
    } finally {
      await sb.cleanup();
    }
  });

  it("history range from the root commit: no old side", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("r.ts", "v1\n");
      await sb.commitAll("one");
      const root = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.write("r.ts", "v2\n");
      await sb.commitAll("two");
      const head = (await sb.git(["rev-parse", "HEAD"])).trim();
      const client = createGitClient(sb.dir);
      const files = (await client.commitRangeChangedFiles([root, head])).files;
      const diff = await client.commitRangeDiff(files[0]!, [root, head], { withSources: true });
      expect(diff.kind).toBe("text");
      expect(diff.sources).toEqual({ old: undefined, new: "v2\n" });
    } finally {
      await sb.cleanup();
    }
  });

  it("commit renaming a file: old side is read from the old path", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("old.ts", "keep\nthese\nlines\nhere\n");
      await sb.commitAll("base");
      await sb.git(["mv", "old.ts", "new.ts"]);
      await sb.write("new.ts", "keep\nthese\nlines\nhere\nplus\n");
      await sb.commitAll("rename");
      const head = (await sb.git(["rev-parse", "HEAD"])).trim();
      const client = createGitClient(sb.dir);
      const files = (await client.changedFiles(head)).files;
      expect(files[0]!.path).toBe("new.ts");
      const diff = await client.commitDiff(files[0]!, head, { withSources: true });
      expect(diff.sources).toEqual({ old: "keep\nthese\nlines\nhere\n", new: "keep\nthese\nlines\nhere\nplus\n" });
    } finally {
      await sb.cleanup();
    }
  });

  it("commit deleting a file: no new side", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("keep.ts", "k\n");
      await sb.write("d.ts", "gone\n");
      await sb.commitAll("base");
      await unlink(`${sb.dir}/d.ts`);
      await sb.commitAll("delete");
      const head = (await sb.git(["rev-parse", "HEAD"])).trim();
      const client = createGitClient(sb.dir);
      const files = (await client.changedFiles(head)).files;
      const diff = await client.commitDiff(files[0]!, head, { withSources: true });
      expect(diff.sources).toEqual({ old: "gone\n", new: undefined });
    } finally {
      await sb.cleanup();
    }
  });

  it("binary: no sources", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("b.bin", "a\0b");
      await sb.commitAll("base");
      await sb.write("b.bin", "a\0c");
      const diff = await createGitClient(sb.dir).stagingDiff("b.bin", { withSources: true });
      expect(diff.kind).toBe("binary");
      expect(diff.sources).toBeUndefined();
    } finally {
      await sb.cleanup();
    }
  });
});
