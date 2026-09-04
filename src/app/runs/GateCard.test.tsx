import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateRow } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const answerPost = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      gates: {
        ':id': {
          answer: { $post: (...args: unknown[]) => answerPost(...args) },
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
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <GateCard gate={gate} />
    </QueryClientProvider>
  );
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
  it('renders a read-only summary, unwrapping the {value, note} form', () => {
    renderCard(
      gateRow({
        status: 'answered',
        answer: {
          answers: {
            outcome: { value: 'pass', note: 'flaky retry, ok on rerun' },
            flags: ['lint'],
          },
          by: 'reviewer-pane',
          answeredAt: 100,
        },
      })
    );

    expect(screen.getByTestId('gate-answered-badge')).toBeInTheDocument();
    const summary = screen.getByTestId('gate-answer-summary');
    expect(within(summary).getByText('pass')).toBeInTheDocument();
    expect(
      within(summary).getByText('flaky retry, ok on rerun')
    ).toBeInTheDocument();
    expect(within(summary).getByText('lint')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'submit' })
    ).not.toBeInTheDocument();
  });

  it('shows a placeholder for a question missing from the answers', () => {
    renderCard(
      gateRow({
        status: 'answered',
        answer: { answers: { outcome: 'pass' }, by: 'p', answeredAt: 1 },
      })
    );

    const summary = screen.getByTestId('gate-answer-summary');
    expect(within(summary).getByText('(none)')).toBeInTheDocument();
  });
});
