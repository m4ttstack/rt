import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SettingRow } from './SettingRow';
import { UnregisteredNote } from './UnregisteredNote';

const APPROVAL: SettingDefWire = {
  key: 'rt.worktreeReadyApproval',
  type: 'string',
  scopes: ['user', 'team', 'machine'],
  merge: 'replace',
  secret: false,
  teamLocked: false,
  repoScoped: true,
  writable: true,
  description: 'Per-repo user approval of a team-authored ready shell ladder.',
  hasDefault: false,
  defaultValue: null,
  effective: {
    scope: 'user',
    file: '/home/user/settings.user.jsonc',
    value: '3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d',
  },
  storeVersion: 1,
};

const store = () => ({
  set: vi.fn(async () => null as string | null),
  unset: vi.fn(async () => null as string | null),
  move: vi.fn(async () => null as string | null),
});

describe('rt.worktreeReadyApproval', () => {
  it('is read-only, explained, and revocable from its layer', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={APPROVAL} store={s} subhead={null} query="" />
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('3f2a9c1e8b7d')).toBeInTheDocument();
    expect(screen.getByTestId('approval-note')).toHaveTextContent(
      "approves the team's worktree ready commands by their hash; approve with rt worktree ready-approve"
    );
    expect(screen.queryByRole('button', { name: /actions$/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.worktreeReadyApproval', 'user')
    );
  });

  it('has nothing to revoke when unset', () => {
    renderWithProviders(
      <SettingRow
        def={{ ...APPROVAL, effective: { scope: null, file: null } }}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('shows its scope badge like any row, outside a matching subhead', () => {
    renderWithProviders(
      <SettingRow def={APPROVAL} store={store()} subhead={null} query="" />
    );
    expect(screen.getByText('user')).toBeInTheDocument();
  });

  it('suppresses its badge under a matching subhead, same as any row', () => {
    renderWithProviders(
      <SettingRow def={APPROVAL} store={store()} subhead="user" query="" />
    );
    expect(screen.queryByText('user')).toBeNull();
  });
});

describe('UnregisteredNote', () => {
  it('lists each unregistered key with its file and says rt ignores them', () => {
    renderWithProviders(
      <UnregisteredNote
        entries={[
          {
            key: 'board.claudeCommand',
            scope: 'machine',
            file: '/home/user/local/settings.local.jsonc',
          },
          {
            key: 'board.rtRepos',
            scope: 'machine',
            file: '/home/user/local/settings.local.jsonc',
          },
        ]}
      />
    );
    expect(
      screen.getByText(
        '2 keys in your stores are not registered; rt ignores them.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('board.claudeCommand')).toBeInTheDocument();
    expect(
      screen.getAllByText('/home/user/local/settings.local.jsonc')
    ).toHaveLength(2);
  });

  it('renders nothing for none', () => {
    renderWithProviders(<UnregisteredNote entries={[]} />);
    expect(screen.queryByTestId('unregistered-note')).toBeNull();
  });

  it('constrains a long file path so it never widens the page', () => {
    const longFile =
      '/home/user/local/deeply/nested/config/directory/tree/settings.local.jsonc';
    renderWithProviders(
      <UnregisteredNote
        entries={[
          { key: 'board.claudeCommand', scope: 'machine', file: longFile },
        ]}
      />
    );
    const file = screen.getByTitle(longFile);
    expect(file.style.flex).toBe('1 1 0%');
    expect(file.style.minWidth).toBe('0px');
    // A nowrap, truncated Text's min-content is its full untruncated width;
    // minWidth: 0 alone does not stop that width reaching an ancestor
    // querying intrinsic size (a page-wide ScrollArea, say). `contain`
    // stops it at the source.
    expect(file.style.contain).toBe('inline-size');
    const row = file.closest('.mantine-Group-root') as HTMLElement;
    expect(row.style.minWidth).toBe('0px');
  });
});
