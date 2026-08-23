import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import type { BoardRun } from './bands';

const detailGet = vi.fn();

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

const originalClipboard = navigator.clipboard;
const originalOpen = window.open;

afterEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    value: originalClipboard,
    configurable: true,
  });
  window.open = originalOpen;
});

// These three cases are RunRow's only branches with real async behaviour --
// the rest of the component is pure render. Each assertion pins a path that
// silently doing the wrong thing (opening nothing, opening a dead link,
// staying quiet about a failure) would still leave "looking fine" without it.
describe('RunRow outward actions', () => {
  it('opens the MR in a new tab once the detail fetch resolves a real url', async () => {
    detailGet.mockResolvedValueOnce(
      detailResponse([{ key: 'mr', value: 'https://example.com/pr/1' }])
    );
    window.open = vi.fn();

    renderWithProviders(<RunRow run={baseRun} />);
    await userEvent.click(screen.getByRole('button', { name: 'open MR' }));

    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        'https://example.com/pr/1',
        '_blank',
        'noopener'
      )
    );
  });

  it('tells the user nothing is recorded yet rather than opening anything', async () => {
    detailGet.mockResolvedValueOnce(detailResponse([]));
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    window.open = vi.fn();

    renderWithProviders(<RunRow run={baseRun} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'copy worktree path' })
    );

    await screen.findByText('No worktree recorded for this run yet.');
    expect(writeText).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('surfaces a failed detail fetch instead of failing silently', async () => {
    detailGet.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'daemon down' }),
    });
    window.open = vi.fn();

    renderWithProviders(<RunRow run={baseRun} />);
    await userEvent.click(screen.getByRole('button', { name: 'open MR' }));

    await screen.findByText(/Could not open MR: run detail failed: 502/);
    expect(window.open).not.toHaveBeenCalled();
  });

  // Finding: `window.open('file://...')` is silently refused by the browser
  // from an http(s) origin (verified against this app's own serving
  // context -- no tab, no error the user sees). Clipboard is the only
  // handoff that actually works, so the worktree action must copy, never open.
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
    window.open = vi.fn();

    renderWithProviders(<RunRow run={baseRun} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'copy worktree path' })
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('/Users/matt/work/repo-tools-wt')
    );
    expect(window.open).not.toHaveBeenCalled();
  });
});
