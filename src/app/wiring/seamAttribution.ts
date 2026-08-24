import type { Seam } from './parseSeam';

/**
 * Attributing a diff hunk to the seam it fell in.
 *
 * The coordinate system is the whole difficulty here. A seam's `lines` span
 * is written by `span()` in rt's `lib/skills/compile.ts` as
 * `bodyStartLine .. bodyStartLine + bodyLines - 1`, where `bodyStartLine` is
 * "1-indexed line in that file where the body begins" -- *that file* being
 * the SOURCE the seam names in `path`, never the compiled SKILL.md the seam
 * appears in. So these spans attribute hunks in a fill or step source; they
 * say nothing about where anything sits in the compiled output, and testing a
 * compiled-file hunk against them compares two different files' line numbers.
 *
 * `path` is likewise plugin-relative, not repo-relative: rt writes it as
 * `relative(<plugin root>, skillMdPath)`, and the plugin root differs between
 * a step (the mattstack plugin) and a fill (whichever plugin the binding came
 * from). Matching is therefore exact-string against the same namespace the
 * seam was read from, and never a path the caller resolved itself.
 */

/** A single hunk's footprint on the NEW side of a diff. */
export interface DiffHunk {
  /** As `+++ b/<path>` named it, with the `b/` prefix stripped. */
  path: string;
  /** 1-indexed and inclusive, matching `Seam.lines`. */
  lines: [number, number];
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const NEW_FILE_HEADER = '+++ ';

/**
 * Parses unified diff text -- `git diff`'s output -- into hunks.
 *
 * The console computes no diff of its own. git already produces a real
 * (Myers) diff, it is already the spawned tool for pack history, and a hunk
 * header carries exactly the two facts attribution needs. That keeps a diff
 * library, and its transitive tree, out of a `package.json` the whole app and
 * the compiled binary share.
 *
 * Hunks whose new side is empty -- a pure deletion -- are anchored on the
 * line they followed, so a deletion inside a seam's body still attributes to
 * that seam. A deletion before the first line of the file has no such line
 * and is dropped.
 */
export function parseDiffHunks(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let path: string | null = null;

  for (const line of diff.split('\n')) {
    if (line.startsWith(NEW_FILE_HEADER)) {
      const target = line.slice(NEW_FILE_HEADER.length).split('\t')[0].trim();
      // A deleted file's new side is /dev/null; its hunks belong to no path
      // in the version being compared to.
      path = target === '/dev/null' ? null : target.replace(/^b\//, '');
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    if (!header || path === null) continue;

    const start = Number(header[1]);
    const count = header[2] === undefined ? 1 : Number(header[2]);

    if (count === 0) {
      if (start < 1) continue;
      hunks.push({ path, lines: [start, start] });
      continue;
    }
    hunks.push({ path, lines: [start, start + count - 1] });
  }

  return hunks;
}

/**
 * The seam whose span contains the hunk, or null.
 *
 * Containment, not overlap: a hunk that straddles the boundary between two
 * seams belongs to neither, and naming one of them would put a change under a
 * provenance it does not have. Same trade `parseSeam` makes -- unattributed
 * beats misattributed.
 */
export function attributeHunk(hunk: DiffHunk, seams: Seam[]): Seam | null {
  const containing = seams.filter(
    seam =>
      seam.path === hunk.path &&
      seam.lines[0] <= hunk.lines[0] &&
      hunk.lines[1] <= seam.lines[1]
  );

  // Two seams covering one line is a shape the emitter cannot produce; if it
  // ever does, the hunk is ambiguous rather than owned by whichever came first.
  return containing.length === 1 ? containing[0] : null;
}
