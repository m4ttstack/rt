import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import { PageBar } from './PageBar';
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
