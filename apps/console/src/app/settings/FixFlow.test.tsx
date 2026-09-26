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

const REPO = 'gitlab.example.com/acme/app';
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
});

describe('Fix in the explain modal', () => {
  afterEach(() => vi.unstubAllGlobals());

  function openFix(d: SettingDefWire, rows: ExplainRowWire[]) {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ def: d, rows }),
    }));
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey={d.key}
          fix="user"
          store={{
            defs: [d],
            loading: false,
            error: null,
            set: vi.fn(async () => null),
            unset: vi.fn(async () => null),
            move: vi.fn(async () => null),
            prune: vi.fn(async () => null),
          }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
  }

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
