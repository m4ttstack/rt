import { Spotlight } from '@mattstack/app-kit/spotlight';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { RunSummary } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runsGet = vi.fn();
const useSettingsDefs = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      runs: { $get: (...args: unknown[]) => runsGet(...args) },
    },
  },
}));

vi.mock('../config/useSettings', () => ({
  useSettingsDefs: (...args: unknown[]) => useSettingsDefs(...args),
}));

const { ConsolePalette } = await import('./ConsolePalette');

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

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function renderPalette() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ConsolePalette />
    </QueryClientProvider>
  );
}

const originalClipboard = navigator.clipboard;

beforeEach(() => {
  useSettingsDefs.mockReturnValue({ data: undefined });
});

afterEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    value: originalClipboard,
    configurable: true,
  });
});

describe('ConsolePalette', () => {
  it('labels each run action "<ticket> — <repo> <status>" and lists the static actions', async () => {
    runsGet.mockResolvedValue(
      ok({
        runs: [
          run({ id: 'run-1', ticket: 'RT-44', status: 'failed' }),
          run({ id: 'run-2', repo: 'console', ticket: null, status: 'done' }),
        ],
      })
    );

    renderPalette();
    Spotlight.open();

    await screen.findByText('RT-44 — repo-tools failed');
    // No ticket recorded: falls back to the run id rather than dropping the row.
    expect(screen.getByText('run-2 — console done')).toBeInTheDocument();
    expect(screen.getByText('Run board')).toBeInTheDocument();
    expect(screen.getByText('Search runs')).toBeInTheDocument();
  });

  // The copy icon must not also trigger the row's own navigate action --
  // proven by asserting the URL never changes, not just that copy fired.
  it('copies the resume command from a run action without navigating', async () => {
    runsGet.mockResolvedValue(
      ok({ runs: [run({ id: 'run-1', ticket: 'RT-44', branch: 'feat/x' })] })
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const before = window.location.pathname;

    renderPalette();
    Spotlight.open();

    await screen.findByText('RT-44 — repo-tools failed');
    await userEvent.click(
      screen.getByRole('button', { name: 'copy to clipboard' })
    );

    expect(writeText).toHaveBeenCalledWith('git checkout feat/x');
    expect(window.location.pathname).toBe(before);
  });

  it('adds a config action per setting def, labeled "<key> — <description>", navigating to /config/:key', async () => {
    runsGet.mockResolvedValue(ok({ runs: [] }));
    useSettingsDefs.mockReturnValue({
      data: {
        defs: [
          { key: 'rt.runsPruneDays', description: 'Days before pruning.' },
          { key: 'rt.otherKey', description: 'Some other setting.' },
        ],
      },
    });

    renderPalette();
    Spotlight.open();

    const action = await screen.findByText(
      'rt.runsPruneDays — Days before pruning.'
    );
    expect(
      screen.getByText('rt.otherKey — Some other setting.')
    ).toBeInTheDocument();

    await userEvent.click(action);

    expect(window.location.pathname).toBe('/config/rt.runsPruneDays');
  });
});
