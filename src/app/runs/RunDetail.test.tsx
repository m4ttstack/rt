import type {
  RunDetail as RunDetailData,
  RunSummary,
} from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';

const detailGet = vi.fn();
const artifactGet = vi.fn();
const seenPost = vi.fn();
const abandonPost = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      runs: {
        ':repo': {
          ':runId': {
            $get: (...args: unknown[]) => detailGet(...args),
            artifact: { $get: (...args: unknown[]) => artifactGet(...args) },
            abandon: { $post: (...args: unknown[]) => abandonPost(...args) },
          },
        },
      },
      seen: {
        ':runId': { $post: (...args: unknown[]) => seenPost(...args) },
      },
    },
  },
}));

const { RunDetail } = await import('./RunDetail');

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 'run-1',
  repo: 'repo-tools',
  work_type: 'feature',
  pipeline: 'implement',
  status: 'failed',
  current_stage: 'implement',
  spawned_by: null,
  started_at: 0,
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: 20,
  ticket: 'RT-1',
  branch: 'feat/x',
  ...over,
});

const FIXTURE: RunDetailData = {
  run: run(),
  stages: [
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
  ],
  fields: [
    { key: 'ticket', value: 'RT-1', produced_by: 'provision', at: 1 },
    { key: 'branch', value: 'feat/x', produced_by: 'provision', at: 2 },
    {
      key: 'reconciled',
      value: 'wedged overnight, no owning process',
      produced_by: 'rt runs abandon',
      at: 99,
    },
  ],
  decisions: [
    {
      contract: 'execution-strategy@1',
      scope: 'run',
      selection: '{"tier":"direct-tdd"}',
      decided_by: 'implement',
      decided_at: 15,
    },
    {
      contract: 'human-override@1',
      scope: 'run',
      selection: '{"note":"skip ci"}',
      decided_by: 'rt runs abandon',
      decided_at: 99,
    },
  ],
  schemaAhead: false,
};

function detailResponse(data: RunDetailData) {
  return { ok: true, status: 200, json: async () => data };
}

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RunDetail repo="repo-tools" runId="run-1" />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('RunDetail', () => {
  it('renders the handoff card before the timeline, fields inside their producing stage, and the failure excerpt', async () => {
    detailGet.mockResolvedValue(detailResponse(FIXTURE));
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        lines: ['assertion failed at line 42', 'exit code 1'],
        truncated: false,
      }),
    });
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    const handoffCard = await screen.findByTestId('handoff-card');
    const timeline = await screen.findByTestId('run-timeline');

    // DOCUMENT_POSITION_FOLLOWING (4) means handoffCard comes before timeline
    // -- this is the "handoff card ON TOP" behaviour, not just "both present".
    expect(
      handoffCard.compareDocumentPosition(timeline) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // A field renders INSIDE the stage item that produced it, not in a
    // separate list -- this fails if fields were flattened above the
    // timeline instead of grouped per stage.
    const provisionStage = screen.getByTestId('timeline-stage-provision-1');
    expect(
      within(provisionStage).getByTestId('field-ticket')
    ).toHaveTextContent('RT-1');
    expect(
      within(provisionStage).getByTestId('field-branch')
    ).toHaveTextContent('feat/x');

    const implementStage = screen.getByTestId('timeline-stage-implement-1');
    expect(
      within(implementStage).getByText('tests failed')
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(implementStage).getByTestId('failure-excerpt')
      ).toHaveTextContent('assertion failed at line 42')
    );
    expect(artifactGet).toHaveBeenCalled();
  });

  // Proves the defensive grouping rule: a field whose produced_by matches no
  // stage (here 'rt runs abandon', which never appears in `stages`) must
  // still render -- dropping it would silently hide the abandon reason.
  it('renders a field with no matching stage in the outside-the-pipeline entry, labelled by its producer', async () => {
    detailGet.mockResolvedValue(detailResponse(FIXTURE));
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    const outside = await screen.findByTestId('timeline-outside-pipeline');
    expect(within(outside).getByText('rt runs abandon')).toBeInTheDocument();
    expect(within(outside).getByTestId('field-reconciled')).toHaveTextContent(
      'wedged overnight, no owning process'
    );

    // The reconciled field must NOT also appear under a real stage -- it
    // has no matching stage name, so it belongs in exactly one place.
    expect(
      within(screen.getByTestId('timeline-stage-provision-1')).queryByTestId(
        'field-reconciled'
      )
    ).not.toBeInTheDocument();
  });

  it('shows a missing handoff field as dimmed "not recorded", never an empty row', async () => {
    detailGet.mockResolvedValue(detailResponse(FIXTURE));
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    await screen.findByTestId('handoff-card');
    // FIXTURE never produces 'worktree', 'mr', or 'commits'.
    expect(screen.getAllByText('not recorded')).toHaveLength(3);
  });

  // Mirrors the field-grouping tests above, but for decisions -- groupTimeline
  // applies the same stage / outside-the-pipeline split to `decided_by` as it
  // does to `produced_by`, and that half of the rule had no fixture data at
  // all before this.
  it('renders a decision inside the stage named by its decided_by', async () => {
    detailGet.mockResolvedValue(detailResponse(FIXTURE));
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        lines: ['assertion failed at line 42'],
        truncated: false,
      }),
    });
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    const implementStage = await screen.findByTestId(
      'timeline-stage-implement-1'
    );
    expect(
      within(implementStage).getByText(/execution-strategy@1/)
    ).toBeInTheDocument();
  });

  it('renders a decision with no matching stage in the outside-the-pipeline entry', async () => {
    detailGet.mockResolvedValue(detailResponse(FIXTURE));
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        lines: ['assertion failed at line 42'],
        truncated: false,
      }),
    });
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    const outside = await screen.findByTestId('timeline-outside-pipeline');
    expect(within(outside).getByText(/human-override@1/)).toBeInTheDocument();

    // Must not also land under a real stage -- 'rt runs abandon' matches no
    // stage name in FIXTURE.
    expect(
      screen.queryByText(/human-override@1/, {
        selector: `[data-testid="timeline-stage-implement-1"] *`,
      })
    ).not.toBeInTheDocument();
  });

  it('marks the run seen on mount', async () => {
    detailGet.mockResolvedValue(detailResponse(FIXTURE));
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    await waitFor(() =>
      expect(seenPost).toHaveBeenCalledWith({ param: { runId: 'run-1' } })
    );
  });

  it('does not show the abandon action for a run that is not stale', async () => {
    detailGet.mockResolvedValue(detailResponse(FIXTURE));
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    await screen.findByTestId('handoff-card');
    expect(
      screen.queryByRole('button', { name: 'Mark abandoned' })
    ).not.toBeInTheDocument();
  });

  it('shows the abandon action only when attention.reason is stale', async () => {
    const staleFixture: RunDetailData = {
      ...FIXTURE,
      run: run({
        attention: { needs: true, reason: 'stale', evidence: 'quiet 3h' },
      }),
    };
    detailGet.mockResolvedValue(detailResponse(staleFixture));
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    expect(
      await screen.findByRole('button', { name: 'Mark abandoned' })
    ).toBeInTheDocument();
  });

  it('copies a handoff field to the clipboard on its single-key hotkey', async () => {
    detailGet.mockResolvedValue(detailResponse(FIXTURE));
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    try {
      renderDetail();

      await screen.findByTestId('handoff-card');
      await userEvent.keyboard('t');

      await waitFor(() => expect(writeText).toHaveBeenCalledWith('RT-1'));
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
      });
    }
  });

  it('names the rt verb that produced this panel, with the run and repo it was scoped to', async () => {
    detailGet.mockResolvedValue(detailResponse(FIXTURE));
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    expect(await screen.findByTestId('command-provenance')).toHaveTextContent(
      'rt runs show run-1 --repo repo-tools'
    );
  });

  it('marks the run abandoned with the entered reason', async () => {
    const staleFixture: RunDetailData = {
      ...FIXTURE,
      run: run({
        attention: { needs: true, reason: 'stale', evidence: 'quiet 3h' },
      }),
    };
    detailGet.mockResolvedValue(detailResponse(staleFixture));
    artifactGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ lines: [], truncated: false }),
    });
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    abandonPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    renderDetail();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark abandoned' })
    );
    const input = await screen.findByLabelText(/Why is this run dead\?/);
    await userEvent.type(input, 'wedged overnight{Enter}');

    await waitFor(() =>
      expect(abandonPost).toHaveBeenCalledWith({
        param: { repo: 'repo-tools', runId: 'run-1' },
        json: { reason: 'wedged overnight' },
      })
    );
  });

  // The bug this pins: a thrown run-detail query used to take the whole
  // view with it (the app-wide RouteErrorBoundary in App.tsx caught it
  // above PageShell), dropping the one piece of context -- which run,
  // which command -- a person needs to go fetch it by hand instead.
  it('keeps the run id heading and command provenance visible when the query errors', async () => {
    detailGet.mockResolvedValue({ ok: false, status: 404 });

    renderDetail();

    expect(
      await screen.findByRole('heading', { name: 'repo-tools / run-1' })
    ).toBeInTheDocument();
    expect(await screen.findByTestId('command-provenance')).toHaveTextContent(
      'rt runs show run-1 --repo repo-tools'
    );
    expect(screen.getByTestId('generic-error')).toBeInTheDocument();
  });
});
