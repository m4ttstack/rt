import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { RunSummary } from '@mattstack/rt-client';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { pillTint } from './LivenessChip';

const { LivenessChip } = await import('./LivenessChip');

const baseRun: RunSummary = {
  id: 'run-1',
  repo: 'acme',
  work_type: 'feature',
  pipeline: 'implement',
  status: 'running',
  current_stage: 'implement',
  spawned_by: null,
  started_at: 0,
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: 0,
  ticket: 'DEMO-1234',
  branch: 'feat/x',
  agent: null,
  stages: [],
};

function chip(run: RunSummary) {
  renderWithProviders(<LivenessChip run={run} />);
  return screen.getByTestId('liveness-chip');
}

describe('LivenessChip', () => {
  it('renders "waiting on you · <pane>" for a blocked run with an attributed agent', () => {
    const run: RunSummary = {
      ...baseRun,
      attention: {
        needs: true,
        reason: 'blocked',
        evidence: 'herdr reports blocked',
      },
      agent: { status: 'blocked', pane: 'pane-3' },
    };
    const el = chip(run);
    expect(el).toHaveAttribute('data-state', 'blocked');
    expect(el).toHaveTextContent('waiting on you · pane-3');
    expect(el).toHaveStyle({
      backgroundColor: pillTint('bad'),
    });
  });

  it('falls back to plain "waiting on you" when a blocked run has no attributed agent', () => {
    const run: RunSummary = {
      ...baseRun,
      attention: {
        needs: true,
        reason: 'blocked',
        evidence: 'herdr reports blocked',
      },
      agent: null,
    };
    const el = chip(run);
    expect(el).toHaveAttribute('data-state', 'blocked');
    expect(el.textContent).toBe('waiting on you');
  });

  it('gives attention.reason "blocked" precedence over a simultaneously-working agent', () => {
    const run: RunSummary = {
      ...baseRun,
      attention: {
        needs: true,
        reason: 'blocked',
        evidence: 'herdr reports blocked',
      },
      agent: { status: 'working', pane: 'pane-9' },
    };
    const el = chip(run);
    expect(el).toHaveAttribute('data-state', 'blocked');
    expect(el).toHaveTextContent('waiting on you · pane-9');
  });

  it('renders "failed" for a failed run', () => {
    const run: RunSummary = {
      ...baseRun,
      attention: {
        needs: true,
        reason: 'failed',
        evidence: 'stage implement failed',
      },
    };
    const el = chip(run);
    expect(el).toHaveAttribute('data-state', 'failed');
    expect(el).toHaveTextContent('failed');
    expect(el).toHaveStyle({
      backgroundColor: pillTint('bad'),
    });
  });

  it('renders "stale · <first evidence clause>" for a stale run', () => {
    const run: RunSummary = {
      ...baseRun,
      attention: {
        needs: true,
        reason: 'stale',
        evidence:
          'no event in 41m while in implement, worktree quiet 52m, no agent working there; threshold is 30m',
      },
    };
    const el = chip(run);
    expect(el).toHaveAttribute('data-state', 'stale');
    expect(el).toHaveTextContent('stale · no event in 41m while in implement');
  });

  it('renders a warn chip for a stranded run', () => {
    const run: RunSummary = {
      ...baseRun,
      attention: {
        needs: true,
        reason: 'stranded',
        evidence: 'worktree missing',
      },
    };
    const el = chip(run);
    expect(el).toHaveAttribute('data-state', 'stranded');
    expect(el).toHaveStyle({
      backgroundColor: pillTint('warn'),
    });
  });

  it('renders "driven · agent working" when an agent is actively working', () => {
    const run: RunSummary = {
      ...baseRun,
      agent: { status: 'working', pane: 'pane-1' },
    };
    const el = chip(run);
    expect(el).toHaveAttribute('data-state', 'driven');
    expect(el).toHaveTextContent('driven · agent working');
    expect(el).toHaveStyle({
      backgroundColor: pillTint('ok'),
    });
  });

  it('renders an idle chip when the attributed agent is idle', () => {
    const run: RunSummary = {
      ...baseRun,
      agent: { status: 'idle', pane: 'pane-1' },
    };
    const el = chip(run);
    expect(el).toHaveAttribute('data-state', 'idle');
    expect(el).toHaveTextContent('idle');
    expect(el).toHaveStyle({
      backgroundColor: pillTint('warn'),
    });
  });

  it('renders a plain running chip when no agent is attributed (herdr-less machine)', () => {
    const run: RunSummary = { ...baseRun, agent: null };
    const el = chip(run);
    expect(el).toHaveAttribute('data-state', 'running');
    expect(el).toHaveTextContent('running');
    expect(el).toHaveStyle({
      backgroundColor: pillTint('accent'),
    });
  });

  it('treats an "unknown" agent status as no evidence -- plain running chip', () => {
    const run: RunSummary = {
      ...baseRun,
      agent: { status: 'unknown', pane: 'pane-1' },
    };
    const el = chip(run);
    expect(el).toHaveAttribute('data-state', 'running');
    expect(el).toHaveTextContent('running');
  });

  it('renders "done" for a finished run with no attributed agent', () => {
    const run: RunSummary = {
      ...baseRun,
      status: 'done',
      ended_at: 1000,
      agent: null,
    };
    const el = chip(run);
    expect(el).toHaveAttribute('data-state', 'done');
    expect(el).toHaveTextContent('done');
    expect(el).toHaveStyle({
      backgroundColor: pillTint('ok'),
    });
  });

  it('renders the run\'s own status for a non-"done" terminal run, under a stable data-state', () => {
    const run: RunSummary = {
      ...baseRun,
      status: 'abandoned',
      ended_at: 1000,
      agent: null,
    };
    const el = chip(run);
    expect(el).toHaveAttribute('data-state', 'finished-other');
    expect(el).toHaveTextContent('abandoned');
    expect(el).toHaveStyle({
      backgroundColor: pillTint('warn'),
    });
  });
});
