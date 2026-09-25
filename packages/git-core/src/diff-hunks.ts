import { DiffParser } from "./vendor/ghd/diff-parser.ts";
import { DiffHunk } from "./vendor/ghd/raw-diff.ts";

/**
 * One path's diff hunks. git splits a typechange (a file replaced by a
 * symlink, or back) into two `diff --git` blocks for the one path, a delete
 * then an add, and GHD's DiffParser reads a single block. Each block parses
 * alone and the hunks join end to end, the later blocks' unifiedDiffStart/End
 * shifted past the earlier ones so every line keeps a unique selection index.
 */
export function parseFileDiff(text: string): { hunks: DiffHunk[]; typechange: boolean } {
  // Split at \n only: a multiline ^ also matches after a lone \r inside a content line.
  const blocks = text.split(/(?<=\n)(?=diff --git )/).filter((block) => block.trim() !== "");
  const hunks: DiffHunk[] = [];
  let offset = 0;
  for (const block of blocks) {
    for (const h of new DiffParser().parse(block).hunks) {
      hunks.push(new DiffHunk(h.header, h.lines, h.unifiedDiffStart + offset, h.unifiedDiffEnd + offset, h.expansionType));
    }
    const last = hunks.at(-1);
    if (last) offset = last.unifiedDiffEnd + 1;
  }
  return { hunks, typechange: blocks.length > 1 };
}
