import { describe, expect, it } from 'vitest';

import type { Seam } from './parseSeam';
import { attributeHunk, parseDiffHunks } from './seamAttribution';

/** Shaped like the seams `rt skills compile` emits: a plugin-relative source
    path and a 1-indexed, inclusive span WITHIN that source file. */
function seam(over: Partial<Seam> & Pick<Seam, 'path' | 'lines'>): Seam {
  return {
    kind: 'slot',
    slot: 'criteria',
    ref: 'demo:review-criteria',
    version: '0.4.11',
    ...over,
  };
}

const CRITERIA = seam({
  path: 'attachments/review-criteria/SKILL.md',
  lines: [10, 20],
});
const CONVENTIONS = seam({
  path: 'attachments/review-criteria/SKILL.md',
  slot: 'conventions',
  lines: [21, 30],
});
const STEP = seam({
  kind: 'step',
  slot: null,
  ref: 'mattstack:review',
  path: 'skills/review/SKILL.md',
  lines: [10, 20],
});

const SEAMS = [CRITERIA, CONVENTIONS, STEP];

describe('attributeHunk', () => {
  it('names the seam whose span the hunk sits inside', () => {
    expect(
      attributeHunk(
        { path: 'attachments/review-criteria/SKILL.md', lines: [14, 16] },
        SEAMS
      )
    ).toBe(CRITERIA);
  });

  it('attributes a hunk landing on the span first line to that seam', () => {
    expect(
      attributeHunk(
        { path: 'attachments/review-criteria/SKILL.md', lines: [10, 10] },
        SEAMS
      )
    ).toBe(CRITERIA);
  });

  it('attributes a hunk landing on the span last line to that seam', () => {
    expect(
      attributeHunk(
        { path: 'attachments/review-criteria/SKILL.md', lines: [20, 20] },
        SEAMS
      )
    ).toBe(CRITERIA);
  });

  it('does not reach one line above a span to claim a hunk', () => {
    expect(
      attributeHunk(
        { path: 'attachments/review-criteria/SKILL.md', lines: [9, 9] },
        SEAMS
      )
    ).toBeNull();
  });

  it('leaves the line below the last line to the next seam, not this one', () => {
    expect(
      attributeHunk(
        { path: 'attachments/review-criteria/SKILL.md', lines: [21, 21] },
        SEAMS
      )
    ).toBe(CONVENTIONS);
  });

  it('refuses a hunk that straddles two seams rather than picking one', () => {
    expect(
      attributeHunk(
        { path: 'attachments/review-criteria/SKILL.md', lines: [19, 22] },
        SEAMS
      )
    ).toBeNull();
  });

  it('never compares line numbers across two different files', () => {
    // Same span as CRITERIA, different file: line 14 of the compiled skill is
    // not line 14 of the fill, and a match here would be that confusion.
    expect(
      attributeHunk({ path: 'skills/review/SKILL.md', lines: [14, 16] }, SEAMS)
    ).toBe(STEP);
    expect(
      attributeHunk({ path: 'PACK.md', lines: [14, 16] }, SEAMS)
    ).toBeNull();
  });

  it('refuses an ambiguous hunk when two seams cover the same line', () => {
    const overlapping = [
      CRITERIA,
      seam({ path: CRITERIA.path, slot: 'other', lines: [12, 25] }),
    ];

    expect(
      attributeHunk({ path: CRITERIA.path, lines: [14, 16] }, overlapping)
    ).toBeNull();
  });

  it('finds nothing in an empty seam list without throwing', () => {
    expect(
      attributeHunk({ path: CRITERIA.path, lines: [14, 16] }, [])
    ).toBeNull();
  });
});

const DIFF = `diff --git a/attachments/review-criteria/SKILL.md b/attachments/review-criteria/SKILL.md
index 1111111..2222222 100644
--- a/attachments/review-criteria/SKILL.md
+++ b/attachments/review-criteria/SKILL.md
@@ -10,3 +14,4 @@ context line
 unchanged
-gone
+added
+added again
@@ -40,4 +45,0 @@ another
-only deletions here
diff --git a/skills/review/SKILL.md b/skills/review/SKILL.md
--- a/skills/review/SKILL.md
+++ b/skills/review/SKILL.md
@@ -1 +1 @@
-old
+new
`;

describe('parseDiffHunks', () => {
  it('reads each hunk span off the new side, and carries the file with it', () => {
    expect(parseDiffHunks(DIFF)).toEqual([
      { path: 'attachments/review-criteria/SKILL.md', lines: [14, 17] },
      { path: 'attachments/review-criteria/SKILL.md', lines: [45, 45] },
      { path: 'skills/review/SKILL.md', lines: [1, 1] },
    ]);
  });

  it('feeds attribution directly -- a real hunk lands in a real seam', () => {
    const [first] = parseDiffHunks(DIFF);

    expect(attributeHunk(first, SEAMS)).toBe(CRITERIA);
  });

  it('drops a hunk whose file was deleted, having no new side to attribute', () => {
    const deleted = `diff --git a/attachments/gone/SKILL.md b/attachments/gone/SKILL.md
--- a/attachments/gone/SKILL.md
+++ /dev/null
@@ -1,3 +0,0 @@
-a
-b
-c
`;

    expect(parseDiffHunks(deleted)).toEqual([]);
  });

  it('does not read a hunk header that arrived before any file header', () => {
    expect(parseDiffHunks('@@ -1,2 +1,2 @@\n-a\n+b\n')).toEqual([]);
  });
});
