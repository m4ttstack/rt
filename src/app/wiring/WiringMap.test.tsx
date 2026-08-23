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
      sourcePath: '/plugins/mattstack/skills/pipeline/watch-ci/SKILL.md',
      artifactPath: '/p/skills/watch-ci',
      slots: [
        {
          name: 'domain',
          contract: 'watch-ci-domain@1',
          required: true,
          boundTo: 'demo:watch-ci-domain',
          fillSourcePath: '/plugins/demo/watch-ci-domain/SKILL.md',
          fillVersion: '0.4.11',
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
      sourcePath: '/plugins/demo/watch-ci-domain/SKILL.md',
      registered: false,
    },
    {
      binding: 'demo:unused',
      provides: 'unused@1',
      sourcePath: '/plugins/demo/unused/SKILL.md',
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
  ],
};

const CHECK = {
  pack: 'demo',
  packDir: '/p',
  verbs: [
    {
      name: 'watch-ci',
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

afterEach(() => {
  vi.clearAllMocks();
});

describe('WiringMap', () => {
  it('renders the verb roster with its health and the orphaned-fills section', async () => {
    packsGet.mockResolvedValue(
      ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
    );
    compositionGet.mockResolvedValue(ok(COMPOSITION));
    checkGet.mockResolvedValue(ok(CHECK));

    renderWiring();

    await waitFor(() =>
      expect(
        within(screen.getByTestId('verb-node-watch-ci')).getByText(
          'source newer than compiled'
        )
      ).toBeInTheDocument()
    );

    await waitFor(() =>
      expect(
        screen.getByTestId('orphan-fill-demo:unused')
      ).toBeInTheDocument()
    );
    // The fill a slot actually binds never surfaces in the orphan section.
    expect(
      screen.queryByTestId('orphan-fill-demo:watch-ci-domain')
    ).not.toBeInTheDocument();
  });

  it('points open-source and reveal-artifact at their own distinct files', async () => {
    packsGet.mockResolvedValue(
      ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
    );
    compositionGet.mockResolvedValue(ok(COMPOSITION));
    checkGet.mockResolvedValue(ok(CHECK));

    renderWiring();

    await waitFor(() =>
      expect(screen.getByTestId('verb-node-watch-ci')).toBeInTheDocument()
    );

    const openSource = screen.getByTestId('open-source');
    const revealArtifact = screen.getByTestId('reveal-artifact');

    expect(openSource).toHaveAttribute(
      'href',
      'vscode://file/plugins/mattstack/skills/pipeline/watch-ci/SKILL.md'
    );
    expect(revealArtifact).toHaveAttribute(
      'href',
      'vscode://file/p/skills/watch-ci'
    );
    expect(openSource.getAttribute('href')).not.toBe(
      revealArtifact.getAttribute('href')
    );
  });

  it('renders the error rt reports for a lint-erroring verb, not a blank pane or a bare 502', async () => {
    packsGet.mockResolvedValue(
      ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
    );
    compositionGet.mockResolvedValue(ok(COMPOSITION));
    checkGet.mockResolvedValue(ok(CHECK));
    compileGet.mockResolvedValue(
      err(502, 'watch-ci: SKILL.md frontmatter is invalid YAML at line 4')
    );

    const user = userEvent.setup();
    renderWiring();

    await waitFor(() =>
      expect(screen.getByTestId('toggle-compile-preview')).toBeInTheDocument()
    );
    await user.click(screen.getByTestId('toggle-compile-preview'));

    await waitFor(() =>
      expect(screen.getByTestId('compile-preview-error')).toBeInTheDocument()
    );
    expect(
      screen.getByText(
        'watch-ci: SKILL.md frontmatter is invalid YAML at line 4'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText('502')).not.toBeInTheDocument();
  });
});
