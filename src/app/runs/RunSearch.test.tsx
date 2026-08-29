import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { RunSummary } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runsGet = vi.fn();
const seenGet = vi.fn();
const pruneDaysGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      runs: { $get: (...args: unknown[]) => runsGet(...args) },
      seen: { $get: (...args: unknown[]) => seenGet(...args) },
      settings: {
        'runs-prune-days': {
          $get: (...args: unknown[]) => pruneDaysGet(...args),
        },
      },
    },
  },
}));

const { RunSearch } = await import('./RunSearch');

const run = (over: Partial<RunSummary>): RunSummary => ({
  id: over.id ?? 'run-x',
  repo: 'repo-tools',
  work_type: 'feature',
  pipeline: 'implement',
  status: 'failed',
  current_stage: null,
  spawned_by: null,
  started_at: 0,
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: 0,
  ticket: null,
  branch: null,
  ...over,
});

const RUNS: RunSummary[] = [
  run({
    id: 'run-1',
    ticket: 'RT-44',
    branch: 'feat/events-bus',
    status: 'failed',
  }),
  run({
    id: 'run-2',
    repo: 'console',
    ticket: 'RT-9',
    branch: 'feat/x',
    status: 'done',
  }),
];

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function renderSearch() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RunSearch />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('RunSearch', () => {
  // Pins that the window comes from the settings endpoint, not a literal --
  // this fails if the copy were ever changed back to a hardcoded "30".
  it('renders the retention window the server resolved, not a hardcoded number', async () => {
    runsGet.mockResolvedValue(ok({ runs: RUNS }));
    seenGet.mockResolvedValue(ok({}));
    pruneDaysGet.mockResolvedValue(ok({ days: 45 }));

    renderSearch();

    const notice = await screen.findByTestId('retention-window');
    await waitFor(() => expect(notice).toHaveTextContent('45'));
    expect(notice).not.toHaveTextContent('30');
  });

  it('names the rt verb that produced these results', async () => {
    runsGet.mockResolvedValue(ok({ runs: RUNS }));
    seenGet.mockResolvedValue(ok({}));
    pruneDaysGet.mockResolvedValue(ok({ days: 30 }));

    renderSearch();

    expect(await screen.findByTestId('command-provenance')).toHaveTextContent(
      'rt runs'
    );
  });

  // Narrowing, proven the same way search.test.ts proves it: a query that
  // widens the result set (rather than narrowing it) is the failure this
  // guards against.
  it('narrows results as more terms are typed, never widens', async () => {
    runsGet.mockResolvedValue(ok({ runs: RUNS }));
    seenGet.mockResolvedValue(ok({}));
    pruneDaysGet.mockResolvedValue(ok({ days: 30 }));

    renderSearch();
    await screen.findByTestId('run-row-run-1');
    expect(screen.getByTestId('run-row-run-2')).toBeInTheDocument();

    const input = screen.getByTestId('run-search-input');
    await userEvent.type(input, 'repo-tools');

    expect(screen.getByTestId('run-row-run-1')).toBeInTheDocument();
    expect(screen.queryByTestId('run-row-run-2')).not.toBeInTheDocument();

    await userEvent.type(input, ' done');

    expect(screen.queryByTestId('run-row-run-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-row-run-2')).not.toBeInTheDocument();
    expect(screen.getByText('No runs match.')).toBeInTheDocument();
  });
});

describe('RunSearch: chrome', () => {
  it("draws its title row at console's page header height, not the kit default", async () => {
    renderSearch();

    await screen.findByRole('heading', { level: 2 });
    const header = document.querySelector('#page-shell-header') as HTMLElement;
    expect(header.style.height).toContain('2.5rem');
    const heading = document.querySelector(
      '#page-shell-header h2'
    ) as HTMLElement;
    expect(heading.style.getPropertyValue('--title-fz')).toContain('h5');
  });
});
