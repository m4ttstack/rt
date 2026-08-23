import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';

const packsGet = vi.fn();
const compositionGet = vi.fn();
const checkGet = vi.fn();
const compileGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      skills: {
        packs: { $get: (...args: unknown[]) => packsGet(...args) },
        composition: { $get: (...args: unknown[]) => compositionGet(...args) },
        check: { $get: (...args: unknown[]) => checkGet(...args) },
        surface: {
          $get: () => Promise.resolve({ ok: true, json: async () => ({}) }),
        },
        compile: { $get: (...args: unknown[]) => compileGet(...args) },
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

afterEach(() => {
  vi.clearAllMocks();
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
    expect(within(slot).getByTestId('slot-fill')).toHaveAttribute(
      'href',
      'vscode://file/fills/watch-ci-domain/SKILL.md'
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

  it('opens the compile drawer stating its own limit, with the files check flagged', async () => {
    mockHappyPath();
    compileGet.mockResolvedValue(ok({ content: '---\nname: work\n---\n' }));

    const user = userEvent.setup();
    renderWiring();

    const row = await screen.findByTestId('skill-row-mattstack:work');
    await user.click(within(row).getByTestId('toggle-compile-preview'));

    const drawer = await screen.findByTestId('compile-drawer');
    expect(
      within(drawer).getByText(/not a diff against the artifact/)
    ).toBeInTheDocument();
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
});
