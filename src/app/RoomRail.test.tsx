import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';

import './icons';

import { RoomRail } from './RoomRail';

test('mention badges are visually distinct from plain unread', () => {
  renderWithProviders(
    <RoomRail
      rooms={[{ room: 'build', memberCount: 3, unread: 4, mentions: 1 }]}
    />
  );
  // the glyph is the difference, not the colour
  expect(screen.getByLabelText('1 mention')).toHaveTextContent('@1');
  expect(screen.getByLabelText('4 unread')).toHaveTextContent('4');
});

test('DM rooms sit in a direct section and are named by their pair, never the hash', () => {
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 3, unread: 0, mentions: 0 },
        {
          room: 'dm-9f3a2b1c0d4e',
          memberCount: 3,
          unread: 1,
          mentions: 1,
          kind: 'dm',
          participants: { a: 'deck-main', b: 'rt-chat-wt' },
        },
      ]}
    />
  );
  expect(screen.getByRole('heading', { name: /direct/i })).toBeInTheDocument();
  // textContent, not getByText: the artboard's `.pair` splits the name into
  // three spans so `.arrows` can carry its own colour, and getByText reads
  // only an element's DIRECT text children. Scoping to the row asserts more
  // than the plan's original line did -- that THIS row is named by its pair.
  expect(screen.getByTestId('room-row-dm-9f3a2b1c0d4e')).toHaveTextContent(
    'deck-main ↔ rt-chat-wt'
  );
  expect(screen.queryByText(/dm-9f3a/)).toBeNull();
});

test('the active room carries the accent wash, and clicking a row selects it', () => {
  const onSelectRoom = vi.fn();
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 3, unread: 0, mentions: 0 },
        { room: 'repo-tools', memberCount: 2, unread: 0, mentions: 0 },
      ]}
      activeRoom="build"
      onSelectRoom={onSelectRoom}
    />
  );
  expect(screen.getByTestId('room-row-build').dataset.active).toBe('true');
  expect(
    screen.getByTestId('room-row-repo-tools').dataset.active
  ).toBeUndefined();

  screen.getByTestId('room-row-repo-tools').click();
  expect(onSelectRoom).toHaveBeenCalledWith('repo-tools');
});

test('a room with neither mentions nor unread renders no badges', () => {
  renderWithProviders(
    <RoomRail
      rooms={[{ room: 'repo-tools', memberCount: 3, unread: 0, mentions: 0 }]}
    />
  );
  expect(screen.queryByTestId('mention-badge')).toBeNull();
  expect(screen.queryByTestId('unread-badge')).toBeNull();
});

test('no DM rooms means no direct section at all', () => {
  renderWithProviders(
    <RoomRail
      rooms={[{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }]}
    />
  );
  expect(screen.queryByRole('heading', { name: /direct/i })).toBeNull();
});

afterEach(() => window.localStorage.removeItem('chat.rail.archived'));

test('archived rooms sit in a collapsed section, badge-less and dimmed, and the toggle remembers itself', async () => {
  const { unmount } = renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 2, unread: 1, mentions: 0 },
        {
          room: 'retro',
          memberCount: 2,
          unread: 3,
          mentions: 1,
          archivedAt: 5,
        },
        {
          room: 'dm-1',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'fred', b: 'matt' },
          archivedAt: 6,
        },
      ]}
      activeRoom="build"
    />
  );
  expect(screen.getByText('ROOMS').nextSibling).toHaveTextContent('1');
  expect(screen.queryByTestId('room-row-retro')).toBeNull();
  const toggle = screen.getByTestId('archived-toggle');
  expect(toggle).toHaveTextContent('ARCHIVED');
  expect(toggle).toHaveTextContent('2');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await userEvent.click(toggle);
  const row = screen.getByTestId('room-row-retro');
  expect(row).toHaveAttribute('data-archived', 'true');
  expect(row.style.opacity).toBe('0.6');
  expect(within(row).queryByTestId('unread-badge')).toBeNull();
  expect(within(row).queryByTestId('mention-badge')).toBeNull();
  expect(screen.getByTestId('room-row-dm-1')).toHaveTextContent('fred');

  unmount();
  renderWithProviders(
    <RoomRail
      rooms={[
        {
          room: 'retro',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          archivedAt: 5,
        },
      ]}
    />
  );
  expect(screen.getByTestId('archived-toggle')).toHaveAttribute(
    'aria-expanded',
    'true'
  );
});

test('no archived rooms means no archived section', () => {
  renderWithProviders(
    <RoomRail
      rooms={[{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }]}
    />
  );
  expect(screen.queryByTestId('archived-toggle')).toBeNull();
});
