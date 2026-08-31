import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import './icons';

import { PageBar, RoomMenu } from './PageBar';
import { fetchMock, installFetchMock } from './test-utils';

beforeEach(() => {
  installFetchMock();
});

test('the page bar counts the fleet, names handles behind a small count, and shows the room’s wake mode', () => {
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
  expect(screen.getByText('3 in room')).toBeInTheDocument();
  expect(screen.getByTestId('chip-live')).toHaveTextContent('2 working: a, b');
  expect(screen.getByTestId('chip-offline')).toHaveTextContent(
    '1 offline: gitq-main'
  );
  expect(screen.getByText('wakes: mention')).toBeInTheDocument();
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

test('a room with a small idle count also names its handles', () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }}
      buddies={[{ handle: 'board-fix-auth', status: 'idle' }]}
    />
  );
  expect(screen.getByTestId('chip-idle')).toHaveTextContent(
    '1 idle: board-fix-auth'
  );
});

test('daemon down: exactly two plain chips, last known and withheld', () => {
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
  expect(screen.getByText('2 in room · last known')).toBeInTheDocument();
  expect(screen.getByText('presence withheld')).toBeInTheDocument();
  expect(screen.queryByTestId('chip-live')).toBeNull();
  expect(screen.queryByTestId('chip-wakes')).toBeNull();
});

test('a DM room shows the pair as its title and wakes: all regardless of defaultWake', () => {
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
  expect(screen.getByText('wakes: all')).toBeInTheDocument();
});

test('the ⋯ menu offers Close for a channel, with no confirm', async () => {
  const onClose = vi.fn();
  renderWithProviders(
    <PageBar
      room={{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }}
      buddies={[{ handle: 'fred', status: 'live' }]}
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

test('a closed room still shows mark read and the wakes chip; nothing says archived', () => {
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
  expect(screen.getByTestId('chip-wakes')).toBeInTheDocument();
  expect(screen.getByTestId('mark-read-button')).toBeInTheDocument();
  expect(screen.queryByText(/archiv/i)).toBeNull();
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
