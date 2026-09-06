import { pluginOf } from './outline';
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
 * from). A diff's paths are relative to the pack dir, so the two are different
 * coordinate systems that occasionally produce equal strings -- see
 * `seamPackPath`, which is where a seam is put into the diff's coordinates
 * and where every check that it belongs there lives.
 */

/** A single hunk's footprint on the NEW side of a diff. */
export interface DiffHunk {
  /** As `+++ b/<path>` named it, with the `b/` prefix stripped. */
  path: string;
  /** 1-indexed and inclusive, matching `Seam.lines`. */
  lines: [number, number];
  /** The hunk's own body, each line keeping its leading ` `/`+`/`-`. Carried
      here rather than re-split by the renderer: two walks of the same diff
      text would eventually disagree about which body belongs to which span,
      and that is exactly the misattribution this module exists to prevent. */
  text: string[];
}

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NEW_FILE_HEADER = '+++ ';
const OLD_FILE_HEADER = '--- ';
const FILE_PAIR = 'diff --git ';
/** `\ No newline at end of file` -- a note about the line above, not a line
    of either side, so it spends neither budget. */
const NO_NEWLINE = '\\';

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
  let open: DiffHunk | null = null;
  // `@@ -a,b +c,d @@` states the body's exact length: b old-side lines and d
  // new-side ones, where a context line spends one of each and a `+`/`-` line
  // spends one. Counting them down is what makes the parse format-driven --
  // a deleted line whose own content is `-- x` arrives as `--- x` and reads
  // as a file header to anything that decides by prefix, which silently drops
  // it and every body line after it.
  let oldLeft = 0;
  let newLeft = 0;

  for (const line of diff.split('\n')) {
    if (open) {
      if (line.startsWith(NO_NEWLINE)) continue;
      // git writes a bare space for an empty context line; a tool that
      // trimmed it leaves the empty string meaning the same thing.
      const side = line === '' ? ' ' : line[0];
      if (side === ' ' || side === '+' || side === '-') {
        if (side !== '+') oldLeft -= 1;
        if (side !== '-') newLeft -= 1;
        open.text.push(line);
        if (oldLeft <= 0 && newLeft <= 0) open = null;
        continue;
      }
      // The counts said more body was coming and something else arrived:
      // a malformed or truncated diff. Close and read the line as structure.
      open = null;
    }

    if (line.startsWith(NEW_FILE_HEADER)) {
      const target = line.slice(NEW_FILE_HEADER.length).split('\t')[0].trim();
      // A deleted file's new side is /dev/null; its hunks belong to no path
      // in the version being compared to.
      path = target === '/dev/null' ? null : target.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith(OLD_FILE_HEADER) || line.startsWith(FILE_PAIR))
      continue;

    const header = HUNK_HEADER.exec(line);
    if (!header || path === null) continue;

    const oldCount = header[1] === undefined ? 1 : Number(header[1]);
    const start = Number(header[2]);
    const newCount = header[3] === undefined ? 1 : Number(header[3]);

    // A pure deletion has no new side; it is anchored on the line it followed,
    // so a deletion inside a seam's body still attributes to that seam. A
    // deletion before the first line of the file has no such line.
    if (newCount === 0 && start < 1) continue;
    const end = newCount === 0 ? start : start + newCount - 1;

    const hunk: DiffHunk = { path, lines: [start, end], text: [] };
    hunks.push(hunk);
    oldLeft = oldCount;
    newLeft = newCount;
    open = oldLeft > 0 || newLeft > 0 ? hunk : null;
  }

  return hunks;
}

/**
 * What rt's composition says about the sources behind ONE verb's seams. Every
 * absolute path here is rt's own `join(<plugin root>, srcPath)`, computed
 * where the plugin roots are known; nothing in this module resolves a path.
 */
export interface SeamSourceIndex {
  /** rt's namespace for the pack being diffed, e.g. `demo`. */
  pack: string;
  packDir: string;
  /** The verb's own compiled artifact, absolute. */
  artifactPath: string | null;
  /** `verbs[].sourcePath` -- the step's source. */
  stepSourcePath: string | null;
  /** Slot name -> `slots[].fillSourcePath`. Paired by NAME, which is why a
      seam is never matched to a source by comparing two relative paths. */
  fillSourcePaths: Record<string, string | null>;
}

/**
 * The file IN THE DIFF'S OWN COORDINATES whose lines a seam's span measures --
 * pack-relative, exactly as `+++ b/<path>` names it -- or null when this repo
 * holds no such file.
 *
 * Null is the common answer and the correct one. A seam's `path` is relative
 * to ITS OWN PLUGIN ROOT, and the diff's paths are relative to the pack dir;
 * the two only appear to agree, so three things are checked before a seam is
 * allowed to claim a pack file:
 *
 * 1. **rt states an absolute source for it.** Paired by slot name (or by the
 *    seam being the step), never by path. No path, no attribution.
 * 2. **rt's absolute path agrees with the seam text.** The seam is a comment
 *    in a compiled artifact and the composition is a separate read; if they
 *    disagree about where the source is, neither is trustworthy here.
 * 3. **The source belongs to THIS pack.** A step, or a fill bound from another
 *    plugin, lives in another repo entirely -- this diff cannot contain it,
 *    and its plugin-relative path colliding with a pack path is exactly the
 *    coincidence that would misattribute. `loadStepSource` and
 *    `loadAttachment` both search `<plugin>/skills/<name>` before
 *    `attachments/`, so `skills/<name>/SKILL.md` is a reachable seam path and
 *    is byte-identical to a compiled artifact's pack-relative path.
 *
 * And compiled output is excluded outright: no seam's span is measured in an
 * artifact, so a hunk under the verb's own `artifactPath` can never be one.
 */
export function seamPackPath(
  seam: Seam,
  index: SeamSourceIndex
): string | null {
  const absolute =
    seam.kind === 'step'
      ? index.stepSourcePath
      : seam.slot === null
        ? null
        : (index.fillSourcePaths[seam.slot] ?? null);
  if (absolute === null) return null;
  if (!absolute.endsWith(`/${seam.path}`)) return null;
  if (pluginOf(seam.ref) !== index.pack) return null;

  const inPack = `${index.packDir}/${seam.path}`;
  if (index.artifactPath && inPack.startsWith(`${index.artifactPath}/`)) {
    return null;
  }
  return seam.path;
}

/** A seam already placed in the diff's coordinates by `seamPackPath`. */
export interface AttributableSeam {
  seam: Seam;
  /** Pack-relative, or null for a seam whose source this repo does not hold. */
  path: string | null;
}

/**
 * The seam whose span contains the hunk, or null.
 *
 * Containment, not overlap: a hunk that straddles the boundary between two
 * seams belongs to neither, and naming one of them would put a change under a
 * provenance it does not have. Same trade `parseSeam` makes -- unattributed
 * beats misattributed.
 */
export function attributeHunk(
  hunk: Pick<DiffHunk, 'path' | 'lines'>,
  seams: AttributableSeam[]
): Seam | null {
  const containing = seams.filter(
    ({ seam, path }) =>
      path !== null &&
      path === hunk.path &&
      seam.lines[0] <= hunk.lines[0] &&
      hunk.lines[1] <= seam.lines[1]
  );

  // Two seams covering one line is a shape the emitter cannot produce; if it
  // ever does, the hunk is ambiguous rather than owned by whichever came first.
  return containing.length === 1 ? containing[0].seam : null;
}
