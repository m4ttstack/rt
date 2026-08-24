import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';

const historyGet = vi.fn();
const diffGet = vi.fn();
const compileGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      skills: {
        history: { $get: (...args: unknown[]) => historyGet(...args) },
        diff: { $get: (...args: unknown[]) => diffGet(...args) },
        compile: { $get: (...args: unknown[]) => compileGet(...args) },
      },
    },
  },
}));

const { VersionTimeline, relativeTime } = await import('./VersionTimeline');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}
function err(status: number, error: string) {
  return { ok: false, status, json: async () => ({ error }) };
}

function commit(shortSha: string, subject: string) {
  return {
    sha: shortSha.padEnd(40, '0'),
    shortSha,
    authoredAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    author: 'M',
    subject,
    files: ['mattstack/packs/demo/skills/watch-ci/SKILL.md'],
  };
}

const HISTORY = {
  pack: 'demo',
  packDir: '/p',
  repoRoot: '/repo',
  scope: 'skills/watch-ci',
  verb: 'watch-ci',
  limit: 20,
  truncated: false,
  commits: [
    commit('ed24bc4', 'pack: restamp self-referential fills at 0.4.11'),
    commit('17f8273', 'pack: 0.4.11 — compiled verbs carry run-DB state'),
    commit('d1c512c', 'pack: restamp at the registered 0.4.10 install'),
  ],
  runtime: { dirtyFiles: [], moreDirtyFiles: false, packVersion: '0.4.11' },
};

const BODY =
  '---\nname: "watch-ci"\n---\n' +
  '<!-- part: slot:domain binding=demo:watch-ci-domain version=0.4.11 path=attachments/watch-ci-domain/SKILL.md lines=13-161 -->\n' +
  'domain text\n';

const DIFF = [
  'diff --git a/attachments/watch-ci-domain/SKILL.md b/attachments/watch-ci-domain/SKILL.md',
  '--- a/attachments/watch-ci-domain/SKILL.md',
  '+++ b/attachments/watch-ci-domain/SKILL.md',
  '@@ -20,1 +20,2 @@ heading',
  ' gate',
  '+advisory',
  '',
].join('\n');

function renderTimeline(
  over: {
    verb?: string | null;
    health?: 'in-sync' | 'source-newer' | 'never-compiled' | 'unknown';
    staleFiles?: string[];
    onClose?: () => void;
  } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <VersionTimeline
        pack="demo"
        verb={over.verb === undefined ? 'watch-ci' : over.verb}
        refName="mattstack:watch-ci"
        health={over.health ?? 'in-sync'}
        staleFiles={over.staleFiles ?? []}
        onClose={over.onClose ?? (() => {})}
      />
    </QueryClientProvider>
  );
}

function mockHappyPath() {
  historyGet.mockResolvedValue(ok(HISTORY));
  diffGet.mockResolvedValue(
    ok({
      pack: 'demo',
      packDir: '/p',
      repoRoot: '/repo',
      scope: '.',
      from: '17f8273',
      to: 'ed24bc4',
      truncated: false,
      diff: DIFF,
    })
  );
  compileGet.mockResolvedValue(ok({ content: BODY }));
}

/** Both regions render from the same query, so waiting on a commit row is
    waiting on the whole panel having its data. */
async function openedHistory() {
  await waitFor(() =>
    expect(screen.getByTestId('commit-ed24bc4')).toBeInTheDocument()
  );
}

afterEach(() => vi.clearAllMocks());

describe('relativeTime', () => {
  const NOW = Date.parse('2026-08-24T12:00:00Z');

  it('reads a commit two days old as an age, not a date', () => {
    expect(relativeTime('2026-08-22T12:00:00Z', NOW)).toBe('2 days ago');
  });

  it('steps down to hours and minutes inside a day', () => {
    expect(relativeTime('2026-08-24T09:00:00Z', NOW)).toBe('3 hours ago');
    expect(relativeTime('2026-08-24T11:30:00Z', NOW)).toBe('30 minutes ago');
  });

  it('steps up to months and years', () => {
    expect(relativeTime('2026-05-24T12:00:00Z', NOW)).toBe('3 months ago');
    expect(relativeTime('2024-08-24T12:00:00Z', NOW)).toBe('2 years ago');
  });

  it('answers an unparseable stamp with the stamp, never with a wrong age', () => {
    expect(relativeTime('not a date', NOW)).toBe('not a date');
  });
});

describe('VersionTimeline: two kinds of truth, two regions', () => {
  it('keeps runtime facts out of the commit list entirely', async () => {
    mockHappyPath();
    renderTimeline();
    await openedHistory();

    const runtime = screen.getByTestId('runtime-facts');
    const commits = screen.getAllByTestId(/^commit-/);

    // The separation IS the assertion: no commit row inside the runtime
    // region, and no runtime row inside any commit.
    expect(within(runtime).queryAllByTestId(/^commit-/)).toHaveLength(0);
    for (const row of commits) {
      expect(within(row).queryAllByTestId(/^runtime-/)).toHaveLength(0);
      expect(runtime.contains(row)).toBe(false);
    }
  });

  it('labels the runtime region as this machine rather than as history', async () => {
    mockHappyPath();
    renderTimeline();
    await openedHistory();

    expect(screen.getByTestId('version-timeline')).toHaveTextContent(
      'Right now — this machine, not history'
    );
  });

  it('states the working tree, the installed version and the compiled output', async () => {
    mockHappyPath();
    renderTimeline();
    await openedHistory();

    expect(screen.getByTestId('runtime-working-tree')).toHaveTextContent(
      'clean under skills/watch-ci'
    );
    expect(screen.getByTestId('runtime-installed')).toHaveTextContent(
      'demo 0.4.11'
    );
    expect(screen.getByTestId('runtime-compiled-output')).toHaveTextContent(
      'matches its sources'
    );
  });

  it('reports an unmeasured working tree as unmeasured, never as clean', async () => {
    historyGet.mockResolvedValue(
      ok({
        ...HISTORY,
        runtime: { dirtyFiles: null, moreDirtyFiles: false, packVersion: null },
      })
    );
    renderTimeline();
    await openedHistory();

    expect(screen.getByTestId('runtime-working-tree')).toHaveTextContent(
      'not measured'
    );
    expect(screen.getByTestId('runtime-installed')).toHaveTextContent(
      'nothing states a version'
    );
  });

  it('names the files check flagged when the artifact is behind its sources', async () => {
    mockHappyPath();
    renderTimeline({ health: 'source-newer', staleFiles: ['SKILL.md'] });
    await openedHistory();

    expect(screen.getByTestId('runtime-compiled-output')).toHaveTextContent(
      'SKILL.md on disk is older than its sources'
    );
  });
});

describe('VersionTimeline: the history region', () => {
  it('names the command and the pathspec the log was taken over', async () => {
    mockHappyPath();
    renderTimeline();
    await openedHistory();

    expect(screen.getByTestId('command-provenance')).toHaveTextContent(
      'git log -- skills/watch-ci'
    );
  });

  it('lists each commit with its sha, age and subject', async () => {
    mockHappyPath();
    renderTimeline();
    await openedHistory();

    const row = screen.getByTestId('commit-17f8273');
    expect(row).toHaveTextContent('2 days ago');
    expect(row).toHaveTextContent('compiled verbs carry run-DB state');
    expect(screen.getByTestId('history-count')).toHaveTextContent(
      'History — 3 of 20 requested'
    );
  });

  it('says the pack repo does not hold the step source, where it is read', async () => {
    mockHappyPath();
    renderTimeline();
    await openedHistory();

    expect(screen.getByTestId('version-timeline')).toHaveTextContent(
      "The step's own source lives in the mattstack plugin, a different repo"
    );
  });

  it('renders nothing until a verb is selected', () => {
    mockHappyPath();
    renderTimeline({ verb: null });

    expect(screen.queryByTestId('runtime-facts')).not.toBeInTheDocument();
    expect(historyGet).not.toHaveBeenCalled();
  });
});

describe('VersionTimeline: compare', () => {
  it('waits for exactly two commits before it will compare', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderTimeline();
    await openedHistory();

    expect(screen.getByTestId('compare-commits')).toBeDisabled();

    await user.click(
      within(screen.getByTestId('commit-ed24bc4')).getByRole('checkbox')
    );
    expect(screen.getByTestId('compare-commits')).toBeDisabled();

    await user.click(
      within(screen.getByTestId('commit-17f8273')).getByRole('checkbox')
    );
    expect(screen.getByTestId('compare-commits')).toBeEnabled();
  });

  it('diffs from the older end to the newer one, whatever order they were picked', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderTimeline();
    await openedHistory();

    // Newest first, so ed24bc4 is picked before the older 17f8273.
    await user.click(
      within(screen.getByTestId('commit-ed24bc4')).getByRole('checkbox')
    );
    await user.click(
      within(screen.getByTestId('commit-17f8273')).getByRole('checkbox')
    );
    await user.click(screen.getByTestId('compare-commits'));

    await waitFor(() => expect(diffGet).toHaveBeenCalled());
    expect(diffGet.mock.calls[0][0]).toMatchObject({
      query: { pack: 'demo', from: '17f8273', to: 'ed24bc4' },
    });
  });

  it('shows the compared hunks under their seams, and names the diff it ran', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderTimeline();
    await openedHistory();

    await user.click(
      within(screen.getByTestId('commit-ed24bc4')).getByRole('checkbox')
    );
    await user.click(
      within(screen.getByTestId('commit-17f8273')).getByRole('checkbox')
    );
    await user.click(screen.getByTestId('compare-commits'));

    await waitFor(() =>
      expect(screen.getByTestId('seam-compare')).toBeInTheDocument()
    );
    expect(screen.getByTestId('command-provenance')).toHaveTextContent(
      'git diff 17f8273..ed24bc4 -- .'
    );
    expect(screen.getByTestId('attributed-hunk')).toHaveTextContent(
      'demo:watch-ci-domain'
    );
    // The history region is gone, not merged in beneath the diff.
    expect(screen.queryByTestId('runtime-facts')).not.toBeInTheDocument();
  });

  it('says no hunk can be attributed when there is no compiled body to read', async () => {
    mockHappyPath();
    compileGet.mockResolvedValue(
      err(502, 'internal: no artifact for this verb')
    );
    const user = userEvent.setup();
    renderTimeline();
    await openedHistory();

    await user.click(
      within(screen.getByTestId('commit-ed24bc4')).getByRole('checkbox')
    );
    await user.click(
      within(screen.getByTestId('commit-17f8273')).getByRole('checkbox')
    );
    await user.click(screen.getByTestId('compare-commits'));

    await waitFor(() =>
      expect(screen.getByTestId('no-seams')).toBeInTheDocument()
    );
    expect(screen.getByTestId('no-seams')).toHaveTextContent(
      'no hunk below can be attributed to a seam'
    );
  });

  it('goes back to the history region rather than closing the drawer', async () => {
    mockHappyPath();
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderTimeline({ onClose });
    await openedHistory();

    await user.click(
      within(screen.getByTestId('commit-ed24bc4')).getByRole('checkbox')
    );
    await user.click(
      within(screen.getByTestId('commit-17f8273')).getByRole('checkbox')
    );
    await user.click(screen.getByTestId('compare-commits'));
    await waitFor(() =>
      expect(screen.getByTestId('seam-compare')).toBeInTheDocument()
    );

    await user.click(screen.getByLabelText('Back to history'));

    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('runtime-facts')).toBeInTheDocument()
    );
  });
});
