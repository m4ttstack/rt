import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import type { SeamSourceIndex } from './seamAttribution';
import { attributeDiff, SeamCompare, seamsOf } from './SeamCompare';

/** Shaped exactly as `rt skills compile` emits them: five whitespace-separated
    fields, a PLUGIN-relative path, and a span measured in that source file. */
const BODY = [
  '---',
  'name: "watch-ci"',
  '---',
  '',
  '<!-- part: step source=mattstack:watch-ci version=0.8.0 path=attachments/pipeline/watch-ci/SKILL.md lines=21-88 -->',
  'step text',
  '<!-- part: slot:domain binding=demo:watch-ci-domain version=0.4.11 path=attachments/watch-ci-domain/SKILL.md lines=13-161 -->',
  'domain text',
].join('\n');

/** Two hunks in the domain fill's span, one in the compiled artifact that no
    seam's span can reach -- the artifact is not any seam's source file. */
const DIFF = [
  'diff --git a/attachments/watch-ci-domain/SKILL.md b/attachments/watch-ci-domain/SKILL.md',
  '--- a/attachments/watch-ci-domain/SKILL.md',
  '+++ b/attachments/watch-ci-domain/SKILL.md',
  '@@ -20,2 +20,3 @@ heading',
  ' The QA suite is the gate.',
  '+A red smoke job with a green QA suite is a ship.',
  // Reaches into the domain seam (13-161) from line 8 without being inside
  // it: only a containment test refuses this one, an overlap test names the
  // seam for a change that is mostly above it.
  '@@ -8,4 +8,6 @@ preamble',
  ' before the body',
  '+not this seam',
  'diff --git a/skills/watch-ci/SKILL.md b/skills/watch-ci/SKILL.md',
  '--- a/skills/watch-ci/SKILL.md',
  '+++ b/skills/watch-ci/SKILL.md',
  '@@ -1,3 +1,3 @@',
  ' ---',
  '-  compiled: "mattstack@0.7.4"',
  '+  compiled: "mattstack@0.8.0"',
  '',
].join('\n');

/** The live demo shape: the pack repo is one tree and every source path
    rt reports is inside the INSTALLED plugin root, a different one. */
const PACK_DIR =
  '/Users/matt/.mattstack/teams/demo/mattstack/packs/demo';
const DEMO_ROOT =
  '/Users/matt/.claude/plugins/cache/acme/demo/0.4.11';
const MATTSTACK_ROOT =
  '/Users/matt/.claude/plugins/cache/mattstack/mattstack/0.8.0';

const INDEX: SeamSourceIndex = {
  pack: 'demo',
  packDir: PACK_DIR,
  artifactPath: `${PACK_DIR}/skills/watch-ci`,
  stepSourcePath: `${MATTSTACK_ROOT}/attachments/pipeline/watch-ci/SKILL.md`,
  fillSourcePaths: {
    domain: `${DEMO_ROOT}/attachments/watch-ci-domain/SKILL.md`,
  },
};

function renderCompare(over: Partial<Parameters<typeof SeamCompare>[0]> = {}) {
  return renderWithProviders(
    <SeamCompare
      verb="watch-ci"
      body={BODY}
      diff={DIFF}
      diffTruncated={false}
      index={INDEX}
      isPending={false}
      error={null}
      {...over}
    />
  );
}

describe('seamsOf', () => {
  it('reads every seam in a compiled body, in order', () => {
    expect(seamsOf(BODY).map(seam => seam.ref)).toEqual([
      'mattstack:watch-ci',
      'demo:watch-ci-domain',
    ]);
  });

  it('finds none in a body whose seams carry no span', () => {
    // What an rt older than SKILLS-52 writes: three fields, no path/lines.
    expect(
      seamsOf('<!-- part: step source=mattstack:watch-ci version=0.8.0 -->')
    ).toEqual([]);
  });
});

function attributed() {
  return attributeDiff(DIFF, seamsOf(BODY), INDEX);
}

describe('attributeDiff', () => {
  it('places a hunk under the seam whose SOURCE span contains it', () => {
    const [domain] = attributed().hunks;

    expect(domain.hunk.path).toBe('attachments/watch-ci-domain/SKILL.md');
    expect(domain.seam?.ref).toBe('demo:watch-ci-domain');
  });

  it('leaves a hunk in the compiled artifact unattributed', () => {
    // Line 1-3 of skills/watch-ci/SKILL.md is inside NO seam's span: every
    // span here is measured in a fill or a step source, a different file.
    const artifact = attributed().hunks.find(
      h => h.hunk.path === 'skills/watch-ci/SKILL.md'
    );

    expect(artifact?.seam).toBeNull();
  });

  it('refuses a hunk that reaches into a seam without sitting inside it', () => {
    const overlapping = attributed().hunks.find(h => h.hunk.lines[0] === 8);

    expect(overlapping?.hunk.lines).toEqual([8, 13]);
    expect(overlapping?.seam).toBeNull();
  });

  it("leads with the verb's own hunks, then the rest of the pack", () => {
    // The compiled artifact's hunk is this verb's even though no seam can
    // reach it; a hunk in another verb's artifact is not.
    const withOther = `${DIFF}diff --git a/skills/review/SKILL.md b/skills/review/SKILL.md
--- a/skills/review/SKILL.md
+++ b/skills/review/SKILL.md
@@ -4,1 +4,1 @@
-old
+new
`;
    const result = attributeDiff(withOther, seamsOf(BODY), INDEX);

    expect(result.hunks.map(h => h.thisVerb)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(result.hunks[result.hunks.length - 1].hunk.path).toBe(
      'skills/review/SKILL.md'
    );
  });

  it('counts the seams it read, the ones it could place, and what matched', () => {
    const result = attributed();

    // Two seams; only the demo fill names a file this repo holds. The
    // step's source is the mattstack plugin's.
    expect(result.seamCount).toBe(2);
    expect(result.placedSeamCount).toBe(1);
    expect(result.attributedCount).toBe(1);
  });
});

/** Located by what it says rather than by position: the panel leads with the
    verb's own hunks, so an index here would silently follow that ordering. */
function unattributedFor(path: string) {
  const block = screen
    .getAllByTestId('unattributed-hunk')
    .find(el =>
      within(el).getByTestId('hunk-span').textContent?.startsWith(path)
    );
  expect(block).toBeDefined();
  return block as HTMLElement;
}

describe('SeamCompare: what each hunk header claims', () => {
  it("names the SEAM's own file and span over an attributed hunk", () => {
    renderCompare();

    const attributed = screen.getByTestId('attributed-hunk');
    expect(within(attributed).getByText('slot domain')).toBeInTheDocument();
    expect(
      within(attributed).getByText('demo:watch-ci-domain')
    ).toBeInTheDocument();
    // 13-161 is the seam's span in the FILL, not 20-22 (the hunk's own).
    expect(within(attributed).getByTestId('hunk-span')).toHaveTextContent(
      'attachments/watch-ci-domain/SKILL.md:13-161'
    );
  });

  it("names the HUNK's own file and span over an unattributed one", () => {
    renderCompare();

    const loose = unattributedFor('skills/watch-ci/SKILL.md');
    expect(
      within(loose).getByText('no seam contains this')
    ).toBeInTheDocument();
    expect(within(loose).getByTestId('hunk-span')).toHaveTextContent(
      'skills/watch-ci/SKILL.md:1-3'
    );
  });

  it('renders an unattributed hunk as itself rather than hiding it', () => {
    renderCompare();

    const loose = unattributedFor('skills/watch-ci/SKILL.md');
    expect(loose).toHaveTextContent('compiled: "mattstack@0.8.0"');
    expect(loose).toHaveTextContent("No part's body span contains these lines");
  });

  it('attributes nothing when no compiled body could be read', () => {
    renderCompare({ body: undefined });

    expect(screen.queryAllByTestId('attributed-hunk')).toHaveLength(0);
    expect(screen.getAllByTestId('unattributed-hunk')).toHaveLength(3);
  });
});

describe('SeamCompare: the coordinate system it states', () => {
  it('says the span is measured in the source, not in the compiled output', () => {
    renderCompare();

    expect(screen.getByTestId('seam-compare')).toHaveTextContent(
      "A seam's line span is measured in its own source file, not in the compiled output"
    );
  });

  it('says the step source is in another repo and cannot be attributed here', () => {
    renderCompare();

    expect(screen.getByTestId('seam-compare')).toHaveTextContent(
      "The step's source is in another repo and no hunk here can attribute to it"
    );
  });
});

describe('SeamCompare: bounds and states', () => {
  it('states an empty diff as a fact, not as a loading state', () => {
    renderCompare({ diff: '' });

    expect(screen.getByTestId('compare-empty')).toHaveTextContent(
      'Nothing changed in this pack between these two commits'
    );
  });

  it('says when the route cut the diff, so a missing change is not read as none', () => {
    renderCompare({ diffTruncated: true });

    expect(screen.getByTestId('compare-truncated')).toBeInTheDocument();
  });

  it('surfaces the diff error instead of an empty comparison', () => {
    renderCompare({ error: 'fatal: bad object 0000000' });

    expect(screen.getByTestId('compare-error')).toHaveTextContent(
      'bad object 0000000'
    );
    expect(screen.queryByTestId('compare-empty')).not.toBeInTheDocument();
  });
});

describe('SeamCompare: saying how much attribution had to work with', () => {
  it('tallies matched hunks and placed seams on the happy path', () => {
    renderCompare();

    expect(screen.getByTestId('seam-tally')).toHaveTextContent(
      '1 of 3 hunks matched a seam · 1 of 2 seams name a file in this repo'
    );
  });

  it('says plainly when the compile emitted no parseable seam', () => {
    // The live shape for an rt older than SKILLS-52: seams with no
    // `path=`/`lines=`. Without this the panel is indistinguishable from an
    // honest run of unattributed hunks.
    renderCompare({
      body: '<!-- part: step source=mattstack:watch-ci version=0.8.0 -->',
    });

    expect(screen.getByTestId('seam-tally')).toHaveTextContent(
      'No seam in this compile carries a source span'
    );
  });

  it('says plainly when every seam names a file this repo does not hold', () => {
    // A verb whose slots are all bound from other plugins: seams read fine,
    // and not one of them can ever place a hunk.
    renderCompare({
      index: { ...INDEX, fillSourcePaths: {} },
    });

    expect(screen.getByTestId('seam-tally')).toHaveTextContent(
      "2 seams read, none of them naming a file this pack's repo holds"
    );
  });

  it('heads the rest of the pack with its own count', () => {
    const withOther = `${DIFF}diff --git a/skills/review/SKILL.md b/skills/review/SKILL.md
--- a/skills/review/SKILL.md
+++ b/skills/review/SKILL.md
@@ -4,1 +4,1 @@
-old
+new
`;
    renderCompare({ diff: withOther });

    expect(screen.getByTestId('elsewhere')).toHaveTextContent(
      '2 more hunks elsewhere in this pack — this diff covers the pack, not just watch-ci.'
    );
  });
});
