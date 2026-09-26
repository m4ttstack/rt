import { useState } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { checkValue } from '@mattstack/settings-kit/shapes';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formShape } from './formShape';
import { NamedSections } from './NamedSections';
import { SettingRow } from './SettingRow';
import { schemaFields } from './testSchemas';

const store = () => ({
  set: vi.fn(async () => null as string | null),
  unset: vi.fn(async () => null as string | null),
  move: vi.fn(async () => null as string | null),
});

function deepDef(
  key: string,
  value: Record<string, unknown>,
  scopes: string[] = ['user']
): SettingDefWire {
  return {
    key,
    type: 'object',
    scopes: scopes as SettingDefWire['scopes'],
    merge: 'deep',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'A map.',
    hasDefault: true,
    defaultValue: {},
    effective: { scope: 'user', file: '/home/user/settings.user.jsonc', value },
    storeVersion: 1,
    ...schemaFields(key),
  };
}

function stubRows(rows: ExplainRowWire[]) {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ def: null, rows }),
  }));
}
afterEach(() => vi.unstubAllGlobals());

async function openRow(def: SettingDefWire, s = store()) {
  renderWithProviders(
    <SettingRow def={def} store={s} subhead={null} query="" />
  );
  await userEvent.click(
    screen.getByRole('button', { name: /^\d+ entr(y|ies)$/ })
  );
  return s;
}

describe('named sections', () => {
  const DEFAULT_FORGE = { 'gitlab.example.com': { provider: 'gitlab' } };
  const USER_FORGE = {
    'github.example.com': { provider: 'github', tokenEnv: 'GH_TOKEN' },
  };

  it("a deep map edits only the target layer's own entries", async () => {
    stubRows([
      { scope: 'default', file: null, present: true, value: DEFAULT_FORGE },
      {
        scope: 'user',
        file: '/home/user/settings.user.jsonc',
        present: true,
        value: USER_FORGE,
      },
    ]);
    const s = await openRow(
      deepDef('gitq.forges', { ...DEFAULT_FORGE, ...USER_FORGE })
    );
    expect(
      await screen.findByTestId('entry-github.example.com')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('entry-gitlab.example.com')).toBeNull();
    await userEvent.type(screen.getByLabelText('new host'), 'git.example.org');
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    const added = screen.getByTestId('entry-git.example.org');
    await userEvent.click(
      within(added).getByRole('button', { name: 'Add property' })
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'baseUrl' })
    );
    await userEvent.type(
      within(added).getByLabelText('baseUrl'),
      'https://git.example.org'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('gitq.forges', 'user', {
        ...USER_FORGE,
        'git.example.org': { baseUrl: 'https://git.example.org' },
      })
    );
  });

  it('rejects an empty or duplicate entry name', async () => {
    stubRows([
      {
        scope: 'user',
        file: '/home/user/settings.user.jsonc',
        present: true,
        value: USER_FORGE,
      },
    ]);
    await openRow(deepDef('gitq.forges', USER_FORGE));
    await screen.findByTestId('entry-github.example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    expect(screen.getByText('host is required')).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText('new host'),
      'github.example.com'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    expect(
      screen.getByText('github.example.com already exists')
    ).toBeInTheDocument();
  });

  it('removes an entry', async () => {
    stubRows([
      {
        scope: 'user',
        file: '/home/user/settings.user.jsonc',
        present: true,
        value: USER_FORGE,
      },
    ]);
    const s = await openRow(deepDef('gitq.forges', USER_FORGE));
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'remove entry github.example.com',
      })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    // An emptied deep layer is removed rather than written as {}.
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('gitq.forges', 'user')
    );
  });

  it('deck.apps draws its nested override read-only and keeps it on save', async () => {
    const APPS = {
      'acme-app': {
        published: true,
        override: { devPort: 5173, basePort: 4100 },
      },
    };
    stubRows([
      {
        scope: 'user',
        file: '/home/user/settings.user.jsonc',
        present: true,
        value: APPS,
      },
    ]);
    const s = await openRow(deepDef('deck.apps', APPS));
    const section = await screen.findByTestId('entry-acme-app');
    expect(within(section).getByText('override')).toBeInTheDocument();
    expect(
      within(section).getByText('{"devPort":5173,"basePort":4100}')
    ).toBeInTheDocument();
    expect(
      within(section).getByText('kept on save · edit in JSON')
    ).toBeInTheDocument();
    await userEvent.click(
      within(section).getByRole('switch', { name: 'published' })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('deck.apps', 'user', {
        'acme-app': {
          published: false,
          override: { devPort: 5173, basePort: 4100 },
        },
      })
    );
  });

  it('an entry named constructor renders and edits', async () => {
    const FORGE = { constructor: { provider: 'github' } };
    stubRows([
      {
        scope: 'user',
        file: '/home/user/settings.user.jsonc',
        present: true,
        value: FORGE,
      },
    ]);
    const s = await openRow(deepDef('gitq.forges', FORGE));
    const section = await screen.findByTestId('entry-constructor');
    await userEvent.click(
      within(section).getByRole('combobox', { name: 'provider' })
    );
    await userEvent.click(
      await screen.findByRole('option', { name: 'gitlab' })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('gitq.forges', 'user', {
        constructor: { provider: 'gitlab' },
      })
    );
  });

  it('a long duplicate-name error shrinks without displacing Cancel/Save', async () => {
    stubRows([
      {
        scope: 'user',
        file: '/home/user/settings.user.jsonc',
        present: true,
        value: USER_FORGE,
      },
    ]);
    await openRow(deepDef('gitq.forges', USER_FORGE));
    await screen.findByTestId('entry-github.example.com');
    await userEvent.type(
      screen.getByLabelText('new host'),
      'github.example.com'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    const error = screen.getByText('github.example.com already exists');
    expect(error).toHaveAttribute('data-truncate');
    expect(error.style.minWidth).toBe('0px');
    expect(screen.getByLabelText('new host')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add entry' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});

describe('named sections touched state', () => {
  const RECORD_SCHEMA = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    propertyNames: { type: 'string' },
    additionalProperties: {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
      additionalProperties: {},
    },
  };
  const RECORD_SHAPE = formShape(RECORD_SCHEMA)!;

  function Harness({
    initial,
  }: {
    initial: Record<string, Record<string, unknown>>;
  }) {
    const [value, setValue] = useState(initial);
    const issues = checkValue(RECORD_SCHEMA, value);
    return (
      <NamedSections
        shape={RECORD_SHAPE}
        value={value}
        onChange={setValue}
        disabled={false}
        issues={issues}
        footerEnd={null}
      />
    );
  }

  it('removing an entry clears its touched fields, so a re-added same name starts untouched', async () => {
    renderWithProviders(<Harness initial={{ alpha: { label: 'x' } }} />);
    const first = screen.getByTestId('entry-alpha');
    await userEvent.clear(within(first).getByLabelText('label'));
    expect(within(first).getByText('required')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'remove entry alpha' })
    );
    expect(screen.queryByTestId('entry-alpha')).toBeNull();

    await userEvent.type(screen.getByLabelText('new name'), 'alpha');
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    const second = screen.getByTestId('entry-alpha');
    expect(within(second).queryByText('required')).toBeNull();
  });
});
