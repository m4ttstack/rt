import type { RunSummary } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';

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
const enrichPost = vi.fn();

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
        enrich: { $post: (...args: unknown[]) => enrichPost(...args) },
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
  enrichPost.mockResolvedValue({ ok: true, json: async () => ({}) });
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RunBoard />
    </QueryClientProvider>
  );
  return { ...result, queryClient };
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

  it('names the rt verb that produced the board', async () => {
    renderBoard();

    expect(await screen.findByTestId('command-provenance')).toHaveTextContent(
      'rt runs'
    );
  });

  describe('the quiet-update pill', () => {
    it('shows no pill for the initial population', async () => {
      renderBoard();

      await waitFor(() =>
        expect(screen.getByTestId('run-row-attn-1')).toBeInTheDocument()
      );

      expect(screen.queryByTestId('board-update-pill')).not.toBeInTheDocument();
    });

    it('holds a band change behind a pill -- the row does not move until the pill is clicked', async () => {
      const { queryClient } = renderBoard();

      await waitFor(() =>
        expect(
          within(screen.getByTestId('band-running')).getByTestId(
            'run-row-running-noisy'
          )
        ).toBeInTheDocument()
      );

      // rt now flags running-noisy into attention -- the daemon event this
      // simulates would, pre-fix, teleport the row into a different band the
      // instant it arrived.
      const updated = FIXTURE.map(r =>
        r.id === 'running-noisy'
          ? {
              ...r,
              attention: {
                needs: true,
                reason: 'failed' as const,
                evidence: 'exit 1',
              },
            }
          : r
      );
      runsGet.mockResolvedValue({
        ok: true,
        json: async () => ({ runs: updated }),
      });
      await queryClient.invalidateQueries({ queryKey: ['runs', null] });

      await waitFor(() =>
        expect(screen.getByTestId('board-update-pill')).toHaveTextContent(
          '1 run moved to needs attention'
        )
      );

      // Still in `running`, not yet in `attention` -- this is the assertion
      // that actually pins the law; the pill appearing alone would not.
      expect(
        within(screen.getByTestId('band-running')).getByTestId(
          'run-row-running-noisy'
        )
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId('band-attention')).queryByTestId(
          'run-row-running-noisy'
        )
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByTestId('board-update-pill'));

      await waitFor(() =>
        expect(
          within(screen.getByTestId('band-attention')).getByTestId(
            'run-row-running-noisy'
          )
        ).toBeInTheDocument()
      );
      expect(
        within(screen.getByTestId('band-running')).queryByTestId(
          'run-row-running-noisy'
        )
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId('board-update-pill')).not.toBeInTheDocument();
    });

    it('updates an unchanged row´s fields in place without waiting for the pill', async () => {
      const { queryClient } = renderBoard();

      await waitFor(() =>
        expect(screen.getByTestId('run-row-running-noisy')).toBeInTheDocument()
      );
      expect(
        within(screen.getByTestId('run-row-running-noisy')).getByText(
          'not started'
        )
      ).toBeInTheDocument();

      // Same band, same rank -- only a field changed, so this is exactly the
      // "in-place" case the law carves out, not a reorder.
      const updated = FIXTURE.map(r =>
        r.id === 'running-noisy' ? { ...r, current_stage: 'provision' } : r
      );
      runsGet.mockResolvedValue({
        ok: true,
        json: async () => ({ runs: updated }),
      });
      await queryClient.invalidateQueries({ queryKey: ['runs', null] });

      await waitFor(() =>
        expect(
          within(screen.getByTestId('run-row-running-noisy')).getByText(
            'provision'
          )
        ).toBeInTheDocument()
      );
      expect(screen.queryByTestId('board-update-pill')).not.toBeInTheDocument();
    });
  });

  describe('the enrich join', () => {
    it('issues one batched request for every visible branch and threads results into the matching row', async () => {
      const runsWithBranches: RunSummary[] = [
        run({ id: 'a', branch: 'feat/a', ticket: 'RT-1' }),
        run({ id: 'b', branch: 'feat/b', ticket: 'RT-2', last_event_at: 5 }),
      ];
      runsGet.mockResolvedValue({
        ok: true,
        json: async () => ({ runs: runsWithBranches }),
      });
      enrichPost.mockResolvedValue({
        ok: true,
        json: async () => ({
          'feat/a': {
            ticket: {
              identifier: 'RT-1',
              title: 'Board redesign',
              url: 'https://linear.app/x',
            },
            mr: null,
            fetchedAt: 0,
          },
        }),
      });

      renderBoard();

      await waitFor(() =>
        expect(screen.getByText('Board redesign')).toBeInTheDocument()
      );

      // Alphabetical: `useRunsEnrich` dedupes and sorts before requesting, so
      // this holds regardless of which order the board discovered the runs in.
      expect(enrichPost).toHaveBeenCalledTimes(1);
      expect(enrichPost).toHaveBeenCalledWith({
        json: { branches: ['feat/a', 'feat/b'] },
      });

      // `feat/b` has no entry in the enrich response -- its row renders with
      // no title, not a second request retrying for it.
      expect(
        within(screen.getByTestId('run-row-b')).queryByText('Board redesign')
      ).not.toBeInTheDocument();
    });

    it('skips the request entirely when no visible run has a branch', async () => {
      renderBoard();

      await waitFor(() =>
        expect(screen.getByTestId('run-row-attn-1')).toBeInTheDocument()
      );

      expect(enrichPost).not.toHaveBeenCalled();
    });
  });
});
