import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/app-kit/lazy', () => ({
  CodeMirror: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (v: string) => void;
  }) => (
    <textarea
      aria-label="JSON"
      value={value}
      onChange={e => onChange?.(e.currentTarget.value)}
    />
  ),
}));
vi.mock('../config/useSettings', () => ({
  useAgentModels: () => ({ data: { models: [] } }),
}));

const { SettingsPage } = await import('./SettingsPage');
const { ExplainModal } = await import('./ExplainModal');
const { schemaFields } = await import('./testSchemas');
const { SettingsRepoContext } = await import('./useConsoleSettings');

const REPO = 'gitlab.example.com/acme/app';
const OTHER_REPO = 'gitlab.example.com/acme/web';
const USER_FILE = '/home/user/settings.user.jsonc';
const RULE = {
  pattern: 'gate/opened/*',
  category: 'gate',
  title: 't',
  message: 'm',
};

function bridges(over: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key: 'rt.notify.eventBridges',
    type: 'array',
    scopes: ['user'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'Event bridge rules.',
    hasDefault: false,
    defaultValue: null,
    effective: {
      scope: 'user',
      file: USER_FILE,
      value: [RULE, RULE, { ...RULE, url: 3 }],
    },
    storeVersion: 1,
    issues: [
      {
        scope: 'user',
        file: USER_FILE,
        kind: 'nonconforming',
        path: [2, 'url'],
        message: 'expected string, got number',
      },
    ],
    ...schemaFields('rt.notify.eventBridges'),
    ...over,
  };
}

function roles(): SettingDefWire {
  return {
    ...bridges(),
    key: 'rt.roles',
    type: 'object',
    scopes: ['user', 'team', 'machine'],
    merge: 'deep',
    repoScoped: true,
    effective: { scope: null, file: null },
    issues: [
      {
        scope: 'team.repo',
        file: '/home/team/settings.team.jsonc',
        repo: REPO,
        kind: 'nonconforming',
        path: ['dev', 'fixedPort'],
        message: 'expected number, got string',
      },
    ],
    ...schemaFields('rt.roles'),
  };
}

/** A deep-merge key whose issue is on the merged value, not one layer --
    Fix has no single layer to open for it. */
function homeSnapshot(): SettingDefWire {
  return {
    key: 'rt.homeSnapshot',
    type: 'object',
    scopes: ['user'],
    merge: 'deep',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'Home snapshot cadence.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: 'user', file: USER_FILE, value: { enabled: 'yes' } },
    storeVersion: 1,
    mergedIssues: [
      { path: ['enabled'], message: 'expected boolean, got string' },
    ],
    ...schemaFields('rt.homeSnapshot'),
  };
}

/** `board.members` is SHAPES-external (edited in board): writable, so
    Remove still applies, but its kind is never in EDITOR_KINDS, so it is
    never editable regardless of the def's own writable flag. */
function boardMembers(): SettingDefWire {
  return {
    key: 'board.members',
    type: 'array',
    scopes: ['user'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'Board members, edited in board.',
    hasDefault: false,
    defaultValue: null,
    effective: {
      scope: 'user',
      file: USER_FILE,
      value: [{ username: 'a' }],
    },
    storeVersion: 1,
    issues: [
      {
        scope: 'user',
        file: USER_FILE,
        kind: 'nonconforming',
        path: [0, 'username'],
        message: 'expected string, got number',
      },
    ],
    ...schemaFields('board.members'),
  };
}

/** A key with no issue at all, so the chip filter has something to hide. */
function fine(): SettingDefWire {
  return {
    key: 'rt.logLevel',
    type: 'string',
    scopes: ['user'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'Log level.',
    hasDefault: true,
    defaultValue: 'info',
    effective: { scope: 'default', file: null, value: 'info' },
    storeVersion: 1,
  };
}

describe('Needs fixing on the page', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/settings');
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.startsWith('/api/settings/repos')
          ? { repos: [{ identity: REPO, label: 'acme/app' }] }
          : url.startsWith('/api/settings/explain/')
            ? { def: null, rows: [] }
            : { defs: [bridges(), roles(), fine()] },
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

  it('counts, lists and filters the keys that need fixing', async () => {
    renderPage();
    const chip = await screen.findByRole('checkbox', { name: /^Needs fixing/ });
    expect(chip.closest('label') ?? chip.parentElement!).toHaveTextContent(
      'Needs fixing 2'
    );
    expect(
      screen.getByText('user · [2].url: expected string, got number')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'team · acme/app · dev.fixedPort: expected number, got string'
      )
    ).toBeInTheDocument();

    expect(screen.getByText('logLevel')).toBeInTheDocument();
    await userEvent.click(chip.closest('label') ?? chip);
    await waitFor(() => expect(screen.queryByText('logLevel')).toBeNull());
    expect(screen.getByText('eventBridges')).toBeInTheDocument();
    expect(screen.getByText('roles')).toBeInTheDocument();
  });

  it('Fix on a merged issue opens the modal with no layer editor', async () => {
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.startsWith('/api/settings/repos')
          ? { repos: [{ identity: REPO, label: 'acme/app' }] }
          : url.startsWith('/api/settings/explain/')
            ? { def: null, rows: [] }
            : { defs: [homeSnapshot()] },
    }));
    renderPage();
    const line = await screen.findByText(
      'merged · enabled: expected boolean, got string'
    );
    await userEvent.click(
      within(line.closest('[data-testid="issue-line"]')!).getByRole('button', {
        name: 'Fix',
      })
    );
    await waitFor(() => {
      const p = new URLSearchParams(window.location.search);
      expect(p.get('explain')).toBe('rt.homeSnapshot');
      expect(p.get('fix')).toBeNull();
      expect(p.get('repo')).toBeNull();
    });
  });

  it('Fix opens the explain modal on that layer, switching to the issue’s repo', async () => {
    renderPage();
    const line = await screen.findByText(
      'team · acme/app · dev.fixedPort: expected number, got string'
    );
    await userEvent.click(
      within(line.closest('[data-testid="issue-line"]')!).getByRole('button', {
        name: 'Fix',
      })
    );
    await waitFor(() => {
      const p = new URLSearchParams(window.location.search);
      expect([p.get('explain'), p.get('fix'), p.get('repo')]).toEqual([
        'rt.roles',
        'team.repo',
        REPO,
      ]);
    });
  });

  it('closing the modal after a Fix that switched repo keeps that repo picked', async () => {
    renderPage();
    const line = await screen.findByText(
      'team · acme/app · dev.fixedPort: expected number, got string'
    );
    await userEvent.click(
      within(line.closest('[data-testid="issue-line"]')!).getByRole('button', {
        name: 'Fix',
      })
    );
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      const p = new URLSearchParams(window.location.search);
      expect(p.get('explain')).toBeNull();
      expect(p.get('fix')).toBeNull();
      expect(p.get('repo')).toBe(REPO);
    });
  });

  it('closing the modal after a Fix with no repo switch returns to the page as it was', async () => {
    renderPage();
    const line = await screen.findByText(
      'user · [2].url: expected string, got number'
    );
    await userEvent.click(
      within(line.closest('[data-testid="issue-line"]')!).getByRole('button', {
        name: 'Fix',
      })
    );
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      const p = new URLSearchParams(window.location.search);
      expect(p.get('explain')).toBeNull();
      expect(p.get('repo')).toBeNull();
    });
  });
});

describe('Fix in the explain modal', () => {
  afterEach(() => vi.unstubAllGlobals());

  function openFix(
    d: SettingDefWire,
    rows: ExplainRowWire[],
    setError: string | null = null,
    fix: string | null = 'user'
  ) {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => structuredClone({ def: d, rows }),
    }));
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey={d.key}
          fix={fix}
          store={{
            defs: [d],
            loading: false,
            error: null,
            set: vi.fn(async () => setError),
            unset: vi.fn(async () => null),
            move: vi.fn(async () => null),
            prune: vi.fn(async () => null),
          }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
  }

  it('a layer issue shows once, on its layer, not again on the row above', async () => {
    openFix(
      bridges(),
      [
        { scope: 'default', file: null, present: false },
        {
          scope: 'user',
          file: USER_FILE,
          present: true,
          value: [RULE, RULE, { ...RULE, url: 3 }],
          nonconforming: [
            { path: [2, 'url'], message: 'expected string, got number' },
          ],
        },
      ],
      null,
      null
    );
    const layer = await screen.findByTestId('layer-user');
    await waitFor(() =>
      expect(screen.getAllByText(/expected string, got number/)).toHaveLength(1)
    );
    expect(
      within(layer).getByText(/expected string, got number/)
    ).toBeInTheDocument();
  });

  it('while a layer is edited, its stored value steps aside for the editor', async () => {
    openFix(bridges(), [
      { scope: 'default', file: null, present: false },
      {
        scope: 'user',
        file: USER_FILE,
        present: true,
        value: [RULE, RULE, { ...RULE, url: 3 }],
        nonconforming: [
          { path: [2, 'url'], message: 'expected string, got number' },
        ],
      },
    ]);
    const layer = await screen.findByTestId('layer-user');
    await within(layer).findByTestId('item-2');
    expect(within(layer).queryByTestId('layer-value-user')).toBeNull();
    expect(within(layer).getAllByText(/expected string, got number/)).toHaveLength(2);
  });

  it('opens the layer in the form when the form can draw it, the field highlighted, Save off', async () => {
    const value = [RULE, RULE, { ...RULE, url: 3 }];
    openFix(bridges(), [
      { scope: 'default', file: null, present: false },
      {
        scope: 'user',
        file: USER_FILE,
        present: true,
        value,
        nonconforming: [
          { path: [2, 'url'], message: 'expected string, got number' },
        ],
      },
    ]);
    const layer = await screen.findByTestId('layer-user');
    const item = await within(layer).findByTestId('item-2');
    // Opened by Fix, the bad field starts touched: its error shows without
    // the user typing into it first, and the footer names the same card.
    expect(within(item).getByTestId('field-row-url')).toHaveTextContent(
      'expected string, got number'
    );
    expect(within(layer).getByTestId('draft-issue')).toHaveTextContent(
      '#3 url: expected string, got number'
    );
    expect(within(layer).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(
      within(layer).getByRole('button', {
        name: 'remove rt.notify.eventBridges from user',
      })
    ).toBeInTheDocument();
  });

  it('highlights and reveals the field at a reported issue path the explain rows do not repeat', async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const value = [{ ...RULE, url: 'https://example.test/{id}' }, RULE];
      openFix(
        bridges({
          effective: { scope: 'user', file: USER_FILE, value },
          issues: [
            {
              scope: 'user',
              file: USER_FILE,
              kind: 'nonconforming',
              path: [0, 'url'],
              message: 'expected string, got number',
            },
          ],
        }),
        [
          { scope: 'default', file: null, present: false },
          { scope: 'user', file: USER_FILE, present: true, value },
        ]
      );
      const layer = await screen.findByTestId('layer-user');
      const item = await within(layer).findByTestId('item-0');
      const row = within(item).getByTestId('field-row-url');
      const input = within(row).getByRole('textbox', { name: 'url' });
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(row).toHaveTextContent('expected string, got number');
      await waitFor(() => expect(scrolled).toContain(input));
      scrolled.length = 0;
      await userEvent.click(
        within(layer).getByRole('button', { name: 'Cancel' })
      );
      await userEvent.click(
        within(layer).getByRole('button', {
          name: 'set rt.notify.eventBridges at user',
        })
      );
      await within(layer).findByTestId('item-0');
      expect(scrolled).toEqual([]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('a reported issue stays on its card through edits elsewhere and a move', async () => {
    const value = [{ ...RULE, url: 'https://example.test/{id}' }, RULE];
    openFix(
      bridges({
        effective: { scope: 'user', file: USER_FILE, value },
        issues: [
          {
            scope: 'user',
            file: USER_FILE,
            kind: 'nonconforming',
            path: [0, 'url'],
            message: 'expected string, got number',
          },
        ],
      }),
      [
        { scope: 'default', file: null, present: false },
        { scope: 'user', file: USER_FILE, present: true, value },
      ]
    );
    const layer = await screen.findByTestId('layer-user');
    const url = (i: number) =>
      within(within(layer).getByTestId(`item-${i}`)).getByRole('textbox', {
        name: 'url',
      });
    await within(layer).findByTestId('item-1');
    await userEvent.type(
      within(within(layer).getByTestId('item-1')).getByRole('textbox', {
        name: 'title',
      }),
      'x'
    );
    expect(url(0)).toHaveAttribute('aria-invalid', 'true');
    expect(within(layer).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(
      within(layer).getByRole('button', { name: 'move item 1 down' })
    );
    expect(url(1)).toHaveAttribute('aria-invalid', 'true');
  });

  it('a reported issue no longer attaches to a layer written in the modal', async () => {
    const value = [{ ...RULE, url: 'https://example.test/{id}' }, RULE];
    openFix(
      bridges({
        effective: { scope: 'user', file: USER_FILE, value },
        issues: [
          {
            scope: 'user',
            file: USER_FILE,
            kind: 'nonconforming',
            path: [0, 'url'],
            message: 'expected string, got number',
          },
        ],
      }),
      [
        { scope: 'default', file: null, present: false },
        { scope: 'user', file: USER_FILE, present: true, value },
      ]
    );
    const layer = await screen.findByTestId('layer-user');
    const url = () =>
      within(within(layer).getByTestId('item-0')).getByRole('textbox', {
        name: 'url',
      });
    await within(layer).findByTestId('item-0');
    await userEvent.type(url(), 'x');
    await userEvent.click(within(layer).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(layer).queryByTestId('item-0')).toBeNull()
    );
    await userEvent.click(
      within(layer).getByRole('button', {
        name: 'set rt.notify.eventBridges at user',
      })
    );
    await within(layer).findByTestId('item-0');
    expect(url()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('a written layer takes its issues again once /defs is re-read', async () => {
    const value = [{ ...RULE, url: 'https://example.test/{id}' }, RULE];
    const issues = () => [
      {
        scope: 'user',
        file: USER_FILE,
        kind: 'nonconforming',
        path: [0, 'url'],
        message: 'expected string, got number',
      },
    ];
    const d = bridges({
      effective: { scope: 'user', file: USER_FILE, value },
      issues: issues(),
    });
    const rows: ExplainRowWire[] = [
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: USER_FILE, present: true, value },
    ];
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => structuredClone({ def: d, rows }),
    }));
    const store = (defs: SettingDefWire[]) => ({
      defs,
      loading: false,
      error: null,
      set: vi.fn(async () => null),
      unset: vi.fn(async () => null),
      move: vi.fn(async () => null),
      prune: vi.fn(async () => null),
    });
    const client = new QueryClient();
    const modal = (s: ReturnType<typeof store>) => (
      <QueryClientProvider client={client}>
        <ExplainModal
          settingKey={d.key}
          fix="user"
          store={s}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { rerender } = renderWithProviders(modal(store([d])));
    const layer = await screen.findByTestId('layer-user');
    const url = () =>
      within(within(layer).getByTestId('item-0')).getByRole('textbox', {
        name: 'url',
      });
    await within(layer).findByTestId('item-0');
    await userEvent.type(url(), 'x');
    await userEvent.click(within(layer).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(layer).queryByTestId('item-0')).toBeNull()
    );
    rerender(modal(store([{ ...d, issues: issues() }])));
    await userEvent.click(
      within(layer).getByRole('button', {
        name: 'set rt.notify.eventBridges at user',
      })
    );
    await within(layer).findByTestId('item-0');
    expect(url()).toHaveAttribute('aria-invalid', 'true');
  });

  it('a refused save keeps the reported issue on its layer', async () => {
    const value = [{ ...RULE, url: 'https://example.test/{id}' }, RULE];
    openFix(
      bridges({
        effective: { scope: 'user', file: USER_FILE, value },
        issues: [
          {
            scope: 'user',
            file: USER_FILE,
            kind: 'nonconforming',
            path: [0, 'url'],
            message: 'expected string, got number',
          },
        ],
      }),
      [
        { scope: 'default', file: null, present: false },
        { scope: 'user', file: USER_FILE, present: true, value },
      ],
      'store refused the write'
    );
    const layer = await screen.findByTestId('layer-user');
    const url = () =>
      within(within(layer).getByTestId('item-0')).getByRole('textbox', {
        name: 'url',
      });
    await within(layer).findByTestId('item-0');
    await userEvent.type(url(), 'x');
    await userEvent.click(within(layer).getByRole('button', { name: 'Save' }));
    await screen.findByText('store refused the write');
    await userEvent.click(
      within(layer).getByRole('button', { name: 'Cancel' })
    );
    await userEvent.click(
      within(layer).getByRole('button', {
        name: 'set rt.notify.eventBridges at user',
      })
    );
    await within(layer).findByTestId('item-0');
    expect(url()).toHaveAttribute('aria-invalid', 'true');
  });

  it('a write in one repo keeps the reported issue on another repo’s rung', async () => {
    const value = { dev: { fixedPort: 3000 } };
    const issue = (repo: string) => ({
      scope: 'team.repo',
      file: '/home/team/settings.team.jsonc',
      repo,
      kind: 'nonconforming',
      path: ['dev', 'fixedPort'],
      message: 'expected number, got string',
    });
    const d = roles();
    d.issues = [issue(REPO), issue(OTHER_REPO)];
    const rows: ExplainRowWire[] = [
      { scope: 'default', file: null, present: false },
      { scope: 'team', file: '/home/team/settings.team.jsonc', present: false },
      {
        scope: 'team.repo',
        file: '/home/team/settings.team.jsonc',
        present: true,
        value,
      },
    ];
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => structuredClone({ def: d, rows }),
    }));
    const store = {
      defs: [d],
      loading: false,
      error: null,
      set: vi.fn(async () => null),
      unset: vi.fn(async () => null),
      move: vi.fn(async () => null),
      prune: vi.fn(async () => null),
    };
    const modal = (repo: string) => (
      <SettingsRepoContext.Provider value={repo}>
        <QueryClientProvider client={new QueryClient()}>
          <ExplainModal
            settingKey={d.key}
            fix="team.repo"
            store={store}
            onClose={vi.fn()}
          />
        </QueryClientProvider>
      </SettingsRepoContext.Provider>
    );
    const { rerender } = renderWithProviders(modal(REPO));
    const layer = await screen.findByTestId('layer-team.repo');
    const port = () =>
      within(layer).getByRole('textbox', { name: 'fixedPort' });
    await userEvent.type(
      await within(layer).findByRole('textbox', { name: 'fixedPort' }),
      '1'
    );
    await userEvent.click(within(layer).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(layer).queryByRole('button', { name: 'Save' })).toBeNull()
    );
    rerender(modal(OTHER_REPO));
    await userEvent.click(
      await within(layer).findByRole('button', {
        name: 'set rt.roles at team · repo',
      })
    );
    expect(
      await within(layer).findByRole('textbox', { name: 'fixedPort' })
    ).toBeInTheDocument();
    expect(port()).toHaveAttribute('aria-invalid', 'true');
  });

  it('a value the form cannot draw opens in JSON, never in cards', async () => {
    openFix(
      bridges({
        effective: { scope: 'user', file: USER_FILE, value: { pattern: 'x' } },
      }),
      [
        { scope: 'default', file: null, present: false },
        {
          scope: 'user',
          file: USER_FILE,
          present: true,
          value: { pattern: 'x' },
          nonconforming: [{ path: [], message: 'expected array, got object' }],
        },
      ]
    );
    const layer = await screen.findByTestId('layer-user');
    expect(
      await within(layer).findByRole('textbox', { name: 'JSON' })
    ).toHaveValue(JSON.stringify({ pattern: 'x' }, null, 2));
    expect(within(layer).queryByTestId('item-0')).toBeNull();
    expect(within(layer).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('a non-editable failing layer keeps Remove as the remedy, no editor opens', async () => {
    openFix(boardMembers(), [
      { scope: 'default', file: null, present: false },
      {
        scope: 'user',
        file: USER_FILE,
        present: true,
        value: [{ username: 'a' }],
      },
    ]);
    const layer = await screen.findByTestId('layer-user');
    expect(within(layer).queryByText(/^Editing the/)).toBeNull();
    expect(
      within(layer).queryByRole('button', { name: 'set board.members at user' })
    ).toBeNull();
    expect(
      within(layer).getByRole('button', {
        name: 'remove board.members from user',
      })
    ).toBeInTheDocument();
  });
});
