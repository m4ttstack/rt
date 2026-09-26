import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import './icons';

import { PageBar, RoomMenu } from './PageBar';
import { fetchMock, installFetchMock } from './test-utils';

beforeEach(() => {
  installFetchMock();
});

afterEach(() => {
  window.localStorage.removeItem('chat-expand-all');
});

test('the members chip opens a roster grouped by status, wake mode in its header', async () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'build',
        memberCount: 3,
        unread: 0,
        mentions: 0,
        defaultWake: 'mention',
      }}
      buddies={[
        { handle: 'a', status: 'live' },
        { handle: 'b', status: 'live' },
        { handle: 'c', status: 'idle' },
        { handle: 'gitq-main', status: 'offline' },
      ]}
    />
  );
  const chip = screen.getByTestId('members-chip');
  expect(chip).toHaveTextContent('3 in #build');
  await userEvent.click(chip);
  expect(await screen.findByTestId('members-dropdown')).toBeInTheDocument();
  expect(screen.getByTestId('members-wakes')).toHaveTextContent(
    'wakes: mention'
  );
  // Status reads from the group each member sits under, not a per-chip label.
  expect(screen.getByText('working')).toBeInTheDocument();
  expect(screen.getByText('idle')).toBeInTheDocument();
  expect(screen.getByText('offline')).toBeInTheDocument();
  expect(screen.getByTestId('members-row-a')).toBeInTheDocument();
  expect(screen.getByTestId('members-row-b')).toBeInTheDocument();
  expect(screen.getByTestId('members-row-c')).toBeInTheDocument();
  expect(screen.getByTestId('members-row-gitq-main')).toBeInTheDocument();
});

test('mark read is explicit: rendering never calls it, the control does', async () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'build', memberCount: 3, unread: 4, mentions: 0 }}
      buddies={[]}
    />
  );
  expect(fetchMock).not.toHaveBeenCalledWith(
    expect.stringContaining('/api/chat/mark'),
    expect.anything()
  );
  await userEvent.click(
    screen.getByRole('button', { name: /mark #build read/i })
  );
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/chat/mark',
    expect.objectContaining({ method: 'POST' })
  );
});

test('the roster lists a member under its status group', async () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }}
      buddies={[{ handle: 'board-fix-auth', status: 'idle' }]}
    />
  );
  await userEvent.click(screen.getByTestId('members-chip'));
  expect(await screen.findByText('idle')).toBeInTheDocument();
  expect(screen.getByTestId('members-row-board-fix-auth')).toBeInTheDocument();
});

test('daemon down: the chip reads last known and the roster withholds presence', async () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }}
      buddies={[
        { handle: 'a', status: 'live' },
        { handle: 'b', status: 'idle' },
      ]}
      reachable={false}
    />
  );
  const chip = screen.getByTestId('members-chip');
  expect(chip).toHaveTextContent('2 in #build · last known');
  await userEvent.click(chip);
  expect(
    await screen.findByText('presence withheld while the daemon is down')
  ).toBeInTheDocument();
  // No status groups while presence is withheld.
  expect(screen.queryByText('working')).toBeNull();
});

test('a DM shows the pair as its title, wakes: all in its member popover', async () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'dm-9f3a2b1c0d4e',
        memberCount: 2,
        unread: 0,
        mentions: 0,
        kind: 'dm',
        participants: { a: 'deck-main', b: 'rt-chat-wt' },
      }}
      buddies={[]}
    />
  );
  expect(screen.getByText('deck-main ↔ rt-chat-wt')).toBeInTheDocument();
  // A DM uses the same members chip + roster as a channel, so wakes moves
  // into the popover header.
  await userEvent.click(screen.getByTestId('members-chip'));
  expect(await screen.findByTestId('members-wakes')).toHaveTextContent(
    'wakes: all'
  );
});

test('a DM without participants shows a neutral title, never its hashed id', () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'dm-9f3a2b1c0d4e',
        memberCount: 2,
        unread: 0,
        mentions: 0,
        kind: 'dm',
      }}
      buddies={[]}
    />
  );
  expect(screen.getByText('Direct message')).toBeInTheDocument();
  expect(screen.queryByText(/dm-9f3a2b1c0d4e/)).toBeNull();
});

test('a DM lists each end and its task in the member roster, join-order gone', async () => {
  const now = 1_700_000_000_000;
  renderWithProviders(
    <PageBar
      room={{
        room: 'dm-8c1d4e6a2f90',
        memberCount: 3,
        unread: 0,
        mentions: 0,
        kind: 'dm',
        participants: { a: 'jay', b: 'max' },
      }}
      now={now}
      buddies={[
        {
          handle: 'jay',
          status: 'live',
          paneTitle: 'Boxscore mattstack integration',
        },
        { handle: 'max', status: 'idle', cwd: '/x/repo-tools', branch: 'main' },
        { handle: 'kai', status: 'offline', signedOutAt: now - 60_000 },
      ]}
    />
  );
  await userEvent.click(screen.getByTestId('members-chip'));
  expect(await screen.findByTestId('members-row-jay')).toHaveTextContent(
    'Boxscore mattstack integration'
  );
  expect(screen.getByTestId('members-row-max')).toHaveTextContent(
    'repo-tools · main'
  );
  expect(screen.getByTestId('members-row-kai')).toBeInTheDocument();
  // No fanned-out task chips on the bar any more, and no join-order select.
  expect(screen.queryByTestId('chip-task-jay')).toBeNull();
  expect(screen.queryByTestId('room-order')).toBeNull();
});

test('the ⋯ menu offers Close for a channel, with no confirm', async () => {
  const onClose = vi.fn();
  renderWithProviders(
    <RoomMenu
      room={{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }}
      onClose={onClose}
    />
  );
  await userEvent.click(screen.getByTestId('room-menu'));
  const item = await screen.findByTestId('room-menu-close');
  expect(item).toHaveTextContent('Close #build');
  await userEvent.click(item);
  expect(onClose).toHaveBeenCalledWith('build');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('the ⋯ menu offers Close this conversation for a DM, fleet or not', async () => {
  const onClose = vi.fn();
  const dm = {
    room: 'dm-aaaa1111bbbb',
    memberCount: 2,
    unread: 0,
    mentions: 0,
    kind: 'dm' as const,
    participants: { a: 'fred', b: 'gitq-main' },
  };
  renderWithProviders(<RoomMenu room={dm} onClose={onClose} />);
  await userEvent.click(screen.getByTestId('room-menu'));
  const item = await screen.findByTestId('room-menu-close');
  expect(item).toHaveTextContent('Close this conversation');
  await userEvent.click(item);
  expect(onClose).toHaveBeenCalledWith('dm-aaaa1111bbbb');
});

test('a closed room still shows mark read and its wake mode; nothing says archived', async () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'retro',
        memberCount: 2,
        unread: 4,
        mentions: 1,
        archivedAt: Date.now() - 3 * 86_400_000,
      }}
      buddies={[{ handle: 'fred', status: 'live' }]}
    />
  );
  expect(screen.queryByTestId('chip-archived')).toBeNull();
  expect(screen.getByTestId('mark-read-button')).toBeInTheDocument();
  expect(screen.queryByText(/archiv/i)).toBeNull();
  await userEvent.click(screen.getByTestId('members-chip'));
  expect(await screen.findByTestId('members-wakes')).toHaveTextContent(
    'wakes: mention'
  );
});

test('add agents sits before mark read, only when wired, disabled while the daemon is down', async () => {
  const onAddAgents = vi.fn();
  const room = { room: 'build', memberCount: 2, unread: 3, mentions: 0 };
  const { rerender } = renderWithProviders(
    <PageBar room={room} buddies={[]} />
  );
  expect(screen.queryByTestId('add-agents-button')).toBeNull();
  rerender(
    <PageBar
      room={room}
      buddies={[]}
      onAddAgents={onAddAgents}
      reachable={false}
    />
  );
  expect(screen.getByTestId('add-agents-button')).toBeDisabled();
  rerender(
    <PageBar
      room={room}
      buddies={[]}
      onAddAgents={onAddAgents}
      onMarkedRead={() => {}}
    />
  );
  const buttons = screen
    .getAllByRole('button')
    .map(b => b.getAttribute('data-testid'));
  expect(buttons.indexOf('add-agents-button')).toBeLessThan(
    buttons.indexOf('mark-read-button')
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Add agents to #build' })
  );
  expect(onAddAgents).toHaveBeenCalled();
});

test('the expand-all toggle flips and persists the app-wide preference', async () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }}
      buddies={[]}
    />
  );
  const toggle = screen.getByTestId('expand-all-toggle');
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(window.localStorage.getItem('chat-expand-all')).toBe('true');
});
