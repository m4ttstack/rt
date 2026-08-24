import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
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
  'diff --git a/skills/watch-ci/SKILL.md b/skills/watch-ci/SKILL.md',
  '--- a/skills/watch-ci/SKILL.md',
  '+++ b/skills/watch-ci/SKILL.md',
  '@@ -1,3 +1,3 @@',
  ' ---',
  '-  compiled: "mattstack@0.7.4"',
  '+  compiled: "mattstack@0.8.0"',
  '',
].join('\n');

function renderCompare(over: Partial<Parameters<typeof SeamCompare>[0]> = {}) {
  return renderWithProviders(
    <SeamCompare
      body={BODY}
      diff={DIFF}
      diffTruncated={false}
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

describe('attributeDiff', () => {
  it('places a hunk under the seam whose SOURCE span contains it', () => {
    const [domain] = attributeDiff(DIFF, seamsOf(BODY));

    expect(domain.hunk.path).toBe('attachments/watch-ci-domain/SKILL.md');
    expect(domain.seam?.ref).toBe('demo:watch-ci-domain');
  });

  it('leaves a hunk in the compiled artifact unattributed', () => {
    // Line 1-3 of skills/watch-ci/SKILL.md is inside NO seam's span: every
    // span here is measured in a fill or a step source, a different file.
    const [, artifact] = attributeDiff(DIFF, seamsOf(BODY));

    expect(artifact.hunk.path).toBe('skills/watch-ci/SKILL.md');
    expect(artifact.seam).toBeNull();
  });

  it('keeps the diff order rather than grouping the attributed ones', () => {
    expect(attributeDiff(DIFF, seamsOf(BODY)).map(a => a.hunk.path)).toEqual([
      'attachments/watch-ci-domain/SKILL.md',
      'skills/watch-ci/SKILL.md',
    ]);
  });
});

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

    const loose = screen.getByTestId('unattributed-hunk');
    expect(
      within(loose).getByText('no seam contains this')
    ).toBeInTheDocument();
    expect(within(loose).getByTestId('hunk-span')).toHaveTextContent(
      'skills/watch-ci/SKILL.md:1-3'
    );
  });

  it('renders an unattributed hunk as itself rather than hiding it', () => {
    renderCompare();

    const loose = screen.getByTestId('unattributed-hunk');
    expect(loose).toHaveTextContent('compiled: "mattstack@0.8.0"');
    expect(loose).toHaveTextContent("No part's body span contains these lines");
  });

  it('attributes nothing when no compiled body could be read', () => {
    renderCompare({ body: undefined });

    expect(screen.queryAllByTestId('attributed-hunk')).toHaveLength(0);
    expect(screen.getAllByTestId('unattributed-hunk')).toHaveLength(2);
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
