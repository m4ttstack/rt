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

vi.mock('../../api', () => ({
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

const { WiringMap } = await import('../WiringMap');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

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
    // Bound by a `verb` binder outside the pipeline -- Group 1 on the
    // On-demand tab, so that tab has content to show once selected.
    {
      name: 'review',
      engine: 'review',
      engineRef: 'mattstack:review',
      plugin: 'mattstack',
      description: 'review',
      public: true,
      sourcePath: '/plugins/mattstack/skills/review/SKILL.md',
      artifactPath: '/p/skills/review',
      slots: [],
    },
  ],
  fills: [],
  binders: [
    { ref: 'mattstack:review', verb: 'review', kind: 'verb', slots: [] },
  ],
  // Empty stage list -- this fixture only needs the orchestrator row to
  // exist and to drift, not a real pipeline order.
  pipelines: { feature: [] },
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
  ],
};

const SURFACE = {
  pack: 'demo',
  packDir: '/p',
  rows: [{ name: 'work', kind: 'compiled', status: 'public' }],
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
  surfaceGet.mockResolvedValue(ok(SURFACE));
}

afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('WiringMap: top-level tabs', () => {
  it('renders Pipeline / On-demand / Surface / Health, in that order, with Pipeline active by default', async () => {
    mockHappyPath();
    renderWiring();

    await screen.findByTestId('wiring-timeline');

    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Pipeline',
      'On-demand',
      'Surface',
      expect.stringMatching(/^Health/),
    ]);

    expect(screen.getByRole('tab', { name: 'Pipeline' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'On-demand' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('tab', { name: /^Surface/ })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('tab', { name: /^Health/ })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('the Pipeline tab no longer renders the retired "Not run by this pipeline" section', async () => {
    mockHappyPath();
    renderWiring();

    await screen.findByTestId('wiring-timeline');

    expect(
      screen.queryByTestId('outside-the-pipeline')
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('offpipe-toggle')).not.toBeInTheDocument();
  });

  it('clicking On-demand hides the pipeline spine and shows Group 1 verbs', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('wiring-timeline');

    await user.click(screen.getByRole('tab', { name: 'On-demand' }));

    expect(screen.queryByTestId('wiring-timeline')).not.toBeInTheDocument();
    const view = await screen.findByTestId('ondemand-split');
    expect(
      within(view).getByTestId('skill-row-mattstack:review')
    ).toBeInTheDocument();
  });

  it('shows the attention count as a badge on the Health tab', async () => {
    mockHappyPath();
    renderWiring();

    await screen.findByTestId('wiring-timeline');

    expect(await screen.findByTestId('health-tab-count')).toHaveTextContent(
      '1'
    );
  });

  it('clicking Health hides the spine and shows the Health panel', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('wiring-timeline');

    await user.click(screen.getByRole('tab', { name: /^Health/ }));

    expect(screen.queryByTestId('wiring-timeline')).not.toBeInTheDocument();
    const health = await screen.findByTestId('health-tab');
    // CHECK's one verb ('work') is stale -- the real Health tab should show
    // it in the "Recompile needed" group rather than the old placeholder copy.
    expect(health).toHaveTextContent('1');
    expect(
      screen.getByTestId('health-group-recompile-needed')
    ).toBeInTheDocument();
  });

  it('clicking Surface hides the spine and shows the roster inline', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('wiring-timeline');
    expect(surfaceGet).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: /^Surface/ }));

    expect(screen.queryByTestId('wiring-timeline')).not.toBeInTheDocument();
    const roster = await screen.findByTestId('surface-tab');
    await waitFor(() =>
      expect(surfaceGet).toHaveBeenCalledWith(
        expect.objectContaining({ query: { pack: 'demo' } })
      )
    );
    expect(roster).toHaveTextContent('Public skills can be invoked by name');
  });

  it('opening a Health row switches to Pipeline and opens that skill in the panel', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('wiring-timeline');
    await user.click(screen.getByRole('tab', { name: /^Health/ }));
    await screen.findByTestId('health-tab');

    await user.click(screen.getByTestId('health-row-mattstack:work'));

    expect(screen.getByRole('tab', { name: 'Pipeline' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(await screen.findByTestId('wiring-split')).toBeInTheDocument();
    expect(screen.getByTestId('compact-spine-header')).toBeInTheDocument();
  });

  it('returns to the spine when Pipeline is clicked again', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('wiring-timeline');
    await user.click(screen.getByRole('tab', { name: /^Health/ }));
    await screen.findByTestId('health-tab');

    await user.click(screen.getByRole('tab', { name: 'Pipeline' }));

    expect(await screen.findByTestId('wiring-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('health-tab')).not.toBeInTheDocument();
  });
});
