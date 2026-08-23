import type {
  RunDetail as RunDetailData,
  RunSummary,
} from '@mattstack/rt-client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Spotlight } from '@ui/spotlight';
import { renderWithProviders } from '@ui/storybook/test-utils';

const runsGet = vi.fn();
const detailGet = vi.fn();
const artifactGet = vi.fn();
const seenGet = vi.fn();
const seenPost = vi.fn();

vi.mock('./api', () => ({
  client: {
    api: {
      runs: {
        $get: (...args: unknown[]) => runsGet(...args),
        ':repo': {
          ':runId': {
            $get: (...args: unknown[]) => detailGet(...args),
            artifact: { $get: (...args: unknown[]) => artifactGet(...args) },
          },
        },
      },
      seen: {
        $get: (...args: unknown[]) => seenGet(...args),
        ':runId': { $post: (...args: unknown[]) => seenPost(...args) },
      },
    },
  },
}));

const { App } = await import('./App');

const run = (): RunSummary => ({
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
});

const DETAIL: RunDetailData = {
  run: run(),
  stages: [],
  fields: [
    { key: 'ticket', value: 'RT-1', produced_by: 'provision', at: 1 },
    { key: 'branch', value: 'feat/x', produced_by: 'provision', at: 2 },
  ],
  decisions: [],
  schemaAhead: false,
};

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('App keyboard contract', () => {
  // The single-key handoff copies (t/b/w/m/c) live on the run detail view and
  // must not fire while the palette's own search input has focus. Spotlight
  // traps its own keys via a real <input>, and useHotkeys' default
  // tagsToIgnore already excludes INPUT -- this proves that combination
  // actually holds end to end, rather than assuming it from reading either
  // library's source separately.
  it('types "b" into the open palette instead of firing the branch-copy hotkey', async () => {
    window.history.pushState(null, '', '/runs/repo-tools/run-1');
    runsGet.mockResolvedValue(ok({ runs: [run()] }));
    detailGet.mockResolvedValue(ok(DETAIL));
    artifactGet.mockResolvedValue(ok({ lines: [], truncated: false }));
    seenGet.mockResolvedValue(ok({}));
    seenPost.mockResolvedValue(ok({}));

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithProviders(<App />);

    // Detail view is live and its hotkeys are registered.
    await screen.findByTestId('handoff-card');

    Spotlight.open();
    const input = await screen.findByPlaceholderText(
      'Search runs, or jump to a page…'
    );
    input.focus();

    await userEvent.keyboard('b');

    expect(input).toHaveValue('b');
    await waitFor(() => expect(writeText).not.toHaveBeenCalled());
  });
});
