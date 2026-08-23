import type { RunSummary } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';

const run = (over: Partial<RunSummary>): RunSummary => ({
  id: 'r',
  repo: 'repo-tools',
  work_type: 'feature',
  pipeline: 'implement',
  status: 'running',
  current_stage: null,
  spawned_by: 'shepherdr job nightly',
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

// One run per band, plus a second `running` row to prove ordering (not just
// membership): both are batch runs so silence -- not the interactive-sink
// rule already pinned in bands.test.ts -- is the only thing under test here.
const FIXTURE: RunSummary[] = [
  run({
    id: 'attn-1',
    attention: { needs: true, reason: 'stale', evidence: 'no event in 2h' },
  }),
  run({ id: 'running-noisy', last_event_at: 200 }),
  run({ id: 'running-quiet', last_event_at: 10 }),
  run({ id: 'finished-1', status: 'done', ended_at: 300, last_event_at: 250 }),
];

const runsGet = vi.fn();
const seenGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      runs: {
        $get: (...args: unknown[]) => runsGet(...args),
        ':repo': {
          ':runId': {
            $get: async () => ({
              ok: true,
              json: async () => ({
                run: FIXTURE[0],
                stages: [],
                fields: [],
                decisions: [],
                schemaAhead: false,
              }),
            }),
          },
        },
      },
      seen: { $get: (...args: unknown[]) => seenGet(...args) },
    },
  },
}));

const { RunBoard } = await import('./RunBoard');

beforeEach(() => {
  runsGet.mockResolvedValue({
    ok: true,
    json: async () => ({ runs: FIXTURE }),
  });
  seenGet.mockResolvedValue({ ok: true, json: async () => ({}) });
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RunBoard />
    </QueryClientProvider>
  );
}

describe('RunBoard', () => {
  it('sorts each run into the band its attention/ended_at fields imply', async () => {
    renderBoard();

    await waitFor(() =>
      expect(screen.getByTestId('run-row-attn-1')).toBeInTheDocument()
    );

    expect(
      within(screen.getByTestId('band-attention')).getByTestId('run-row-attn-1')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('band-running')).getByTestId(
        'run-row-running-noisy'
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('band-running')).getByTestId(
        'run-row-running-quiet'
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('band-finished')).getByTestId(
        'run-row-finished-1'
      )
    ).toBeInTheDocument();

    // A row lives in exactly one band.
    expect(
      within(screen.getByTestId('band-running')).queryByTestId('run-row-attn-1')
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('band-finished')).queryByTestId(
        'run-row-running-noisy'
      )
    ).not.toBeInTheDocument();
  });

  it('orders the running band by silence -- longest since last event first', async () => {
    renderBoard();

    await waitFor(() =>
      expect(screen.getByTestId('run-row-running-noisy')).toBeInTheDocument()
    );

    const rowIds = within(screen.getByTestId('band-running'))
      .getAllByTestId(/^run-row-/)
      .map(el => el.getAttribute('data-testid'));

    // `running-quiet` (last_event_at: 10) sits longer in silence than
    // `running-noisy` (last_event_at: 200), so it sorts first -- this would
    // fail if RunBoard fed bands in list order instead of through sortBand.
    expect(rowIds).toEqual(['run-row-running-quiet', 'run-row-running-noisy']);
  });

  it('sinks a run marked seen to the bottom of its band', async () => {
    // Without the seen map, `running-quiet` (last_event_at: 10) sorts ahead
    // of `running-noisy` (last_event_at: 200) on silence alone -- marking it
    // seen must override that and sink it instead, proving the board actually
    // reads `useSeen()` rather than rendering every row as unseen.
    seenGet.mockResolvedValue({
      ok: true,
      json: async () => ({ 'running-quiet': true }),
    });

    renderBoard();

    await waitFor(() =>
      expect(screen.getByTestId('run-row-running-noisy')).toBeInTheDocument()
    );

    const rowIds = within(screen.getByTestId('band-running'))
      .getAllByTestId(/^run-row-/)
      .map(el => el.getAttribute('data-testid'));

    expect(rowIds).toEqual(['run-row-running-noisy', 'run-row-running-quiet']);
  });

  it('caps the finished band at the 20 most recent, linking to search for the rest', async () => {
    const manyFinished = Array.from({ length: 25 }, (_, i) =>
      run({
        id: `finished-${i}`,
        status: 'done',
        ended_at: 1000,
        last_event_at: i,
      })
    );
    runsGet.mockResolvedValue({
      ok: true,
      json: async () => ({ runs: manyFinished }),
    });

    renderBoard();

    await waitFor(() =>
      expect(screen.getByTestId('run-row-finished-24')).toBeInTheDocument()
    );

    const rows = within(screen.getByTestId('band-finished')).getAllByTestId(
      /^run-row-/
    );
    expect(rows).toHaveLength(20);
    // "Most recent" is highest last_event_at -- finished-24..finished-5.
    expect(
      within(screen.getByTestId('band-finished')).getByTestId(
        'run-row-finished-24'
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('band-finished')).queryByTestId(
        'run-row-finished-4'
      )
    ).not.toBeInTheDocument();

    const seeAll = within(screen.getByTestId('band-finished')).getByRole(
      'link',
      { name: /see all 25 finished runs in search/i }
    );
    expect(seeAll).toHaveAttribute('href', '/search');
  });
});
