import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
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

const USER_FILE = '/home/user/settings.user.jsonc';
const RULE = {
  pattern: 'gate/opened/*',
  category: 'gate',
  title: '{label}',
  message: '{question}',
};
const INTERCEPT = {
  command: 'bun',
  matches: [{ cwdGlob: '/home/user/src/*', role: 'dev' }],
};

function def(
  key: string,
  value: unknown,
  over: Partial<SettingDefWire> = {}
): SettingDefWire {
  return {
    key,
    type: 'array',
    scopes: ['user'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'A JSON key.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: 'user', file: USER_FILE, value },
    storeVersion: 1,
    ...schemaFields(key),
    ...over,
  };
}

function deepDef(
  key: string,
  value: Record<string, unknown>,
  over: Partial<SettingDefWire> = {}
): SettingDefWire {
  return {
    key,
    type: 'object',
    scopes: ['user'],
    merge: 'deep',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'A deep map.',
    hasDefault: true,
    defaultValue: {},
    effective: { scope: 'user', file: USER_FILE, value },
    storeVersion: 1,
    ...schemaFields(key),
    ...over,
  };
}

const store = () => ({
  set: vi.fn(async () => null as string | null),
  unset: vi.fn(async () => null as string | null),
  move: vi.fn(async () => null as string | null),
  prune: vi.fn(async () => null as string | null),
});

function stubRows(rows: ExplainRowWire[], d: SettingDefWire | null = null) {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ def: d, rows }),
  }));
}
afterEach(() => vi.unstubAllGlobals());

const editor = () => screen.getByRole('textbox', { name: 'JSON' });
const setText = (t: string) =>
  fireEvent.change(editor(), { target: { value: t } });

describe('JSON editor', () => {
  it('a key the forms cannot draw edits as JSON with schema errors inline', async () => {
    stubRows([]);
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.intercepts', [INTERCEPT])}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: /^1 intercept$/ })
    );
    expect(editor()).toHaveValue(JSON.stringify([INTERCEPT], null, 2));
    expect(screen.queryByRole('radio', { name: 'Form' })).toBeNull();

    setText('[{"command": "bun"');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByTestId('draft-issue')).toHaveTextContent(/^JSON: /);

    setText('[{"command": "bun"}]');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByTestId('draft-issue')).toHaveTextContent(
      '[0].matches: required property "matches" is missing'
    );

    const next = [{ ...INTERCEPT, command: 'bunx' }];
    setText(JSON.stringify(next));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.intercepts', 'user', next)
    );
  });

  it('switching between form and JSON keeps the draft', async () => {
    stubRows([]);
    renderWithProviders(
      <SettingRow
        def={def('rt.notify.eventBridges', [RULE])}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /^1 bridge$/ }));
    const title = within(screen.getByTestId('item-0')).getByLabelText('title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Gate');
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual([
      { ...RULE, title: 'Gate' },
    ]);
    setText(JSON.stringify([{ ...RULE, title: 'Gate 2' }]));
    await userEvent.click(screen.getByRole('radio', { name: 'Form' }));
    expect(
      within(screen.getByTestId('item-0')).getByLabelText('title')
    ).toHaveValue('Gate 2');
  });

  it('the form stays out of reach while the JSON does not parse', async () => {
    stubRows([]);
    renderWithProviders(
      <SettingRow
        def={def('rt.notify.eventBridges', [RULE])}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /^1 bridge$/ }));
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    setText('[');
    expect(screen.getByRole('radio', { name: 'Form' })).toBeDisabled();
    expect(
      screen.getByText('Fix the JSON to switch back to the form.')
    ).toBeInTheDocument();
  });

  it('a short string list edits as JSON from its row menu', async () => {
    stubRows([]);
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('board.ticketPrefixes', ['RT'], {
          scopes: ['team'],
          effective: { scope: 'team', file: '/t', value: ['RT'] },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'board.ticketPrefixes actions' })
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Edit as JSON' })
    );
    setText('["RT", "MAT"]');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', [
        'RT',
        'MAT',
      ])
    );
  });

  it("a string map's Edit as JSON button opens the JSON editor", async () => {
    stubRows([]);
    renderWithProviders(
      <SettingRow
        def={def(
          'rt.repoIdentityOverrides',
          { 'https://example.dev/a.git': 'a' },
          { type: 'object' }
        )}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /1 entry/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit as JSON' }));
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual({
      'https://example.dev/a.git': 'a',
    });
  });

  it("a leaves field's Edit as JSON button opens the JSON editor", async () => {
    const SNAPSHOT_DEFAULTS = {
      enabled: true,
      debounceSec: 20,
      pushDelaySec: 60,
      janitorThresholdHours: 6,
      janitorIntervalMin: 30,
    };
    stubRows([
      { scope: 'default', file: null, present: true, value: SNAPSHOT_DEFAULTS },
      {
        scope: 'machine',
        file: '/m',
        present: true,
        value: { enabled: false },
      },
    ]);
    renderWithProviders(
      <SettingRow
        def={def(
          'rt.homeSnapshot',
          { ...SNAPSHOT_DEFAULTS, enabled: false },
          {
            type: 'object',
            merge: 'deep',
            scopes: ['machine'],
            effective: {
              scope: 'machine',
              file: '/m',
              value: { ...SNAPSHOT_DEFAULTS, enabled: false },
              authored: { enabled: false },
            },
          }
        )}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /1 of 5 set/ }));
    expect(await screen.findByText('debounceSec')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit as JSON' }));
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual({
      enabled: false,
    });
  });

  it("in JSON mode, a deep map writes only the target layer's own fields", async () => {
    const DEFAULT_FORGE = { 'gitlab.example.com': { provider: 'gitlab' } };
    const USER_FORGE = {
      'github.example.com': { provider: 'github', tokenEnv: 'GH_TOKEN' },
    };
    stubRows([
      { scope: 'default', file: null, present: true, value: DEFAULT_FORGE },
      { scope: 'user', file: USER_FILE, present: true, value: USER_FORGE },
    ]);
    const s = store();
    renderWithProviders(
      <SettingRow
        def={deepDef('gitq.forges', { ...DEFAULT_FORGE, ...USER_FORGE })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /^2 entries$/ }));
    await userEvent.click(await screen.findByRole('radio', { name: 'JSON' }));
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual(
      USER_FORGE
    );
    const next = { ...USER_FORGE, 'git.example.org': { provider: 'gitlab' } };
    setText(JSON.stringify(next));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('gitq.forges', 'user', next)
    );
  });

  it('in the explain modal, Escape abandons a layer edit and leaves the modal open', async () => {
    const d = def('rt.notify.eventBridges', [RULE]);
    stubRows(
      [
        { scope: 'default', file: null, present: false },
        { scope: 'user', file: USER_FILE, present: true, value: [RULE] },
      ],
      d
    );
    const onClose = vi.fn();
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey="rt.notify.eventBridges"
          store={{ defs: [d], loading: false, error: null, ...store() }}
          onClose={onClose}
        />
      </QueryClientProvider>
    );
    const layer = await screen.findByTestId('layer-user');
    await userEvent.click(
      within(layer).getByRole('button', {
        name: 'set rt.notify.eventBridges at user',
      })
    );
    await userEvent.click(within(layer).getByRole('radio', { name: 'JSON' }));
    setText('[]');
    await userEvent.type(
      within(layer).getByRole('textbox', { name: 'JSON' }),
      '{Escape}'
    );
    expect(within(layer).queryByRole('textbox', { name: 'JSON' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
