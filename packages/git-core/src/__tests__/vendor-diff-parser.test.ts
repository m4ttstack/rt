import { describe, expect, test } from "bun:test";
import { DiffParser } from "../vendor/ghd/diff-parser.ts";
import { DiffLineType } from "../vendor/ghd/diff-line.ts";
import { DiffHunkHeader } from "../vendor/ghd/raw-diff.ts";

const BASIC = [
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,3 +1,3 @@",
  " one",
  "-two",
  "+deux",
  " three",
  "",
].join("\n");

describe("vendored DiffParser", () => {
  test("hunk lines[0] is the synthetic @@ header line", () => {
    const d = new DiffParser().parse(BASIC);
    expect(d.hunks).toHaveLength(1);
    const h = d.hunks[0]!;
    expect(h.lines[0]!.type).toBe(DiffLineType.Hunk);
    expect(h.lines[0]!.text).toBe("@@ -1,3 +1,3 @@");
  });

  test("line text carries the prefix character", () => {
    const h = new DiffParser().parse(BASIC).hunks[0]!;
    expect(h.lines[1]!.text).toBe(" one");
    expect(h.lines[2]!.text).toBe("-two");
    expect(h.lines[3]!.text).toBe("+deux");
    expect(h.lines[2]!.content).toBe("two");
  });

  test("unifiedDiffStart chains as a diff-global counter", () => {
    const TWO_HUNKS = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+deux",
      " three",
      "@@ -10,3 +10,3 @@",
      " ten",
      "-eleven",
      "+onze",
      " twelve",
      "",
    ].join("\n");
    const d = new DiffParser().parse(TWO_HUNKS);
    const [h1, h2] = [d.hunks[0]!, d.hunks[1]!];
    expect(h1.unifiedDiffStart).toBe(0);
    expect(h1.unifiedDiffEnd).toBe(h1.unifiedDiffStart + h1.lines.length - 1);
    expect(h2.unifiedDiffStart).toBe(h1.unifiedDiffStart + h1.lines.length);
  });

  test("no-newline marker sets noTrailingNewLine on the preceding line", () => {
    const NO_NL = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    const h = new DiffParser().parse(NO_NL).hunks[0]!;
    const added = h.lines.find((l) => l.type === DiffLineType.Add)!;
    expect(added.noTrailingNewLine).toBe(true);
  });

  test("content lines starting with -- and ++ survive", () => {
    const TRICKY = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,2 +1,2 @@",
      "--x",
      "++y",
      "",
    ].join("\n");
    const h = new DiffParser().parse(TRICKY).hunks[0]!;
    expect(h.lines[1]!.text).toBe("--x");
    expect(h.lines[1]!.type).toBe(DiffLineType.Delete);
    expect(h.lines[2]!.text).toBe("++y");
    expect(h.lines[2]!.type).toBe(DiffLineType.Add);
  });

  test("empty context line (bare space) is preserved", () => {
    const BLANK = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,3 +1,3 @@",
      " ",
      "-a",
      "+b",
      " ",
      "",
    ].join("\n");
    const h = new DiffParser().parse(BLANK).hunks[0]!;
    expect(h.lines[1]!.text).toBe(" ");
    expect(h.lines[1]!.type).toBe(DiffLineType.Context);
  });

  test("parses full git diff preamble", () => {
    const FULL_PREAMBLE = [
      "diff --git a/f.txt b/f.txt",
      "index 1234567..abcdefg 100644",
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+deux",
      " three",
      "",
    ].join("\n");
    const d = new DiffParser().parse(FULL_PREAMBLE);
    expect(d.hunks).toHaveLength(1);
    const h = d.hunks[0]!;
    expect(h.lines[0]!.type).toBe(DiffLineType.Hunk);
    expect(h.lines[0]!.text).toBe("@@ -1,3 +1,3 @@");
    expect(h.lines[1]!.text).toBe(" one");
    expect(h.lines[2]!.text).toBe("-two");
    expect(h.lines[3]!.text).toBe("+deux");
  });
});

describe("vendored DiffHunkHeader.equals", () => {
  test("two headers differing only in newLineCount are not equal", () => {
    const a = new DiffHunkHeader(1, 3, 1, 3);
    const b = new DiffHunkHeader(1, 3, 1, 4);
    expect(a.equals(b)).toBe(false);
  });

  test("identical headers are equal", () => {
    const a = new DiffHunkHeader(1, 3, 1, 3);
    const b = new DiffHunkHeader(1, 3, 1, 3);
    expect(a.equals(b)).toBe(true);
  });
});
