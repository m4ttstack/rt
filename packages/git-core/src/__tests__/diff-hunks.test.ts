import { expect, test } from "bun:test";
import { parseFileDiff } from "../diff-hunks.ts";

test("a content line holding a CR before 'diff --git ' stays in its block", () => {
  const text = [
    "diff --git a/p.patch b/p.patch",
    "index 1111111..2222222 100644",
    "--- a/p.patch",
    "+++ b/p.patch",
    "@@ -1 +1 @@",
    "-old",
    "+x\rdiff --git a/q b/q",
    "",
  ].join("\n");

  const { hunks, typechange } = parseFileDiff(text);

  expect(typechange).toBe(false);
  expect(hunks.flatMap((h) => h.lines.map((l) => l.text))).toEqual(["@@ -1 +1 @@", "-old", "+x\rdiff --git a/q b/q"]);
});
