import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';

const packsGet = vi.fn();
const compositionGet = vi.fn();
const checkGet = vi.fn();
const compileGet = vi.fn();
const historyGet = vi.fn();
const surfaceGet = vi.fn();
const surfaceApplyPost = vi.fn();
const bindPost = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      skills: {
        packs: { $get: (...args: unknown[]) => packsGet(...args) },
        composition: { $get: (...args: unknown[]) => compositionGet(...args) },
        check: { $get: (...args: unknown[]) => checkGet(...args) },
        surface: {
          $get: (...args: unknown[]) => surfaceGet(...args),
          apply: { $post: (...args: unknown[]) => surfaceApplyPost(...args) },
        },
        bind: { $post: (...args: unknown[]) => bindPost(...args) },
        compile: { $get: (...args: unknown[]) => compileGet(...args) },
        history: { $get: (...args: unknown[]) => historyGet(...args) },
        diff: {
          $get: () => Promise.resolve({ ok: true, json: async () => ({}) }),
        },
      },
    },
  },
}));

const { WiringMap } = await import('./WiringMap');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}
function err(status: number, error: string) {
  return { ok: false, status, json: async () => ({ error }) };
}

/**
 * `binders[]` is deliberately in a DIFFERENT order from `pipelines.feature`,
 * and alphabetical order is a third order again -- so a spine that reads
 * either one instead of the pipeline shows up as a failing assertion rather
 * than as a plausible-looking page.
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
      slots: [
        {
          name: 'tiering',
          contract: 'model-tiering@1',
          required: false,
          boundTo: 'mattstack:model-tiering',
          fillSourcePath: '/fills/model-tiering/SKILL.md',
          fillVersion: '0.8.0',
          registered: false,
          inlined: true,
        },
      ],
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
    // No binder names it and no pipeline reaches it, which is exactly how rt
    // reports a roster verb that binds nothing.
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
      binding: 'mattstack:model-tiering',
      provides: 'model-tiering@1',
      sourcePath: '/fills/model-tiering/SKILL.md',
      registered: false,
    },
    {
      binding: 'demo:watch-ci-domain',
      provides: 'watch-ci-domain@1',
      sourcePath: '/fills/watch-ci-domain/SKILL.md',
      registered: false,
    },
    {
      binding: 'demo:work-provision',
      provides: 'provision-domain@1',
      sourcePath: '/fills/work-provision/SKILL.md',
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
      ref: 'mattstack:work',
      verb: 'work',
      kind: 'verb',
      slots: [{ name: 'tiering', boundTo: 'mattstack:model-tiering' }],
    },
    {
      ref: 'mattstack:stage-provision',
      verb: null,
      kind: 'stage',
      slots: [{ name: 'domain', boundTo: 'demo:work-provision' }],
    },
  ],
  pipelines: {
    feature: [
      'mattstack:stage-provision',
      'mattstack:stage-implement',
      'mattstack:stage-watch-ci',
    ],
    hotfix: ['mattstack:stage-watch-ci'],
  },
};

const CHECK = {
  pack: 'demo',
  packDir: '/p',
  verbs: [
    {
      name: 'work',
      status: 'stale',
      staleFiles: ['SKILL.md'],
      orphanFiles: [],
    },
    {
      name: 'watch-ci',
      status: 'in-sync',
      staleFiles: [],
      orphanFiles: [],
    },
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

/** The filter rides the URL, so a test that navigated has to put it back or
    the next one renders filtered. */
afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('WiringMap: the spine', () => {
  it('draws the stages in the pipeline order, numbered, not in binders order', async () => {
    mockHappyPath();
    renderWiring();

    await waitFor(() =>
      expect(screen.getByTestId('wiring-timeline')).toBeInTheDocument()
    );

    const items = screen
      .getAllByTestId(/^timeline-item-/)
      .map(el => el.getAttribute('data-testid'));

    expect(items).toEqual([
      'timeline-item-mattstack:work',
      'timeline-item-mattstack:stage-provision',
      'timeline-item-mattstack:stage-implement',
      'timeline-item-mattstack:stage-watch-ci',
      'timeline-item-outside',
    ]);
    expect(
      within(
        screen.getByTestId('timeline-item-mattstack:stage-watch-ci')
      ).getByText('3')
    ).toBeInTheDocument();
  });

  it('states a stage that binds nothing rather than leaving a silent gap', async () => {
    mockHappyPath();
    renderWiring();

    await waitFor(() =>
      expect(
        screen.getByTestId('skill-row-mattstack:stage-implement')
      ).toBeInTheDocument()
    );

    expect(
      within(
        screen.getByTestId('skill-row-mattstack:stage-implement')
      ).getByText('no slots — this stage takes nothing from the pack')
    ).toBeInTheDocument();
  });

  it('keeps the step number on a drifting row and states the drift beside it', async () => {
    mockHappyPath();
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:work');

    await waitFor(() =>
      expect(within(row).getByTestId('health-badge')).toHaveTextContent(
        'source newer'
      )
    );
    expect(
      within(row).getByText(
        'SKILL.md on disk is older than its sources — Claude is reading the previous compile'
      )
    ).toBeInTheDocument();
  });

  it('shows every slot open, with the fill and how many sites bind it', async () => {
    mockHappyPath();
    renderWiring();

    const stage = await screen.findByTestId(
      'skill-row-mattstack:stage-watch-ci'
    );
    const slot = within(stage).getByTestId('slot-domain');

    // The stage binder declares no contract, so the row shows what the bound
    // fill provides rather than nothing at all.
    expect(within(slot).getByText('watch-ci-domain@1')).toBeInTheDocument();
    expect(within(slot).getByTestId('slot-fill')).toHaveTextContent(
      'demo:watch-ci-domain'
    );
    expect(within(slot).getByTestId('slot-sites')).toHaveTextContent('2 sites');
  });

  it('puts a fill nothing binds outside the pipeline, and a stage-bound fill nowhere near it', async () => {
    mockHappyPath();
    renderWiring();

    await waitFor(() =>
      expect(
        screen.getByTestId('orphan-fill-demo:unused')
      ).toBeInTheDocument()
    );
    expect(
      screen.queryByTestId('orphan-fill-demo:work-provision')
    ).not.toBeInTheDocument();
  });

  it('draws a drifting roster verb no binder names, instead of dropping it', async () => {
    mockHappyPath();
    renderWiring();

    const outside = await screen.findByTestId('outside-the-pipeline');
    const row = within(outside).getByTestId(
      'skill-row-mattstack:rebase-worktree'
    );

    expect(within(row).getByText('unwired')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(row).getByTestId('health-badge')).toHaveTextContent(
        'source newer'
      )
    );
  });

  it('counts that verb in the attention badge, so the badge matches what check reported', async () => {
    mockHappyPath();
    renderWiring();

    // `work` is stale and so is `rebase-worktree`; `watch-ci` is in sync.
    await waitFor(() =>
      expect(screen.getByTestId('attention-count')).toHaveTextContent(
        '2 need attention'
      )
    );
  });

  it('says why the numbered rows carry no health, rather than letting bare read as fine', async () => {
    mockHappyPath();
    renderWiring();

    const orchestrator = await screen.findByTestId('skill-row-mattstack:work');

    expect(
      within(orchestrator).getByText(
        'rt skills check covers roster verbs, so the numbered rows below state no health — bare is unmeasured there, not healthy'
      )
    ).toBeInTheDocument();
  });

  it('names the command that produced the panel', async () => {
    mockHappyPath();
    renderWiring();

    await waitFor(() =>
      expect(screen.getByTestId('command-provenance')).toHaveTextContent(
        'rt skills composition'
      )
    );
  });
});

describe('WiringMap: the inverse index', () => {
  it('opens on the fill whose sites chip was clicked, listing every site with its kind', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    const stage = await screen.findByTestId(
      'skill-row-mattstack:stage-watch-ci'
    );
    await user.click(
      within(within(stage).getByTestId('slot-domain')).getByTestId('slot-sites')
    );

    // Mantine keeps `Drawer.Root` mounted whether or not it is open, so the
    // drawer's own testid is no signal -- wait on content only an OPEN
    // drawer has.
    await screen.findByTestId('site-count');
    const drawer = screen.getByTestId('inverse-index');
    expect(
      within(drawer).getByText('demo:watch-ci-domain')
    ).toBeInTheDocument();
    // The roster verb and the pipeline stage that both bind it -- neither is
    // reachable from the other's row.
    expect(
      within(drawer)
        .getAllByTestId(/^binding-site-/)
        .map(row => row.getAttribute('data-testid'))
    ).toEqual([
      'binding-site-mattstack:watch-ci:domain',
      'binding-site-mattstack:stage-watch-ci:domain',
    ]);
  });

  it('opens on a fill bound in exactly one place, which carries no chip at all', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    // stage-provision's fill is bound once, so its row has no `N sites`
    // chip. The fill name is the only way in -- and a fill bound in one
    // place is the one a reader is most likely about to delete.
    const stage = await screen.findByTestId(
      'skill-row-mattstack:stage-provision'
    );
    const slot = within(stage).getByTestId('slot-domain');
    expect(within(slot).queryByTestId('slot-sites')).not.toBeInTheDocument();

    await user.click(within(slot).getByTestId('slot-fill'));

    await screen.findByTestId('site-count');
    const drawer = screen.getByTestId('inverse-index');
    expect(within(drawer).getByTestId('site-count')).toHaveTextContent('1');
    expect(
      within(drawer).getByTestId(
        'binding-site-mattstack:stage-provision:domain'
      )
    ).toBeInTheDocument();
  });

  it("carries the fill's own source, which the slot row used to link to", async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:stage-watch-ci');
    await user.click(
      within(within(row).getByTestId('slot-domain')).getByTestId('slot-fill')
    );

    await screen.findByTestId('site-count');
    expect(screen.getByTestId('open-fill-source')).toHaveAttribute(
      'href',
      'vscode://file/fills/watch-ci-domain/SKILL.md'
    );
  });

  it('lists exactly as many sites as the chip on the row claims', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    const stage = await screen.findByTestId(
      'skill-row-mattstack:stage-watch-ci'
    );
    const chip = within(within(stage).getByTestId('slot-domain')).getByTestId(
      'slot-sites'
    );
    expect(chip).toHaveTextContent('2 sites');

    await user.click(chip);
    await screen.findByTestId('site-count');
    const drawer = screen.getByTestId('inverse-index');

    expect(within(drawer).getByTestId('site-count')).toHaveTextContent('2');
    expect(within(drawer).getAllByTestId(/^binding-site-/)).toHaveLength(2);
  });

  it('answers for a fill nothing binds too, which is the question asked before deleting it', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    const orphan = await screen.findByTestId('orphan-fill-demo:unused');
    await user.click(within(orphan).getByTestId('open-inverse-index'));

    await screen.findByTestId('bound-by-nothing');
    const drawer = screen.getByTestId('inverse-index');
    expect(within(drawer).getByTestId('site-count')).toHaveTextContent('0');
    expect(within(drawer).getByTestId('bound-by-nothing')).toHaveTextContent(
      'Bound by nothing. Not an error'
    );
  });
});

describe('WiringMap: the work-type picker', () => {
  it('switches which pipeline the spine draws', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    const select = await screen.findByTestId('work-type-select');
    expect(select).toHaveValue('feature');

    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'hotfix' }));

    await waitFor(() =>
      expect(
        screen.queryByTestId('timeline-item-mattstack:stage-provision')
      ).not.toBeInTheDocument()
    );
    expect(
      screen.getByTestId('timeline-item-mattstack:stage-watch-ci')
    ).toBeInTheDocument();
  });

  it('stays out of the way when the pack has only one work type', async () => {
    packsGet.mockResolvedValue(
      ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
    );
    compositionGet.mockResolvedValue(
      ok({
        ...COMPOSITION,
        pipelines: { feature: COMPOSITION.pipelines.feature },
      })
    );
    checkGet.mockResolvedValue(ok(CHECK));
    renderWiring();

    await waitFor(() =>
      expect(screen.getByTestId('wiring-timeline')).toBeInTheDocument()
    );
    expect(screen.queryByTestId('work-type-select')).not.toBeInTheDocument();
  });

  it('says so when rt reports no pipelines at all, instead of drawing an empty spine', async () => {
    packsGet.mockResolvedValue(
      ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
    );
    const { pipelines, ...withoutPipelines } = COMPOSITION;
    void pipelines;
    compositionGet.mockResolvedValue(ok(withoutPipelines));
    checkGet.mockResolvedValue(ok(CHECK));
    renderWiring();

    await waitFor(() =>
      expect(screen.getByTestId('pipeline-notice')).toHaveTextContent(
        'This rt does not report pipelines'
      )
    );
  });
});

describe('WiringMap: actions', () => {
  it('points open-source and reveal-artifact at their own distinct files', async () => {
    mockHappyPath();
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:work');
    const openSource = within(row).getByTestId('open-source');
    const revealArtifact = within(row).getByTestId('reveal-artifact');

    expect(openSource).toHaveAttribute(
      'href',
      'vscode://file/plugins/mattstack/attachments/pipeline/work/SKILL.md'
    );
    expect(revealArtifact).toHaveAttribute(
      'href',
      'vscode://file/p/skills/work'
    );
    expect(openSource.getAttribute('href')).not.toBe(
      revealArtifact.getAttribute('href')
    );
  });

  it('offers no compile action for a stage, which has no verb to compile', async () => {
    mockHappyPath();
    renderWiring();

    const stage = await screen.findByTestId(
      'skill-row-mattstack:stage-provision'
    );

    expect(
      within(stage).queryByTestId('toggle-compile-preview')
    ).not.toBeInTheDocument();
  });

  it('offers version history on a verb, and none on a stage', async () => {
    mockHappyPath();
    renderWiring();

    const verb = await screen.findByTestId('skill-row-mattstack:work');
    expect(within(verb).getByTestId('toggle-history')).toBeInTheDocument();

    // A stage compiles INTO the orchestrator, so it has no artifact of its
    // own for a commit to have touched -- the same reason it carries no
    // health and no other action.
    const stage = screen.getByTestId('skill-row-mattstack:stage-provision');
    expect(
      within(stage).queryByTestId('toggle-history')
    ).not.toBeInTheDocument();
  });

  it('opens the history drawer from the row, scoped to that verb', async () => {
    mockHappyPath();
    historyGet.mockResolvedValue(
      ok({
        pack: 'demo',
        packDir: '/p',
        repoRoot: '/repo',
        scope: 'skills/work',
        verb: 'work',
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
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:work');
    await user.click(within(row).getByTestId('toggle-history'));

    await waitFor(() =>
      expect(screen.getByTestId('history-empty')).toBeInTheDocument()
    );
    expect(historyGet.mock.calls[0][0]).toMatchObject({
      query: { pack: 'demo', verb: 'work' },
    });
  });

  it('opens the compile drawer stating its own limit, with the files check flagged', async () => {
    mockHappyPath();
    compileGet.mockResolvedValue(ok({ content: '---\nname: work\n---\n' }));

    const user = userEvent.setup();
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:work');
    await user.click(within(row).getByTestId('toggle-compile-preview'));

    // Mantine keeps `Drawer.Root` mounted whether or not it is open, so the
    // drawer's own testid resolves on a CLOSED drawer -- wait on content
    // only an open one has, or the negative assertion below is vacuous.
    await screen.findByText(/not a diff against the artifact/);
    const drawer = screen.getByTestId('compile-drawer');
    expect(within(drawer).getByText('SKILL.md')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(drawer).getByTestId('compile-preview-body')
      ).toHaveTextContent('name: work')
    );
    // No write route exists, so the panel must not offer to apply anything.
    expect(
      within(drawer).queryByRole('button', { name: /compile|apply|write/i })
    ).not.toBeInTheDocument();
  });

  it('renders the error rt reports for a lint-erroring verb, not a blank pane or a bare 502', async () => {
    mockHappyPath();
    compileGet.mockResolvedValue(
      err(502, 'work: SKILL.md frontmatter is invalid YAML at line 4')
    );

    const user = userEvent.setup();
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:work');
    await user.click(within(row).getByTestId('toggle-compile-preview'));

    await waitFor(() =>
      expect(screen.getByTestId('compile-preview-error')).toBeInTheDocument()
    );
    expect(
      screen.getByText('work: SKILL.md frontmatter is invalid YAML at line 4')
    ).toBeInTheDocument();
    expect(screen.queryByText('502')).not.toBeInTheDocument();
  });

  it("states an internal verb's missing body as a fact, not as a failure", async () => {
    mockHappyPath();
    // rt prints this on stderr and leaves stdout empty, so the route answers
    // 502 with the whole stderr -- banner and plugin warnings included.
    compileGet.mockResolvedValue(
      err(
        502,
        'rt: skipping plugin "current-time"\ninternal: work (not compiled; roster entry retired)'
      )
    );

    const user = userEvent.setup();
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:work');
    await user.click(within(row).getByTestId('toggle-compile-preview'));

    const notice = await screen.findByTestId('compile-preview-internal');
    expect(notice).toHaveTextContent(
      'internal: work (not compiled; roster entry retired)'
    );
    expect(notice).not.toHaveTextContent('skipping plugin');
    expect(
      screen.queryByTestId('compile-preview-error')
    ).not.toBeInTheDocument();
  });

  it("hands the drawer the verb's own slots, so a referenced fill is named at all", async () => {
    mockHappyPath();
    // The body carries a seam for the step only; `tiering` reaches the pane
    // through the composition, which is the only record that it exists.
    compileGet.mockResolvedValue(
      ok({
        content:
          '<!-- part: step source=mattstack:work version=0.8.0 path=a/SKILL.md lines=1-2 -->\n\n# work',
      })
    );

    const user = userEvent.setup();
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:work');
    await user.click(within(row).getByTestId('toggle-compile-preview'));

    const drawer = screen.getByTestId('compile-drawer');
    await waitFor(() =>
      expect(
        within(drawer).getByTestId('compiled-slot-tiering')
      ).toBeInTheDocument()
    );
    expect(
      within(drawer).queryByTestId('compiled-slot-domain')
    ).not.toBeInTheDocument();
  });
});

const CHECK_CLEAN = {
  ...CHECK,
  verbs: CHECK.verbs.map(row => ({
    ...row,
    status: 'in-sync',
    staleFiles: [],
  })),
};

describe('WiringMap: needs-attention only', () => {
  it('renders the drifting rows and drops the healthy ones, same components, same order', async () => {
    window.history.pushState(null, '', '/wiring?attention=1');
    mockHappyPath();
    renderWiring();

    await screen.findByTestId('skill-row-mattstack:work');

    // `work` drifted; the three stages carry no health and nothing else is
    // wrong with them, so only the orchestrator survives above the terminal
    // item.
    expect(
      screen.getAllByTestId(/^timeline-item-/).map(el => el.dataset.testid)
    ).toEqual(['timeline-item-mattstack:work', 'timeline-item-outside']);

    const outside = screen.getByTestId('outside-the-pipeline');
    expect(
      within(outside).getByTestId('skill-row-mattstack:rebase-worktree')
    ).toBeInTheDocument();
    // In sync, so it is not in the inbox.
    expect(
      within(outside).queryByTestId('skill-row-mattstack:watch-ci')
    ).not.toBeInTheDocument();
    // Never counted by attentionCount, so it would make the list longer than
    // the badge that reached it.
    expect(
      screen.queryByTestId('orphan-fill-demo:unused')
    ).not.toBeInTheDocument();
  });

  it('shows exactly as many rows as the header said needed attention', async () => {
    window.history.pushState(null, '', '/wiring?attention=1');
    mockHappyPath();
    renderWiring();

    await screen.findByTestId('skill-row-mattstack:work');
    expect(screen.getAllByTestId(/^skill-row-/)).toHaveLength(2);
  });

  it('is reachable from the count on the header, and reversible from there', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    const badge = await screen.findByTestId('attention-count');
    expect(badge).toHaveAttribute('href', '/wiring?attention=1');

    await user.click(badge);

    await waitFor(() =>
      expect(
        screen.queryByTestId('skill-row-mattstack:watch-ci')
      ).not.toBeInTheDocument()
    );

    await user.click(screen.getByTestId('show-all-rows'));

    await waitFor(() =>
      expect(
        screen.getByTestId('skill-row-mattstack:watch-ci')
      ).toBeInTheDocument()
    );
  });

  it('states the clean result as measured, naming what check compared', async () => {
    window.history.pushState(null, '', '/wiring?attention=1');
    packsGet.mockResolvedValue(
      ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
    );
    compositionGet.mockResolvedValue(ok(COMPOSITION));
    checkGet.mockResolvedValue(ok(CHECK_CLEAN));
    renderWiring();

    const empty = await screen.findByTestId('attention-empty');
    expect(empty).toHaveTextContent('Nothing needs attention.');
    // The header counts the rows on screen, which at empty is none of them.
    expect(screen.getByTestId('spine-summary')).toHaveTextContent(
      'showing 0 of 6 rows'
    );
    expect(empty).toHaveTextContent(
      'rt skills check compared 3 roster verbs in demo against a fresh compile; none differed.'
    );
    // It must not claim to have checked the stages, which check never covers.
    expect(empty).toHaveTextContent('so check does not cover them');
    expect(screen.queryByTestId('wiring-timeline')).not.toBeInTheDocument();
  });

  it('keeps the header and the provenance the empty claim rests on', async () => {
    window.history.pushState(null, '', '/wiring?attention=1');
    packsGet.mockResolvedValue(
      ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
    );
    compositionGet.mockResolvedValue(ok(COMPOSITION));
    checkGet.mockResolvedValue(ok(CHECK_CLEAN));
    renderWiring();

    await screen.findByTestId('attention-empty');
    expect(screen.getByTestId('command-provenance')).toHaveTextContent(
      'rt skills composition'
    );
    expect(screen.getByTestId('spine-summary')).toHaveTextContent('feature');
    expect(screen.getByTestId('work-type-select')).toBeInTheDocument();
  });

  it('says "not measured" rather than "nothing wrong" when check never answered', async () => {
    window.history.pushState(null, '', '/wiring?attention=1');
    packsGet.mockResolvedValue(
      ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
    );
    compositionGet.mockResolvedValue(ok(COMPOSITION));
    checkGet.mockResolvedValue(err(502, 'rt skills check: pack not found'));
    renderWiring();

    const empty = await screen.findByTestId('attention-empty');
    expect(empty).toHaveTextContent(
      'This list is empty because nothing was measured, not because nothing has drifted.'
    );
    expect(empty).not.toHaveTextContent('Nothing needs attention.');
  });
  it('summarises the rows on screen rather than the pack, and says where the stages went', async () => {
    window.history.pushState(null, '', '/wiring?attention=1');
    mockHappyPath();
    renderWiring();

    await screen.findByTestId('skill-row-mattstack:work');
    const summary = screen.getByTestId('spine-summary');

    // Six rows in the pack: the orchestrator, three stages, and two
    // outside it. Two of them drifted.
    expect(summary).toHaveTextContent('showing 2 of 6 rows');
    // The pipeline did not vanish -- it is named, hidden, and explained.
    expect(summary).toHaveTextContent('3 stages hidden');
    expect(summary).toHaveTextContent(
      'check covers no artifact of a stage to flag'
    );
    // The unfiltered claim must be gone, or the header states two sets.
    // Matched on the caveat's own wording: "3 stages" is a substring of
    // "3 of 3 stages hidden", so a negative on that would never fail.
    expect(summary).not.toHaveTextContent(
      'so they carry no artifact of their own to check'
    );
  });

  it('still summarises the pack when the filter is off', async () => {
    mockHappyPath();
    renderWiring();

    await screen.findByTestId('skill-row-mattstack:work');
    const summary = screen.getByTestId('spine-summary');

    expect(summary).toHaveTextContent('3 stages');
    expect(summary).not.toHaveTextContent('showing');
    expect(summary).not.toHaveTextContent('hidden');
  });

  it('does not call an empty roster a clean compile', async () => {
    window.history.pushState(null, '', '/wiring?attention=1');
    packsGet.mockResolvedValue(
      ok({ packs: [{ name: 'mattstack', dir: '/m', layout: 'grouped' }] })
    );
    compositionGet.mockResolvedValue(
      ok({
        pack: 'mattstack',
        packDir: '/m',
        verbs: [],
        fills: [],
        binders: [],
        pipelines: {},
      })
    );
    checkGet.mockResolvedValue(
      ok({ pack: 'mattstack', packDir: '/m', verbs: [] })
    );
    renderWiring();

    const empty = await screen.findByTestId('attention-empty');
    expect(empty).toHaveTextContent(
      'rt skills check found no roster verbs in mattstack to compare'
    );
    expect(empty).not.toHaveTextContent('none differed');
  });
});

describe('WiringMap: wiring the deferred surfaces', () => {
  it('opens the surface roster from the toolbar action, fetching the live roster', async () => {
    mockHappyPath();
    surfaceGet.mockResolvedValue(
      ok({
        pack: 'demo',
        packDir: '/p',
        rows: [{ name: 'watch-ci', kind: 'compiled', status: 'public' }],
      })
    );
    const user = userEvent.setup();
    renderWiring();

    // The roster is not fetched before the drawer is opened -- no rt
    // subprocess is spent on a panel nobody asked to see.
    await screen.findByTestId('wiring-timeline');
    expect(surfaceGet).not.toHaveBeenCalled();

    await user.click(await screen.findByTestId('open-surface-roster'));

    const drawer = await screen.findByTestId('surface-roster');
    expect(surfaceGet).toHaveBeenCalledWith(
      expect.objectContaining({ query: { pack: 'demo' } })
    );
    await waitFor(() =>
      expect(
        within(drawer).getByTestId('surface-row-watch-ci')
      ).toBeInTheDocument()
    );
  });

  it("opens Rebind from a bound slot's rebind action, scoped to that verb and slot", async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:watch-ci');
    const slot = within(row).getByTestId('slot-domain');
    await user.click(within(slot).getByTestId('rebind-slot'));

    const drawer = screen.getByTestId('rebind-drawer');
    const panel = await within(drawer).findByTestId('rebind');
    expect(panel).toHaveTextContent('watch-ci');
    expect(panel).toHaveTextContent('slot domain');
  });

  it('copies the agent context for a verb, built from the real composition entry and its seams', async () => {
    mockHappyPath();
    compileGet.mockResolvedValue(
      ok({
        content:
          '<!-- part: step source=mattstack:work version=0.8.0 path=a/SKILL.md lines=1-2 -->\n\n# work',
      })
    );
    const user = userEvent.setup();
    // Set up AFTER `userEvent.setup()` -- it installs its own clipboard
    // stub, which would otherwise clobber this one.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:work');
    await user.click(within(row).getByTestId('copy-agent-context'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    // The real composition verb, not a hand-built stub -- its engine ref and
    // its slot's bound fill both have to survive into the copied blob.
    expect(copied).toContain('Verb: work');
    expect(copied).toContain('Engine: mattstack:work');
    expect(copied).toContain('tiering -> mattstack:model-tiering');
    // The seam's span, resolved through the SAME parse `CompiledView` uses --
    // `work`'s own `sourcePath` from the composition, not the seam's bare
    // plugin-relative `path`.
    expect(copied).toContain(
      '/plugins/mattstack/attachments/pipeline/work/SKILL.md:1-2'
    );
  });

  it('surfaces a failed compile preview fetch instead of leaving the copy silently no-op', async () => {
    mockHappyPath();
    compileGet.mockResolvedValue(err(502, 'rt exited nonzero'));
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:work');
    await user.click(within(row).getByTestId('copy-agent-context'));

    await screen.findByText(/rt exited nonzero/);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('surfaces a clipboard write rejection instead of leaving the copy silently no-op', async () => {
    mockHappyPath();
    compileGet.mockResolvedValue(
      ok({
        content:
          '<!-- part: step source=mattstack:work version=0.8.0 path=a/SKILL.md lines=1-2 -->\n\n# work',
      })
    );
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:work');
    await user.click(within(row).getByTestId('copy-agent-context'));

    await screen.findByText(/denied/);
  });
});
