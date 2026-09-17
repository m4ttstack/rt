import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function seeded(content: string) {
  const sb = await makeSandbox();
  await sb.write("f.txt", content);
  await sb.commitAll("base");
  return sb;
}

describe("diffFile", () => {
  it("basic modification with correct line numbers", async () => {
    const sb = await seeded("a\nb\nc\n");
    try {
      await sb.write("f.txt", "a\nB\nc\n");
      const d = await createGitClient(sb.dir).diffFile("f.txt");
      expect(d.kind).toBe("text");
      expect(d.hunks.length).toBe(1);
      const lines = d.hunks[0]!.lines;
      expect(lines.map((l) => l.type)).toEqual(["context", "del", "add", "context"]);
      expect(lines[1]).toMatchObject({ content: "b", oldLineNo: 2, newLineNo: null });
      expect(lines[2]).toMatchObject({ content: "B", oldLineNo: null, newLineNo: 2 });
    } finally {
      await sb.cleanup();
    }
  });

  it("deleted line whose content starts with '-- ' (SQL comment)", async () => {
    const sb = await seeded("select 1;\n-- comment\nselect 2;\n");
    try {
      await sb.write("f.txt", "select 1;\nselect 2;\n");
      const d = await createGitClient(sb.dir).diffFile("f.txt");
      const dels = d.hunks[0]!.lines.filter((l) => l.type === "del");
      expect(dels).toEqual([
        { type: "del", content: "-- comment", oldLineNo: 2, newLineNo: null },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("added line starting with '++' (C increment)", async () => {
    const sb = await seeded("int x;\n");
    try {
      await sb.write("f.txt", "int x;\n++x;\n");
      const d = await createGitClient(sb.dir).diffFile("f.txt");
      const adds = d.hunks[0]!.lines.filter((l) => l.type === "add");
      expect(adds).toEqual([
        { type: "add", content: "++x;", oldLineNo: null, newLineNo: 2 },
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("trailing blank context line survives", async () => {
    const sb = await seeded("a\n\nb\n");
    try {
      await sb.write("f.txt", "a\n\nB\n");
      const d = await createGitClient(sb.dir).diffFile("f.txt");
      const lines = d.hunks[0]!.lines;
      // context "a", context "", del "b", add "B"
      expect(lines.map((l) => [l.type, l.content])).toEqual([
        ["context", "a"],
        ["context", ""],
        ["del", "b"],
        ["add", "B"],
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("no newline at EOF does not corrupt lines", async () => {
    const sb = await seeded("a\nb");
    try {
      await sb.write("f.txt", "a\nc");
      const d = await createGitClient(sb.dir).diffFile("f.txt");
      const lines = d.hunks[0]!.lines;
      expect(lines.filter((l) => l.type === "del").map((l) => l.content)).toEqual(["b"]);
      expect(lines.filter((l) => l.type === "add").map((l) => l.content)).toEqual(["c"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("staged=true diffs the index", async () => {
    const sb = await seeded("a\n");
    try {
      await sb.write("f.txt", "staged\n");
      await sb.git(["add", "f.txt"]);
      await sb.write("f.txt", "working\n");
      const staged = await createGitClient(sb.dir).diffFile("f.txt", { staged: true });
      const unstaged = await createGitClient(sb.dir).diffFile("f.txt");
      expect(staged.hunks[0]!.lines.some((l) => l.content === "staged")).toBe(true);
      expect(unstaged.hunks[0]!.lines.some((l) => l.content === "working")).toBe(true);
    } finally {
      await sb.cleanup();
    }
  });

  it("untracked file diffs as all-adds", async () => {
    const sb = await seeded("a\n");
    try {
      await sb.write("new.txt", "one\ntwo\n");
      const d = await createGitClient(sb.dir).diffFile("new.txt");
      expect(d.kind).toBe("text");
      expect(d.hunks[0]!.lines.map((l) => [l.type, l.content])).toEqual([
        ["add", "one"],
        ["add", "two"],
      ]);
    } finally {
      await sb.cleanup();
    }
  });

  it("binary file is classified, no hunks", async () => {
    const sb = await seeded("a\n");
    try {
      await sb.git(["config", "core.autocrlf", "false"]);
      const bytes = new Uint8Array([0, 1, 2, 255, 0, 40, 10]);
      await Bun.write(`${sb.dir}/bin.dat`, bytes);
      await sb.git(["add", "bin.dat"]);
      await sb.git(["commit", "-m", "add binary"]);
      await Bun.write(`${sb.dir}/bin.dat`, new Uint8Array([9, 9, 0, 255]));
      const d = await createGitClient(sb.dir).diffFile("bin.dat");
      expect(d.kind).toBe("binary");
      expect(d.hunks).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });
});
