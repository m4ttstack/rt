import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';

const packsGet = vi.fn();
const compositionGet = vi.fn();
const checkGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      skills: {
        packs: { $get: (...args: unknown[]) => packsGet(...args) },
        composition: { $get: (...args: unknown[]) => compositionGet(...args) },
        check: { $get: (...args: unknown[]) => checkGet(...args) },
      },
    },
  },
}));

const { WiringRailEntry } = await import('./WiringRailEntry');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

const COMPOSITION = {
  pack: 'demo',
  packDir: '/p',
  verbs: ['work', 'ship', 'watch-ci'].map(name => ({
    name,
    engine: name,
    engineRef: `mattstack:${name}`,
    plugin: 'mattstack',
    description: name,
    public: true,
    sourcePath: `/steps/${name}/SKILL.md`,
    artifactPath: `/p/skills/${name}`,
    slots: [],
  })),
  fills: [],
  binders: [{ ref: 'mattstack:work', verb: 'work', kind: 'verb', slots: [] }],
  pipelines: { feature: [] },
};

/** Four stale FILES on one verb, plus one never-compiled verb: the count is
    2, and any implementation summing file lists reads 5. */
const CHECK_TWO_DRIFTED = {
  pack: 'demo',
  packDir: '/p',
  verbs: [
    {
      name: 'work',
      status: 'stale',
      staleFiles: ['SKILL.md', 'parts/a.md', 'parts/b.md', 'parts/c.md'],
      orphanFiles: [],
    },
    { name: 'ship', status: 'never-compiled', staleFiles: [], orphanFiles: [] },
    { name: 'watch-ci', status: 'in-sync', staleFiles: [], orphanFiles: [] },
  ],
};

const CHECK_CLEAN = {
  pack: 'demo',
  packDir: '/p',
  verbs: CHECK_TWO_DRIFTED.verbs.map(row => ({
    ...row,
    status: 'in-sync',
    staleFiles: [],
  })),
};

function renderRail(check: unknown) {
  packsGet.mockResolvedValue(
    ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
  );
  compositionGet.mockResolvedValue(ok(COMPOSITION));
  checkGet.mockResolvedValue(ok(check));

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <WiringRailEntry active={false} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('WiringRailEntry: the drift badge', () => {
  it('counts verbs, not files: four stale files on one verb plus one missing artifact is 2', async () => {
    renderRail(CHECK_TWO_DRIFTED);

    expect(await screen.findByTestId('drift-badge')).toHaveTextContent('2');
  });

  it('renders no badge at all when nothing has drifted', async () => {
    renderRail(CHECK_CLEAN);

    // The rail entry itself is what proves the tree rendered -- without it
    // the absent badge below would pass on an empty document.
    expect(await screen.findByLabelText('Wiring')).toBeInTheDocument();
    await waitFor(() => expect(checkGet).toHaveBeenCalled());
    expect(screen.queryByTestId('drift-badge')).toBeNull();
  });

  it('takes the reader to the spine already filtered, while the entry itself does not', async () => {
    const user = userEvent.setup();
    renderRail(CHECK_TWO_DRIFTED);

    const badge = await screen.findByTestId('drift-badge');
    expect(screen.getByLabelText('Wiring')).toHaveAttribute('href', '/wiring');

    await user.click(badge);

    expect(window.location.pathname + window.location.search).toBe(
      '/wiring?attention=1'
    );
  });
});
