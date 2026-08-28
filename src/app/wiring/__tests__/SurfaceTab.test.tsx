import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';

const surfaceGet = vi.fn();
const surfaceApplyPost = vi.fn();
const compositionGet = vi.fn();

vi.mock('../../api', () => ({
  client: {
    api: {
      skills: {
        surface: {
          $get: (...args: unknown[]) => surfaceGet(...args),
          apply: { $post: (...args: unknown[]) => surfaceApplyPost(...args) },
        },
        composition: {
          $get: (...args: unknown[]) => compositionGet(...args),
        },
      },
    },
  },
}));

const { SurfaceTab } = await import('../SurfaceTab');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}
function err(status: number, error: string) {
  return { ok: false, status, json: async () => ({ error }) };
}

const ROWS = [
  { name: 'review', kind: 'compiled', status: 'public' },
  { name: 'watch-ci', kind: 'compiled', status: 'internal' },
  { name: 'ship', kind: 'compiled', status: 'public' },
  { name: 'model-tiering', kind: 'hand-authored', status: 'internal' },
];

function renderSurfaceTab(
  rows: unknown[] = ROWS,
  composition: { verbs?: unknown[]; fills?: unknown[] } = {}
) {
  surfaceGet.mockResolvedValue(ok({ pack: 'demo', packDir: '/p', rows }));
  // The open-in-editor link joins composition by name; default to none so the
  // staging tests are unaffected, and let a test supply verbs/fills to opt in.
  compositionGet.mockResolvedValue(
    ok({
      pack: 'demo',
      packDir: '/p',
      verbs: composition.verbs ?? [],
      fills: composition.fills ?? [],
    })
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <SurfaceTab pack="demo" />
    </QueryClientProvider>
  );
}

/** Same read-the-rendered-switches approach the old `SurfaceRoster` suite
    used -- the delta the test computes must match exactly what the
    component itself is required to compute. */
function stagedDelta(rows: { name: string; status: string }[]) {
  const toPublic: string[] = [];
  const toInternal: string[] = [];
  for (const row of rows) {
    const input = screen.getByRole('switch', {
      name: new RegExp(`^${row.name}$`),
    }) as HTMLInputElement;
    const now = input.checked ? 'public' : 'internal';
    if (now === row.status) continue;
    (now === 'public' ? toPublic : toInternal).push(row.name);
  }
  toPublic.sort();
  toInternal.sort();
  return { toPublic, toInternal };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SurfaceTab: public rows render as on', () => {
  it('checks the switch for every row whose on-disk status is public', async () => {
    renderSurfaceTab();

    await screen.findByTestId('surface-row-review');
    expect(screen.getByRole('switch', { name: /^review$/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /^ship$/ })).toBeChecked();
    expect(
      screen.getByRole('switch', { name: /^watch-ci$/ })
    ).not.toBeChecked();
    expect(
      screen.getByRole('switch', { name: /^model-tiering$/ })
    ).not.toBeChecked();
  });
});

describe('SurfaceTab: staging is the whole design', () => {
  it('toggling rows writes nothing until Apply', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    await userEvent.click(screen.getByRole('switch', { name: /^ship$/ }));

    expect(surfaceApplyPost).not.toHaveBeenCalled();
  });

  it('the staged delta names the equivalent CLI command in the footer', async () => {
    renderSurfaceTab([
      { name: 'watch-ci', kind: 'compiled', status: 'internal' },
    ]);
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));

    expect(
      screen.getByText('rt skills surface set watch-ci --public')
    ).toBeInTheDocument();
    expect(screen.getByText('1 change staged')).toBeInTheDocument();
  });

  it('names both directions, joined, when the delta goes both ways', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    // watch-ci: internal -> public. ship: public -> internal.
    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    await userEvent.click(screen.getByRole('switch', { name: /^ship$/ }));

    expect(
      screen.getByText(
        'rt skills surface set watch-ci --public · rt skills surface set ship --internal'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('2 changes staged')).toBeInTheDocument();
  });

  it('a row toggled twice leaves the delta empty rather than listing it as unchanged-but-touched', async () => {
    renderSurfaceTab([
      { name: 'watch-ci', kind: 'compiled', status: 'internal' },
    ]);
    await screen.findByTestId('surface-row-watch-ci');
    const toggle = screen.getByRole('switch', { name: /^watch-ci$/ });

    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(stagedDelta([{ name: 'watch-ci', status: 'internal' }])).toEqual({
      toPublic: [],
      toInternal: [],
    });
    expect(screen.getByText('Nothing staged')).toBeInTheDocument();
  });
});

describe('SurfaceTab: pressing Apply', () => {
  it('hands Apply the full bidirectional delta, sorted, via surfaceApply.mutate', async () => {
    surfaceApplyPost.mockResolvedValue(
      ok({ pack: 'demo', steps: [], rows: null })
    );
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    await userEvent.click(screen.getByRole('switch', { name: /^ship$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(surfaceApplyPost).toHaveBeenCalledTimes(1));
    expect(surfaceApplyPost.mock.calls[0][0]).toMatchObject({
      json: {
        pack: 'demo',
        toPublic: ['watch-ci'],
        toInternal: ['ship'],
      },
    });
  });

  it('disables Apply and Discard until something is staged', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  });

  it('Discard clears every staged row without calling Apply', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(
      screen.getByRole('switch', { name: /^watch-ci$/ })
    ).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(surfaceApplyPost).not.toHaveBeenCalled();
  });

  it('shows the error when the apply mutation fails outright', async () => {
    surfaceApplyPost.mockResolvedValue(err(400, 'ship: rt exited nonzero'));
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(
      await screen.findByText('ship: rt exited nonzero')
    ).toBeInTheDocument();
  });
});

describe('SurfaceTab: compiled rows are not moved', () => {
  it('gives a compiled row its own effect line, never the hand-authored move wording', async () => {
    renderSurfaceTab([{ name: 'ship', kind: 'compiled', status: 'public' }]);
    await screen.findByTestId('surface-row-ship');

    await userEvent.click(screen.getByRole('switch', { name: /^ship$/ }));

    expect(
      screen.getByText('skills/ship/ stops being compiled and is removed')
    ).toBeInTheDocument();
    expect(screen.queryByText(/attachments\/ship/)).not.toBeInTheDocument();
  });

  it('describes a hand-authored row as a real move', async () => {
    renderSurfaceTab([
      { name: 'model-tiering', kind: 'hand-authored', status: 'internal' },
    ]);
    await screen.findByTestId('surface-row-model-tiering');

    await userEvent.click(
      screen.getByRole('switch', { name: /^model-tiering$/ })
    );

    expect(
      screen.getByText('attachments/model-tiering/ → skills/model-tiering/')
    ).toBeInTheDocument();
  });
});

describe('SurfaceTab: filters', () => {
  it('narrows the roster by name as the filter text is typed', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.type(screen.getByTestId('surface-filter-input'), 'watch');

    expect(screen.getByTestId('surface-row-watch-ci')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-row-review')).not.toBeInTheDocument();
    expect(screen.queryByTestId('surface-row-ship')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('surface-row-model-tiering')
    ).not.toBeInTheDocument();
  });

  it('the Public chip narrows to rows currently public on disk', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByTestId('surface-filter-public'));

    expect(screen.getByTestId('surface-row-review')).toBeInTheDocument();
    expect(screen.getByTestId('surface-row-ship')).toBeInTheDocument();
    expect(
      screen.queryByTestId('surface-row-watch-ci')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('surface-row-model-tiering')
    ).not.toBeInTheDocument();
  });

  it('the Fill chip narrows to hand-authored rows', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByTestId('surface-filter-fill'));

    expect(screen.getByTestId('surface-row-model-tiering')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-row-review')).not.toBeInTheDocument();
    expect(screen.queryByTestId('surface-row-ship')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('surface-row-watch-ci')
    ).not.toBeInTheDocument();
  });
});

describe('SurfaceTab: staging resets on pack switch', () => {
  it('drops a staged change when the pack changes, even if the new pack shares the row signature', async () => {
    const user = userEvent.setup();
    surfaceGet.mockResolvedValue(
      ok({ pack: 'demo', packDir: '/p', rows: ROWS })
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { rerender } = renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <SurfaceTab pack="demo" />
      </QueryClientProvider>
    );

    await screen.findByTestId('surface-row-watch-ci');
    await user.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    expect(await screen.findByText('1 change staged')).toBeInTheDocument();

    // A different pack that happens to return the SAME rows (identical
    // signature): only `pack` changed, so a signature-only reset would leak the
    // stale delta. The reset must fire on the pack change.
    rerender(
      <QueryClientProvider client={queryClient}>
        <SurfaceTab pack="other" />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(screen.getByText('Nothing staged')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(surfaceApplyPost).not.toHaveBeenCalled();
  });
});

describe('SurfaceTab: open in editor', () => {
  it('links a row to its source, joining composition by name (verb) and binding suffix (fill)', async () => {
    renderSurfaceTab(ROWS, {
      verbs: [{ name: 'review', sourcePath: '/p/skills/review/SKILL.md' }],
      fills: [
        {
          binding: 'demo:model-tiering',
          sourcePath: '/p/fills/model-tiering/SKILL.md',
        },
      ],
    });

    expect(await screen.findByTestId('surface-open-review')).toHaveAttribute(
      'href',
      'vscode://file/p/skills/review/SKILL.md'
    );
    expect(screen.getByTestId('surface-open-model-tiering')).toHaveAttribute(
      'href',
      'vscode://file/p/fills/model-tiering/SKILL.md'
    );
    // A row composition has no source for shows no link, rather than a dead one.
    expect(
      screen.queryByTestId('surface-open-watch-ci')
    ).not.toBeInTheDocument();
  });
});
