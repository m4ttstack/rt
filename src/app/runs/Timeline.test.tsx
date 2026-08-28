import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  RunDecisionRow,
  RunFieldRow,
  RunStageRow,
} from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const artifactGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      runs: {
        ':repo': {
          ':runId': {
            artifact: { $get: (...args: unknown[]) => artifactGet(...args) },
          },
        },
      },
    },
  },
}));

const { RunContext, Timeline } = await import('./Timeline');

const STAGES: RunStageRow[] = [
  {
    name: 'provision',
    status: 'done',
    attempt: 1,
    started_at: 0,
    ended_at: 5,
    reason: null,
    detail_path: null,
  },
  {
    name: 'implement',
    status: 'failed',
    attempt: 1,
    started_at: 5,
    ended_at: 20,
    reason: 'tests failed',
    detail_path: '/fake/runs/repo-tools/run-1/implement.log',
  },
];

const FIELDS: RunFieldRow[] = [
  { key: 'ticket', value: 'RT-1', produced_by: 'provision', at: 1 },
  {
    key: 'reconciled',
    value: 'wedged overnight, no owning process',
    produced_by: 'rt runs abandon',
    at: 99,
  },
];

const DECISIONS: RunDecisionRow[] = [
  {
    contract: 'human-override@1',
    scope: 'run',
    selection: '{"note":"skip ci"}',
    decided_by: 'rt runs abandon',
    decided_at: 99,
  },
];

function renderTimeline(
  props: Partial<{
    stages: RunStageRow[];
    fields: RunFieldRow[];
    decisions: RunDecisionRow[];
    currentStage: string | null;
  }> = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <Timeline
        repo="repo-tools"
        runId="run-1"
        stages={props.stages ?? STAGES}
        fields={props.fields ?? FIELDS}
        decisions={props.decisions ?? DECISIONS}
        currentStage={
          props.currentStage === undefined ? 'implement' : props.currentStage
        }
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('Timeline', () => {
  it('wraps the pipeline in a titled surface', () => {
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });

    renderTimeline();

    const surface = screen.getByTestId('timeline-surface');
    expect(within(surface).getByText('Pipeline')).toBeInTheDocument();
    expect(within(surface).getByTestId('run-timeline')).toBeInTheDocument();
  });

  it('condenses a done (non-current) stage to a single row, keeping its field summary', () => {
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });

    renderTimeline();

    const provisionStage = screen.getByTestId('timeline-stage-provision-1');
    expect(
      within(provisionStage).getByTestId('field-ticket')
    ).toHaveTextContent('RT-1');
    expect(
      within(provisionStage).queryByTestId('timeline-current-stage')
    ).not.toBeInTheDocument();
  });

  it('keeps the current stage expanded inside an accent-tinted block, with its failure detail intact', async () => {
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        lines: ['assertion failed at line 42'],
        truncated: false,
      }),
    });

    renderTimeline({ currentStage: 'implement' });

    const implementStage = screen.getByTestId('timeline-stage-implement-1');
    const tinted = within(implementStage).getByTestId('timeline-current-stage');
    expect(within(tinted).getByText('tests failed')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(tinted).getByTestId('failure-excerpt')).toHaveTextContent(
        'assertion failed at line 42'
      )
    );
  });

  it('picks the latest attempt of the current stage name when a stage retried', () => {
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });

    const retriedStages: RunStageRow[] = [
      {
        name: 'implement',
        status: 'failed',
        attempt: 1,
        started_at: 0,
        ended_at: 5,
        reason: 'first try failed',
        detail_path: null,
      },
      {
        name: 'implement',
        status: 'running',
        attempt: 2,
        started_at: 6,
        ended_at: null,
        reason: null,
        detail_path: null,
      },
    ];

    renderTimeline({ stages: retriedStages, currentStage: 'implement' });

    const firstAttempt = screen.getByTestId('timeline-stage-implement-1');
    const secondAttempt = screen.getByTestId('timeline-stage-implement-2');
    expect(
      within(firstAttempt).queryByTestId('timeline-current-stage')
    ).not.toBeInTheDocument();
    expect(
      within(secondAttempt).getByTestId('timeline-current-stage')
    ).toBeInTheDocument();
  });

  // The records with no matching stage moved out of the timeline into their
  // own tab; the rule they prove -- never silently dropped -- is unchanged.
  it('keeps stage-less records out of the timeline and in RunContext', () => {
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });

    renderTimeline();
    expect(
      screen.queryByTestId('timeline-outside-pipeline')
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('field-reconciled')).not.toBeInTheDocument();

    renderWithProviders(
      <RunContext stages={STAGES} fields={FIELDS} decisions={DECISIONS} />
    );
    const context = screen.getByTestId('run-context');
    expect(within(context).getByText('rt runs abandon')).toBeInTheDocument();
    expect(within(context).getByTestId('field-reconciled')).toHaveTextContent(
      'wedged overnight, no owning process'
    );
    expect(within(context).getByText(/human-override@1/)).toBeInTheDocument();
  });

  it('renders no current-stage tint when currentStage matches nothing', () => {
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });

    renderTimeline({ currentStage: null });

    expect(
      screen.queryByTestId('timeline-current-stage')
    ).not.toBeInTheDocument();
  });
});
