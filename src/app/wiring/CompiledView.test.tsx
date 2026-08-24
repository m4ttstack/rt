import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import { CompiledView } from './CompiledView';
import type { SlotOutlineNode } from './outline';

const HEADER_COMMENT =
  '<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->';

const STEP_SEAM =
  '<!-- part: step source=mattstack:work version=0.8.0 path=attachments/pipeline/work/SKILL.md lines=17-135 -->';
const TIERING_SEAM =
  '<!-- part: slot:tiering binding=mattstack:model-tiering version=0.8.0 path=attachments/model-tiering/SKILL.md lines=8-117 -->';

/** A real preview in miniature: frontmatter, the compiler header, the step's
    own body, and one inlined fill. */
const BODY = [
  '---',
  'name: "work"',
  '---',
  '',
  HEADER_COMMENT,
  '',
  STEP_SEAM,
  '',
  '# work -- the do-a-unit-of-work orchestrator',
  '',
  TIERING_SEAM,
  '',
  '# Model Tiering',
].join('\n');

function slot(
  name: string,
  over: Partial<SlotOutlineNode> = {}
): SlotOutlineNode {
  return {
    name,
    contract: `${name}@1`,
    required: false,
    boundTo: `mattstack:${name}`,
    fill: null,
    siteCount: 1,
    inlined: true,
    ...over,
  };
}

function renderView(over: { body?: string; slots?: SlotOutlineNode[] } = {}) {
  return renderWithProviders(
    <CompiledView
      body={over.body ?? BODY}
      slots={over.slots ?? [slot('tiering')]}
    />
  );
}

/** The pane mounts before its content: the body arrives from a query, so the
    second wait is for that fetch to resolve, not for a lazy component. */
async function pane() {
  const found = await screen.findByTestId('compile-preview-body');
  await waitFor(() => expect(found.textContent).toContain('# work'));
  return found;
}

describe('CompiledView: seams as structure', () => {
  it('heads each part with its source, version and line span', async () => {
    renderView();
    await pane();

    const step = screen.getByTestId('compiled-section-step');
    expect(within(step).getByText('step')).toBeInTheDocument();
    expect(within(step).getByText('mattstack:work')).toBeInTheDocument();
    expect(within(step).getByText('0.8.0')).toBeInTheDocument();
    expect(
      within(step).getByText('attachments/pipeline/work/SKILL.md:17-135')
    ).toBeInTheDocument();

    const tiering = screen.getByTestId('compiled-section-tiering');
    expect(within(tiering).getByText('slot tiering')).toBeInTheDocument();
    expect(
      within(tiering).getByText('mattstack:model-tiering')
    ).toBeInTheDocument();
    expect(
      within(tiering).getByText('attachments/model-tiering/SKILL.md:8-117')
    ).toBeInTheDocument();
  });

  it('shows the part text without the seam comment that introduced it', async () => {
    renderView();
    const body = await pane();

    // Paired on purpose: the absence below is only meaningful because the
    // section text it belongs to is present.
    expect(body.textContent).toContain('# Model Tiering');
    expect(body.textContent).not.toContain('<!-- part:');
  });

  it('keeps the frontmatter and the compiler header, under no heading', async () => {
    renderView();
    await pane();

    const preamble = screen.getByTestId('compiled-preamble');
    expect(preamble.textContent).toContain('name: "work"');
    // rt's own statement about what this file is stays in the text; it is
    // not a seam, and hiding it would drop the artifact's honesty line.
    expect(preamble.textContent).toContain('compiled by rt skills compile');
    expect(within(preamble).queryByTestId('seam-heading')).toBeNull();
  });

  it('renders a body carrying no seams at all rather than an empty pane', async () => {
    renderView({ body: '---\nname: "work"\n---\n\n# work', slots: [] });

    const body = await screen.findByTestId('compile-preview-body');
    await waitFor(() => expect(body.textContent).toContain('name: "work"'));
    expect(screen.queryAllByTestId('seam-heading')).toHaveLength(0);
  });
});

describe('CompiledView: the slots a body cannot show', () => {
  it('lists a referenced fill the compiler left out of the body entirely', async () => {
    // The trap this view exists for: a registered, surface-public fill is
    // compiled to a reference and emits NO seam, so a pane built from seams
    // alone omits exactly the fills that are public and reusable.
    renderView({
      slots: [slot('tiering'), slot('domain', { inlined: false })],
    });
    await pane();

    expect(screen.queryByTestId('compiled-section-domain')).toBeNull();

    const row = screen.getByTestId('compiled-slot-domain');
    expect(within(row).getByText('referenced')).toBeInTheDocument();
    expect(row).toHaveTextContent(
      'invoked as its own skill; its body is not copied in here'
    );
  });

  it('places an inlined slot at the span its seam names', async () => {
    renderView();
    await pane();

    const row = screen.getByTestId('compiled-slot-tiering');
    expect(within(row).getByText('inlined')).toBeInTheDocument();
    expect(row).toHaveTextContent('attachments/model-tiering/SKILL.md:8-117');
  });

  it('reports an inlined slot with no seam as a disagreement, not as absent', async () => {
    // rt says it was inlined and the text has no seam for it. Dropping the
    // row would hide the contradiction; claiming a span would invent one.
    renderView({ slots: [slot('tiering'), slot('accounts')] });
    await pane();

    expect(screen.getByTestId('compiled-slot-accounts')).toHaveTextContent(
      'inlined, but no seam for it in this body'
    );
  });

  it('calls an unflagged slot neither inlined nor referenced', async () => {
    // `inlined: null` is rt stating nothing -- a binder-only or unbound slot.
    // Reading it as `false` would claim a reference the compiler never wrote.
    renderView({
      slots: [
        slot('domain', { inlined: null }),
        slot('extra', { inlined: null, boundTo: null }),
      ],
    });
    await pane();

    const bound = screen.getByTestId('compiled-slot-domain');
    expect(within(bound).getByText('not in this body')).toBeInTheDocument();
    expect(bound).toHaveTextContent('rt states no inline flag for it');
    expect(screen.getByTestId('compiled-slot-extra')).toHaveTextContent(
      'nothing bound, so nothing to compile in'
    );
  });

  it('draws no slot table for a verb that declares none', async () => {
    renderView({ slots: [] });
    await pane();

    expect(screen.queryByTestId('compiled-slots')).toBeNull();
    expect(screen.getByTestId('compiled-section-step')).toBeInTheDocument();
  });
});
