import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateRow } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const answerPost = vi.fn();
const focusPost = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      gates: {
        ':id': {
          answer: { $post: (...args: unknown[]) => answerPost(...args) },
          focus: { $post: (...args: unknown[]) => focusPost(...args) },
        },
      },
    },
  },
}));

const { GateCard } = await import('./GateCard');

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
      {
        id: 'flags',
        label: 'Any flags?',
        multi: true,
        options: ['lint', 'types'],
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

function renderCard(gate: GateRow) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <GateCard gate={gate} />
    </QueryClientProvider>
  );
  return { ...result, queryClient };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('GateCard: open/actionable', () => {
  it('renders a single-select question as radios and a multi question as checkboxes', () => {
    renderCard(gateRow());

    expect(screen.getByText('What happened?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'pass' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'fail' })).toBeInTheDocument();
    expect(screen.getByText('Any flags?')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'lint' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'types' })).toBeInTheDocument();
  });

  it('disables submit until every question has an answer', async () => {
    renderCard(gateRow());

    const submit = screen.getByRole('button', { name: 'submit' });
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: 'pass' }));
    // The multi question is still unanswered.
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'lint' }));
    expect(submit).toBeEnabled();
  });

  it('posts {answers} keyed to the gate id in the URL -- no mrUrl anywhere', async () => {
    answerPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ row: gateRow({ status: 'answered' }) }),
    });
    renderCard(gateRow({ id: 'g42' }));

    await userEvent.click(screen.getByRole('radio', { name: 'pass' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'lint' }));
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() =>
      expect(answerPost).toHaveBeenCalledWith({
        param: { id: 'g42' },
        json: { answers: { outcome: 'pass', flags: ['lint'] } },
      })
    );
  });

  it('shows a retry-shaped error and keeps the answer selected when the request rejects outright', async () => {
    answerPost.mockRejectedValue(new Error('network down'));
    renderCard(gateRow());

    await userEvent.click(screen.getByRole('radio', { name: 'pass' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'lint' }));
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    await screen.findByText(/submit failed/);
    expect(screen.getByRole('radio', { name: 'pass' })).toBeChecked();
  });

  it('renders the winning answer from a 409 conflict instead of a retry prompt', async () => {
    answerPost.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        row: {
          answer: {
            answers: { outcome: 'fail', flags: ['types'] },
            by: 'other-pane',
          },
        },
      }),
    });
    renderCard(gateRow());

    await userEvent.click(screen.getByRole('radio', { name: 'pass' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'lint' }));
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    await screen.findByText('answered elsewhere');
    expect(screen.getByTestId('gate-answered-badge')).toBeInTheDocument();
    const summary = screen.getByTestId('gate-answer-summary');
    expect(within(summary).getByText('fail')).toBeInTheDocument();
    expect(within(summary).getByText('types')).toBeInTheDocument();
  });

  // A 409 means the row genuinely changed (someone else answered it), not
  // just a local UI state to reconcile -- every other consumer of the
  // shared ['gates'] cache (RunRow's blocked badge, a sibling GateCard for
  // the same run) needs that refetch too, and the websocket that would
  // normally trigger it may be delayed or dropped.
  it('invalidates the shared gates cache on a 409 conflict, not only on success', async () => {
    answerPost.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        row: {
          answer: { answers: { outcome: 'fail' }, by: 'other-pane' },
        },
      }),
    });
    const { queryClient } = renderCard(gateRow());
    queryClient.setQueryData(['gates'], { gates: [] });

    await userEvent.click(screen.getByRole('radio', { name: 'pass' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'lint' }));
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    await screen.findByText('answered elsewhere');
    await waitFor(() =>
      expect(queryClient.getQueryState(['gates'])?.isInvalidated).toBe(true)
    );
  });

  it('stops a click from bubbling out of the card', async () => {
    const onOuterClick = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <div onClick={onOuterClick}>
          <GateCard gate={gateRow()} />
        </div>
      </QueryClientProvider>
    );

    await userEvent.click(screen.getByText('What happened?'));

    expect(onOuterClick).not.toHaveBeenCalled();
  });
});

describe('GateCard: title', () => {
  it('titles the card by the gate kind, not a hardcoded "review gate"', () => {
    renderCard(gateRow({ kind: 'self-review' }));

    const title = screen.getByTestId('gate-card-title');
    expect(title).toHaveTextContent('self-review');
    expect(title).not.toHaveTextContent('review gate');
  });

  it('titles a non-review kind by its own name too', () => {
    renderCard(gateRow({ kind: 'clarify' }));

    expect(screen.getByTestId('gate-card-title')).toHaveTextContent('clarify');
  });

  it('prefers meta.label over the raw kind when the opener set one', () => {
    renderCard(
      gateRow({ kind: 'stage-retry', meta: { label: 'Wedged retry' } })
    );

    expect(screen.getByTestId('gate-card-title')).toHaveTextContent(
      'Wedged retry'
    );
  });

  it('falls back to the kind when meta has no string label', () => {
    renderCard(gateRow({ kind: 'clarify', meta: { label: 42 } }));

    expect(screen.getByTestId('gate-card-title')).toHaveTextContent('clarify');
  });
});

describe('GateCard: parked', () => {
  it('still renders the questions and wears a parked badge', () => {
    renderCard(gateRow({ status: 'parked' }));

    expect(screen.getByTestId('gate-parked-badge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'submit' })).toBeInTheDocument();
  });
});

describe('GateCard: answered', () => {
  it('renders a chip for an answered gate and expands to the unwrapped detail', async () => {
    renderCard(
      gateRow({
        status: 'answered',
        answer: {
          answers: {
            outcome: { value: 'pass', note: 'clean run' },
            flags: ['lint'],
          },
          by: 'pane',
          answeredAt: 1,
        },
      })
    );

    expect(screen.getByTestId('gate-chip')).toHaveTextContent(
      'self-review run run-1 · pass, lint'
    );
    expect(screen.queryByTestId('gate-answer-summary')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('gate-detail-toggle'));
    const summary = screen.getByTestId('gate-answer-summary');
    expect(within(summary).getByText('pass')).toBeInTheDocument();
    expect(within(summary).getByText('clean run')).toBeInTheDocument();
    expect(within(summary).getByText('lint')).toBeInTheDocument();
  });

  it('shows a placeholder for a question missing from the answers', async () => {
    renderCard(
      gateRow({
        status: 'answered',
        answer: { answers: { outcome: 'pass' }, by: 'p', answeredAt: 1 },
      })
    );

    await userEvent.click(screen.getByTestId('gate-detail-toggle'));
    const summary = screen.getByTestId('gate-answer-summary');
    expect(within(summary).getByText('(none)')).toBeInTheDocument();
  });
});

describe('W4 rendering', () => {
  it('renders option labels but submits values', async () => {
    const user = userEvent.setup();
    renderCard(
      gateRow({
        questions: [
          {
            id: 'outcome',
            label: 'What happened?',
            multi: false,
            options: [{ value: 'pass', label: 'Pass (all green)' }, 'fail'],
          },
        ],
      })
    );
    await user.click(screen.getByLabelText('Pass (all green)'));
    await user.click(screen.getByRole('button', { name: 'submit' }));
    await waitFor(() => expect(answerPost).toHaveBeenCalled());
    expect(answerPost.mock.calls[0]![0]).toMatchObject({
      json: { answers: { outcome: 'pass' } },
    });
  });

  it('shows a context toggle and reveals the context text', async () => {
    const user = userEvent.setup();
    renderCard(gateRow({ context: 'the failing check output' }));
    expect(screen.queryByTestId('gate-context-body')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('gate-context-toggle'));
    expect(screen.getByTestId('gate-context-body')).toHaveTextContent(
      'the failing check output'
    );
  });

  it('hides code-changes until a fix is picked and submits the sentinel while hidden', async () => {
    const user = userEvent.setup();
    // A prior test's answerPost.mockResolvedValue (409 conflict) otherwise
    // survives vi.clearAllMocks() -- it clears calls, not the resolved
    // implementation -- and would flip this card to the read-only conflict
    // view after the first submit below, before the second interaction.
    answerPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ row: gateRow({ status: 'open' }) }),
    });
    renderCard(
      gateRow({
        kind: 'respond-plan',
        questions: [
          {
            id: 'threads-1',
            label: 'Threads',
            multi: true,
            options: ['reply:t1', 'fix:t1', 'skip:t1'],
          },
          {
            id: 'code-changes',
            label: 'Approve the proposed code changes?',
            multi: false,
            options: ['approve', 'revise', 'skip'],
          },
        ],
      })
    );
    expect(
      screen.queryByText('Approve the proposed code changes?')
    ).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('reply:t1'));
    await user.click(screen.getByRole('button', { name: 'submit' }));
    await waitFor(() => expect(answerPost).toHaveBeenCalled());
    expect(answerPost.mock.calls[0]![0]).toMatchObject({
      json: { answers: { 'threads-1': ['reply:t1'], 'code-changes': 'skip' } },
    });
    answerPost.mockClear();
    await user.click(screen.getByLabelText('fix:t1'));
    expect(screen.getByRole('radio', { name: 'approve' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'approve' })).toBeEnabled();
  });

  it('renders a recommended badge on the marked option only', () => {
    renderCard(
      gateRow({
        questions: [
          {
            id: 'outcome',
            label: 'What happened?',
            multi: false,
            options: [
              { value: 'approve', label: 'Approve (recommended)' },
              { value: 'comment', label: 'Comment' },
            ],
          },
        ],
      })
    );
    const approveChoice = screen.getByText('Approve').closest('label')!;
    expect(
      within(approveChoice).getByTestId('gate-recommended')
    ).toBeInTheDocument();

    const commentChoice = screen.getByText('Comment').closest('label')!;
    expect(
      within(commentChoice).queryByTestId('gate-recommended')
    ).not.toBeInTheDocument();
  });
});

describe('focus button', () => {
  it('is enabled when the origin can resolve and disabled with a reason otherwise', () => {
    renderCard(gateRow({ origin: { paneId: 'p1', presentation: 'form' } }));
    expect(screen.getByTestId('gate-focus')).toBeEnabled();
  });

  it('is disabled with reasons for origin-less and parked gates', () => {
    renderCard(gateRow({}));
    expect(screen.getByTestId('gate-focus')).toBeDisabled();
    expect(screen.getByTestId('gate-focus')).toHaveAttribute(
      'title',
      'no origin on this gate'
    );
  });

  it('parked gates disable focus but keep the submit path', () => {
    renderCard(gateRow({ status: 'parked', origin: { paneId: 'p1' } }));
    expect(screen.getByTestId('gate-focus')).toBeDisabled();
    expect(screen.getByTestId('gate-focus')).toHaveAttribute(
      'title',
      'parked; resume is board-owned'
    );
    expect(screen.getByRole('button', { name: 'submit' })).toBeInTheDocument();
  });

  it('posts to the focus endpoint keyed to the gate id when the enabled button is clicked', async () => {
    focusPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ focused: true }),
    });
    renderCard(gateRow({ id: 'g7', origin: { paneId: 'p1' } }));

    await userEvent.click(screen.getByTestId('gate-focus'));

    await waitFor(() =>
      expect(focusPost).toHaveBeenCalledWith({ param: { id: 'g7' } })
    );
    expect(screen.queryByTestId('gate-focus-error')).not.toBeInTheDocument();
  });

  it('renders the daemon-reported reason on a non-2xx focus response', async () => {
    focusPost.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'no live pane matches the origin worktree' }),
    });
    renderCard(gateRow({ origin: { worktree: '/w' } }));

    await userEvent.click(screen.getByTestId('gate-focus'));

    await screen.findByText('no live pane matches the origin worktree');
  });

  it('renders a generic error when the focus request rejects outright', async () => {
    focusPost.mockRejectedValue(new Error('network down'));
    renderCard(gateRow({ origin: { paneId: 'p1' } }));

    await userEvent.click(screen.getByTestId('gate-focus'));

    await screen.findByText('focus failed');
  });
});
