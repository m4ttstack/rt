import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient, AppFileStatusKind } from "../index.ts";

type Sb = Awaited<ReturnType<typeof makeSandbox>>;

async function commit(sb: Sb, file: string, content: string, message: string): Promise<string> {
  await sb.write(file, content);
  await sb.commitAll(message);
  return (await sb.git(["rev-parse", "HEAD"])).trim();
}

const TEN_LINES = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n") + "\n";

describe("changedFiles()", () => {
  it("lists the root commit's files as new", async () => {
    const sb = await makeSandbox();
    try {
      const root = await commit(sb, "README.md", "hi\n", "first");
      const data = await createGitClient(sb.dir).changedFiles(root);
      expect(data.files.map((f) => f.path)).toEqual(["README.md"]);
      expect(data.files[0]!.status.kind).toBe(AppFileStatusKind.New);
      expect(data.linesAdded).toBe(1);
    } finally {
      await sb.cleanup();
    }
  });

  it("detects a pure rename and a rename with edits", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "OLD.md", TEN_LINES, "add");
      await sb.git(["mv", "OLD.md", "NEW.md"]);
      await sb.git(["commit", "-m", "pure rename"]);
      const pure = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.git(["mv", "NEW.md", "NEWER.md"]);
      await sb.write("NEWER.md", TEN_LINES + "one more\n");
      await sb.commitAll("rename with edit");
      const edited = (await sb.git(["rev-parse", "HEAD"])).trim();
      const client = createGitClient(sb.dir);
      expect((await client.changedFiles(pure)).files[0]!.status).toEqual({
        kind: AppFileStatusKind.Renamed,
        oldPath: "OLD.md",
        submoduleStatus: undefined,
        renameIncludesModifications: false,
      });
      expect((await client.changedFiles(edited)).files[0]!.status).toEqual({
        kind: AppFileStatusKind.Renamed,
        oldPath: "NEW.md",
        submoduleStatus: undefined,
        renameIncludesModifications: true,
      });
    } finally {
      await sb.cleanup();
    }
  });

  it("detects a copy when the source also changed", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "initial.md", TEN_LINES, "add");
      await sb.git(["config", "diff.renames", "copies"]);
      await sb.write("duplicate.md", TEN_LINES);
      await sb.write("initial.md", TEN_LINES + "edit\n");
      await sb.commitAll("copy");
      const data = await createGitClient(sb.dir).changedFiles("HEAD");
      const dup = data.files.find((f) => f.path === "duplicate.md")!;
      expect(dup.status.kind).toBe(AppFileStatusKind.Copied);
    } finally {
      await sb.cleanup();
    }
  });

  it("a merge commit lists only what it changed relative to its first parent", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "base.txt", "b\n", "base");
      await sb.git(["checkout", "-b", "feature"]);
      await commit(sb, "f.txt", "f\n", "feature");
      await sb.git(["checkout", "main"]);
      await commit(sb, "m.txt", "m\n", "main");
      await sb.git(["merge", "--no-ff", "feature", "-m", "merge"]);
      const data = await createGitClient(sb.dir).changedFiles("HEAD");
      expect(data.files.map((f) => f.path)).toEqual(["f.txt"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("marks a submodule entry", async () => {
    const sub = await makeSandbox();
    const sb = await makeSandbox();
    try {
      await commit(sub, "s.txt", "s\n", "sub root");
      await commit(sb, "a.txt", "a\n", "root");
      await sb.git(["-c", "protocol.file.allow=always", "submodule", "add", sub.dir, "foo/submodule"]);
      await sb.git(["commit", "-m", "add submodule"]);
      const data = await createGitClient(sb.dir).changedFiles("HEAD");
      const entry = data.files.find((f) => f.path === "foo/submodule")!;
      expect(entry.status.submoduleStatus).toBeDefined();
    } finally {
      await sb.cleanup();
      await sub.cleanup();
    }
  });
});

describe("commitDiff()", () => {
  it("returns the commit's hunks for one file", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "a.txt", "one\ntwo\n", "add");
      const sha = await commit(sb, "a.txt", "one\nTWO\n", "edit");
      const client = createGitClient(sb.dir);
      const file = (await client.changedFiles(sha)).files[0]!;
      const diff = await client.commitDiff(file, sha);
      expect(diff.kind).toBe("text");
      expect(diff.untracked).toBe(false);
      const text = diff.hunks.flatMap((h) => h.lines.map((l) => l.text));
      expect(text).toContain("-two");
      expect(text).toContain("+TWO");
    } finally {
      await sb.cleanup();
    }
  });

  it("follows a rename through its old path", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "OLD.md", TEN_LINES, "add");
      await sb.git(["mv", "OLD.md", "NEW.md"]);
      await sb.write("NEW.md", TEN_LINES + "tail\n");
      await sb.commitAll("rename");
      const client = createGitClient(sb.dir);
      const file = (await client.changedFiles("HEAD")).files[0]!;
      const diff = await client.commitDiff(file, "HEAD");
      expect(diff.hunks.flatMap((h) => h.lines.map((l) => l.text))).toContain("+tail");
    } finally {
      await sb.cleanup();
    }
  });

  it("reports a binary file as binary with no hunks", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "img.bin", "a\0b\0c", "binary");
      const client = createGitClient(sb.dir);
      const file = (await client.changedFiles("HEAD")).files[0]!;
      const diff = await client.commitDiff(file, "HEAD");
      expect(diff.kind).toBe("binary");
      expect(diff.hunks).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("a merge commit's file diffs against the first parent", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "base.txt", "b\n", "base");
      await sb.git(["checkout", "-b", "feature"]);
      await commit(sb, "f.txt", "from feature\n", "feature");
      await sb.git(["checkout", "main"]);
      await commit(sb, "m.txt", "m\n", "main");
      await sb.git(["merge", "--no-ff", "feature", "-m", "merge"]);
      const client = createGitClient(sb.dir);
      const file = (await client.changedFiles("HEAD")).files[0]!;
      const diff = await client.commitDiff(file, "HEAD");
      expect(diff.hunks.flatMap((h) => h.lines.map((l) => l.text))).toContain("+from feature");
    } finally {
      await sb.cleanup();
    }
  });
});

describe("range methods", () => {
  it("combine a contiguous range, oldest first", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "a.txt", "0\n", "root");
      const c2 = await commit(sb, "b.txt", "b\n", "two");
      const c3 = await commit(sb, "a.txt", "3\n", "three");
      const client = createGitClient(sb.dir);
      const data = await client.commitRangeChangedFiles([c2, c3]);
      expect(data.files.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt"]);
      const aFile = data.files.find((f) => f.path === "a.txt")!;
      const diff = await client.commitRangeDiff(aFile, [c2, c3]);
      expect(diff.hunks.flatMap((h) => h.lines.map((l) => l.text))).toContain("+3");
    } finally {
      await sb.cleanup();
    }
  });

  it("retry against the null tree when the range starts at the root commit", async () => {
    const sb = await makeSandbox();
    try {
      const c1 = await commit(sb, "a.txt", "1\n", "root");
      const c2 = await commit(sb, "b.txt", "2\n", "two");
      const client = createGitClient(sb.dir);
      const data = await client.commitRangeChangedFiles([c1, c2]);
      expect(data.files.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt"]);
      const aFile = data.files.find((f) => f.path === "a.txt")!;
      const diff = await client.commitRangeDiff(aFile, [c1, c2]);
      expect(diff.hunks.flatMap((h) => h.lines.map((l) => l.text))).toContain("+1");
    } finally {
      await sb.cleanup();
    }
  });
});
