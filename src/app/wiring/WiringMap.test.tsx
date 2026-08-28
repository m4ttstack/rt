import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';

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

/** Post-4a the per-skill actions (open source, preview compile, version
    history, copy agent context, rebind) live in the detail panel, not on the
    row. Every migrated interaction opens the panel first, then drives its
    header or Slots tab. */
async function openPanel(
  user: ReturnType<typeof userEvent.setup>,
  label: string
) {
  await user.click(
    await screen.findByRole('button', { name: `open ${label}` })
  );
  return screen.getByTestId('skill-detail-panel');
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

    // `outside` (watch-ci, rebase-worktree) no longer draws a Timeline.Item
    // on this tab at all -- it moved wholesale to the On-demand tab.
    expect(items).toEqual([
      'timeline-item-mattstack:work',
      'timeline-item-mattstack:stage-provision',
      'timeline-item-mattstack:stage-implement',
      'timeline-item-mattstack:stage-watch-ci',
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

    // The slim row states this as its compact slot count rather than a
    // sentence -- slot detail itself moves to the Task 4 detail panel.
    expect(
      within(
        screen.getByTestId('skill-row-mattstack:stage-implement')
      ).getByText('no slots')
    ).toBeInTheDocument();
  });

  it('keeps the step number on a drifting row and states the drift beside it', async () => {
    mockHappyPath();
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:work');

    // Which file drifted now lives behind the row's history action, not in
    // a prose line the slim row has no room for -- the row itself only
    // states the health label.
    await waitFor(() =>
      expect(within(row).getByTestId('health-badge')).toHaveTextContent(
        'source newer'
      )
    );
  });

  // `watch-ci`'s slot detail (the fill, the site count) now opens from the
  // On-demand tab -- see `OnDemandView.test.tsx`, "shows every slot open,
  // with the fill and how many sites bind it".

  it('states a pipeline stage as a compact slot count, with the table itself deferred to the detail panel', async () => {
    mockHappyPath();
    renderWiring();

    const stage = await screen.findByTestId(
      'skill-row-mattstack:stage-watch-ci'
    );

    expect(within(stage).getByText('1 slot')).toBeInTheDocument();
    expect(within(stage).queryByTestId('slot-domain')).not.toBeInTheDocument();
  });

  // A fill nothing binds (`demo:unused`, orphaned) vs. one a stage binds
  // (`demo:work-provision`, not orphaned) is `buildSpine`'s own claim --
  // covered at the data layer in `outline.test.ts`'s "buildSpine: orphaned
  // fills" suite. The On-demand tab now only counts orphans into its Group 3
  // pointer rather than listing them; see `OnDemandView.test.tsx`.

  // `rebase-worktree` (unwired, drifting) no longer renders as a row on this
  // tab at all -- it is counted into the On-demand tab's Group 3 pointer.
  // The combination of "unwired" and "carries its own drift" is `buildSpine`
  // logic, covered in `outline.test.ts`'s "a roster verb no binder names"
  // suite; the pointer's count is covered in `OnDemandView.test.tsx`.

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

    // This explanation now sits once above the lane (`.spine-note` in the
    // parity spec), not repeated as two prose lines inside the orchestrator's
    // own row.
    await screen.findByTestId('skill-row-mattstack:work');
    expect(
      within(screen.getByTestId('spine-note')).getByText(
        /Stages compile into it, so they carry no artifact of their own to check/
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

// The "Not run by this pipeline" section (its count, its collapse/expand)
// is retired -- that content now lives on the On-demand tab as Group 1's own
// list plus the Group 2 footnote and Group 3 pointer, with no collapse
// affordance. See `OnDemandView.test.tsx` and `WiringMap.tabs.test.tsx`
// ("top-level tabs") for its coverage.

describe('WiringMap: the inverse index (Used-by tab)', () => {
  // `watch-ci`'s Used-by cases (listing every site the `N sites` chip
  // claims, and the fill's own source link) now open from the On-demand
  // tab -- see `OnDemandView.test.tsx`, "the inverse index (Used-by tab)".
  // The orphan-fill "bound by nothing" inline claim is retired along with
  // the detailed orphan row: `OnDemandView` only counts orphans into its
  // Group 3 pointer now, and the underlying orphan-detection fact stays
  // covered in `outline.test.ts`'s "buildSpine: orphaned fills" suite.

  it('reaches a fill bound in exactly one place from its slot fill link', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    // stage-provision binds `demo:work-provision`, bound in exactly one place
    // and carrying no `N sites` chip. The Slots tab's fill link still reaches
    // its Used-by list -- restoring the single-site fill-click Task 2 dropped.
    await screen.findByTestId('skill-row-mattstack:stage-provision');
    const panel = await openPanel(user, 'stage-provision');
    await user.click(
      within(within(panel).getByTestId('slot-card-domain')).getByTestId(
        'slot-fill'
      )
    );

    const index = await within(panel).findByTestId('inverse-index');
    expect(within(index).getByTestId('site-count')).toHaveTextContent('1');
    expect(within(index).getAllByTestId(/^binding-site-/)).toHaveLength(1);
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
  it('points open-source at the verb source file', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('skill-row-mattstack:work');
    const panel = await openPanel(user, 'work');

    expect(within(panel).getByTestId('open-source')).toHaveAttribute(
      'href',
      'vscode://file/plugins/mattstack/attachments/pipeline/work/SKILL.md'
    );
  });

  it('states a stage has no compiled artifact of its own on the Compiled tab', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('skill-row-mattstack:stage-provision');
    const panel = await openPanel(user, 'stage-provision');
    await user.click(within(panel).getByRole('tab', { name: 'Compiled' }));

    expect(within(panel).getByTestId('detail-no-verb')).toBeInTheDocument();
  });

  it('offers version history on a verb, and states a stage has none', async () => {
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

    await screen.findByTestId('skill-row-mattstack:work');
    const verbPanel = await openPanel(user, 'work');
    await user.click(within(verbPanel).getByRole('tab', { name: 'History' }));
    expect(
      await within(verbPanel).findByTestId('version-timeline')
    ).toBeInTheDocument();

    // A stage compiles INTO the orchestrator, so it has no artifact of its own
    // for a commit to have touched -- the same reason it carries no health.
    const stagePanel = await openPanel(user, 'stage-provision');
    await user.click(within(stagePanel).getByRole('tab', { name: 'History' }));
    expect(
      within(stagePanel).getByTestId('detail-no-verb')
    ).toBeInTheDocument();
  });

  it('reads the verb history scoped to that verb from the History tab', async () => {
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

    await screen.findByTestId('skill-row-mattstack:work');
    const panel = await openPanel(user, 'work');
    await user.click(within(panel).getByRole('tab', { name: 'History' }));

    await waitFor(() =>
      expect(screen.getByTestId('history-empty')).toBeInTheDocument()
    );
    expect(historyGet.mock.calls[0][0]).toMatchObject({
      query: { pack: 'demo', verb: 'work' },
    });
  });

  it('shows the compiled body from the Compiled tab, stating it is not a diff', async () => {
    mockHappyPath();
    compileGet.mockResolvedValue(ok({ content: '---\nname: work\n---\n' }));

    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('skill-row-mattstack:work');
    const panel = await openPanel(user, 'work');
    await user.click(within(panel).getByRole('tab', { name: 'Compiled' }));

    expect(
      await within(panel).findByText(/not a diff against the artifact/)
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(panel).getByTestId('compile-preview-body')
      ).toHaveTextContent('name: work')
    );
    // No write route exists, so the panel must not offer to apply anything.
    expect(
      within(panel).queryByRole('button', { name: /compile|apply|write/i })
    ).not.toBeInTheDocument();
  });

  it('renders the error rt reports for a lint-erroring verb, not a blank pane or a bare 502', async () => {
    mockHappyPath();
    compileGet.mockResolvedValue(
      err(502, 'work: SKILL.md frontmatter is invalid YAML at line 4')
    );

    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('skill-row-mattstack:work');
    const panel = await openPanel(user, 'work');
    await user.click(within(panel).getByRole('tab', { name: 'Compiled' }));

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

    await screen.findByTestId('skill-row-mattstack:work');
    const panel = await openPanel(user, 'work');
    await user.click(within(panel).getByRole('tab', { name: 'Compiled' }));

    const notice = await screen.findByTestId('compile-preview-internal');
    expect(notice).toHaveTextContent(
      'internal: work (not compiled; roster entry retired)'
    );
    expect(notice).not.toHaveTextContent('skipping plugin');
    expect(
      screen.queryByTestId('compile-preview-error')
    ).not.toBeInTheDocument();
  });

  it("names a referenced fill through the verb's own slots on the Compiled tab", async () => {
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

    await screen.findByTestId('skill-row-mattstack:work');
    const panel = await openPanel(user, 'work');
    await user.click(within(panel).getByRole('tab', { name: 'Compiled' }));

    await waitFor(() =>
      expect(
        within(panel).getByTestId('compiled-slot-tiering')
      ).toBeInTheDocument()
    );
    expect(
      within(panel).queryByTestId('compiled-slot-domain')
    ).not.toBeInTheDocument();
  });
});

describe('WiringMap: walking the pipeline in the split view', () => {
  it('switches the panel to the skill clicked in the compact left list', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('skill-row-mattstack:work');
    const panel = await openPanel(user, 'work');
    expect(within(panel).getByText('work')).toBeInTheDocument();

    // The left column is the compact mini-list once a panel is open; clicking
    // another row swaps the panel to that skill, with no drawer to chase.
    await user.click(
      await screen.findByRole('button', { name: 'open stage-watch-ci' })
    );

    await waitFor(() =>
      expect(
        within(screen.getByTestId('skill-detail-panel')).getByText(
          'stage-watch-ci'
        )
      ).toBeInTheDocument()
    );
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
    // wrong with them. `outside` (watch-ci, rebase-worktree) no longer draws
    // a Timeline.Item on this tab regardless of the filter -- the attention-
    // worthy one (`rebase-worktree`, unwired) now surfaces only in the
    // On-demand tab's Group 3 pointer, covered in `OnDemandView.test.tsx`.
    await waitFor(() =>
      expect(
        screen.getAllByTestId(/^timeline-item-/).map(el => el.dataset.testid)
      ).toEqual(['timeline-item-mattstack:work'])
    );
  });

  it('shows exactly as many rows as the header said needed attention', async () => {
    window.history.pushState(null, '', '/wiring?attention=1');
    mockHappyPath();
    renderWiring();

    // Only `work` renders on this tab now -- the other attention-worthy row
    // (`rebase-worktree`) lives entirely on the On-demand tab.
    await waitFor(() =>
      expect(screen.getAllByTestId(/^skill-row-/)).toHaveLength(1)
    );
  });

  it('is reachable from the count on the header, and reversible from there', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    const badge = await screen.findByTestId('attention-count');
    expect(badge).toHaveAttribute('href', '/wiring?attention=1');

    await user.click(badge);

    // `stage-implement` is healthy (no slots, nothing wrong), so the filter
    // drops it; `watch-ci`/`rebase-worktree` never render on this tab at all
    // now, so a Pipeline-tab row is what proves the filter and its reversal.
    await waitFor(() =>
      expect(
        screen.queryByTestId('skill-row-mattstack:stage-implement')
      ).not.toBeInTheDocument()
    );

    await user.click(screen.getByTestId('show-all-rows'));

    await waitFor(() =>
      expect(
        screen.getByTestId('skill-row-mattstack:stage-implement')
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
    // The header counts the pipeline rows this tab draws (orchestrator + 3
    // stages = 4), which at empty is none of them. Rows outside the run order
    // live on the On-demand tab and are not in this denominator.
    expect(screen.getByTestId('spine-summary')).toHaveTextContent(
      'showing 0 of 4 rows'
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

    // The Pipeline tab draws 4 rows: the orchestrator and three stages. Of
    // those, only the orchestrator (`work`) drifted -- the other drifted row
    // (`rebase-worktree`) is outside the run order, on the On-demand tab, and
    // is not counted here.
    expect(summary).toHaveTextContent('showing 1 of 4 rows');
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

    // The always-on `SummaryStrip` carries the stage count now; the
    // filter's own "showing N of M" notice does not exist unfiltered.
    expect(screen.getByTestId('fact-stages')).toHaveTextContent(
      '3 in run order'
    );
    expect(screen.queryByTestId('spine-summary')).not.toBeInTheDocument();
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

  it('points to the other tabs when the pipeline is clean but an outside skill drifted', async () => {
    window.history.pushState(null, '', '/wiring?attention=1');
    packsGet.mockResolvedValue(
      ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
    );
    compositionGet.mockResolvedValue(ok(COMPOSITION));
    // `work` (orchestrator) is in-sync; only `rebase-worktree` (unwired, so
    // it lives on the On-demand/Health tabs) drifted. No pipeline row needs
    // attention, but the pack is not clean.
    checkGet.mockResolvedValue(
      ok({
        pack: 'demo',
        packDir: '/p',
        verbs: [
          { name: 'work', status: 'in-sync', staleFiles: [], orphanFiles: [] },
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
      })
    );
    renderWiring();

    const elsewhere = await screen.findByTestId('attention-elsewhere');
    expect(elsewhere).toHaveTextContent('No pipeline stage needs attention.');
    expect(elsewhere).toHaveTextContent('1 skill outside the run order does');
    expect(elsewhere).toHaveTextContent('On-demand or Health tab');
    // Not stranded on an empty Timeline, and not a false all-clear.
    expect(screen.queryByTestId('wiring-timeline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('attention-empty')).not.toBeInTheDocument();
  });
});

describe('WiringMap: wiring the deferred surfaces', () => {
  it('fetches the live roster only once the Surface tab is opened', async () => {
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

    // The roster is not fetched before its tab is selected -- no rt
    // subprocess is spent on a panel nobody asked to see.
    await screen.findByTestId('wiring-timeline');
    expect(surfaceGet).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: 'Surface' }));

    const panel = await screen.findByTestId('surface-tab');
    expect(surfaceGet).toHaveBeenCalledWith(
      expect.objectContaining({ query: { pack: 'demo' } })
    );
    await waitFor(() =>
      expect(
        within(panel).getByTestId('surface-row-watch-ci')
      ).toBeInTheDocument()
    );
  });

  // `watch-ci`'s inline Rebind (opened from its slot card) now opens from
  // the On-demand tab -- see `OnDemandView.test.tsx`, "opens Rebind inline
  // from a bound slot's rebind action, scoped to that verb and slot".

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

    await screen.findByTestId('skill-row-mattstack:work');
    const panel = await openPanel(user, 'work');
    await user.click(within(panel).getByTestId('copy-agent-context'));

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

    await screen.findByTestId('skill-row-mattstack:work');
    const panel = await openPanel(user, 'work');
    await user.click(within(panel).getByTestId('copy-agent-context'));

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

    await screen.findByTestId('skill-row-mattstack:work');
    const panel = await openPanel(user, 'work');
    await user.click(within(panel).getByTestId('copy-agent-context'));

    await screen.findByText(/denied/);
  });
});

describe('WiringMap: the pack', () => {
  it('offers an Open pack link straight to the pack directory', async () => {
    mockHappyPath();
    renderWiring();

    const open = await screen.findByTestId('open-pack');
    expect(open).toHaveAttribute('href', 'vscode://file/p');
  });
});
