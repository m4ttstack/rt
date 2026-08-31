import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

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

test('no ARCHIVED section renders, and a closed room passed in is listed like any other', () => {
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 2, unread: 1, mentions: 0 },
        {
          room: 'retro',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          archivedAt: 5,
        },
      ]}
      activeRoom="retro"
    />
  );
  expect(screen.queryByText('ARCHIVED')).toBeNull();
  expect(screen.queryByTestId('archived-toggle')).toBeNull();
  expect(screen.getByTestId('room-row-retro').dataset.active).toBe('true');
  expect(screen.getByTestId('room-row-retro').style.opacity).toBe('');
});

test('the hover × closes that row without selecting it', async () => {
  const onCloseRoom = vi.fn();
  const onSelectRoom = vi.fn();
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 2, unread: 0, mentions: 0 },
        {
          room: 'dm-1',
          memberCount: 2,
          unread: 2,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'fred', b: 'gitq-main' },
        },
      ]}
      onCloseRoom={onCloseRoom}
      onSelectRoom={onSelectRoom}
    />
  );
  const close = screen.getByTestId('room-close-dm-1');
  expect(close).toHaveAttribute('aria-label', 'Close fred ↔ gitq-main');
  expect(close.style.display).toBe('none');
  await userEvent.hover(screen.getByTestId('room-row-dm-1'));
  expect(close.style.display).toBe('');
  await userEvent.click(close);
  expect(onCloseRoom).toHaveBeenCalledWith('dm-1');
  expect(onSelectRoom).not.toHaveBeenCalled();
  expect(screen.getByTestId('room-close-build')).toHaveAttribute(
    'aria-label',
    'Close #build'
  );
});

test('a left click selects the row and never opens its menu', async () => {
  const onCloseRoom = vi.fn();
  const onSelectRoom = vi.fn();
  renderWithProviders(
    <RoomRail
      rooms={[{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }]}
      onCloseRoom={onCloseRoom}
      onSelectRoom={onSelectRoom}
    />
  );
  const row = screen.getByTestId('room-row-build');
  await userEvent.click(row);
  expect(onSelectRoom).toHaveBeenCalledWith('build');
  expect(screen.queryByTestId('room-context-build')).toBeNull();

  fireEvent.contextMenu(row);
  expect(await screen.findByTestId('room-context-build')).toBeInTheDocument();
});

test('right-click opens a menu for that row: Mark read with its count, then Close', async () => {
  const onCloseRoom = vi.fn();
  const onMarkRead = vi.fn();
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 2, unread: 3, mentions: 0 },
        { room: 'quiet', memberCount: 2, unread: 0, mentions: 0 },
      ]}
      onCloseRoom={onCloseRoom}
      onMarkRead={onMarkRead}
    />
  );
  fireEvent.contextMenu(screen.getByTestId('room-row-build'));
  const menu = await screen.findByTestId('room-context-build');
  expect(menu).toHaveTextContent('#build');
  expect(within(menu).getByTestId('room-context-mark-read')).toHaveTextContent(
    '3'
  );
  await userEvent.click(within(menu).getByTestId('room-context-mark-read'));
  expect(onMarkRead).toHaveBeenCalledWith('build');

  fireEvent.contextMenu(screen.getByTestId('room-row-quiet'));
  const quiet = await screen.findByTestId('room-context-quiet');
  expect(within(quiet).queryByTestId('room-context-mark-read')).toBeNull();
  await userEvent.click(within(quiet).getByTestId('room-context-close'));
  expect(onCloseRoom).toHaveBeenCalledWith('quiet');
});

test('without onCloseRoom there is no × and right-click does nothing', () => {
  renderWithProviders(
    <RoomRail
      rooms={[{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }]}
    />
  );
  expect(screen.queryByTestId('room-close-build')).toBeNull();
  fireEvent.contextMenu(screen.getByTestId('room-row-build'));
  expect(screen.queryByTestId('room-context-build')).toBeNull();
});

test('the + renders only with onNewRoom, disables with the daemon down, and fires', async () => {
  const onNewRoom = vi.fn();
  const rooms = [{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }];
  const { rerender } = renderWithProviders(<RoomRail rooms={rooms} />);
  expect(screen.queryByTestId('new-room-button')).toBeNull();
  rerender(
    <RoomRail rooms={rooms} onNewRoom={onNewRoom} daemonReachable={false} />
  );
  expect(screen.getByTestId('new-room-button')).toBeDisabled();
  rerender(<RoomRail rooms={rooms} onNewRoom={onNewRoom} />);
  await userEvent.click(screen.getByRole('button', { name: 'New room' }));
  expect(onNewRoom).toHaveBeenCalled();
});
