import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExplainModal, type ExplainStore } from './ExplainModal';
import { schemaFields } from './testSchemas';
import { SettingsRepoContext } from './useConsoleSettings';

const KEY = 'board.agent.model';

const DEF: SettingDefWire = {
  key: KEY,
  type: 'string',
  scopes: ['user', 'machine'],
  merge: 'replace',
  secret: false,
  teamLocked: false,
  repoScoped: false,
  writable: true,
  description:
    "Default --model for the board's panes. Unset omits the flag entirely.",
  hasDefault: false,
  defaultValue: null,
  effective: { scope: 'machine', file: '/stores/local.jsonc', value: 'm-old' },
  storeVersion: 1,
};

const ROWS: ExplainRowWire[] = [
  { scope: 'default', file: null, present: false },
  { scope: 'team', file: '/stores/team.jsonc', present: false },
  { scope: 'user', file: '/stores/user.jsonc', present: true, value: 'm-new' },
  {
    scope: 'machine',
    file: '/stores/local.jsonc',
    present: true,
    value: 'm-old',
  },
];

const explainGet = vi.fn();

vi.stubGlobal('fetch', (url: string) => {
  if (url.startsWith('/api/settings/explain/')) return explainGet(url);
  return Promise.resolve({
    ok: false,
    status: 404,
    json: async () => ({ error: 'not found' }),
  });
});

function ok(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function store(over: Partial<ExplainStore> = {}): ExplainStore {
  return {
    defs: [DEF],
    loading: false,
    error: null,
    set: vi.fn(async () => null as string | null),
    unset: vi.fn(async () => null as string | null),
    move: vi.fn(async () => null as string | null),
    prune: vi.fn(async () => null as string | null),
    ...over,
  };
}

function renderModal(s: ExplainStore, settingKey: string | null = KEY) {
  const onClose = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ExplainModal settingKey={settingKey} store={s} onClose={onClose} />
    </QueryClientProvider>
  );
  return { onClose };
}

afterEach(() => explainGet.mockReset());

describe('ExplainModal', () => {
  it('renders the settings row, the verdict and every layer', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    renderModal(store());

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(`>_ rt settings explain ${KEY}`)
    ).toBeInTheDocument();
    expect(within(dialog).getByText('model')).toBeInTheDocument();
    expect(within(dialog).getByText(DEF.description)).toBeInTheDocument();
    expect(
      await within(dialog).findByTestId('explain-sentence')
    ).toHaveTextContent(
      `${KEY} is "m-old" because the machine layer sets it, overriding user.`
    );
    expect(within(dialog).getByTestId('layer-value-user')).toHaveStyle({
      textDecoration: 'line-through',
    });
    expect(
      within(within(dialog).getByTestId('layer-machine')).getByText('wins')
    ).toBeInTheDocument();
    expect(
      within(within(dialog).getByTestId('layer-team')).getByText(
        'not allowed at this layer (allowed: user, machine)'
      )
    ).toBeInTheDocument();
  });

  it('removes one layer and re-reads the stack', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    const s = store();
    renderModal(s);

    const remove = await screen.findByRole('button', {
      name: `remove ${KEY} from machine`,
    });
    expect(explainGet).toHaveBeenCalledTimes(1);
    await userEvent.click(remove);

    expect(s.unset).toHaveBeenCalledWith(KEY, 'machine');
    await waitFor(() => expect(explainGet).toHaveBeenCalledTimes(2));
  });

  it('offers no remove on unset or disallowed layers', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    renderModal(store());

    await screen.findByTestId('layer-machine');
    expect(
      screen.queryByRole('button', { name: `remove ${KEY} from team` })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `remove ${KEY} from user` })
    ).toBeInTheDocument();
  });

  it('shows a refused remove', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    const s = store({ unset: vi.fn(async () => 'store is read-only') });
    renderModal(s);

    await userEvent.click(
      await screen.findByRole('button', { name: `remove ${KEY} from user` })
    );
    expect(await screen.findByText('store is read-only')).toBeInTheDocument();
    await waitFor(() => expect(explainGet).toHaveBeenCalledTimes(2));
  });

  it('sets a value at a layer other than the winning one', async () => {
    explainGet.mockImplementation(async () =>
      ok(structuredClone({ def: DEF, rows: ROWS }))
    );
    const s = store();
    renderModal(s);

    await userEvent.click(
      await screen.findByRole('button', { name: `set ${KEY} at user` })
    );
    const input = within(screen.getByTestId('layer-user')).getByRole(
      'textbox',
      { name: KEY }
    );
    await userEvent.clear(input);
    await userEvent.type(input, 'm-other{Enter}');

    expect(s.set).toHaveBeenCalledWith(KEY, 'user', 'm-other');
    await waitFor(() => expect(explainGet).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: `set ${KEY} at user` })
      ).toBeInTheDocument()
    );
  });

  it('Escape inside an edit reverts it without closing the modal', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    const { onClose } = renderModal(store());

    await userEvent.click(
      await screen.findByRole('button', { name: `set ${KEY} at user` })
    );
    const input = within(screen.getByTestId('layer-user')).getByRole(
      'textbox',
      { name: KEY }
    );
    await userEvent.type(input, 'x{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape in a number edit abandons it: no save, modal stays', async () => {
    const days: SettingDefWire = {
      ...DEF,
      key: 'rt.runsPruneDays',
      type: 'number',
      effective: { scope: 'user', file: '/stores/user.jsonc', value: 30 },
    };
    explainGet.mockResolvedValue(
      ok({
        def: days,
        rows: [
          { scope: 'default', file: null, present: false },
          {
            scope: 'user',
            file: '/stores/user.jsonc',
            present: true,
            value: 30,
          },
          { scope: 'machine', file: '/stores/local.jsonc', present: false },
        ],
      })
    );
    const s = store({ defs: [days] });
    const { onClose } = renderModal(s, 'rt.runsPruneDays');

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'set rt.runsPruneDays at machine',
      })
    );
    const input = within(screen.getByTestId('layer-machine')).getByRole(
      'textbox',
      { name: 'rt.runsPruneDays' }
    );
    await userEvent.type(input, '45{Escape}');

    expect(s.set).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(input).not.toHaveFocus();
  });

  it('Escape outside a field closes', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    const { onClose } = renderModal(store());
    await screen.findByTestId('explain-sentence');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes from its close button', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    const { onClose } = renderModal(store());
    await userEvent.click(
      await screen.findByRole('button', { name: 'Close modal' })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('loads the key itself when no store is passed', async () => {
    explainGet.mockResolvedValue(ok({ def: DEF, rows: ROWS }));
    vi.stubGlobal('fetch', (url: string) => {
      if (url.startsWith('/api/settings/explain/')) return explainGet(url);
      if (url.startsWith('/api/settings/defs'))
        return Promise.resolve(ok({ defs: [DEF] }));
      return Promise.resolve(ok({}));
    });
    const onClose = vi.fn();
    const queryClient = new QueryClient();
    renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <ExplainModal settingKey={KEY} onClose={onClose} />
      </QueryClientProvider>
    );
    expect(await screen.findByTestId('explain-sentence')).toHaveTextContent(
      'because the machine layer sets it'
    );
  });

  it('says so for an unknown key', async () => {
    renderModal(store(), 'no.such.key');
    expect(
      await screen.findByText('No setting named no.such.key is registered.')
    ).toBeInTheDocument();
  });

  it('is closed without a key', () => {
    renderModal(store(), null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a composite layer shows its whole value, never cut at 40 characters', async () => {
    const LONG = {
      triggers: [
        {
          name: 'nightly-sync',
          event: 'cron/tick',
          run: ['rt', 'sync', '--all'],
        },
      ],
    };
    const CRON: SettingDefWire = {
      ...DEF,
      key: 'rt.cron',
      type: 'object',
      scopes: ['machine'],
      merge: 'deep',
      effective: { scope: 'machine', file: '/stores/local.jsonc', value: LONG },
    };
    explainGet.mockResolvedValue(
      ok({
        def: CRON,
        rows: [
          { scope: 'default', file: null, present: false },
          {
            scope: 'machine',
            file: '/stores/local.jsonc',
            present: true,
            value: LONG,
          },
        ],
      })
    );
    renderModal(store({ defs: [CRON] }), 'rt.cron');
    const layer = await screen.findByTestId('layer-machine');
    expect(layer).toHaveTextContent('"name": "nightly-sync"');
    expect(layer).toHaveTextContent('"--all"');
    expect(layer.textContent).not.toContain('…');
  });

  it('Set at an unset objectList layer opens the form, not JSON', async () => {
    const BRIDGES: SettingDefWire = {
      ...DEF,
      key: 'rt.notify.eventBridges',
      type: 'array',
      scopes: ['user', 'machine'],
      merge: 'replace',
      effective: { scope: 'default', file: null, value: [] },
      ...schemaFields('rt.notify.eventBridges'),
    };
    explainGet.mockResolvedValue(
      ok({
        def: BRIDGES,
        rows: [
          { scope: 'default', file: null, present: false },
          { scope: 'user', file: '/stores/user.jsonc', present: false },
          { scope: 'machine', file: '/stores/local.jsonc', present: false },
        ],
      })
    );
    renderModal(store({ defs: [BRIDGES] }), 'rt.notify.eventBridges');

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'set rt.notify.eventBridges at user',
      })
    );
    const layer = screen.getByTestId('layer-user');
    expect(
      within(layer).getByText('Editing the user layer')
    ).toBeInTheDocument();
    expect(
      within(layer).getByRole('button', { name: 'Add item' })
    ).toBeInTheDocument();
    expect(within(layer).queryByRole('textbox', { name: 'JSON' })).toBeNull();
  });

  it('rt.worktreeReadyApproval has no pencil or text editor, only Remove', async () => {
    const APPROVAL: SettingDefWire = {
      ...DEF,
      key: 'rt.worktreeReadyApproval',
      scopes: ['user', 'team', 'machine'],
      repoScoped: true,
      description:
        'Per-repo user approval of a team-authored ready shell ladder.',
      effective: {
        scope: 'user',
        file: '/home/user/settings.user.jsonc',
        value: '3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d',
      },
    };
    explainGet.mockResolvedValue(
      ok({
        def: APPROVAL,
        rows: [
          { scope: 'default', file: null, present: false },
          {
            scope: 'team',
            file: '/home/team/settings.team.jsonc',
            present: false,
          },
          {
            scope: 'user',
            file: '/home/user/settings.user.jsonc',
            present: true,
            value: '3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d',
          },
          { scope: 'machine', file: '/stores/local.jsonc', present: false },
        ],
      })
    );
    renderModal(store({ defs: [APPROVAL] }), APPROVAL.key);

    const layer = await screen.findByTestId('layer-user');
    expect(
      within(layer).queryByRole('button', {
        name: `set ${APPROVAL.key} at user`,
      })
    ).toBeNull();
    expect(within(layer).queryByRole('textbox')).toBeNull();
    expect(
      within(layer).getByRole('button', {
        name: `remove ${APPROVAL.key} from user`,
      })
    ).toBeInTheDocument();
  });
});

describe('with a repo picked', () => {
  const REPO = 'gitlab.example.com/acme/app';
  const REPO_KEY = 'rt.roles';

  const REPO_DEF: SettingDefWire = {
    key: REPO_KEY,
    type: 'string',
    scopes: ['team', 'user', 'machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: true,
    writable: true,
    description: 'Per-repo dev role definitions.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: 'team', file: '/stores/team.jsonc', value: 'global' },
    storeVersion: 1,
  };

  const REPO_ROWS: ExplainRowWire[] = [
    { scope: 'default', file: null, present: false },
    {
      scope: 'team',
      file: '/stores/team.jsonc',
      present: true,
      value: 'global',
    },
    {
      scope: 'team.repo',
      file: '/stores/team-repo.jsonc',
      present: true,
      value: 'override',
    },
    { scope: 'user', file: '/stores/user.jsonc', present: false },
    { scope: 'user.repo', file: '/stores/user-repo.jsonc', present: false },
    { scope: 'machine', file: '/stores/local.jsonc', present: false },
    {
      scope: 'machine.repo',
      file: '/stores/machine-repo.jsonc',
      present: false,
    },
  ];

  it('names a repo rung distinctly from its global layer', async () => {
    explainGet.mockResolvedValue(ok({ def: REPO_DEF, rows: REPO_ROWS }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWithProviders(
      <SettingsRepoContext.Provider value={REPO}>
        <QueryClientProvider client={queryClient}>
          <ExplainModal
            settingKey={REPO_KEY}
            store={store({ defs: [REPO_DEF] })}
            onClose={vi.fn()}
          />
        </QueryClientProvider>
      </SettingsRepoContext.Provider>
    );

    const globalRemove = await screen.findByRole('button', {
      name: `remove ${REPO_KEY} from team`,
    });
    const rungRemove = screen.getByRole('button', {
      name: `remove ${REPO_KEY} from team · repo`,
    });
    expect(globalRemove).not.toBe(rungRemove);

    expect(
      screen.getByRole('button', { name: `set ${REPO_KEY} at team` })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `set ${REPO_KEY} at team · repo` })
    ).toBeInTheDocument();
  });

  it('clearing a repo-rung scalar unsets that rung, not the global layer', async () => {
    explainGet.mockResolvedValue(ok({ def: REPO_DEF, rows: REPO_ROWS }));
    const s = store({ defs: [REPO_DEF] });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWithProviders(
      <SettingsRepoContext.Provider value={REPO}>
        <QueryClientProvider client={queryClient}>
          <ExplainModal settingKey={REPO_KEY} store={s} onClose={vi.fn()} />
        </QueryClientProvider>
      </SettingsRepoContext.Provider>
    );

    await userEvent.click(
      await screen.findByRole('button', {
        name: `set ${REPO_KEY} at team · repo`,
      })
    );
    const layer = screen.getByTestId('layer-team.repo');
    const input = within(layer).getByRole('textbox', { name: REPO_KEY });
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith(REPO_KEY, 'team', REPO)
    );
  });

  it('Fix opens the repo-rung layer in the form, Save off, and the explain fetch carries the repo', async () => {
    const ROLES: SettingDefWire = {
      ...REPO_DEF,
      merge: 'deep',
      type: 'object',
      ...schemaFields('rt.roles'),
    };
    explainGet.mockResolvedValue(
      ok({
        def: ROLES,
        rows: [
          { scope: 'default', file: null, present: false },
          { scope: 'team', file: '/stores/team.jsonc', present: false },
          {
            scope: 'team.repo',
            file: '/stores/team-repo.jsonc',
            present: true,
            value: { dev: { fixedPort: '3000' } },
            nonconforming: [
              {
                path: ['dev', 'fixedPort'],
                message: 'expected number, got string',
              },
            ],
          },
          { scope: 'user', file: '/stores/user.jsonc', present: false },
          {
            scope: 'user.repo',
            file: '/stores/user-repo.jsonc',
            present: false,
          },
          { scope: 'machine', file: '/stores/local.jsonc', present: false },
          {
            scope: 'machine.repo',
            file: '/stores/machine-repo.jsonc',
            present: false,
          },
        ],
      })
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWithProviders(
      <SettingsRepoContext.Provider value={REPO}>
        <QueryClientProvider client={queryClient}>
          <ExplainModal
            settingKey={REPO_KEY}
            fix="team.repo"
            store={store({ defs: [ROLES] })}
            onClose={vi.fn()}
          />
        </QueryClientProvider>
      </SettingsRepoContext.Provider>
    );

    const layer = await screen.findByTestId('layer-team.repo');
    expect(
      within(layer).getByText('Editing the team · repo layer')
    ).toBeInTheDocument();
    expect(within(layer).getByRole('button', { name: 'Save' })).toBeDisabled();
    await waitFor(() =>
      expect(
        explainGet.mock.calls.some((call: unknown[]) =>
          (call[0] as string).includes(`repo=${encodeURIComponent(REPO)}`)
        )
      ).toBe(true)
    );
  });

  it('with all repos, lists each repo that sets the key and switches to it', async () => {
    const REPO = 'gitlab.example.com/acme/app';
    const ROLES: SettingDefWire = {
      ...DEF,
      key: 'rt.roles',
      type: 'object',
      scopes: ['user', 'team', 'machine'],
      merge: 'deep',
      repoScoped: true,
      repos: [{ identity: REPO, scopes: ['team'] }],
      effective: { scope: null, file: null },
    };
    // settings-kit 0.4.0's /explain never sets `repos` (only /defs does), so
    // the mock omits it here to exercise ExplainBody's carry-over from the
    // /defs-sourced store def.
    const EXPLAINED_ROLES: SettingDefWire = { ...ROLES, repos: undefined };
    explainGet.mockImplementation(async (url: string) =>
      ok({
        def: EXPLAINED_ROLES,
        rows: url.includes('repo=')
          ? [
              { scope: 'default', file: null, present: false },
              {
                scope: 'team.repo',
                file: '/home/team/settings.team.jsonc',
                present: true,
                value: { dev: { fixedPort: 3000 } },
              },
            ]
          : [{ scope: 'default', file: null, present: false }],
      })
    );
    const onPickRepo = vi.fn();
    const queryClient = new QueryClient();
    renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <ExplainModal
          settingKey="rt.roles"
          store={store({ defs: [ROLES] })}
          onClose={vi.fn()}
          onPickRepo={onPickRepo}
        />
      </QueryClientProvider>
    );
    const section = await screen.findByTestId(`repo-${REPO}`);
    expect(within(section).getByText('acme/app')).toBeInTheDocument();
    expect(within(section).getByText('team · repo')).toBeInTheDocument();
    expect(section).toHaveTextContent('"fixedPort": 3000');
    await userEvent.click(
      within(section).getByRole('button', { name: 'Show acme/app' })
    );
    expect(onPickRepo).toHaveBeenCalledWith(REPO);
  });
});
