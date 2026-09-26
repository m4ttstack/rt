import { useState } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const { SettingRow } = await import('./SettingRow');
const { ExplainModal } = await import('./ExplainModal');
const { schemaFields } = await import('./testSchemas');
const { SettingsRepoContext } = await import('./useConsoleSettings');

const USER_FILE = '/home/user/settings.user.jsonc';
const CURRENT = { dev: { fixedPort: 3000 } };
const OLDER = { dev: { fixedPort: 3100 } };
const REPO_ID = 'gitlab.example.com/acme/app';
const REPO_FILE = '/home/team/repo-settings.jsonc';

const ROLES: SettingDefWire = {
  key: 'rt.roles',
  type: 'object',
  scopes: ['user', 'team', 'machine'],
  merge: 'deep',
  secret: false,
  teamLocked: false,
  repoScoped: true,
  writable: true,
  description: 'Roles.',
  hasDefault: false,
  defaultValue: null,
  effective: { scope: 'user', file: USER_FILE, value: CURRENT },
  storeVersion: 2,
  issues: [
    {
      scope: 'user',
      file: USER_FILE,
      kind: 'diverged',
      path: [],
      message: 'rt.roles changed after rt.roles@2 was written',
      storeName: 'rt.roles',
      olderValue: OLDER,
      currentValue: CURRENT,
    },
  ],
  ...schemaFields('rt.roles'),
};

afterEach(() => vi.unstubAllGlobals());

const store = () => ({
  set: vi.fn(async () => null as string | null),
  unset: vi.fn(async () => null as string | null),
  move: vi.fn(async () => null as string | null),
  prune: vi.fn(async () => null as string | null),
});

/** settings-kit 0.5.0's /explain route never sends `issues` (only /defs
    does), so every stub here matches that and leaves the diverged issue to
    come from the `store.defs` row instead. */
function stubExplain(def: SettingDefWire, rows: unknown[]) {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ def: { ...def, issues: undefined }, rows }),
  }));
}

function findConfirm(title: string): Promise<HTMLElement> {
  return screen
    .findByText(title)
    .then(node => node.closest('[role="dialog"]') as HTMLElement);
}

describe('a diverged older name', () => {
  it('the row shows both values, contained so neither widens the page', () => {
    renderWithProviders(
      <SettingRow def={ROLES} store={store()} subhead={null} query="" />
    );
    const line = screen.getByTestId('diverged-user-rt.roles');
    expect(line).toHaveTextContent(
      'user · rt.roles differs from the current value'
    );
    expect(line.style.width).toBe('100%');
    const current = within(line).getByTestId('diverged-current');
    const older = within(line).getByTestId('diverged-older');
    expect(current.parentElement).toBe(older.parentElement);
    expect((current.parentElement as HTMLElement).style.width).toBe('100%');
    expect(current).toHaveTextContent('"fixedPort": 3000');
    expect(older).toHaveTextContent('"fixedPort": 3100');
    for (const col of [current, older]) {
      // flex-shrink must stay 1 (not 0): a column that cannot shrink
      // reports its own unshrinkable width to every ancestor doing
      // intrinsic sizing, widening the whole page (see IssueLines.tsx).
      expect(col.style.flexShrink).toBe('1');
      expect(col.style.minWidth).toBe('0px');
      expect(col.style.contain).toBe('inline-size');
      const block = within(col).getByTestId('json-block');
      expect(block.style.width).toBe('100%');
      expect(block.style.minWidth).toBe('0px');
      expect(block.style.contain).toBe('inline-size');
    }
  });

  it('a secret def shows the message with no value blocks', () => {
    const SECRET: SettingDefWire = {
      ...ROLES,
      secret: true,
      issues: [
        {
          scope: 'user',
          file: USER_FILE,
          kind: 'diverged',
          path: [],
          message: 'rt.roles changed after rt.roles@2 was written',
          storeName: 'rt.roles',
        },
      ],
    };
    renderWithProviders(
      <SettingRow def={SECRET} store={store()} subhead={null} query="" />
    );
    const line = screen.getByTestId('diverged-user-rt.roles');
    expect(line).toHaveTextContent(
      'user · rt.roles differs from the current value'
    );
    expect(within(line).queryByTestId('diverged-current')).toBeNull();
    expect(within(line).queryByTestId('diverged-older')).toBeNull();
  });

  it('a secret def offers no Remove the older name in the modal', async () => {
    const SECRET: SettingDefWire = {
      ...ROLES,
      secret: true,
      issues: [
        {
          scope: 'user',
          file: USER_FILE,
          kind: 'diverged',
          path: [],
          message: 'rt.roles changed after rt.roles@2 was written',
          storeName: 'rt.roles',
        },
      ],
    };
    stubExplain(SECRET, [
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: USER_FILE, present: true },
    ]);
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey="rt.roles"
          store={{ defs: [SECRET], loading: false, error: null, ...store() }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
    await screen.findByTestId('layer-user');
    expect(
      screen.queryByRole('button', { name: 'Remove the older name' })
    ).toBeNull();
  });

  it('Fix edits the current value; Use the older value swaps the draft in; Remove the older name prunes it', async () => {
    stubExplain(ROLES, [
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: USER_FILE, present: true, value: CURRENT },
    ]);
    const s = store();
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey="rt.roles"
          fix="user"
          store={{ defs: [ROLES], loading: false, error: null, ...s }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
    const layer = await screen.findByTestId('layer-user');
    await userEvent.click(within(layer).getByRole('radio', { name: 'JSON' }));
    expect(within(layer).getByRole('textbox', { name: 'JSON' })).toHaveValue(
      JSON.stringify(CURRENT, null, 2)
    );
    await userEvent.click(
      within(layer).getByRole('button', { name: 'Use the older value' })
    );
    expect(within(layer).getByRole('textbox', { name: 'JSON' })).toHaveValue(
      JSON.stringify(OLDER, null, 2)
    );
    await userEvent.click(within(layer).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.roles', 'user', OLDER)
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove the older name' })
    );
    const confirm = await findConfirm('Remove rt.roles');
    expect(confirm).toHaveTextContent('"fixedPort": 3100');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(s.prune).toHaveBeenCalledWith('rt.roles', 'user', 'rt.roles')
    );
  });

  it('Use the older value switches to JSON when the older value does not fit the form', async () => {
    const BAD_OLDER = { dev: 3100 };
    const ROLES_BAD: SettingDefWire = {
      ...ROLES,
      issues: [
        {
          ...ROLES.issues![0]!,
          olderValue: BAD_OLDER,
        },
      ],
    };
    stubExplain(ROLES_BAD, [
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: USER_FILE, present: true, value: CURRENT },
    ]);
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey="rt.roles"
          fix="user"
          store={{ defs: [ROLES_BAD], loading: false, error: null, ...store() }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
    const layer = await screen.findByTestId('layer-user');
    expect(within(layer).getByTestId('entry-dev')).toBeInTheDocument();
    await userEvent.click(
      within(layer).getByRole('button', { name: 'Use the older value' })
    );
    expect(within(layer).queryByTestId('entry-dev')).toBeNull();
    expect(within(layer).getByRole('textbox', { name: 'JSON' })).toHaveValue(
      JSON.stringify(BAD_OLDER, null, 2)
    );
  });

  it('a repo-section prune carries the repo', async () => {
    const ROLES_RUNG: SettingDefWire = {
      ...ROLES,
      issues: [
        {
          scope: 'user.repo',
          file: REPO_FILE,
          repo: REPO_ID,
          kind: 'diverged',
          path: [],
          message: 'rt.roles changed after rt.roles@2 was written',
          storeName: 'rt.roles',
          olderValue: OLDER,
          currentValue: CURRENT,
        },
      ],
    };
    stubExplain(ROLES_RUNG, [
      { scope: 'default', file: null, present: false },
      { scope: 'user.repo', file: REPO_FILE, present: true, value: CURRENT },
    ]);
    const s = store();
    renderWithProviders(
      <SettingsRepoContext.Provider value={REPO_ID}>
        <QueryClientProvider client={new QueryClient()}>
          <ExplainModal
            settingKey="rt.roles"
            store={{ defs: [ROLES_RUNG], loading: false, error: null, ...s }}
            onClose={vi.fn()}
          />
        </QueryClientProvider>
      </SettingsRepoContext.Provider>
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove the older name' })
    );
    const confirm = await findConfirm('Remove rt.roles');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(s.prune).toHaveBeenCalledWith(
        'rt.roles',
        'user',
        'rt.roles',
        REPO_ID
      )
    );
  });

  it('shows the refusal message when prune is refused', async () => {
    stubExplain(ROLES, [
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: USER_FILE, present: true, value: CURRENT },
    ]);
    const s = store();
    s.prune.mockResolvedValue('"rt.roles" is not in the user store');
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey="rt.roles"
          store={{ defs: [ROLES], loading: false, error: null, ...s }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove the older name' })
    );
    const confirm = await findConfirm('Remove rt.roles');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(
        screen.getByText('"rt.roles" is not in the user store')
      ).toBeInTheDocument()
    );
  });

  it('Use the older value in form mode shows the older value in the field itself', async () => {
    stubExplain(ROLES, [
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: USER_FILE, present: true, value: CURRENT },
    ]);
    const s = store();
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey="rt.roles"
          fix="user"
          store={{ defs: [ROLES], loading: false, error: null, ...s }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
    const layer = await screen.findByTestId('layer-user');
    // No switch to JSON: the layer opens in form mode already, since the
    // older value still fits the form.
    await userEvent.click(
      within(layer).getByRole('button', { name: 'Use the older value' })
    );
    expect(within(layer).getByLabelText('fixedPort')).toHaveValue('3100');
    await userEvent.click(within(layer).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.roles', 'user', OLDER)
    );
  });

  it('editing another field afterwards keeps an older-only key', async () => {
    const OLDER_WITH_EXTRA = { dev: { fixedPort: 3100, legacy: 'x' } };
    const ROLES_EXTRA: SettingDefWire = {
      ...ROLES,
      issues: [{ ...ROLES.issues![0]!, olderValue: OLDER_WITH_EXTRA }],
    };
    stubExplain(ROLES_EXTRA, [
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: USER_FILE, present: true, value: CURRENT },
    ]);
    const s = store();
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey="rt.roles"
          fix="user"
          store={{ defs: [ROLES_EXTRA], loading: false, error: null, ...s }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
    const layer = await screen.findByTestId('layer-user');
    await userEvent.click(
      within(layer).getByRole('button', { name: 'Use the older value' })
    );
    const fixedPort = within(layer).getByLabelText('fixedPort');
    await userEvent.clear(fixedPort);
    await userEvent.type(fixedPort, '4000');
    await userEvent.click(within(layer).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.roles', 'user', {
        dev: { fixedPort: 4000, legacy: 'x' },
      })
    );
  });

  it('an older list with a different length renders the right number of cards', async () => {
    const RULE = {
      pattern: 'gate/opened/*',
      category: 'gate',
      title: 't',
      message: 'm',
    };
    const CURRENT_LIST = [RULE];
    const OLDER_LIST = [
      RULE,
      { ...RULE, pattern: 'run/*' },
      { ...RULE, pattern: 'mr/*' },
    ];
    const BRIDGES: SettingDefWire = {
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
      effective: { scope: 'user', file: USER_FILE, value: CURRENT_LIST },
      storeVersion: 2,
      issues: [
        {
          scope: 'user',
          file: USER_FILE,
          kind: 'diverged',
          path: [],
          message:
            'rt.notify.eventBridges changed after rt.notify.eventBridges@2 was written',
          storeName: 'rt.notify.eventBridges',
          olderValue: OLDER_LIST,
          currentValue: CURRENT_LIST,
        },
      ],
      ...schemaFields('rt.notify.eventBridges'),
    };
    stubExplain(BRIDGES, [
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: USER_FILE, present: true, value: CURRENT_LIST },
    ]);
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey="rt.notify.eventBridges"
          fix="user"
          store={{ defs: [BRIDGES], loading: false, error: null, ...store() }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
    const layer = await screen.findByTestId('layer-user');
    expect(within(layer).getByTestId('item-0')).toBeInTheDocument();
    expect(within(layer).queryByTestId('item-1')).toBeNull();
    await userEvent.click(
      within(layer).getByRole('button', { name: 'Use the older value' })
    );
    expect(within(layer).getByTestId('item-0')).toBeInTheDocument();
    expect(within(layer).getByTestId('item-1')).toBeInTheDocument();
    expect(within(layer).getByTestId('item-2')).toBeInTheDocument();
  });

  it('the issue disappears once a successful prune is reflected back through defs', async () => {
    stubExplain(ROLES, [
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: USER_FILE, present: true, value: CURRENT },
    ]);
    function Harness() {
      const [defs, setDefs] = useState<SettingDefWire[]>([ROLES]);
      return (
        <ExplainModal
          settingKey="rt.roles"
          store={{
            defs,
            loading: false,
            error: null,
            set: vi.fn(async () => null),
            unset: vi.fn(async () => null),
            move: vi.fn(async () => null),
            prune: vi.fn(async () => {
              setDefs([{ ...ROLES, issues: [] }]);
              return null;
            }),
          }}
          onClose={vi.fn()}
        />
      );
    }
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <Harness />
      </QueryClientProvider>
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove the older name' })
    );
    const confirm = await findConfirm('Remove rt.roles');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Remove the older name' })
      ).toBeNull()
    );
    expect(screen.queryByTestId('diverged-user-rt.roles')).toBeNull();
  });
});
