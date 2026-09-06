import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SpineEntry } from '../outline';
import { SummaryStrip } from '../SummaryStrip';

function orchestrator(over: Partial<SpineEntry> = {}): SpineEntry {
  return {
    kind: 'orchestrator',
    key: 'mattstack:work',
    label: 'work',
    ref: 'mattstack:work',
    verb: 'work',
    step: null,
    invocable: true,
    external: false,
    unwired: false,
    sourcePath: null,
    artifactPath: null,
    health: 'in-sync',
    staleFiles: [],
    orphanFiles: [],
    slots: [],
    includes: [],
    ...over,
  };
}

describe('SummaryStrip', () => {
  it('renders the five labelled facts with the given values', () => {
    renderWithProviders(
      <SummaryStrip
        orchestrator={orchestrator()}
        workType="feature"
        stageCount={8}
        health="in-sync"
        attentionCount={3}
      />
    );

    expect(screen.getByTestId('fact-orchestrator')).toHaveTextContent(
      'mattstack:work'
    );
    expect(screen.getByTestId('fact-work-type')).toHaveTextContent('feature');
    expect(screen.getByTestId('fact-stages')).toHaveTextContent(
      '8 in run order'
    );
    expect(screen.getByTestId('fact-health')).toHaveTextContent('in sync');
    expect(screen.getByTestId('fact-attention')).toHaveTextContent(
      '3 need attention'
    );
  });

  it('links the attention fact to the filtered view only once something needs it', () => {
    renderWithProviders(
      <SummaryStrip
        orchestrator={orchestrator()}
        workType="feature"
        stageCount={3}
        health="in-sync"
        attentionCount={2}
      />
    );

    const attention = screen.getByTestId('attention-count');
    expect(attention).toHaveAttribute('href', '/wiring?attention=1');
    expect(attention).toHaveTextContent('2 need attention');
  });

  it('states zero attention as plain text, not a link to an empty filter', () => {
    renderWithProviders(
      <SummaryStrip
        orchestrator={orchestrator()}
        workType="feature"
        stageCount={3}
        health="in-sync"
        attentionCount={0}
      />
    );

    expect(screen.queryByTestId('attention-count')).not.toBeInTheDocument();
    expect(screen.getByTestId('fact-attention')).toHaveTextContent(
      '0 need attention'
    );
  });

  it('says "none" for a pack with no orchestrator rather than rendering a broken link', () => {
    renderWithProviders(
      <SummaryStrip
        orchestrator={null}
        workType={null}
        stageCount={0}
        health="unknown"
        attentionCount={0}
      />
    );

    expect(screen.getByTestId('fact-orchestrator')).toHaveTextContent('none');
    expect(screen.getByTestId('fact-work-type')).toHaveTextContent('none');
    expect(screen.getByTestId('fact-health')).toHaveTextContent('unmeasured');
  });
});
