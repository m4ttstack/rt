import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import { InverseIndex } from './InverseIndex';
import type { BindingSite } from './outline';

/** The verb's ref is deliberately not its name: rt keys a binder by
    `mattstack:<engine>`, and a roster verb's name and engine are two
    different fields, so a title taken from the ref would read wrong here
    while looking right on every verb that happens to share the two. */
const SITES: BindingSite[] = [
  {
    ref: 'mattstack:review-engine',
    verb: 'review',
    kind: 'verb',
    slot: 'criteria',
  },
  {
    ref: 'mattstack:stage-self-review',
    verb: null,
    kind: 'stage',
    slot: 'domain',
  },
  {
    ref: 'mattstack:review-core',
    verb: null,
    kind: 'skill',
    slot: 'criteria',
  },
  { ref: 'mr-board:review', verb: null, kind: 'external', slot: 'skill' },
];

function renderIndex(
  over: {
    fill?: string | null;
    sites?: BindingSite[];
    onShowInMap?: (site: BindingSite) => void;
    onClose?: () => void;
  } = {}
) {
  return renderWithProviders(
    <InverseIndex
      pack="demo"
      fill={over.fill === undefined ? 'demo:review-criteria' : over.fill}
      sites={over.sites ?? SITES}
      asOf={1_700_000_000_000}
      onShowInMap={over.onShowInMap ?? (() => {})}
      onClose={over.onClose ?? (() => {})}
    />
  );
}

function site(ref: string, slot: string) {
  const found = screen.getByTestId(`binding-site-${ref}:${slot}`);
  expect(found).toBeInTheDocument();
  return found;
}

describe('InverseIndex: what binds this fill', () => {
  it('names the fill and the command that produced the answer', () => {
    renderIndex();

    const drawer = screen.getByTestId('inverse-index');
    expect(
      within(drawer).getByText('demo:review-criteria')
    ).toBeInTheDocument();
    expect(within(drawer).getByTestId('command-provenance')).toHaveTextContent(
      'rt skills composition --pack demo'
    );
  });

  it('lists every site with its kind, and counts them', () => {
    renderIndex();

    expect(screen.getByTestId('site-count')).toHaveTextContent('4');
    expect(
      screen.getAllByTestId('site-kind').map(badge => badge.textContent)
    ).toEqual(['verb', 'stage', 'skill', 'external']);
  });

  it('titles a roster verb by its verb and names the ref and slot beneath it', () => {
    renderIndex();
    const row = site('mattstack:review-engine', 'criteria');

    expect(within(row).getByText('review')).toBeInTheDocument();
    expect(row).toHaveTextContent('mattstack:review-engine · slot criteria');
  });

  it('gives the fourth kind a badge of its own rather than a blank one', () => {
    renderIndex();
    const row = site('mattstack:review-core', 'criteria');

    // `skill` is a mattstack ref that is neither a roster verb nor a pipeline
    // stage. A three-value map would render this row's badge empty.
    expect(within(row).getByTestId('site-kind')).toHaveTextContent('skill');
    expect(within(row).getByText('review-core')).toBeInTheDocument();
    expect(row).toHaveTextContent('mattstack:review-core · slot criteria');
  });

  it("keeps a cross-plugin site's plugin in its title and says it has no verb", () => {
    renderIndex();
    const row = site('mr-board:review', 'skill');

    expect(within(row).getByText('mr-board:review')).toBeInTheDocument();
    expect(row).toHaveTextContent(
      "another plugin's skill · slot skill · no roster verb"
    );
  });
});

describe('InverseIndex: bound by nothing', () => {
  it('states the empty case plainly instead of as an error', () => {
    renderIndex({ fill: 'mattstack:self-review', sites: [] });

    const empty = screen.getByTestId('bound-by-nothing');
    expect(within(empty).getByText('orphaned')).toBeInTheDocument();
    expect(empty).toHaveTextContent(
      'Bound by nothing. Not an error — a fill that no verb, stage, or other plugin resolves to.'
    );
    expect(screen.getByTestId('site-count')).toHaveTextContent('0');
    expect(screen.queryAllByTestId('site-kind')).toHaveLength(0);
  });
});

describe('InverseIndex: closed', () => {
  it('renders no panel until a fill is selected', () => {
    // Mantine leaves `Drawer.Root` in the DOM whether or not it is open, so
    // the absence has to be asserted on the panel's own content -- and the
    // second half is what proves this harness renders any at all.
    const { unmount } = renderIndex({ fill: null });
    expect(screen.queryByTestId('site-count')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/^binding-site-/)).toHaveLength(0);

    unmount();
    renderIndex();
    expect(screen.getByTestId('site-count')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^binding-site-/)).toHaveLength(4);
  });
});

describe('InverseIndex: showing a site in the map', () => {
  it('hands the whole site back, so the caller can find its row', async () => {
    const onShowInMap = vi.fn();
    const user = userEvent.setup();
    renderIndex({ sites: [SITES[0]], onShowInMap });

    const row = site('mattstack:review-engine', 'criteria');
    await user.click(within(row).getByTestId('show-in-map'));

    expect(onShowInMap).toHaveBeenCalledTimes(1);
    expect(onShowInMap.mock.calls[0][0]).toMatchObject({
      ref: 'mattstack:review-engine',
    });
  });
});
