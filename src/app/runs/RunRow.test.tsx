import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { BranchEnrichment } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardRun } from './bands';

const detailGet = vi.fn();
const focusPost = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      runs: {
        ':repo': {
          ':runId': {
            $get: (...args: unknown[]) => detailGet(...args),
          },
        },
      },
      panes: {
        ':id': {
          focus: { $post: (...args: unknown[]) => focusPost(...args) },
        },
      },
    },
  },
}));

const { RunRow } = await import('./RunRow');

const baseRun: BoardRun = {
  id: 'run-1',
  repo: 'repo-tools',
  work_type: 'feature',
  pipeline: 'implement',
  status: 'running',
  current_stage: null,
  spawned_by: null,
  started_at: 0,
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: 0,
  ticket: 'RT-1',
  branch: 'feat/x',
  seen: false,
};

const enrichedMr: BranchEnrichment = {
  ticket: {
    identifier: 'RT-1',
    title: 'Redesign the board row',
    url: 'https://linear.app/acme/issue/RT-1',
  },
  mr: {
    iid: 42,
    webUrl: 'https://example.com/pr/42',
    state: 'opened',
    pipeline: null,
  },
  fetchedAt: 0,
};

function detailResponse(fields: Array<{ key: string; value: string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      run: baseRun,
      stages: [],
      fields: fields.map(f => ({ ...f, produced_by: 'test', at: 0 })),
      decisions: [],
      schemaAhead: false,
    }),
  };
}

function renderRow(
  run: BoardRun,
  opts: { pruneDays?: number; enrichment?: BranchEnrichment } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RunRow
        run={run}
        pruneDays={opts.pruneDays}
        enrichment={opts.enrichment}
      />
    </QueryClientProvider>
  );
}

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: 'run actions' }));
}

const originalClipboard = navigator.clipboard;
const originalOpen = window.open;

afterEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    value: originalClipboard,
    configurable: true,
  });
  window.open = originalOpen;
  window.history.replaceState(null, '', '/');
});

describe('RunRow board redesign', () => {
  it('renders the enriched Linear title next to the ticket id', () => {
    renderRow(baseRun, { enrichment: enrichedMr });

    expect(screen.getByText('RT-1')).toBeInTheDocument();
    expect(screen.getByText('Redesign the board row')).toBeInTheDocument();
  });

  it('omits the title entirely when enrich has no entry for the branch', () => {
    renderRow(baseRun, { enrichment: undefined });

    expect(screen.getByText('RT-1')).toBeInTheDocument();
    expect(
      screen.queryByText('Redesign the board row')
    ).not.toBeInTheDocument();
  });

  it('renders repoLabel and branch, appending the MR when enriched', () => {
    renderRow(baseRun, { enrichment: enrichedMr });

    expect(
      screen.getByText('repo-tools · feat/x · MR !42 opened')
    ).toBeInTheDocument();
  });

  it('renders repoLabel and branch with no MR suffix when unenriched', () => {
    renderRow(baseRun);

    expect(screen.getByText('repo-tools · feat/x')).toBeInTheDocument();
  });

  it('shows the current stage name, elapsed time, and StageProgress', () => {
    const run: BoardRun = {
      ...baseRun,
      current_stage: 'implement',
      stages: [
        { name: 'plan', status: 'done', started_at: 1_000 },
        { name: 'implement', status: 'running', started_at: 2_000 },
      ],
    };
    renderRow(run);

    expect(screen.getByText('implement')).toBeInTheDocument();
    expect(screen.getByTestId('stage-progress')).toBeInTheDocument();
  });

  it('falls back to "not started" with no current stage', () => {
    renderRow(baseRun);
    expect(screen.getByText('not started')).toBeInTheDocument();
  });

  it('deletes the old standalone action icons -- only the ellipsis trigger remains', () => {
    const { getByTestId } = renderRow(baseRun, { enrichment: enrichedMr });
    const row = getByTestId('run-row-run-1');

    expect(within(row).getAllByRole('button')).toHaveLength(1);
    expect(
      within(row).getByRole('button', { name: 'run actions' })
    ).toBeInTheDocument();
  });

  it('opens exactly one menu with the four labeled items', async () => {
    renderRow(baseRun, { enrichment: enrichedMr });

    await openMenu();

    expect(
      screen.getByRole('menuitem', { name: 'Open MR' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Open ticket' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Copy worktree path' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Copy branch' })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
  });

  it('disables Open MR and Open ticket when the branch has no enrichment', async () => {
    renderRow(baseRun);

    await openMenu();

    expect(screen.getByRole('menuitem', { name: 'Open MR' })).toBeDisabled();
    expect(
      screen.getByRole('menuitem', { name: 'Open ticket' })
    ).toBeDisabled();
  });

  it('disables Copy branch when the run has no branch', async () => {
    renderRow({ ...baseRun, branch: null });

    await openMenu();

    expect(
      screen.getByRole('menuitem', { name: 'Copy branch' })
    ).toBeDisabled();
  });

  it('navigates to the run detail page on a row click outside the menu', async () => {
    renderRow(baseRun);

    await userEvent.click(screen.getByText('RT-1'));

    expect(window.location.pathname).toBe('/runs/repo-tools/run-1');
  });

  it('exposes the ticket-id/title text as a real link to the run detail page', () => {
    const { getByTestId } = renderRow(baseRun, { enrichment: enrichedMr });
    const row = getByTestId('run-row-run-1');

    const link = within(row).getByRole('link', { name: /RT-1/ });
    expect(link).toHaveAttribute('href', '/runs/repo-tools/run-1');
  });

  it('does not navigate when opening the actions menu', async () => {
    renderRow(baseRun);

    await openMenu();

    expect(window.location.pathname).toBe('/');
    expect(
      screen.getByRole('menuitem', { name: 'Copy worktree path' })
    ).toBeInTheDocument();
  });
});

describe('RunRow menu actions', () => {
  it('opens the MR in a new tab using the enriched MR url', async () => {
    renderRow(baseRun, { enrichment: enrichedMr });
    window.open = vi.fn();

    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open MR' }));

    expect(window.open).toHaveBeenCalledWith(
      'https://example.com/pr/42',
      '_blank',
      'noopener'
    );
  });

  it('opens the ticket in a new tab using the enriched ticket url', async () => {
    renderRow(baseRun, { enrichment: enrichedMr });
    window.open = vi.fn();

    await openMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Open ticket' })
    );

    expect(window.open).toHaveBeenCalledWith(
      'https://linear.app/acme/issue/RT-1',
      '_blank',
      'noopener'
    );
  });

  it('copies the raw branch name via Copy branch', async () => {
    renderRow(baseRun);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    await openMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Copy branch' })
    );

    expect(writeText).toHaveBeenCalledWith('feat/x');
  });

  // Regression: `Menu.Dropdown` is portalled, but React re-dispatches its
  // bubbling clicks along the REACT tree (not the DOM tree the portal
  // actually renders into), so an item click still reached the row's
  // onClick and navigated to the detail page underneath the copy.
  it('does not also navigate the row when a menu item is clicked', async () => {
    renderRow(baseRun);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    await openMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Copy branch' })
    );

    expect(writeText).toHaveBeenCalledWith('feat/x');
    expect(window.location.pathname).toBe('/');
  });

  it('tells the user nothing is recorded yet rather than opening anything', async () => {
    detailGet.mockResolvedValueOnce(detailResponse([]));
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderRow(baseRun);
    await openMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Copy worktree path' })
    );

    await screen.findByText('No worktree recorded for this run yet.');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('surfaces a failed detail fetch instead of failing silently', async () => {
    detailGet.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'daemon down' }),
    });

    renderRow(baseRun);
    await openMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Copy worktree path' })
    );

    await screen.findByText(
      /Could not copy worktree path: run detail failed: 502/
    );
  });

  // `window.open('file://...')` is silently refused by the browser from an
  // http(s) origin (verified against this app's own serving context -- no
  // tab, no error the user sees). Clipboard is the only handoff that
  // actually works, so the worktree action must copy, never open.
  it('copies the worktree path to the clipboard instead of opening a file:// link', async () => {
    detailGet.mockResolvedValueOnce(
      detailResponse([
        { key: 'worktree', value: '/Users/matt/work/repo-tools-wt' },
      ])
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderRow(baseRun);
    await openMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Copy worktree path' })
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('/Users/matt/work/repo-tools-wt')
    );
  });

  // The menu closes on each item click, so reusing the worktree action means
  // reopening it -- this is what proves the SAME `['run', repo, runId]`
  // query still gets reused rather than issuing a fresh detail request
  // every time, now that the fetch lives behind a menu item instead of a
  // standalone button.
  it('reuses the cached detail fetch across repeated worktree copies', async () => {
    detailGet.mockResolvedValue(
      detailResponse([
        { key: 'worktree', value: '/Users/matt/work/repo-tools-wt' },
      ])
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderRow(baseRun);

    await openMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Copy worktree path' })
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    await openMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Copy worktree path' })
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

    expect(detailGet).toHaveBeenCalledTimes(1);
  });
});

describe('RunRow focus button', () => {
  it('renders for a working run with an attributed pane', () => {
    renderRow({
      ...baseRun,
      agent: { status: 'working', pane: 'w1:p1' },
    });

    expect(
      screen.getByRole('button', { name: 'focus pane' })
    ).toBeInTheDocument();
  });

  it('is absent when the run has no agent', () => {
    renderRow({ ...baseRun, agent: null });

    expect(
      screen.queryByRole('button', { name: 'focus pane' })
    ).not.toBeInTheDocument();
  });

  it('is absent once the run is done', () => {
    renderRow({
      ...baseRun,
      agent: { status: 'done', pane: 'w1:p1' },
    });

    expect(
      screen.queryByRole('button', { name: 'focus pane' })
    ).not.toBeInTheDocument();
  });

  it('raises the attributed pane via the typed client', async () => {
    focusPost.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ paneId: 'w1:p1', focused: true }),
    });
    renderRow({
      ...baseRun,
      agent: { status: 'working', pane: 'w1:p1' },
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'focus pane' })
    );

    expect(focusPost).toHaveBeenCalledWith({ param: { id: 'w1:p1' } });
  });

  it('shows an error notification when the focus request fails', async () => {
    focusPost.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'no such pane' }),
    });
    renderRow({
      ...baseRun,
      agent: { status: 'working', pane: 'w1:p1' },
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'focus pane' })
    );

    await screen.findByText("couldn't focus the pane");
  });

  it('does not also navigate the row when the focus button is clicked', async () => {
    focusPost.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ paneId: 'w1:p1', focused: true }),
    });
    renderRow({
      ...baseRun,
      agent: { status: 'working', pane: 'w1:p1' },
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'focus pane' })
    );

    expect(window.location.pathname).toBe('/');
  });
});

describe('RunRow aging warning', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('warns once a finished run is close to the retention floor', () => {
    const now = Date.now();
    const run: BoardRun = {
      ...baseRun,
      status: 'done',
      ended_at: now - 28 * DAY_MS,
      last_event_at: now - 28 * DAY_MS,
    };

    renderRow(run, { pruneDays: 30 });

    expect(screen.getByTestId('aging-warning')).toHaveTextContent(
      'ages out in 2 days'
    );
  });

  it('stays quiet for a run nowhere near the floor', () => {
    const now = Date.now();
    const run: BoardRun = {
      ...baseRun,
      status: 'done',
      ended_at: now - 2 * DAY_MS,
      last_event_at: now - 2 * DAY_MS,
    };

    renderRow(run, { pruneDays: 30 });

    expect(screen.queryByTestId('aging-warning')).not.toBeInTheDocument();
  });

  it('stays quiet before the prune-days setting has loaded', () => {
    const now = Date.now();
    const run: BoardRun = {
      ...baseRun,
      status: 'done',
      ended_at: now - 29 * DAY_MS,
      last_event_at: now - 29 * DAY_MS,
    };

    renderRow(run, { pruneDays: undefined });

    expect(screen.queryByTestId('aging-warning')).not.toBeInTheDocument();
  });
});

it('labels a finished row with total runtime, not the last-event sliver', () => {
  const twoHours = 2 * 60 * 60 * 1000;
  const run = {
    ...baseRun,
    status: 'done',
    started_at: Date.now() - twoHours,
    ended_at: Date.now(),
    last_event_at: Date.now() - 30_000,
  };
  renderRow(run);
  expect(screen.getByText(/2h/)).toBeInTheDocument();
});
