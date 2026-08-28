import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import { memberList, PageBar, RoomMenu } from './PageBar';
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
        { handle: 'gitq-main', status: 'deaf' },
      ]}
    />
  );
  expect(screen.getByText('4 in room')).toBeInTheDocument();
  expect(screen.getByTestId('chip-live')).toHaveTextContent(
    '2 listening: a, b'
  );
  expect(screen.getByTestId('chip-deaf')).toHaveTextContent(
    '1 deaf: gitq-main'
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

test('the ⋯ menu offers Archive with a confirm that names the members, and confirms through onArchive', async () => {
  const onArchive = vi.fn();
  renderWithProviders(
    <PageBar
      room={{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }}
      buddies={[
        { handle: 'fred', status: 'live' },
        { handle: 'gitq-main', status: 'deaf' },
      ]}
      onArchive={onArchive}
    />
  );
  await userEvent.click(screen.getByTestId('room-menu'));
  await userEvent.click(await screen.findByTestId('room-menu-archive'));
  expect(await screen.findByText('Archive #build?')).toBeInTheDocument();
  expect(
    screen.getByText(/for you and for fred and gitq-main/)
  ).toBeInTheDocument();
  expect(onArchive).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
  expect(onArchive).toHaveBeenCalledWith('build', true);
});

test('an archived room shows the archived chip, hides mark read, and its menu offers Reopen with no confirm', async () => {
  const onArchive = vi.fn();
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
      onArchive={onArchive}
    />
  );
  expect(screen.getByTestId('chip-archived')).toHaveTextContent('archived');
  expect(screen.queryByTestId('chip-wakes')).toBeNull();
  expect(screen.queryByTestId('mark-read-button')).toBeNull();
  await userEvent.click(screen.getByTestId('room-menu'));
  await userEvent.click(await screen.findByTestId('room-menu-reopen'));
  expect(onArchive).toHaveBeenCalledWith('retro', false);
  expect(screen.queryByText(/Archive #retro\?/)).toBeNull();
});

const fleetDm = {
  room: 'dm-aaaa1111bbbb',
  memberCount: 2,
  unread: 0,
  mentions: 0,
  kind: 'dm' as const,
  participants: { a: 'fred', b: 'gitq-main' },
};

test('an open fleet DM renders no ⋯ trigger at all (its only action would be a hidden Archive)', () => {
  const onArchive = vi.fn();
  renderWithProviders(
    <RoomMenu
      room={{ ...fleetDm, joined: false }}
      memberHandles={['fred', 'gitq-main']}
      onArchive={onArchive}
    />
  );
  expect(screen.queryByTestId('room-menu')).toBeNull();
});

test('an open non-fleet room still renders the ⋯ trigger with Archive', async () => {
  const onArchive = vi.fn();
  renderWithProviders(
    <RoomMenu
      room={{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }}
      memberHandles={['fred']}
      onArchive={onArchive}
    />
  );
  await userEvent.click(screen.getByTestId('room-menu'));
  expect(await screen.findByTestId('room-menu-archive')).toBeInTheDocument();
});

test('an archived fleet DM still renders the ⋯ trigger with Reopen', async () => {
  const onArchive = vi.fn();
  renderWithProviders(
    <RoomMenu
      room={{
        ...fleetDm,
        joined: false,
        archivedAt: Date.now() - 86_400_000,
      }}
      memberHandles={['fred', 'gitq-main']}
      onArchive={onArchive}
    />
  );
  await userEvent.click(screen.getByTestId('room-menu'));
  expect(await screen.findByTestId('room-menu-reopen')).toBeInTheDocument();
  expect(screen.queryByTestId('room-menu-archive')).toBeNull();
});

test('the ⋯ menu keeps Archive for the human’s own DM', async () => {
  const onArchive = vi.fn();
  renderWithProviders(
    <RoomMenu
      room={{ ...fleetDm, participants: { a: 'fred', b: 'matt' } }}
      memberHandles={['fred', 'matt']}
      onArchive={onArchive}
    />
  );
  await userEvent.click(screen.getByTestId('room-menu'));
  expect(await screen.findByTestId('room-menu-archive')).toBeInTheDocument();
});

test('memberList reads like a sentence and caps at three names', () => {
  expect(memberList([])).toBe('');
  expect(memberList(['fred'])).toBe('fred');
  expect(memberList(['fred', 'gitq'])).toBe('fred and gitq');
  expect(memberList(['a', 'b', 'c', 'd'])).toBe('a, b, c and d');
  expect(memberList(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more');
});
