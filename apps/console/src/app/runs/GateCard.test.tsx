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
  // The card writes a draft to localStorage on every pick; every test here
  // uses gate id g1, so a leftover draft would pre-check a later test.
  localStorage.clear();
});

describe('GateCard: open/actionable', () => {
  it('renders the first question as radios and steps to the multi question as checkboxes', async () => {
    renderCard(gateRow());

    expect(screen.getByText('What happened?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'pass' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'fail' })).toBeInTheDocument();
    // The second question is the primitive's hidden, inert step.
    expect(
      screen.queryByRole('checkbox', { name: 'lint' })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('1 of 2');

    await userEvent.click(screen.getByRole('radio', { name: 'pass' }));
    await userEvent.click(screen.getByTestId('gate-next'));
    expect(screen.getByText('Any flags?')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'lint' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'types' })).toBeInTheDocument();
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('2 of 2');
  });

  it('disables Next until the active question is answered, then Submit until the last one is', async () => {
    renderCard(gateRow());

    expect(
      screen.queryByRole('button', { name: 'submit' })
    ).not.toBeInTheDocument();
    const next = screen.getByTestId('gate-next');
    expect(next).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: 'pass' }));
    expect(next).toBeEnabled();
    await userEvent.click(next);

    const submit = screen.getByRole('button', { name: 'submit' });
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
    await userEvent.click(screen.getByTestId('gate-next'));
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
    await userEvent.click(screen.getByTestId('gate-next'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'lint' }));
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    await screen.findByText(/submit failed/);
    expect(screen.getByRole('checkbox', { name: 'lint' })).toBeChecked();
    await userEvent.click(screen.getByTestId('gate-previous'));
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
    await userEvent.click(screen.getByTestId('gate-next'));
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
    await userEvent.click(screen.getByTestId('gate-next'));
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
    expect(screen.getByRole('radio', { name: 'pass' })).toBeInTheDocument();
    expect(screen.getByTestId('gate-next')).toBeInTheDocument();
  });
});

describe('GateCard: closed', () => {
  it('renders the summary chip, never the questionnaire form', () => {
    renderCard(gateRow({ status: 'closed', closedReason: 'superseded' }));

    expect(screen.getByTestId('gate-chip')).toHaveTextContent('superseded');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'submit' })
    ).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('radio', { name: 'Pass (all green)' }));
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
    await user.click(screen.getByRole('checkbox', { name: 'reply:t1' }));
    await user.click(screen.getByRole('button', { name: 'submit' }));
    await waitFor(() => expect(answerPost).toHaveBeenCalled());
    expect(answerPost.mock.calls[0]![0]).toMatchObject({
      json: { answers: { 'threads-1': ['reply:t1'], 'code-changes': 'skip' } },
    });
    answerPost.mockClear();
    await user.click(screen.getByRole('checkbox', { name: 'fix:t1' }));
    // The code-changes item joins as a new LAST step: Submit moves to it.
    expect(
      screen.queryByRole('button', { name: 'submit' })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('1 of 2');
    expect(
      screen.queryByRole('radio', { name: 'approve' })
    ).not.toBeInTheDocument();
    await user.click(screen.getByTestId('gate-next'));
    expect(screen.getByRole('radio', { name: 'approve' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'approve' })).toBeEnabled();
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('2 of 2');
    expect(screen.getByRole('button', { name: 'submit' })).toBeInTheDocument();
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

  it('parked gates disable focus but keep the answer path', () => {
    renderCard(gateRow({ status: 'parked', origin: { paneId: 'p1' } }));
    expect(screen.getByTestId('gate-focus')).toBeDisabled();
    expect(screen.getByTestId('gate-focus')).toHaveAttribute(
      'title',
      'parked; resume is board-owned'
    );
    expect(screen.getByTestId('gate-next')).toBeInTheDocument();
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

describe('GateCard: step mode', () => {
  it('shows a progress line that advances on Next and returns on Previous', async () => {
    renderCard(gateRow());
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('1 of 2');

    await userEvent.click(screen.getByRole('radio', { name: 'pass' }));
    await userEvent.click(screen.getByTestId('gate-next'));
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('2 of 2');

    await userEvent.click(screen.getByTestId('gate-previous'));
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('1 of 2');
  });

  it('renders a single-question gate flat: no progress, no Previous, Next, or Reset, and Submit disabled until answered', async () => {
    renderCard(gateRow({ questions: [gateRow().questions[0]!] }));
    expect(screen.queryByTestId('gate-progress')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gate-next')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gate-previous')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gate-reset')).not.toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'submit' });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'pass' }));
    expect(submit).toBeEnabled();
  });

  it('shows the required message on an empty Next: Cmd+Enter is the keyboard path past the disabled button', async () => {
    renderCard(gateRow());
    expect(screen.queryByTestId('gate-error')).not.toBeInTheDocument();

    screen.getByRole('radio', { name: 'pass' }).focus();
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');

    expect(screen.getByTestId('gate-error')).toHaveTextContent(
      'Choose an answer to continue.'
    );
    expect(screen.getByRole('alert')).toBe(screen.getByTestId('gate-error'));
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('1 of 2');
  });

  it('renders a key hint per option and picks with the number key inside the active question', async () => {
    renderCard(gateRow());
    const fail = screen.getByRole('radio', { name: 'fail' });
    expect(fail.closest('label')).toHaveTextContent('2');

    screen.getByRole('radio', { name: 'pass' }).focus();
    await userEvent.keyboard('2');
    expect(fail).toBeChecked();
  });

  it('sends a non-empty note as { value, note } and leaves untouched questions bare', async () => {
    answerPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ row: gateRow({ status: 'answered' }) }),
    });
    renderCard(gateRow({ id: 'g9' }));

    await userEvent.click(screen.getByRole('radio', { name: 'pass' }));
    await userEvent.type(
      screen.getByLabelText('Note for What happened?'),
      '  clean run  '
    );
    await userEvent.click(screen.getByTestId('gate-next'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'lint' }));
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() =>
      expect(answerPost).toHaveBeenCalledWith({
        param: { id: 'g9' },
        json: {
          answers: {
            outcome: { value: 'pass', note: 'clean run' },
            flags: ['lint'],
          },
        },
      })
    );
  });

  it('restores a saved draft on mount, including the step, and clears it on a successful submit', async () => {
    localStorage.setItem(
      'gate-kit:draft:g1',
      JSON.stringify({
        selections: { outcome: 'fail' },
        notes: { outcome: 'from the draft' },
        item: 'flags',
      })
    );
    answerPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ row: gateRow({ status: 'answered' }) }),
    });
    renderCard(gateRow());

    expect(screen.getByTestId('gate-progress')).toHaveTextContent('2 of 2');
    await userEvent.click(screen.getByTestId('gate-previous'));
    expect(screen.getByRole('radio', { name: 'fail' })).toBeChecked();
    expect(screen.getByLabelText('Note for What happened?')).toHaveValue(
      'from the draft'
    );

    await userEvent.click(screen.getByTestId('gate-next'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'types' }));
    expect(localStorage.getItem('gate-kit:draft:g1')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => expect(answerPost).toHaveBeenCalled());
    await waitFor(() =>
      expect(localStorage.getItem('gate-kit:draft:g1')).toBeNull()
    );
  });

  it('reset clears the picks, the note, and the draft, and returns to the first question', async () => {
    renderCard(gateRow());
    await userEvent.click(screen.getByRole('radio', { name: 'pass' }));
    await userEvent.type(screen.getByLabelText('Note for What happened?'), 'x');
    await userEvent.click(screen.getByTestId('gate-next'));
    expect(localStorage.getItem('gate-kit:draft:g1')).not.toBeNull();

    await userEvent.click(screen.getByTestId('gate-reset'));

    expect(screen.getByTestId('gate-progress')).toHaveTextContent('1 of 2');
    expect(screen.getByRole('radio', { name: 'pass' })).not.toBeChecked();
    expect(screen.getByLabelText('Note for What happened?')).toHaveValue('');
    expect(screen.getByTestId('gate-next')).toBeDisabled();
    expect(localStorage.getItem('gate-kit:draft:g1')).toBeNull();
  });

  it('drops a stored draft for a gate that is no longer open', () => {
    localStorage.setItem(
      'gate-kit:draft:g1',
      JSON.stringify({ selections: { outcome: 'fail' }, notes: {}, item: null })
    );
    renderCard(
      gateRow({
        status: 'answered',
        answer: { answers: { outcome: 'pass' }, by: 'p', answeredAt: 1 },
      })
    );
    expect(localStorage.getItem('gate-kit:draft:g1')).toBeNull();
  });
});
