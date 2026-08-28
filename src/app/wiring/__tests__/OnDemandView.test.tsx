import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const packsGet = vi.fn();
const compositionGet = vi.fn();
const checkGet = vi.fn();
const bindPost = vi.fn();

vi.mock('../../api', () => ({
  client: {
    api: {
      skills: {
        packs: { $get: (...args: unknown[]) => packsGet(...args) },
        composition: { $get: (...args: unknown[]) => compositionGet(...args) },
        check: { $get: (...args: unknown[]) => checkGet(...args) },
        surface: {
          $get: () => Promise.resolve({ ok: true, json: async () => ({}) }),
          apply: {
            $post: () => Promise.resolve({ ok: true, json: async () => ({}) }),
          },
        },
        bind: { $post: (...args: unknown[]) => bindPost(...args) },
        compile: {
          $get: () =>
            Promise.resolve({
              ok: false,
              status: 502,
              json: async () => ({ error: 'not used' }),
            }),
        },
        history: {
          $get: () => Promise.resolve({ ok: true, json: async () => ({}) }),
        },
        diff: {
          $get: () => Promise.resolve({ ok: true, json: async () => ({}) }),
        },
      },
    },
  },
}));

const { WiringMap } = await import('../WiringMap');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

/**
 * `watch-ci` is Group 1 (invocable, wired, not external, not unwired):
 * bound by a `verb` binder AND the same fill a pipeline stage binds, so its
 * Used-by list carries two sites. `mr-board:review` is Group 2 (another
 * plugin). `rebase-worktree` is Group 3 (unwired -- no binder, no pipeline).
 * `demo:unused` is a fill nothing binds at all, counted into Group 3's
 * pointer alongside the unwired verb.
 */
const COMPOSITION = {
  pack: 'demo',
  packDir: '/p',
  verbs: [
    {
      name: 'work',
      engine: 'work',
      engineRef: 'mattstack:work',
      plugin: 'mattstack',
      description: 'the orchestrator',
      public: true,
      sourcePath: '/plugins/mattstack/attachments/pipeline/work/SKILL.md',
      artifactPath: '/p/skills/work',
      slots: [],
    },
    {
      name: 'watch-ci',
      engine: 'watch-ci',
      engineRef: 'mattstack:watch-ci',
      plugin: 'mattstack',
      description: 'watch ci',
      public: true,
      sourcePath: '/plugins/mattstack/skills/pipeline/watch-ci/SKILL.md',
      artifactPath: '/p/skills/watch-ci',
      slots: [
        {
          name: 'domain',
          contract: 'watch-ci-domain@1',
          required: false,
          boundTo: 'demo:watch-ci-domain',
          fillSourcePath: '/fills/watch-ci-domain/SKILL.md',
          fillVersion: '0.4.11',
          registered: false,
          inlined: true,
        },
      ],
    },
    {
      name: 'rebase-worktree',
      engine: 'rebase-worktree',
      engineRef: 'mattstack:rebase-worktree',
      plugin: 'mattstack',
      description: 'rebase a worktree',
      public: true,
      sourcePath: '/plugins/mattstack/skills/rebase-worktree/SKILL.md',
      artifactPath: '/p/skills/rebase-worktree',
      slots: [],
    },
  ],
  fills: [
    {
      binding: 'demo:watch-ci-domain',
      provides: 'watch-ci-domain@1',
      sourcePath: '/fills/watch-ci-domain/SKILL.md',
      registered: false,
    },
    {
      binding: 'demo:mr-board-review',
      provides: 'mr-review@1',
      sourcePath: '/fills/mr-board-review/SKILL.md',
      registered: false,
    },
    {
      binding: 'demo:unused',
      provides: 'unused@1',
      sourcePath: '/fills/unused/SKILL.md',
      registered: false,
    },
  ],
  binders: [
    {
      ref: 'mattstack:watch-ci',
      verb: 'watch-ci',
      kind: 'verb',
      slots: [{ name: 'domain', boundTo: 'demo:watch-ci-domain' }],
    },
    {
      ref: 'mattstack:stage-watch-ci',
      verb: null,
      kind: 'stage',
      slots: [{ name: 'domain', boundTo: 'demo:watch-ci-domain' }],
    },
    {
      ref: 'mr-board:review',
      verb: null,
      kind: 'external',
      slots: [{ name: 'skill', boundTo: 'demo:mr-board-review' }],
    },
  ],
  pipelines: {
    feature: ['mattstack:stage-watch-ci'],
  },
};

const CHECK = {
  pack: 'demo',
  packDir: '/p',
  verbs: [
    { name: 'work', status: 'in-sync', staleFiles: [], orphanFiles: [] },
    { name: 'watch-ci', status: 'in-sync', staleFiles: [], orphanFiles: [] },
    {
      name: 'rebase-worktree',
      status: 'stale',
      staleFiles: ['SKILL.md'],
      orphanFiles: [],
    },
  ],
};

function renderWiring() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <WiringMap />
    </QueryClientProvider>
  );
}

function mockHappyPath() {
  packsGet.mockResolvedValue(
    ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
  );
  compositionGet.mockResolvedValue(ok(COMPOSITION));
  checkGet.mockResolvedValue(ok(CHECK));
}

async function openOnDemandTab(user: ReturnType<typeof userEvent.setup>) {
  renderWiring();
  await screen.findByTestId('wiring-timeline');
  await user.click(screen.getByRole('tab', { name: 'On-demand' }));
  return screen.findByTestId('ondemand-split');
}

afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('OnDemandView: Group 1 (invocable verbs)', () => {
  it('lists watch-ci and hides the unwired and external rows', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    const view = await openOnDemandTab(user);

    expect(
      within(view).getByTestId('skill-row-mattstack:watch-ci')
    ).toBeInTheDocument();
    expect(
      within(view).queryByTestId('skill-row-mattstack:rebase-worktree')
    ).not.toBeInTheDocument();
    expect(
      within(view).queryByTestId('skill-row-external:mr-board')
    ).not.toBeInTheDocument();
  });

  it('opens the same detail panel a pipeline row opens', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    await openOnDemandTab(user);

    await user.click(
      await screen.findByRole('button', { name: 'open watch-ci' })
    );

    const panel = await screen.findByTestId('skill-detail-panel');
    expect(within(panel).getByText('watch-ci')).toBeInTheDocument();
  });

  it('shows every slot open, with the fill and how many sites bind it', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    await openOnDemandTab(user);

    await user.click(
      await screen.findByRole('button', { name: 'open watch-ci' })
    );
    const panel = await screen.findByTestId('skill-detail-panel');
    const card = within(panel).getByTestId('slot-card-domain');

    expect(within(card).getByText('watch-ci-domain@1')).toBeInTheDocument();
    expect(within(card).getByTestId('slot-fill')).toHaveTextContent(
      'demo:watch-ci-domain'
    );
    expect(within(card).getByTestId('slot-sites')).toHaveTextContent('2 sites');
  });
});

describe('OnDemandView: the inverse index (Used-by tab)', () => {
  async function openWatchCiUsedBy(user: ReturnType<typeof userEvent.setup>) {
    await openOnDemandTab(user);
    await user.click(
      await screen.findByRole('button', { name: 'open watch-ci' })
    );
    const panel = await screen.findByTestId('skill-detail-panel');
    await user.click(
      within(within(panel).getByTestId('slot-card-domain')).getByTestId(
        'slot-sites'
      )
    );
    return within(panel).findByTestId('inverse-index');
  }

  it('lists every site with its kind for the fill whose chip was clicked', async () => {
    mockHappyPath();
    const user = userEvent.setup();

    const index = await openWatchCiUsedBy(user);
    expect(within(index).getByText('demo:watch-ci-domain')).toBeInTheDocument();
    expect(
      within(index)
        .getAllByTestId(/^binding-site-/)
        .map(row => row.getAttribute('data-testid'))
    ).toEqual([
      'binding-site-mattstack:watch-ci:domain',
      'binding-site-mattstack:stage-watch-ci:domain',
    ]);
  });

  it("carries the fill's own source, which the slot row used to link to", async () => {
    mockHappyPath();
    const user = userEvent.setup();

    const index = await openWatchCiUsedBy(user);
    expect(within(index).getByTestId('open-fill-source')).toHaveAttribute(
      'href',
      'vscode://file/fills/watch-ci-domain/SKILL.md'
    );
  });

  it('lists exactly as many sites as the chip on the slot claimed', async () => {
    mockHappyPath();
    const user = userEvent.setup();

    const index = await openWatchCiUsedBy(user);
    expect(within(index).getByTestId('site-count')).toHaveTextContent('2');
    expect(within(index).getAllByTestId(/^binding-site-/)).toHaveLength(2);
  });
});

describe('OnDemandView: wiring the deferred surfaces', () => {
  it("opens Rebind inline from a bound slot's rebind action, scoped to that verb and slot", async () => {
    mockHappyPath();
    const user = userEvent.setup();
    await openOnDemandTab(user);

    await user.click(
      await screen.findByRole('button', { name: 'open watch-ci' })
    );
    const detail = await screen.findByTestId('skill-detail-panel');

    const slot = within(detail).getByTestId('slot-card-domain');
    await user.click(within(slot).getByTestId('rebind-slot'));

    const rebind = await within(slot).findByTestId('rebind');
    expect(rebind).toHaveTextContent('watch-ci');
    expect(rebind).toHaveTextContent('slot domain');
  });
});

describe('OnDemandView: Group 2 (another plugin)', () => {
  it('names the external plugin as a muted footnote, not a peer row', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    const view = await openOnDemandTab(user);

    expect(
      within(view).getByTestId('ondemand-external-footnote')
    ).toHaveTextContent('Also bound by another plugin: mr-board');
  });
});

describe('OnDemandView: Group 3 (unwired, a pointer to Health)', () => {
  it('counts the unwired verb and the orphaned fill, but not the stage-bound one', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    const view = await openOnDemandTab(user);

    // `rebase-worktree` (unwired) + `demo:unused` (orphaned) = 2. The fill
    // bound by `watch-ci`/`stage-watch-ci` must not be double-counted in.
    expect(
      within(view).getByTestId('ondemand-unwired-pointer')
    ).toHaveTextContent('2 unwired skills');
  });

  it('switches to the Health tab on click', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    const view = await openOnDemandTab(user);

    await user.click(within(view).getByTestId('ondemand-unwired-pointer'));

    expect(screen.getByRole('tab', { name: 'Pipeline' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(await screen.findByTestId('health-tab')).toBeInTheDocument();
  });
});

describe('OnDemandView: empty state', () => {
  it('states plainly that nothing is invoked outside the pipeline', async () => {
    packsGet.mockResolvedValue(
      ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
    );
    compositionGet.mockResolvedValue(
      ok({
        pack: 'demo',
        packDir: '/p',
        verbs: [COMPOSITION.verbs[0]],
        fills: [],
        binders: [],
        pipelines: { feature: [] as string[] },
      })
    );
    checkGet.mockResolvedValue(
      ok({ pack: 'demo', packDir: '/p', verbs: [CHECK.verbs[0]] })
    );
    const user = userEvent.setup();
    const view = await openOnDemandTab(user);

    expect(within(view).getByTestId('ondemand-empty')).toHaveTextContent(
      'No skills are invoked outside the pipeline.'
    );
    expect(
      within(view).queryByTestId('ondemand-external-footnote')
    ).not.toBeInTheDocument();
    expect(
      within(view).queryByTestId('ondemand-unwired-pointer')
    ).not.toBeInTheDocument();
  });
});
