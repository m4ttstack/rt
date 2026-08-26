import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import type { SpineEntry } from '../outline';
import { SkillRow } from '../SkillRow';

function entry(
  over: Partial<SpineEntry> & { key: string; label: string }
): SpineEntry {
  return {
    kind: 'stage',
    ref: null,
    verb: null,
    step: null,
    invocable: false,
    external: false,
    unwired: false,
    sourcePath: null,
    artifactPath: null,
    health: 'unknown',
    staleFiles: [],
    orphanFiles: [],
    slots: [],
    ...over,
  };
}

describe('SkillRow: slim pipeline rows', () => {
  it('renders one line: name, ref, slot count, health, no slot table', () => {
    const stage = entry({
      kind: 'stage',
      key: 'mattstack:stage-watch-ci',
      label: 'stage-watch-ci',
      ref: 'mattstack:stage-watch-ci',
      step: 8,
      health: 'in-sync',
      slots: [
        {
          name: 'domain',
          contract: 'watch-ci-domain@1',
          required: false,
          boundTo: 'demo:watch-ci-domain',
          fillSourcePath: null,
          fill: null,
          siteCount: 1,
          inlined: null,
        },
        {
          name: 'extra',
          contract: null,
          required: false,
          boundTo: null,
          fillSourcePath: null,
          fill: null,
          siteCount: 0,
          inlined: null,
        },
      ],
    });

    renderWithProviders(<SkillRow entry={stage} slim />);

    const row = screen.getByTestId('skill-row-mattstack:stage-watch-ci');
    expect(within(row).getByText('stage-watch-ci')).toBeInTheDocument();
    expect(
      within(row).getByText('mattstack:stage-watch-ci')
    ).toBeInTheDocument();
    expect(within(row).getByText('2 slots')).toBeInTheDocument();
    expect(within(row).getByTestId('health-badge')).toHaveTextContent(
      'in sync'
    );
    // Slot detail moves to the Task 4 detail panel -- the slim row never
    // renders the table inline unless a caller opts back in.
    expect(within(row).queryByTestId('slot-domain')).not.toBeInTheDocument();
  });

  it('states "no slots" rather than "0 slots"', () => {
    const stage = entry({
      key: 'mattstack:stage-implement',
      label: 'stage-implement',
      slots: [],
    });

    renderWithProviders(<SkillRow entry={stage} slim />);

    expect(screen.getByText('no slots')).toBeInTheDocument();
  });

  it('states "unmeasured" without a dot for a health rt never reported', () => {
    const stage = entry({
      key: 'mattstack:stage-plan',
      label: 'stage-plan',
      health: 'unknown',
    });

    renderWithProviders(<SkillRow entry={stage} slim />);

    expect(screen.getByTestId('health-badge')).toHaveTextContent('unmeasured');
  });

  it('badges the orchestrator distinctly from a numbered stage', () => {
    const work = entry({
      kind: 'orchestrator',
      key: 'mattstack:work',
      label: 'work',
      ref: 'mattstack:work',
      health: 'in-sync',
    });

    renderWithProviders(<SkillRow entry={work} slim />);

    expect(screen.getByText('orchestrator')).toBeInTheDocument();
  });

  it('makes the row a clickable, keyboard-focusable surface once onOpen is given', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const stage = entry({
      key: 'mattstack:stage-provision',
      label: 'stage-provision',
    });

    renderWithProviders(<SkillRow entry={stage} slim onOpen={onOpen} />);

    const surface = screen.getByRole('button', {
      name: 'open stage-provision',
    });
    // A native button element -- focusable and Enter/Space-activatable without
    // a hand-rolled tabIndex/keydown.
    expect(surface.tagName).toBe('BUTTON');

    await user.click(surface);
    expect(onOpen).toHaveBeenCalledTimes(1);

    surface.focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('is not a click target at all when the caller passes no onOpen', () => {
    const stage = entry({
      key: 'mattstack:stage-provision',
      label: 'stage-provision',
    });

    renderWithProviders(<SkillRow entry={stage} slim />);

    expect(
      screen.queryByRole('button', { name: 'open stage-provision' })
    ).not.toBeInTheDocument();
  });
});
