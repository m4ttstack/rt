import { notifications } from '@mattstack/app-kit/notifications';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  BranchEnrichment,
  GateRow,
  RunDetail as RunDetailData,
  RunSummary,
} from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const detailGet = vi.fn();
const artifactGet = vi.fn();
const seenPost = vi.fn();
const abandonPost = vi.fn();
const enrichPost = vi.fn();
const linearWorkspaceGet = vi.fn();
const focusPost = vi.fn();
const gatesGet = vi.fn();
const answerPost = vi.fn();

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
        enrich: { $post: (...args: unknown[]) => enrichPost(...args) },
      },
      settings: {
        'linear-workspace': {
          $get: (...args: unknown[]) => linearWorkspaceGet(...args),
        },
      },
      seen: {
        ':runId': { $post: (...args: unknown[]) => seenPost(...args) },
      },
      panes: {
        ':id': {
          focus: { $post: (...args: unknown[]) => focusPost(...args) },
        },
      },
      gates: {
        $get: (...args: unknown[]) => gatesGet(...args),
        ':id': {
          answer: { $post: (...args: unknown[]) => answerPost(...args) },
        },
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

function gateRow(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: 'g1',
    subject: 'run:run-1',
    kind: 'self-review',
    questions: [
      {
        id: 'outcome',
        label: 'What happened?',
        multi: false,
        options: ['pass', 'fail'],
      },
    ],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: 0,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    ...overrides,
  };
}

function gatesResponse(gates: GateRow[]) {
  return { ok: true, status: 200, json: async () => ({ gates }) };
}

const enrichedBranch: BranchEnrichment = {
  ticket: {
    identifier: 'RT-1',
    title: 'Redesign the run detail page',
    url: 'https://linear.app/acme/issue/RT-1',
  },
  mr: {
    iid: 7,
    webUrl: 'https://example.com/mr/7',
    state: 'opened',
    pipeline: { status: 'success' },
  },
  fetchedAt: 0,
};

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  linearWorkspaceGet.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ workspace: 'acme' }),
  });
  enrichPost.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  });
  gatesGet.mockResolvedValue(gatesResponse([]));
});

describe('RunDetail', () => {
  it('renders the summary card before the timeline, fields inside their producing stage, and the failure excerpt', async () => {
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

    const summaryCard = await screen.findByTestId('summary-card');
    const timeline = await screen.findByTestId('run-timeline');

    // DOCUMENT_POSITION_FOLLOWING (4) means summaryCard comes before timeline
    // -- this is the "summary card ON TOP" behaviour, not just "both present".
    expect(
      summaryCard.compareDocumentPosition(timeline) &
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

    // The reconciled field must NOT appear under a real stage -- it has no
    // matching stage name, so it belongs in exactly one place. Asserted on
    // the Pipeline tab, before switching away unmounts it.
    expect(
      within(
        await screen.findByTestId('timeline-stage-provision-1')
      ).queryByTestId('field-reconciled')
    ).not.toBeInTheDocument();

    await userEvent.click(
      await screen.findByRole('tab', { name: 'Run context' })
    );
    const outside = await screen.findByTestId('run-context');
    expect(within(outside).getByText('rt runs abandon')).toBeInTheDocument();
    expect(within(outside).getByTestId('field-reconciled')).toHaveTextContent(
      'wedged overnight, no owning process'
    );
  });

  it('shows a missing summary-card value as dimmed "not recorded", never an empty row', async () => {
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

    await screen.findByTestId('summary-card');
    // FIXTURE never produces 'worktree' or 'commits' fields, and enrich
    // (mocked empty by beforeEach) never produces an 'mr' entry.
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

    await userEvent.click(
      await screen.findByRole('tab', { name: 'Run context' })
    );
    const outside = await screen.findByTestId('run-context');
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

    await screen.findByTestId('summary-card');
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

  it('shows a focus-pane button for a run with a working agent', async () => {
    detailGet.mockResolvedValue(
      detailResponse({
        ...FIXTURE,
        run: run({
          status: 'running',
          agent: { status: 'working', pane: 'w1:p1' },
        }),
      })
    );
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
      await screen.findByRole('button', { name: 'focus pane' })
    ).toBeInTheDocument();
  });

  it('has no focus-pane button when the run has no agent', async () => {
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

    await screen.findByTestId('summary-card');
    expect(
      screen.queryByRole('button', { name: 'focus pane' })
    ).not.toBeInTheDocument();
  });

  it('has no focus-pane button once the run is done', async () => {
    detailGet.mockResolvedValue(
      detailResponse({
        ...FIXTURE,
        run: run({
          status: 'done',
          agent: { status: 'done', pane: 'w1:p1' },
        }),
      })
    );
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

    await screen.findByTestId('summary-card');
    expect(
      screen.queryByRole('button', { name: 'focus pane' })
    ).not.toBeInTheDocument();
  });

  it('raises the attributed pane via the typed client, and surfaces a failure', async () => {
    detailGet.mockResolvedValue(
      detailResponse({
        ...FIXTURE,
        run: run({
          status: 'running',
          agent: { status: 'working', pane: 'w1:p1' },
        }),
      })
    );
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
    focusPost.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'no such pane' }),
    });

    renderDetail();

    await userEvent.click(
      await screen.findByRole('button', { name: 'focus pane' })
    );

    expect(focusPost).toHaveBeenCalledWith({ param: { id: 'w1:p1' } });
    await screen.findByText("couldn't focus the pane");
  });

  it('surfaces the same failure when the focus request rejects outright', async () => {
    // The notifications store is module-global, so the previous test's toast
    // would make the text query ambiguous without a clean slate.
    notifications.clean();
    detailGet.mockResolvedValue(
      detailResponse({
        ...FIXTURE,
        run: run({
          status: 'running',
          agent: { status: 'working', pane: 'w1:p1' },
        }),
      })
    );
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
    focusPost.mockRejectedValueOnce(new Error('network down'));

    renderDetail();

    await userEvent.click(
      await screen.findByRole('button', { name: 'focus pane' })
    );

    await screen.findByText("couldn't focus the pane");
  });

  it('copies the ticket to the clipboard on its single-key hotkey', async () => {
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

      await screen.findByTestId('summary-card');
      await userEvent.keyboard('t');

      await waitFor(() => expect(writeText).toHaveBeenCalledWith('RT-1'));
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
      });
    }
  });

  // The `b` hotkey moved from the deleted HandoffField into the SummaryCard
  // header wiring -- this pins that the move didn't drop the binding.
  it('copies the branch to the clipboard on hotkey b', async () => {
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

      await screen.findByTestId('summary-card');
      await userEvent.keyboard('b');

      await waitFor(() => expect(writeText).toHaveBeenCalledWith('feat/x'));
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
      });
    }
  });

  it('shows the same liveness chip the board row shows for a running run whose agent is idle', async () => {
    const idleFixture: RunDetailData = {
      ...FIXTURE,
      run: run({
        status: 'running',
        agent: { status: 'idle', pane: 'w1:p1' },
      }),
    };
    detailGet.mockResolvedValue(detailResponse(idleFixture));
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

    const card = await screen.findByTestId('summary-card');
    expect(within(card).getByTestId('liveness-chip')).toHaveAttribute(
      'data-state',
      'idle'
    );
  });

  it('shows the liveness chip once a run needs attention', async () => {
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

    const card = await screen.findByTestId('summary-card');
    expect(within(card).getByTestId('liveness-chip')).toHaveAttribute(
      'data-state',
      'stale'
    );
  });

  it('links the ticket id to its Linear url, opening in a new tab', async () => {
    enrichPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ 'feat/x': enrichedBranch }),
    });
    detailGet.mockResolvedValue(detailResponse(FIXTURE));
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    const link = await screen.findByTestId('ticket-link');
    expect(link).toHaveAttribute('href', 'https://linear.app/acme/issue/RT-1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('RT-1');
  });

  it('builds a Linear url from the ticket field when enrichment is cold', async () => {
    detailGet.mockResolvedValue(detailResponse(FIXTURE));
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    const link = await screen.findByTestId('ticket-link');
    expect(link).toHaveAttribute('href', 'https://linear.app/acme/issue/RT-1');
    expect(link).toHaveTextContent('RT-1');
  });

  it('leaves the ticket id as plain text when neither enrichment nor a workspace slug gives a url', async () => {
    linearWorkspaceGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ workspace: null }),
    });
    detailGet.mockResolvedValue(detailResponse(FIXTURE));
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    const card = await screen.findByTestId('summary-card');
    expect(within(card).getByText('RT-1')).toBeInTheDocument();
    expect(screen.queryByTestId('ticket-link')).not.toBeInTheDocument();
  });

  it('renders the enriched ticket title and links the MR iid+state to its webUrl, with CI status below', async () => {
    enrichPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ 'feat/x': enrichedBranch }),
    });
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

    const card = await screen.findByTestId('summary-card');
    expect(
      await within(card).findByText('Redesign the run detail page')
    ).toBeInTheDocument();

    const mrLink = within(card).getByRole('link', { name: '!7 opened' });
    expect(mrLink).toHaveAttribute('href', 'https://example.com/mr/7');
    expect(within(card).getByText('success')).toBeInTheDocument();
  });

  it('falls back to the mr field URL when enrichment has nothing for the branch', async () => {
    detailGet.mockResolvedValue(
      detailResponse({
        ...FIXTURE,
        fields: [
          ...FIXTURE.fields,
          {
            key: 'mr',
            value: 'https://gitlab.example.com/g/p/-/merge_requests/43166',
            produced_by: 'review',
            at: 5,
          },
        ],
      })
    );
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    const link = await screen.findByTestId('mr-link');
    expect(link).toHaveAttribute(
      'href',
      'https://gitlab.example.com/g/p/-/merge_requests/43166'
    );
    expect(link).toHaveTextContent('!43166');
  });

  it('still prefers enrichment when both the field and the cache answer', async () => {
    enrichPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ 'feat/x': enrichedBranch }),
    });
    detailGet.mockResolvedValue(
      detailResponse({
        ...FIXTURE,
        fields: [
          ...FIXTURE.fields,
          {
            key: 'mr',
            value: 'https://stale.example.com/mr/1',
            produced_by: 'ship',
            at: 5,
          },
        ],
      })
    );
    seenPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    renderDetail();

    const link = await screen.findByTestId('mr-link');
    expect(link).toHaveAttribute('href', 'https://example.com/mr/7');
    expect(link).toHaveTextContent('!7 opened');
  });

  it('shows the commits field and repoLabel under branch/worktree, and last-event recency under liveness', async () => {
    const withMoreFields: RunDetailData = {
      ...FIXTURE,
      fields: [
        ...FIXTURE.fields,
        {
          key: 'worktree',
          value: '/Users/matt/work/repo-tools-wt',
          produced_by: 'provision',
          at: 3,
        },
        {
          key: 'commits',
          value: '3 commits @ a1b2c3d',
          produced_by: 'implement',
          at: 10,
        },
      ],
    };
    detailGet.mockResolvedValue(detailResponse(withMoreFields));
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

    const card = await screen.findByTestId('summary-card');
    expect(within(card).getByText('3 commits @ a1b2c3d')).toBeInTheDocument();
    expect(within(card).getByText('repo-tools')).toBeInTheDocument();
    expect(within(card).getByText(/last pipeline event/)).toBeInTheDocument();
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

    // EffectiveInputs renders its own CommandProvenance-style attribution
    // lower on the page, so this testid now matches twice -- the page-level
    // one (asserted here) is the first in DOM order.
    const [pageLevel] = await screen.findAllByTestId('command-provenance');
    expect(pageLevel).toHaveTextContent('rt runs show run-1 --repo repo-tools');
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

describe('RunDetail: gate card', () => {
  it('renders the gate card between the summary card and the tabs panel, plus the Answer action, for an open gate', async () => {
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
    gatesGet.mockResolvedValue(
      gatesResponse([gateRow({ subject: 'run:run-1', status: 'open' })])
    );

    renderDetail();

    const summaryCard = await screen.findByTestId('summary-card');
    const gateCard = await screen.findByTestId('gate-card');
    const panels = await screen.findByTestId('run-panels');
    expect(
      summaryCard.compareDocumentPosition(gateCard) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      gateCard.compareDocumentPosition(panels) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      within(summaryCard).getByRole('button', { name: 'answer gate' })
    ).toBeInTheDocument();
  });

  it('renders the gate card for a parked gate, badge included', async () => {
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
    gatesGet.mockResolvedValue(
      gatesResponse([gateRow({ subject: 'run:run-1', status: 'parked' })])
    );

    renderDetail();

    expect(await screen.findByTestId('gate-parked-badge')).toBeInTheDocument();
  });

  it('renders an answered gate as a read-only summary while the run is still running', async () => {
    detailGet.mockResolvedValue(
      detailResponse({ ...FIXTURE, run: run({ status: 'running' }) })
    );
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
    gatesGet.mockResolvedValue(
      gatesResponse([
        gateRow({
          subject: 'run:run-1',
          status: 'answered',
          answer: {
            answers: { outcome: 'pass' },
            by: 'someone',
            answeredAt: 1,
          },
        }),
      ])
    );

    renderDetail();

    expect(
      await screen.findByTestId('gate-answered-badge')
    ).toBeInTheDocument();
    expect(await screen.findByTestId('gate-chip')).toHaveTextContent(
      'self-review run run-1 · pass · by someone'
    );
    // Answered isn't actionable -- no Answer affordance for it.
    expect(
      screen.queryByRole('button', { name: 'answer gate' })
    ).not.toBeInTheDocument();
  });

  it('drops an answered gate once the run itself is no longer running', async () => {
    // FIXTURE's own run status is 'failed'.
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
    gatesGet.mockResolvedValue(
      gatesResponse([
        gateRow({
          subject: 'run:run-1',
          status: 'answered',
          answer: {
            answers: { outcome: 'pass' },
            by: 'someone',
            answeredAt: 1,
          },
        }),
      ])
    );

    renderDetail();

    await screen.findByTestId('summary-card');
    expect(screen.queryByTestId('gate-card')).not.toBeInTheDocument();
  });

  it('shows nothing for a gate belonging to a different run', async () => {
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
    gatesGet.mockResolvedValue(
      gatesResponse([
        gateRow({ subject: 'run:some-other-run', status: 'open' }),
      ])
    );

    renderDetail();

    await screen.findByTestId('summary-card');
    expect(screen.queryByTestId('gate-card')).not.toBeInTheDocument();
  });

  it('submits an answer with a bare {answers} body -- no mrUrl anywhere -- keyed to the gate id in the URL', async () => {
    detailGet.mockResolvedValue(
      detailResponse({ ...FIXTURE, run: run({ status: 'running' }) })
    );
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
    gatesGet.mockResolvedValue(
      gatesResponse([
        gateRow({ id: 'g7', subject: 'run:run-1', status: 'open' }),
      ])
    );
    answerPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        row: gateRow({ id: 'g7', subject: 'run:run-1', status: 'answered' }),
      }),
    });

    renderDetail();

    await userEvent.click(await screen.findByLabelText('pass'));
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() =>
      expect(answerPost).toHaveBeenCalledWith({
        param: { id: 'g7' },
        json: { answers: { outcome: 'pass' } },
      })
    );
  });

  // Supersede only fires within the same (subject, kind) -- a `clarify` gate
  // and a `self-review` gate can both be open on the same run at once (e.g.
  // a stage gate opened by a wedged retry alongside an existing review
  // gate), so this must render a card per gate, not pick one.
  it('renders one card per active gate when different kinds are both open, most-recently-opened first', async () => {
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
    gatesGet.mockResolvedValue(
      gatesResponse([
        gateRow({
          id: 'g-review',
          subject: 'run:run-1',
          kind: 'self-review',
          status: 'open',
          openedAt: 100,
          questions: [
            {
              id: 'outcome',
              label: 'What happened?',
              multi: false,
              options: ['pass', 'fail'],
            },
          ],
        }),
        gateRow({
          id: 'g-clarify',
          subject: 'run:run-1',
          kind: 'clarify',
          status: 'open',
          openedAt: 200,
          questions: [
            {
              id: 'direction',
              label: 'Which way?',
              multi: false,
              options: ['left', 'right'],
            },
          ],
        }),
      ])
    );

    renderDetail();

    const cards = await screen.findAllByTestId('gate-card');
    expect(cards).toHaveLength(2);

    // Most recently opened (openedAt 200, 'clarify') comes first.
    const titles = await screen.findAllByTestId('gate-card-title');
    expect(titles.map(t => t.textContent)).toEqual(['clarify', 'self-review']);

    // Both question sets are actually reachable, not just one card's.
    expect(within(cards[0]).getByText('Which way?')).toBeInTheDocument();
    expect(within(cards[1]).getByText('What happened?')).toBeInTheDocument();
  });

  it('titles a card by meta.label when the opener set one, else the raw kind', async () => {
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
    gatesGet.mockResolvedValue(
      gatesResponse([
        gateRow({
          id: 'g-labeled',
          subject: 'run:run-1',
          kind: 'stage-retry',
          status: 'open',
          meta: { label: 'Wedged retry' },
        }),
      ])
    );

    renderDetail();

    expect(await screen.findByTestId('gate-card-title')).toHaveTextContent(
      'Wedged retry'
    );
  });

  it('falls back to the bare kind when meta.label is absent -- never the old hardcoded "review gate"', async () => {
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
    gatesGet.mockResolvedValue(
      gatesResponse([
        gateRow({
          id: 'g-clarify',
          subject: 'run:run-1',
          kind: 'clarify',
          status: 'open',
        }),
      ])
    );

    renderDetail();

    const title = await screen.findByTestId('gate-card-title');
    expect(title).toHaveTextContent('clarify');
    expect(title).not.toHaveTextContent('review gate');
  });

  // activeGatesForRun orders by openedAt alone, so a more recently opened
  // but already-answered (read-only) gate can sort ahead of an older
  // still-open one -- the Answer button has to skip past it to the card
  // that actually has a submit control.
  it('scrolls to the first ACTIONABLE gate card, not just the first card in DOM order', async () => {
    detailGet.mockResolvedValue(
      detailResponse({ ...FIXTURE, run: run({ status: 'running' }) })
    );
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
    gatesGet.mockResolvedValue(
      gatesResponse([
        gateRow({
          id: 'g-answered',
          subject: 'run:run-1',
          status: 'answered',
          openedAt: 300,
          answer: {
            answers: { outcome: 'pass' },
            by: 'someone',
            answeredAt: 1,
          },
        }),
        gateRow({
          id: 'g-open',
          subject: 'run:run-1',
          status: 'open',
          openedAt: 100,
        }),
      ])
    );

    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy;

    try {
      renderDetail();

      const cards = await screen.findAllByTestId('gate-card');
      expect(cards).toHaveLength(2);
      // Most-recently-opened first: the answered one (300) sorts ahead of
      // the open one (100) -- this is the setup that reproduces the bug.
      expect(cards[0]).toHaveAttribute('data-actionable', 'false');
      expect(cards[1]).toHaveAttribute('data-actionable', 'true');

      await userEvent.click(
        await screen.findByRole('button', { name: 'answer gate' })
      );

      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy.mock.instances[0]).toBe(cards[1]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('RunDetail: chrome', () => {
  it("draws its title row at console's page header height, not the kit default", async () => {
    renderDetail();

    await screen.findByRole('heading', { level: 2 });
    const header = document.querySelector('#page-shell-header') as HTMLElement;
    expect(header.style.height).toContain('2.5rem');
    const heading = document.querySelector(
      '#page-shell-header h2'
    ) as HTMLElement;
    expect(heading.style.getPropertyValue('--title-fz')).toContain('h5');
  });
});
