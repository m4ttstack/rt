import { describe, expect, it } from 'vitest';

import type { Seam } from './parseSeam';
import {
  attributeHunk,
  parseDiffHunks,
  seamPackPath,
  type AttributableSeam,
  type SeamSourceIndex,
} from './seamAttribution';

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

/** A seam already put into the diff's coordinates. `seamPackPath` is what
    does that for real, and has its own describe below; these cases are about
    the span arithmetic once the file is settled. */
function placed(s: Seam, path: string | null = s.path): AttributableSeam {
  return { seam: s, path };
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

/** STEP is placed at null: its source is the mattstack plugin's, and the repo
    being diffed is the demo pack, which does not hold it. */
const SEAMS = [placed(CRITERIA), placed(CONVENTIONS), placed(STEP, null)];

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

  it('refuses a hunk that overlaps one seam without being inside it', () => {
    // Lines 8-12 reach into CRITERIA (10-20) and touch no other seam, so the
    // ambiguity guard cannot save this one: only containment can. An
    // overlap test would name CRITERIA for a change that is mostly outside
    // it.
    expect(
      attributeHunk(
        { path: 'attachments/review-criteria/SKILL.md', lines: [8, 12] },
        SEAMS
      )
    ).toBeNull();
  });

  it('refuses a hunk that runs off the end of one seam', () => {
    // Against CRITERIA alone, so 18-24 overlaps exactly one span and the
    // ambiguity guard cannot be what refuses it.
    expect(
      attributeHunk(
        { path: 'attachments/review-criteria/SKILL.md', lines: [18, 24] },
        [placed(CRITERIA)]
      )
    ).toBeNull();
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
      attributeHunk({ path: 'PACK.md', lines: [14, 16] }, SEAMS)
    ).toBeNull();
  });

  it('cannot attribute a compiled-output hunk to a seam of the same name', () => {
    // STEP's plugin-relative path IS `skills/review/SKILL.md`, byte-identical
    // to the pack-relative path of this pack's own compiled `review`
    // artifact. Placed at null it can claim nothing, which is the whole point
    // of resolving the coordinates before the span arithmetic runs.
    expect(
      attributeHunk({ path: 'skills/review/SKILL.md', lines: [14, 16] }, SEAMS)
    ).toBeNull();
  });

  it('refuses an ambiguous hunk when two seams cover the same line', () => {
    const overlapping = [
      placed(CRITERIA),
      placed(seam({ path: CRITERIA.path, slot: 'other', lines: [12, 25] })),
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

/** The live demo shape, from `rt skills composition --json`: the pack dir
    is the repo being diffed, and every source path rt reports is inside the
    INSTALLED plugin root under ~/.claude/plugins/cache -- a different tree. */
const PACK_DIR = '/Users/matt/.mattstack/teams/demo/mattstack/packs/demo';
const DEMO_ROOT = '/Users/matt/.claude/plugins/cache/acme/demo/0.4.11';
const MATTSTACK_ROOT =
  '/Users/matt/.claude/plugins/cache/mattstack/mattstack/0.8.0';

const INDEX: SeamSourceIndex = {
  pack: 'demo',
  packDir: PACK_DIR,
  artifactPath: `${PACK_DIR}/skills/review`,
  stepSourcePath: `${MATTSTACK_ROOT}/attachments/pipeline/review/SKILL.md`,
  fillSourcePaths: {
    criteria: `${DEMO_ROOT}/attachments/review-criteria/SKILL.md`,
    forge: `${MATTSTACK_ROOT}/attachments/ci-forge-gitlab/SKILL.md`,
    unbound: null,
  },
};

describe('seamPackPath', () => {
  it("places this pack's own fill at its pack-relative path", () => {
    expect(seamPackPath(CRITERIA, INDEX)).toBe(
      'attachments/review-criteria/SKILL.md'
    );
  });

  it('refuses a step, whose source is another plugin repo this diff cannot hold', () => {
    expect(seamPackPath(STEP, INDEX)).toBeNull();
  });

  it('refuses a fill bound from another plugin, for the same reason', () => {
    const forge = seam({
      slot: 'forge',
      ref: 'mattstack:ci-forge-gitlab',
      path: 'attachments/ci-forge-gitlab/SKILL.md',
      lines: [9, 45],
    });

    expect(seamPackPath(forge, INDEX)).toBeNull();
  });

  it('refuses a seam rt states no source path for', () => {
    const unbound = seam({
      slot: 'unbound',
      path: 'attachments/nothing/SKILL.md',
      lines: [1, 5],
    });
    const unknown = seam({
      slot: 'not-in-the-composition',
      path: 'attachments/ghost/SKILL.md',
      lines: [1, 5],
    });

    expect(seamPackPath(unbound, INDEX)).toBeNull();
    expect(seamPackPath(unknown, INDEX)).toBeNull();
  });

  it("refuses a seam whose text disagrees with rt's own record of its source", () => {
    // The seam comment lives in a compiled artifact and the composition is a
    // separate read; when they disagree neither can be trusted to place a
    // hunk.
    const drifted = seam({
      path: 'attachments/somewhere-else/SKILL.md',
      lines: [10, 20],
    });

    expect(seamPackPath(drifted, INDEX)).toBeNull();
  });

  it("refuses a seam that would land inside the verb's own compiled artifact", () => {
    // Reachable: `loadAttachment` searches `<plugin>/skills/<name>` before
    // `attachments/`, so a demo fill named `review` has exactly this
    // source path -- identical to the pack path of the compiled `review`.
    const collides = seam({
      path: 'skills/review/SKILL.md',
      lines: [10, 20],
    });
    const index: SeamSourceIndex = {
      ...INDEX,
      fillSourcePaths: {
        criteria: `${DEMO_ROOT}/skills/review/SKILL.md`,
      },
    };

    expect(seamPackPath(collides, index)).toBeNull();
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
    expect(
      parseDiffHunks(DIFF).map(({ path, lines }) => ({ path, lines }))
    ).toEqual([
      { path: 'attachments/review-criteria/SKILL.md', lines: [14, 17] },
      { path: 'attachments/review-criteria/SKILL.md', lines: [45, 45] },
      { path: 'skills/review/SKILL.md', lines: [1, 1] },
    ]);
  });

  it('carries each hunk body with the span it belongs to', () => {
    expect(parseDiffHunks(DIFF).map(hunk => hunk.text)).toEqual([
      [' unchanged', '-gone', '+added', '+added again'],
      ['-only deletions here'],
      ['-old', '+new'],
    ]);
  });

  it("never reads a file header's own -/+ as a body line", () => {
    // `--- a/x` and `+++ b/x` open with the characters a deletion and an
    // addition do. They arrive once the header's line counts are spent, so
    // the parse is past the body and reads them as the structure they are.
    for (const hunk of parseDiffHunks(DIFF)) {
      expect(hunk.text.some(line => line.startsWith('--- a/'))).toBe(false);
      expect(hunk.text.some(line => line.startsWith('+++ b/'))).toBe(false);
    }
  });

  it('keeps a body line whose own content looks like a file header', () => {
    // A deleted line reading `-- a dashed continuation` arrives as `--- a
    // dashed continuation`; an added `++ x` arrives as `+++ x`. Deciding by
    // prefix drops the rest of the hunk silently -- the header's own counts
    // are what say where the body ends.
    const tricky = `diff --git a/attachments/x/SKILL.md b/attachments/x/SKILL.md
--- a/attachments/x/SKILL.md
+++ b/attachments/x/SKILL.md
@@ -10,3 +10,3 @@ ctx
 keep
--- a dashed list continuation
+++ an added line starting with plus plus
 tail
diff --git a/PACK.md b/PACK.md
--- a/PACK.md
+++ b/PACK.md
@@ -1 +1 @@
-before
+after
`;

    const hunks = parseDiffHunks(tricky);

    expect(hunks.map(h => h.path)).toEqual([
      'attachments/x/SKILL.md',
      'PACK.md',
    ]);
    expect(hunks[0].text).toEqual([
      ' keep',
      '--- a dashed list continuation',
      '+++ an added line starting with plus plus',
      ' tail',
    ]);
    // The `+++ ` body line must not have been read as a file header, or the
    // NEXT hunk carries a path invented from someone's prose.
    expect(hunks[1].text).toEqual(['-before', '+after']);
  });

  it('spends the two side budgets separately, as the header states them', () => {
    // 1 old-side line and 3 new-side: one context spends both, two additions
    // spend only new, so the body is exactly four lines and `diff --git`
    // closes nothing that was still open.
    const [hunk] = parseDiffHunks(`+++ b/x.md
@@ -4,1 +4,3 @@
 context
+one
+two
diff --git a/y.md b/y.md
`);

    expect(hunk.text).toEqual([' context', '+one', '+two']);
    expect(hunk.lines).toEqual([4, 6]);
  });

  it('does not spend a budget on the no-newline marker', () => {
    const [hunk] = parseDiffHunks(`+++ b/x.md
@@ -1,2 +1,2 @@
 kept
-was
\\ No newline at end of file
+now
`);

    expect(hunk.text).toEqual([' kept', '-was', '+now']);
  });

  it('feeds attribution directly -- a real hunk lands in a real seam', () => {
    const [first] = parseDiffHunks(DIFF);

    expect(attributeHunk(first, SEAMS)).toBe(CRITERIA);
  });

  it('ends a hunk on its own count, not on the next structure line', () => {
    // The second hunk's `-only deletions here` is its whole body: 4 old-side
    // lines are claimed but only one arrives before `diff --git`, so the
    // malformed tail closes the hunk rather than swallowing the next file.
    const hunks = parseDiffHunks(DIFF);

    expect(hunks[1].text).toEqual(['-only deletions here']);
    expect(hunks[2].path).toBe('skills/review/SKILL.md');
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
