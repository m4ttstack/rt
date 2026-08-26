import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import type { SpineEntry } from '../outline';

const bindPost = vi.fn();
const surfaceApplyPost = vi.fn();
const compileGet = vi.fn();
const historyGet = vi.fn();
const diffGet = vi.fn();

vi.mock('../../api', () => ({
  client: {
    api: {
      skills: {
        bind: { $post: (...args: unknown[]) => bindPost(...args) },
        surface: {
          apply: { $post: (...args: unknown[]) => surfaceApplyPost(...args) },
        },
        compile: { $get: (...args: unknown[]) => compileGet(...args) },
        history: { $get: (...args: unknown[]) => historyGet(...args) },
        diff: { $get: (...args: unknown[]) => diffGet(...args) },
      },
    },
  },
}));

const { SkillDetailPanel } = await import('../SkillDetailPanel');
const { buildSpine } = await import('../outline');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}
function err(status: number, error: string) {
  return { ok: false, status, json: async () => ({ error }) };
}

/** A single roster verb with one bound slot, plus a second fill providing the
    same contract so Rebind has a real candidate to stage a command against. */
const COMPOSITION = {
  pack: 'demo',
  packDir: '/p',
  verbs: [
    {
      name: 'watch-ci',
      engine: 'watch-ci',
      engineRef: 'mattstack:watch-ci',
      plugin: 'mattstack',
      description: 'watch ci',
      public: true,
      sourcePath: '/plugins/mattstack/skills/watch-ci/SKILL.md',
      artifactPath: '/p/skills/watch-ci',
      slots: [
        {
          name: 'domain',
          contract: 'watch-ci-domain@1',
          required: false,
          boundTo: 'demo:watch-ci-domain',
          fillSourcePath: null,
          fillVersion: null,
          registered: false,
          inlined: true,
        },
      ],
    },
  ],
  fills: [
    {
      binding: 'demo:watch-ci-domain',
      provides: 'watch-ci-domain@1',
      sourcePath: '/fills/a/SKILL.md',
      registered: false,
    },
    {
      binding: 'other:watch-ci-domain',
      provides: 'watch-ci-domain@1',
      sourcePath: '/fills/b/SKILL.md',
      registered: false,
    },
  ],
  binders: [
    {
      ref: 'mattstack:watch-ci',
      verb: 'watch-ci',
      kind: 'verb' as const,
      slots: [{ name: 'domain', boundTo: 'demo:watch-ci-domain' }],
    },
  ],
  pipelines: { feature: [] as string[] },
};

const spine = buildSpine(
  COMPOSITION,
  {
    verbs: [
      { name: 'watch-ci', status: 'in-sync', staleFiles: [], orphanFiles: [] },
    ],
  },
  'feature'
);

/** watch-ci binds nothing the (empty) pipeline names, so it lands outside. */
const WATCH_CI = spine.outside.find(e => e.verb === 'watch-ci') as SpineEntry;

function renderPanel(
  overrides: Partial<Parameters<typeof SkillDetailPanel>[0]> = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <SkillDetailPanel
        pack="demo"
        entry={WATCH_CI}
        composition={COMPOSITION}
        bindingSites={spine.bindingSites}
        onClose={() => {}}
        onCopyContext={() => {}}
        onShowInMap={() => {}}
        {...overrides}
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SkillDetailPanel', () => {
  it('names the skill and offers the four sub-tabs', () => {
    renderPanel();

    const panel = screen.getByTestId('skill-detail-panel');
    expect(within(panel).getByText('watch-ci')).toBeInTheDocument();
    expect(within(panel).getByText('mattstack:watch-ci')).toBeInTheDocument();

    for (const label of [
      'Slots & bindings',
      'Compiled',
      'History',
      'Used by',
    ]) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });

  it('lists the skill slots on the default Slots & bindings tab', () => {
    renderPanel();

    const card = screen.getByTestId('slot-card-domain');
    expect(within(card).getByText('domain')).toBeInTheDocument();
    expect(within(card).getByText('watch-ci-domain@1')).toBeInTheDocument();
    expect(within(card).getByTestId('slot-fill')).toHaveTextContent(
      'demo:watch-ci-domain'
    );
  });

  it('opens the inline rebind editor with the staged rt skills bind command', async () => {
    const user = userEvent.setup();
    renderPanel();

    const card = screen.getByTestId('slot-card-domain');
    await user.click(within(card).getByTestId('rebind-slot'));

    const rebind = await within(card).findByTestId('rebind');
    // Reach the staged command: the reused Rebind stages it after its own
    // confirm step, then previews the exact `rt skills bind` it will run.
    await user.click(within(rebind).getByRole('button', { name: 'Rebind' }));

    expect(
      await within(rebind).findByText(
        'rt skills bind watch-ci domain other:watch-ci-domain --pack demo'
      )
    ).toBeInTheDocument();
  });

  it('runs the bind mutation when Apply is pressed', async () => {
    bindPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        pack: 'demo',
        verb: 'watch-ci',
        slot: 'domain',
        fill: 'other:watch-ci-domain',
        ok: true,
      }),
    });
    const user = userEvent.setup();
    renderPanel();

    const card = screen.getByTestId('slot-card-domain');
    await user.click(within(card).getByTestId('rebind-slot'));
    const rebind = await within(card).findByTestId('rebind');
    await user.click(within(rebind).getByRole('button', { name: 'Rebind' }));
    await user.click(within(rebind).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(bindPost).toHaveBeenCalledTimes(1));
    expect(bindPost.mock.calls[0][0]).toMatchObject({
      json: {
        pack: 'demo',
        verb: 'watch-ci',
        slot: 'domain',
        fill: 'other:watch-ci-domain',
      },
    });
  });
});

describe('SkillDetailPanel: the Compiled tab', () => {
  it('shows the compiled body for a verb, fetched for that pack and verb', async () => {
    compileGet.mockResolvedValue(ok({ content: '---\nname: watch-ci\n---\n' }));
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('tab', { name: 'Compiled' }));

    await waitFor(() =>
      expect(screen.getByTestId('compile-preview-body')).toHaveTextContent(
        'name: watch-ci'
      )
    );
    expect(compileGet.mock.calls[0][0]).toMatchObject({
      query: { pack: 'demo', verb: 'watch-ci' },
    });
  });

  it('renders the error rt reports, not a blank pane or a bare status', async () => {
    compileGet.mockResolvedValue(
      err(502, 'watch-ci: SKILL.md frontmatter is invalid YAML at line 4')
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('tab', { name: 'Compiled' }));

    await waitFor(() =>
      expect(screen.getByTestId('compile-preview-error')).toHaveTextContent(
        'invalid YAML at line 4'
      )
    );
    expect(screen.queryByText('502')).not.toBeInTheDocument();
  });

  it("states an internal verb's missing body as a fact, not as a failure", async () => {
    compileGet.mockResolvedValue(
      err(
        502,
        'rt: skipping plugin "current-time"\ninternal: watch-ci (not compiled; roster entry retired)'
      )
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('tab', { name: 'Compiled' }));

    const notice = await screen.findByTestId('compile-preview-internal');
    expect(notice).toHaveTextContent(
      'internal: watch-ci (not compiled; roster entry retired)'
    );
    expect(notice).not.toHaveTextContent('skipping plugin');
  });
});

describe('SkillDetailPanel: the History tab', () => {
  it('reads the verb history scoped to that verb', async () => {
    historyGet.mockResolvedValue(
      ok({
        pack: 'demo',
        packDir: '/p',
        repoRoot: '/repo',
        scope: 'skills/watch-ci',
        verb: 'watch-ci',
        limit: 20,
        truncated: false,
        commits: [],
        runtime: {
          dirtyFiles: [],
          moreDirtyFiles: false,
          packVersion: '0.4.11',
        },
      })
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('tab', { name: 'History' }));

    await waitFor(() =>
      expect(screen.getByTestId('history-empty')).toBeInTheDocument()
    );
    expect(historyGet.mock.calls[0][0]).toMatchObject({
      query: { pack: 'demo', verb: 'watch-ci' },
    });
  });
});

describe('SkillDetailPanel: the Used-by tab', () => {
  it("lists the binding sites of the skill's primary fill, single site included", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('tab', { name: 'Used by' }));

    // demo:watch-ci-domain is bound in exactly one place -- the watch-ci verb.
    // That single site restores the fill-click coverage Task 2 dropped when the
    // slot table left the pipeline rows.
    const index = await screen.findByTestId('inverse-index');
    expect(within(index).getByText('demo:watch-ci-domain')).toBeInTheDocument();
    expect(within(index).getByTestId('site-count')).toHaveTextContent('1');
    expect(within(index).getAllByTestId(/^binding-site-/)).toHaveLength(1);
  });

  it("switches to the Used-by tab focused on a slot's fill when its link is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    const card = screen.getByTestId('slot-card-domain');
    await user.click(within(card).getByTestId('slot-fill'));

    const index = await screen.findByTestId('inverse-index');
    expect(within(index).getByText('demo:watch-ci-domain')).toBeInTheDocument();
    expect(within(index).getByTestId('site-count')).toHaveTextContent('1');
  });

  it('answers a skill that binds nothing as bound by nothing rather than blank', async () => {
    const bare: SpineEntry = { ...WATCH_CI, slots: [] };
    const user = userEvent.setup();
    renderPanel({ entry: bare });

    await user.click(screen.getByRole('tab', { name: 'Used by' }));

    expect(screen.getByTestId('detail-usedby-empty')).toBeInTheDocument();
  });
});
