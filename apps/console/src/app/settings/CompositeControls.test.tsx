import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingRow } from './SettingRow';

function def(key: string, over: Partial<SettingDefWire>): SettingDefWire {
  return {
    key,
    type: 'array',
    scopes: ['machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'A composite.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: null, file: null },
    ...over,
  };
}
const store = () => ({
  set: vi.fn(async () => null),
  unset: vi.fn(async () => null),
  move: vi.fn(async () => null),
});

const SNAPSHOT_DEFAULTS = {
  enabled: true,
  debounceSec: 20,
  pushDelaySec: 60,
  janitorThresholdHours: 6,
  janitorIntervalMin: 30,
};

function stubExplain() {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      def: {},
      rows: [
        {
          scope: 'default',
          file: null,
          present: true,
          value: SNAPSHOT_DEFAULTS,
        },
        {
          scope: 'machine',
          file: '/m',
          present: true,
          value: { enabled: false },
        },
      ],
    }),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('composite rows', () => {
  const PREFIXES = def('board.ticketPrefixes', {
    scopes: ['team'],
    effective: { scope: 'team', file: '/t', value: ['RT', 'MAT'] },
  });

  it('a short string list shows its items as tags with a separate add control', () => {
    renderWithProviders(
      <SettingRow def={PREFIXES} store={store()} subhead={null} query="" />
    );
    expect(screen.getByText('RT')).toBeInTheDocument();
    expect(screen.getByText('MAT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'remove RT' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'remove MAT' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('the add control opens a field that appends on Enter', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('board.ticketPrefixes', {
          scopes: ['team'],
          effective: { scope: 'team', file: '/t', value: ['RT'] },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    );
    const field = screen.getByRole('textbox', { name: 'board.ticketPrefixes' });
    expect(field).toHaveFocus();
    await userEvent.type(field, 'MAT{enter}');
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', [
        'RT',
        'MAT',
      ])
    );
    expect(s.set).toHaveBeenCalledTimes(1);
  });

  it('an inline tag keeps its commas', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('boxscore.excludeFilePatterns', {
          scopes: ['team'],
          effective: { scope: 'team', file: '/t', value: ['*.md'] },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: 'add to boxscore.excludeFilePatterns',
      })
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'boxscore.excludeFilePatterns' }),
      '*.{{js,ts}{enter}'
    );
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith(
        'boxscore.excludeFilePatterns',
        'team',
        ['*.md', '*.{js,ts}']
      )
    );
    expect(s.set).toHaveBeenCalledTimes(1);
  });

  it('a tag’s x removes just that item', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(screen.getByRole('button', { name: 'remove RT' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', [
        'MAT',
      ])
    );
  });

  it('Backspace in an empty add field removes the last tag', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    );
    await userEvent.keyboard('{Backspace}');
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', ['RT'])
    );
  });

  it('Escape closes the add field and writes nothing', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    );
    await userEvent.keyboard('JIRA{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    ).toBeInTheDocument();
    expect(s.set).not.toHaveBeenCalled();
  });

  it('leaving the add field keeps what was typed', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    );
    await userEvent.keyboard('JIRA');
    await userEvent.tab();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', [
        'RT',
        'MAT',
        'JIRA',
      ])
    );
  });

  it('after an Escape, the next add still saves on leaving the field', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    const plus = () =>
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' });
    await userEvent.click(plus());
    await userEvent.keyboard('{Escape}');
    await userEvent.click(plus());
    await userEvent.keyboard('JIRA');
    await userEvent.tab();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', [
        'RT',
        'MAT',
        'JIRA',
      ])
    );
  });

  it('keys in the add field write nothing more while a save is in flight', async () => {
    const s = store();
    s.set.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    );
    await userEvent.keyboard('{Backspace}');
    await waitFor(() => expect(s.set).toHaveBeenCalledTimes(1));
    await userEvent.keyboard('{Backspace}{Enter}');
    expect(s.set).toHaveBeenCalledTimes(1);
  });

  it('removing a tag from the keyboard leaves focus on the add control', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    screen.getByRole('button', { name: 'remove RT' }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(s.set).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
      ).toHaveFocus()
    );
  });

  it('tabbing out after a Backspace removal leaves focus where Tab put it', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    );
    await userEvent.keyboard('{Backspace}');
    await waitFor(() => expect(s.set).toHaveBeenCalledTimes(1));
    await userEvent.tab();
    expect(
      screen.getByRole('button', { name: 'board.ticketPrefixes actions' })
    ).toHaveFocus();
  });

  it('a repeated item removes one copy at a time', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('board.ticketPrefixes', {
          scopes: ['team'],
          effective: { scope: 'team', file: '/t', value: ['RT', 'RT', 'MAT'] },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getAllByRole('button', { name: 'remove RT' })[1]!
    );
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', [
        'RT',
        'MAT',
      ])
    );
  });

  it('inline tags hold still while a save is in flight', async () => {
    const s = store();
    s.set.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(screen.getByRole('button', { name: 'remove RT' }));
    await waitFor(() => expect(s.set).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'remove MAT' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    ).toBeDisabled();
  });

  it('list editors hold still while a save is in flight', async () => {
    const s = store();
    s.set.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(
      <SettingRow
        def={def('rt.repoRoots', {
          effective: {
            scope: 'machine',
            file: '/m',
            value: ['~/a', '~/b', '~/c', '~/d'],
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: /4 /, expanded: false })
    );
    await userEvent.click(screen.getByRole('button', { name: 'remove ~/a' }));
    await waitFor(() => expect(s.set).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'remove ~/b' })).toBeDisabled();
    expect(screen.getByLabelText('add to rt.repoRoots')).toBeDisabled();
  });

  it('a long string list expands to rows with remove and add', async () => {
    const s = store();
    const value = ['~/a', '~/b', '~/c', '~/d'];
    renderWithProviders(
      <SettingRow
        def={def('rt.repoRoots', {
          effective: { scope: 'machine', file: '/m', value },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /4 roots/ }));
    await userEvent.click(screen.getByRole('button', { name: 'remove ~/b' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.repoRoots', 'machine', [
        '~/a',
        '~/c',
        '~/d',
      ])
    );
    await userEvent.type(
      screen.getByLabelText('add to rt.repoRoots'),
      '~/e{enter}'
    );
    await waitFor(() =>
      expect(s.set).toHaveBeenLastCalledWith('rt.repoRoots', 'machine', [
        '~/a',
        '~/b',
        '~/c',
        '~/d',
        '~/e',
      ])
    );
  });

  it('a string map edits a value in place', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.repoIdentityOverrides', {
          type: 'object',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { 'https://example.dev/a.git': 'a' },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /1 entry/ }));
    const identity = screen.getByLabelText(
      'identity for https://example.dev/a.git'
    );
    await userEvent.clear(identity);
    await userEvent.type(identity, 'apps');
    identity.blur();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith(
        'rt.repoIdentityOverrides',
        'machine',
        { 'https://example.dev/a.git': 'apps' }
      )
    );
  });

  it('a leaves field writes onto the target layer’s own object and shows its source', async () => {
    stubExplain();
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { ...SNAPSHOT_DEFAULTS, enabled: false },
            authored: { enabled: false },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /1 of 5 set/ }));
    expect(await screen.findByText('debounceSec')).toBeInTheDocument();
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.clear(debounce);
    await userEvent.type(debounce, '45');
    debounce.blur();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.homeSnapshot', 'machine', {
        enabled: false,
        debounceSec: 45,
      })
    );
  });

  it('emptying a number leaf clears that field from the target layer', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        def: {},
        rows: [
          {
            scope: 'default',
            file: null,
            present: true,
            value: SNAPSHOT_DEFAULTS,
          },
          {
            scope: 'machine',
            file: '/m',
            present: true,
            value: { enabled: false, debounceSec: 45 },
          },
        ],
      }),
    }));
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { ...SNAPSHOT_DEFAULTS, enabled: false, debounceSec: 45 },
            authored: { enabled: false, debounceSec: 45 },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /2 of 5 set/ }));
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.clear(debounce);
    debounce.blur();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.homeSnapshot', 'machine', {
        enabled: false,
      })
    );
  });

  it('emptying a leaf the target layer does not set writes nothing and restores it', async () => {
    stubExplain();
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { ...SNAPSHOT_DEFAULTS, enabled: false },
            authored: { enabled: false },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /1 of 5 set/ }));
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.clear(debounce);
    debounce.blur();
    await waitFor(() =>
      expect(screen.getByLabelText('rt.homeSnapshot.debounceSec')).toHaveValue(
        '20'
      )
    );
    expect(s.set).not.toHaveBeenCalled();
    expect(s.unset).not.toHaveBeenCalled();
  });

  it('emptying the last field the target layer sets unsets that layer', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        def: {},
        rows: [
          {
            scope: 'default',
            file: null,
            present: true,
            value: SNAPSHOT_DEFAULTS,
          },
          {
            scope: 'machine',
            file: '/m',
            present: true,
            value: { debounceSec: 45 },
          },
        ],
      }),
    }));
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { ...SNAPSHOT_DEFAULTS, debounceSec: 45 },
            authored: { debounceSec: 45 },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /1 of 5 set/ }));
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.clear(debounce);
    debounce.blur();
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.homeSnapshot', 'machine')
    );
    expect(s.set).not.toHaveBeenCalled();
  });

  it('a leaves field follows a refreshed value and writes nothing on a bare blur', async () => {
    stubExplain();
    const s = store();
    const at = (debounceSec: number) =>
      def('rt.homeSnapshot', {
        type: 'object',
        merge: 'deep',
        effective: {
          scope: 'machine',
          file: '/m',
          value: { ...SNAPSHOT_DEFAULTS, enabled: false, debounceSec },
          authored: { enabled: false, debounceSec },
        },
      });
    const { rerender } = renderWithProviders(
      <SettingRow def={at(20)} store={s} subhead={null} query="" />
    );
    await userEvent.click(screen.getByRole('button', { name: /2 of 5 set/ }));
    await waitFor(() =>
      expect(screen.getByLabelText('rt.homeSnapshot.debounceSec')).toBeEnabled()
    );
    rerender(<SettingRow def={at(90)} store={s} subhead={null} query="" />);
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    expect(debounce).toHaveValue('90');
    await userEvent.click(debounce);
    debounce.blur();
    await new Promise(r => setTimeout(r, 0));
    expect(s.set).not.toHaveBeenCalled();
  });

  it('after a scope move, leaf fields wait for fresh rows and write onto the new layer', async () => {
    const machineRows = [
      { scope: 'default', file: null, present: true, value: SNAPSHOT_DEFAULTS },
      {
        scope: 'machine',
        file: '/m',
        present: true,
        value: { enabled: false },
      },
      { scope: 'team', file: '/t', present: false },
    ];
    const teamRows = [
      { scope: 'default', file: null, present: true, value: SNAPSHOT_DEFAULTS },
      { scope: 'machine', file: '/m', present: false },
      { scope: 'team', file: '/t', present: true, value: { enabled: false } },
    ];
    let release: () => void = () => {};
    const moved = new Promise<void>(r => (release = r));
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      const rows = calls++ === 0 ? machineRows : (await moved, teamRows);
      return { ok: true, status: 200, json: async () => ({ def: {}, rows }) };
    });
    const s = store();
    const at = (scope: string) =>
      def('rt.homeSnapshot', {
        type: 'object',
        merge: 'deep',
        scopes: ['machine', 'team'],
        effective: {
          scope,
          file: '/x',
          value: { ...SNAPSHOT_DEFAULTS, enabled: false },
          authored: { enabled: false },
        },
      });
    const { rerender } = renderWithProviders(
      <SettingRow def={at('machine')} store={s} subhead={null} query="" />
    );
    await userEvent.click(screen.getByRole('button', { name: /1 of 5 set/ }));
    await waitFor(() =>
      expect(screen.getByLabelText('rt.homeSnapshot.debounceSec')).toBeEnabled()
    );
    rerender(<SettingRow def={at('team')} store={s} subhead={null} query="" />);
    expect(screen.getByLabelText('rt.homeSnapshot.debounceSec')).toBeDisabled();
    release();
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.clear(debounce);
    await userEvent.type(debounce, '45');
    debounce.blur();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.homeSnapshot', 'team', {
        enabled: false,
        debounceSec: 45,
      })
    );
  });

  it('other leaf fields are disabled while a leaf save is pending', async () => {
    stubExplain();
    const s = store();
    s.set.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { ...SNAPSHOT_DEFAULTS, enabled: false },
            authored: { enabled: false },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /1 of 5 set/ }));
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.click(screen.getByLabelText('rt.homeSnapshot.enabled'));
    await waitFor(() => expect(s.set).toHaveBeenCalledTimes(1));
    expect(debounce).toBeDisabled();
  });

  it('leaf fields stay disabled until the layer rows arrive', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { enabled: false },
            authored: { enabled: false },
          },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /1 of 5 set/ }));
    expect(
      await screen.findByLabelText('rt.homeSnapshot.debounceSec')
    ).toBeDisabled();
    expect(screen.getByLabelText('rt.homeSnapshot.enabled')).toBeDisabled();
  });

  it('an empty short list says so instead of showing a blank box', () => {
    renderWithProviders(
      <SettingRow
        def={def('board.ticketPrefixes', {
          scopes: ['team'],
          effective: { scope: 'default', file: null, value: [] },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    ).toBeInTheDocument();
  });

  it('a deep key locked by a weaker layer clears that layer, not the winner', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        def: {},
        rows: [
          {
            scope: 'default',
            file: null,
            present: true,
            value: SNAPSHOT_DEFAULTS,
          },
          {
            scope: 'user',
            file: '/u',
            present: true,
            value: { enabled: 'yes' },
          },
          {
            scope: 'machine',
            file: '/m',
            present: true,
            value: { debounceSec: 45 },
          },
        ],
      }),
    }));
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          scopes: ['user', 'machine'],
          effective: {
            scope: 'machine',
            file: '/m',
            value: { ...SNAPSHOT_DEFAULTS, enabled: 'yes', debounceSec: 45 },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('unexpected shape')).toBeInTheDocument();
    const clear = await screen.findByRole('button', { name: 'Clear' });
    await waitFor(() => expect(clear).toBeEnabled());
    await userEvent.click(clear);
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.homeSnapshot', 'user')
    );
  });

  it('a stored value of the wrong shape locks behind Clear', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.repoRoots', {
          effective: { scope: 'machine', file: '/m', value: [1, 2] },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('unexpected shape')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.repoRoots', 'machine')
    );
  });

  it('an invalid winning layer on a composite offers Clear, not an editor', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.repoRoots', {
          effective: {
            scope: 'machine',
            file: '/m',
            invalid: 'expected array',
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    expect(
      screen.getByText('stored value rejected: expected array')
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.repoRoots', 'machine')
    );
    expect(s.set).not.toHaveBeenCalled();
  });

  it('an unshaped composite is read-only with a preview and its file', async () => {
    renderWithProviders(
      <SettingRow
        def={def('rt.cron', {
          type: 'object',
          writable: false,
          effective: {
            scope: 'machine',
            file: '/stores/local.jsonc',
            value: { triggers: [] },
          },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /1 field/ }));
    expect(screen.getByText('/stores/local.jsonc')).toBeInTheDocument();
    expect(screen.getByText(/"triggers"/)).toBeInTheDocument();
  });

  it('an unset read-only composite summarises as unset, with no toggle', () => {
    renderWithProviders(
      <SettingRow
        def={def('rt.runaway', {
          type: 'object',
          writable: false,
          effective: { scope: null, file: null },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
    expect(screen.getAllByText('unset')).toHaveLength(2);
  });

  it('a shaped key that is not writable gets no editor and no Clear', async () => {
    renderWithProviders(
      <SettingRow
        def={def('board.ticketPrefixes', {
          scopes: ['team'],
          writable: false,
          effective: { scope: 'team', file: '/t', value: ['RT', 7] },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /2 prefixes/ }));
    expect(screen.getByText(/"RT"/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
